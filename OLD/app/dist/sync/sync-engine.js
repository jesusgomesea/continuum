import { setTimeout as aguardar } from 'node:timers/promises';
import { calcularEspera } from './backoff.js';
import { enviarLote } from './cliente-nuvem.js';
/**
 * Sync Engine (ADR 011): envia a outbox para a cloud-api em lotes pela seq e
 * só marca como sincronizado o que a nuvem confirmou. Erro temporário se
 * repete com backoff; erro do evento ou da origem bloqueia a fila, fica
 * consultável em `bloqueio()` e é registrado no registro geral.
 */
export class SyncEngine {
    #outbox;
    #registro;
    #cliente;
    #tamanhoLote;
    #backoff;
    #esperaOciosaMs;
    #aleatorio;
    #bloqueio = null;
    /** Falhas temporárias seguidas, para o backoff. */
    #falhasSeguidas = 0;
    /** Depois de um 400/413: o evento envenenado está entre os primeiros `#suspeitos` pendentes. */
    #suspeitos = null;
    /** Depois de um 409 com lacuna: reenviar a partir desta seq, mesmo já marcada. */
    #retomarDe = null;
    /** ultimaSeq do 409 anterior; um segundo 409 seguido no mesmo ponto é origem divergente. */
    #ultimo409 = null;
    #ocupado = false;
    #laco = null;
    #parada = null;
    constructor(opcoes) {
        this.#outbox = opcoes.outbox;
        this.#registro = opcoes.registro;
        this.#cliente = { urlBase: opcoes.urlBase, timeoutMs: opcoes.timeoutMs ?? 10_000 };
        this.#tamanhoLote = opcoes.tamanhoLote ?? 100;
        this.#backoff = opcoes.backoff ?? { inicialMs: 1000, maximoMs: 60_000 };
        this.#esperaOciosaMs = opcoes.esperaOciosaMs ?? 1000;
        this.#aleatorio = opcoes.aleatorio ?? Math.random;
        if (!Number.isSafeInteger(this.#tamanhoLote) || this.#tamanhoLote < 1) {
            throw new RangeError(`tamanhoLote inválido: ${this.#tamanhoLote}`);
        }
    }
    /** null com a fila livre; senão, o motivo do bloqueio. Lê outbox_falhas, que sobrevive à reinicialização. */
    bloqueio() {
        if (this.#bloqueio === null) {
            const falha = this.#outbox.falhas()[0];
            if (falha !== undefined) {
                this.#bloqueio = Object.freeze({ motivo: 'evento', ...dadosDaFalha(falha) });
            }
        }
        return this.#bloqueio;
    }
    /** Um passo: no máximo um envio para a nuvem. Não espera o backoff; quem decide é o laço. */
    async sincronizarUmaVez() {
        if (this.#ocupado) {
            throw new Error('sync engine: passo já em andamento');
        }
        this.#ocupado = true;
        try {
            return await this.#passo();
        }
        finally {
            this.#ocupado = false;
        }
    }
    async #passo() {
        const bloqueio = this.bloqueio();
        if (bloqueio !== null) {
            return { tipo: 'bloqueado', bloqueio };
        }
        const lote = this.#montarLote();
        const primeiro = lote[0];
        const ultimo = lote.at(-1);
        if (primeiro === undefined || ultimo === undefined) {
            return { tipo: 'vazio' };
        }
        const resposta = await enviarLote(this.#cliente, this.#outbox.origemId, lote);
        if (resposta.classe !== 'temporario') {
            this.#falhasSeguidas = 0;
        }
        if (resposta.classe !== 'fora-de-ordem') {
            this.#ultimo409 = null;
        }
        switch (resposta.classe) {
            case 'confirmado': {
                const marcados = this.#outbox.marcarSincronizados(resposta.ultimaSeq);
                if (this.#suspeitos !== null) {
                    const restantes = this.#suspeitos - lote.length;
                    this.#suspeitos = restantes > 0 ? restantes : null;
                }
                if (this.#retomarDe !== null) {
                    const pendente = this.#outbox.pendentes(1)[0];
                    const proxima = resposta.ultimaSeq + 1;
                    this.#retomarDe = pendente !== undefined && proxima < pendente.seq ? proxima : null;
                }
                return { tipo: 'confirmado', ultimaSeq: resposta.ultimaSeq, marcados };
            }
            case 'temporario': {
                this.#falhasSeguidas += 1;
                const esperaMs = calcularEspera(this.#falhasSeguidas, this.#backoff, this.#aleatorio);
                return { tipo: 'temporario', erro: resposta.erro, esperaMs };
            }
            case 'fora-de-ordem': {
                if (this.#ultimo409 === resposta.ultimaSeq) {
                    // Já retomamos deste ponto e a nuvem recusou de novo: o que ela tem
                    // desta origem diverge do que está aqui. Não é culpa de um evento.
                    this.#ultimo409 = null;
                    return this.#bloquearOrigem('origem-divergente', 409, resposta.erro, { ultimaSeq: resposta.ultimaSeq });
                }
                this.#ultimo409 = resposta.ultimaSeq;
                this.#suspeitos = null;
                // Lacuna: a nuvem está atrás do que já foi marcado aqui; reenviar de lá.
                this.#retomarDe = resposta.ultimaSeq + 1 < primeiro.seq ? resposta.ultimaSeq + 1 : null;
                return { tipo: 'reenviar' };
            }
            case 'lote-recusado': {
                if (lote.length === 1) {
                    return this.#bloquearEvento(primeiro, resposta.status, resposta.erro);
                }
                this.#suspeitos = lote.length;
                return { tipo: 'reenviar' };
            }
            case 'origem-recusada':
                return this.#bloquearOrigem('origem', resposta.status, resposta.erro);
        }
    }
    /** Bloqueio sem culpar evento: nada vai para outbox_falhas, e vale até reiniciar. */
    #bloquearOrigem(motivo, status, erro, extra = {}) {
        const tipo = motivo === 'origem' ? 'sync.origem-recusada' : 'sync.origem-divergente';
        this.#registro.registrar(tipo, { origemId: this.#outbox.origemId, status, erro, ...extra });
        this.#suspeitos = null;
        this.#retomarDe = null;
        this.#bloqueio = Object.freeze({ motivo, status, erro });
        return { tipo: 'bloqueado', bloqueio: this.#bloqueio };
    }
    /** Os próximos eventos a enviar: metade dos suspeitos, ou a retomada, ou os pendentes. */
    #montarLote() {
        const limite = this.#suspeitos === null ? this.#tamanhoLote : Math.max(1, Math.floor(this.#suspeitos / 2));
        if (this.#retomarDe !== null) {
            return this.#outbox.listar(this.#retomarDe).slice(0, limite);
        }
        return this.#outbox.pendentes(limite);
    }
    #bloquearEvento(evento, status, erro) {
        // Registra antes de gravar a falha: uma queda entre os dois faz o evento
        // ser reenviado e registrado de novo, em vez de bloquear sem aviso.
        this.#registro.registrar('sync.evento-recusado', {
            origemId: this.#outbox.origemId,
            seq: evento.seq,
            id: evento.id,
            status,
            erro,
        });
        const falha = this.#outbox.registrarFalha(evento.seq, status, erro);
        this.#suspeitos = null;
        this.#retomarDe = null;
        this.#ultimo409 = null;
        this.#bloqueio = Object.freeze({ motivo: 'evento', ...dadosDaFalha(falha) });
        return { tipo: 'bloqueado', bloqueio: this.#bloqueio };
    }
    /** Começa o laço: repete os passos, esperando o backoff ou a espera ociosa entre eles. */
    iniciar() {
        if (this.#laco !== null) {
            return;
        }
        const parada = new AbortController();
        this.#parada = parada;
        this.#laco = this.#rodar(parada.signal);
    }
    /** Para o laço, sem esperar o backoff em curso, e espera o passo atual terminar. */
    async parar() {
        this.#parada?.abort();
        await this.#laco;
        this.#laco = null;
        this.#parada = null;
    }
    async #rodar(sinal) {
        while (!sinal.aborted) {
            let esperaMs;
            try {
                const resultado = await this.sincronizarUmaVez();
                esperaMs =
                    resultado.tipo === 'temporario'
                        ? resultado.esperaMs
                        : resultado.tipo === 'vazio' || resultado.tipo === 'bloqueado'
                            ? this.#esperaOciosaMs
                            : 0;
            }
            catch (erro) {
                // Erro local inesperado (ex.: banco ocupado): conta como temporário.
                console.error('sync engine:', erro);
                this.#falhasSeguidas += 1;
                esperaMs = calcularEspera(this.#falhasSeguidas, this.#backoff, this.#aleatorio);
            }
            if (esperaMs > 0) {
                await aguardar(esperaMs, undefined, { signal: sinal }).catch(() => undefined);
            }
        }
    }
}
function dadosDaFalha(falha) {
    return { seq: falha.seq, id: falha.id, status: falha.status, erro: falha.erro };
}
//# sourceMappingURL=sync-engine.js.map