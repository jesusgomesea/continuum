import { setTimeout as aguardar } from 'node:timers/promises';
import { contextoDoErro } from '../banco/sqlite.js';
import { alertaDoEstado, fonteDeEvidencia, syncEnvia } from './maquina-de-estados.js';
/** Enquanto um erro local se repete, um resumo a cada este intervalo. */
const RESUMO_REPETICAO_MS = 30_000;
/** Como cada tipo de erro aparece no log. */
const ROTULO = {
    'health check': 'erro local no health check',
    sync: 'erro local no sync',
    envio: 'falha temporária no envio à nuvem',
};
const segundos = (ms) => `${(ms / 1000).toFixed(1)} s`;
/**
 * Junta o health check, o Sync Engine e a máquina de estados (ADR 012):
 * - o sync só envia nos estados que permitem e nunca em LOCAL FORÇADO;
 * - uma fonte de evidência por vez: o sync quando está enviando, o health
 *   check nos outros casos;
 * - bloqueio da fila não muda o estado, mas é gravado e alertado.
 */
export class Orquestrador {
    #estado;
    #outbox;
    #engine;
    #verificarSaude;
    #intervaloHealthMs;
    #esperaOciosaMs;
    #log;
    /** Chave do último bloqueio gravado, para não regravar a cada passo. */
    #bloqueioGravado;
    /** Erro local que está se repetindo, por laço: mostrado uma vez, depois só contado. */
    #repeticoes = new Map();
    #parada = null;
    #lacos = [];
    constructor(opcoes) {
        this.#estado = opcoes.estado;
        this.#outbox = opcoes.outbox;
        this.#engine = opcoes.engine;
        this.#verificarSaude = opcoes.verificarSaude;
        this.#intervaloHealthMs = opcoes.intervaloHealthMs;
        this.#esperaOciosaMs = opcoes.esperaOciosaMs ?? 1000;
        this.#log = opcoes.log ?? ((linha) => process.stderr.write(`${linha}\n`));
    }
    /** Um health check. O resultado só move os contadores quando o sync não está enviando. */
    async passoHealthCheck() {
        const resultado = await this.#verificarSaude();
        const bloqueada = this.#atualizarBloqueio(this.#engine.bloqueio());
        const pendentes = this.#outbox.contarPendentes();
        const situacao = this.#estado.ler();
        if (fonteDeEvidencia(situacao, { pendentes, bloqueada }) === 'health-check') {
            this.#aplicar(resultado.ok ? { tipo: 'sucesso', pendentes } : { tipo: 'falha' });
        }
        if (this.#estado.ler().estado === 'sincronizando') {
            this.#aplicar({ tipo: 'fila', pendentes });
        }
        return resultado;
    }
    /** Um passo do sync, se o estado e o modo permitirem e houver o que enviar; null se não enviou. */
    async passoSync() {
        const situacao = this.#estado.ler();
        if (!syncEnvia(situacao.estado, situacao.modo)) {
            return null;
        }
        if (this.#atualizarBloqueio(this.#engine.bloqueio()) || this.#outbox.contarPendentes() === 0) {
            return null;
        }
        const resultado = await this.#engine.sincronizarUmaVez();
        if (resultado.tipo === 'confirmado') {
            this.#encerrarRepeticao('envio');
            const pendentes = this.#outbox.contarPendentes();
            this.#aplicar({ tipo: 'sucesso', pendentes });
            this.#aplicar({ tipo: 'fila', pendentes });
        }
        else if (resultado.tipo === 'temporario') {
            // O motivo (rede, timeout ou 5xx) aparece no log, uma vez por sequência igual.
            this.#registrarErro('envio', new Error(resultado.erro));
            this.#aplicar({ tipo: 'falha' });
        }
        else if (resultado.tipo === 'bloqueado') {
            this.#atualizarBloqueio(resultado.bloqueio);
        }
        return resultado;
    }
    /** Começa os dois laços: health check a cada intervalo e o sync. */
    iniciar() {
        if (this.#parada !== null) {
            return;
        }
        const parada = new AbortController();
        this.#parada = parada;
        this.#lacos = [this.#lacoHealthCheck(parada.signal), this.#lacoSync(parada.signal)];
    }
    /** Para os laços sem esperar intervalos em curso e espera o passo atual terminar. */
    async parar() {
        this.#parada?.abort();
        await Promise.all(this.#lacos);
        this.#parada = null;
        this.#lacos = [];
        this.#encerrarRepeticao('health check');
        this.#encerrarRepeticao('sync');
        this.#encerrarRepeticao('envio');
    }
    async #lacoHealthCheck(sinal) {
        while (!sinal.aborted) {
            await this.#protegido('health check', () => this.passoHealthCheck());
            await esperar(this.#intervaloHealthMs, sinal);
        }
    }
    async #lacoSync(sinal) {
        while (!sinal.aborted) {
            const resultado = await this.#protegido('sync', () => this.passoSync());
            const esperaMs = resultado === undefined || resultado === null || resultado.tipo === 'vazio' || resultado.tipo === 'bloqueado'
                ? this.#esperaOciosaMs
                : resultado.tipo === 'temporario'
                    ? resultado.esperaMs
                    : 0;
            if (esperaMs > 0) {
                await esperar(esperaMs, sinal);
            }
        }
    }
    /**
     * Erro local inesperado (ex.: database is locked além do busy_timeout): loga e
     * segue no próximo ciclo. Nunca vira evidência: não diz nada sobre a nuvem, e
     * contá-lo como falha daria um OFFLINE falso sob carga alta (ADR 012). Falha
     * da nuvem só sai do cliente HTTP (cliente-nuvem.ts e health-check.ts).
     */
    async #protegido(nome, passo) {
        try {
            const resultado = await passo();
            this.#encerrarRepeticao(nome);
            return resultado;
        }
        catch (erro) {
            this.#registrarErro(nome, erro);
            return undefined;
        }
    }
    /**
     * Mostra o erro uma vez, com banco, comando e espera (contextoDoErro). Os
     * iguais seguintes só contam; o total sai quando o erro some ou muda, e a
     * cada RESUMO_REPETICAO_MS enquanto continuar.
     */
    #registrarErro(nome, erro) {
        const contexto = contextoDoErro(erro);
        const mensagem = erro instanceof Error ? erro.message : String(erro);
        const onde = contexto === undefined ? '' : ` (banco ${contexto.banco}, comando "${contexto.sql}")`;
        const chave = `${mensagem}${onde}`;
        const esperaMs = contexto?.esperaMs ?? 0;
        const agora = Date.now();
        const atual = this.#repeticoes.get(nome);
        if (atual?.chave === chave) {
            atual.vezes += 1;
            atual.maiorEsperaMs = Math.max(atual.maiorEsperaMs, esperaMs);
            if (agora - atual.avisadoEm >= RESUMO_REPETICAO_MS) {
                this.#log(`[continuum] ${ROTULO[nome]} continua: ${atual.vezes} vezes em ${segundos(agora - atual.desde)}`);
                atual.avisadoEm = agora;
            }
            return;
        }
        this.#encerrarRepeticao(nome);
        const espera = contexto === undefined ? '' : ` após ${esperaMs} ms`;
        this.#log(`[continuum] ${ROTULO[nome]}: ${mensagem}${onde}${espera}`);
        this.#repeticoes.set(nome, { chave, vezes: 1, desde: agora, avisadoEm: agora, maiorEsperaMs: esperaMs });
    }
    #encerrarRepeticao(nome) {
        const atual = this.#repeticoes.get(nome);
        if (atual === undefined)
            return;
        this.#repeticoes.delete(nome);
        if (atual.vezes > 1) {
            this.#log(`[continuum] ${ROTULO[nome]} se repetiu ${atual.vezes} vezes em ${segundos(Date.now() - atual.desde)}` +
                (atual.maiorEsperaMs > 0 ? ` (maior espera: ${atual.maiorEsperaMs} ms)` : ''));
        }
    }
    #aplicar(evidencia) {
        const efeito = this.#estado.aplicar(evidencia);
        if (efeito.transicao !== null) {
            const { de, para, motivo } = efeito.transicao;
            const alerta = alertaDoEstado(para);
            this.#log(`[continuum] ${de} -> ${para} (${motivo})${alerta === 'nenhum' ? '' : ` alerta ${alerta}`}`);
        }
        if (efeito.propostaNova !== null) {
            const { de, para, motivo } = efeito.propostaNova;
            this.#log(`[continuum] proposta em MANUAL: ${de} -> ${para} (${motivo}); confirme com "continuum confirmar"`);
        }
        return efeito;
    }
    /** Grava o bloqueio se mudou e alerta se for novo. Devolve se a fila está bloqueada. */
    #atualizarBloqueio(bloqueio) {
        const chave = bloqueio === null ? 'livre' : JSON.stringify(bloqueio);
        if (chave !== this.#bloqueioGravado) {
            if (this.#estado.registrarBloqueio(bloqueio) && bloqueio !== null) {
                this.#log(`[continuum] alerta: fila bloqueada (${bloqueio.motivo}, status ${bloqueio.status}): ${bloqueio.erro}`);
            }
            this.#bloqueioGravado = chave;
        }
        return bloqueio !== null;
    }
}
async function esperar(ms, sinal) {
    await aguardar(ms, undefined, { signal: sinal }).catch(() => undefined);
}
//# sourceMappingURL=orquestrador.js.map