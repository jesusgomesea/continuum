// Sync Engine: leva a fila para o próximo elo, em ordem, em lotes, sem duplicar e sem perder.
// Reconstruído de OLD/app/dist/sync/sync-engine.js (ADR 011), agora com a máquina de estados junto.
//
// - Só marca "sincronizado" o que o destino confirmou ("recebido até a seq N").
// - Falha de rede: tenta de novo, esperando cada vez mais (backoff), e a máquina de estados vai
//   para DEGRADADO e, confirmada a queda, OFFLINE. A loja continua vendendo; a fila só cresce.
// - Lote recusado: divide ao meio até achar o evento torto, que vai para outbox_falhas e bloqueia a fila.
// - Fora de ordem (o destino perdeu algo): reenvia a partir do que o destino tem.
import type { Evento } from '@continuum/contratos';
import { setTimeout as aguardar } from 'node:timers/promises';
import { aplicarEvidencia, calcularEspera, PARAMETROS_PADRAO, SITUACAO_INICIAL, syncEnvia } from './estados.ts';
import type { Evidencia, ParametrosDosEstados, Situacao, Transicao } from './estados.ts';
import type { EventoNaFila, Fila } from './fila.ts';
import type { Transporte } from './transporte.ts';

export type Bloqueio =
  | { motivo: 'evento'; seq: number; status: number; erro: string }
  | { motivo: 'origem'; status: number; erro: string };

export type ResultadoDoPasso =
  | { tipo: 'confirmado'; ultimaSeq: number; marcados: number }
  | { tipo: 'temporario'; erro: string; esperaMs: number }
  | { tipo: 'reenviar' }
  | { tipo: 'vazio' }
  | { tipo: 'saude'; ok: boolean }
  | { tipo: 'bloqueado'; bloqueio: Bloqueio };

export interface OpcoesDoMotor {
  fila: Fila;
  transporte: Transporte;
  /** Quem envia: o id do dispositivo (caixa ou agente). */
  origemId: string;
  tamanhoLote?: number;
  backoff?: { inicialMs: number; maximoMs: number };
  /** Espera entre passos quando não há nada a enviar. */
  esperaOciosaMs?: number;
  parametros?: ParametrosDosEstados;
  aleatorio?: () => number;
  /** Avisado a cada mudança de estado (para a tela e o sinal de vida). */
  aoMudarEstado?: (situacao: Situacao, transicao: Transicao) => void;
}

export class MotorDeSync {
  #o: Required<Omit<OpcoesDoMotor, 'aoMudarEstado'>> & Pick<OpcoesDoMotor, 'aoMudarEstado'>;
  #situacao: Situacao = SITUACAO_INICIAL;
  #bloqueioOrigem: Bloqueio | null = null;
  #falhasSeguidas = 0;
  /** Depois de lote recusado: o evento torto está entre os primeiros `suspeitos` pendentes. */
  #suspeitos: number | null = null;
  /** Depois de "fora de ordem": reenviar a partir desta seq, mesmo já marcada. */
  #retomarDe: number | null = null;
  #ultimoErro: string | null = null;
  #ultimoSucessoEm: string | null = null;
  #ocupado = false;
  #laco: Promise<void> | null = null;
  #parada: AbortController | null = null;

  constructor(opcoes: OpcoesDoMotor) {
    this.#o = {
      tamanhoLote: 100,
      backoff: { inicialMs: 1000, maximoMs: 60_000 },
      esperaOciosaMs: 2000,
      parametros: PARAMETROS_PADRAO,
      aleatorio: Math.random,
      ...opcoes,
    };
  }

  situacao(): Situacao {
    return this.#situacao;
  }

  /** O retrato para a tela e o sinal de vida. */
  resumo() {
    return {
      estado: this.#situacao.estado,
      pendentes: this.#o.fila.contarPendentes(),
      bloqueio: this.bloqueio(),
      ultimoErro: this.#ultimoErro,
      ultimoSucessoEm: this.#ultimoSucessoEm,
    };
  }

  /** null com a fila livre; senão, o motivo. A falha de evento fica no banco e sobrevive a reinícios. */
  bloqueio(): Bloqueio | null {
    if (this.#bloqueioOrigem !== null) return this.#bloqueioOrigem;
    const falha = this.#o.fila.falhas()[0];
    return falha === undefined ? null : { motivo: 'evento', seq: falha.seq, status: falha.status, erro: falha.erro };
  }

  #evidencia(e: Evidencia): void {
    const { situacao, transicao } = aplicarEvidencia(this.#situacao, e, this.#o.parametros);
    this.#situacao = situacao;
    if (transicao !== null) this.#o.aoMudarEstado?.(situacao, transicao);
  }

  /** Um passo: no máximo um envio (ou uma consulta de saúde). */
  async sincronizarUmaVez(): Promise<ResultadoDoPasso> {
    if (this.#ocupado) throw new Error('sync: passo já em andamento');
    this.#ocupado = true;
    try {
      return await this.#passo();
    } finally {
      this.#ocupado = false;
    }
  }

  async #passo(): Promise<ResultadoDoPasso> {
    const bloqueio = this.bloqueio();
    if (bloqueio !== null) return { tipo: 'bloqueado', bloqueio };

    const lote = syncEnvia(this.#situacao.estado) ? this.#montarLote() : [];
    if (lote.length === 0) {
      // Nada a enviar (ou em OFFLINE/RECUPERANDO): a consulta de saúde é a evidência.
      const ok = await this.#o.transporte.verificarSaude();
      this.#registrarResultado(ok, ok ? null : 'destino fora do ar');
      if (!ok) return { tipo: 'temporario', erro: 'destino fora do ar', esperaMs: this.#espera() };
      return syncEnvia(this.#situacao.estado) && this.#o.fila.contarPendentes() === 0 ? { tipo: 'vazio' } : { tipo: 'saude', ok };
    }

    const primeiro = lote[0] as EventoNaFila;
    // Só os campos do contrato viajam (a marca "sincronizado" é assunto deste caixa).
    const envio = lote.map(({ sincronizadoEm: _s, ...evento }) => evento as Evento);
    const resposta = await this.#o.transporte.enviarLote(this.#o.origemId, envio);
    switch (resposta.classe) {
      case 'confirmado': {
        const marcados = this.#o.fila.marcarSincronizados(resposta.ultimaSeq);
        if (this.#suspeitos !== null) {
          const restantes = this.#suspeitos - lote.length;
          this.#suspeitos = restantes > 0 ? restantes : null;
        }
        if (this.#retomarDe !== null) {
          const pendente = this.#o.fila.pendentes(1)[0];
          const proxima = resposta.ultimaSeq + 1;
          this.#retomarDe = pendente !== undefined && proxima < pendente.seq ? proxima : null;
        }
        this.#registrarResultado(true, null);
        return { tipo: 'confirmado', ultimaSeq: resposta.ultimaSeq, marcados };
      }
      case 'temporario':
        this.#registrarResultado(false, resposta.erro);
        return { tipo: 'temporario', erro: resposta.erro, esperaMs: this.#espera() };
      case 'fora-de-ordem':
        this.#suspeitos = null;
        this.#retomarDe = resposta.ultimaSeq + 1 < primeiro.seq ? resposta.ultimaSeq + 1 : null;
        if (this.#retomarDe === null) {
          // O destino diz ter menos do que mandamos, mas não há o que reenviar daqui: origem divergente.
          this.#bloqueioOrigem = { motivo: 'origem', status: 409, erro: resposta.erro };
          return { tipo: 'bloqueado', bloqueio: this.#bloqueioOrigem };
        }
        return { tipo: 'reenviar' };
      case 'lote-recusado': {
        if (lote.length === 1) {
          this.#o.fila.registrarFalha(primeiro.seq, resposta.status, resposta.erro);
          this.#suspeitos = null;
          this.#retomarDe = null;
          const b = this.bloqueio() as Bloqueio;
          return { tipo: 'bloqueado', bloqueio: b };
        }
        this.#suspeitos = lote.length;
        return { tipo: 'reenviar' };
      }
      case 'origem-recusada':
        this.#bloqueioOrigem = { motivo: 'origem', status: resposta.status, erro: resposta.erro };
        return { tipo: 'bloqueado', bloqueio: this.#bloqueioOrigem };
    }
  }

  #registrarResultado(ok: boolean, erro: string | null): void {
    if (ok) {
      this.#falhasSeguidas = 0;
      this.#ultimoErro = null;
      this.#ultimoSucessoEm = new Date().toISOString();
      const pendentes = this.#o.fila.contarPendentes();
      this.#evidencia({ tipo: 'sucesso', pendentes });
      this.#evidencia({ tipo: 'fila', pendentes });
    } else {
      this.#falhasSeguidas += 1;
      this.#ultimoErro = erro;
      this.#evidencia({ tipo: 'falha' });
    }
  }

  #espera(): number {
    return calcularEspera(Math.max(1, this.#falhasSeguidas), this.#o.backoff, this.#o.aleatorio);
  }

  #montarLote(): EventoNaFila[] {
    const limite = this.#suspeitos === null ? this.#o.tamanhoLote : Math.max(1, Math.floor(this.#suspeitos / 2));
    return this.#retomarDe !== null ? this.#o.fila.aPartirDe(this.#retomarDe, limite) : this.#o.fila.pendentes(limite);
  }

  /** Começa a enviar sozinho, repetindo os passos, até `parar()`. */
  iniciar(): void {
    if (this.#laco !== null) return;
    const parada = new AbortController();
    this.#parada = parada;
    this.#laco = this.#rodar(parada.signal);
  }

  async parar(): Promise<void> {
    this.#parada?.abort();
    await this.#laco;
    this.#laco = null;
    this.#parada = null;
  }

  async #rodar(sinal: AbortSignal): Promise<void> {
    while (!sinal.aborted) {
      let esperaMs: number;
      try {
        const r = await this.sincronizarUmaVez();
        esperaMs = r.tipo === 'temporario' ? r.esperaMs : r.tipo === 'confirmado' || r.tipo === 'reenviar' ? 0 : this.#o.esperaOciosaMs;
      } catch (erro) {
        // Erro local inesperado (ex.: banco ocupado): conta como falha temporária.
        this.#registrarResultado(false, (erro as Error).message);
        esperaMs = this.#espera();
      }
      if (esperaMs > 0) await aguardar(esperaMs, undefined, { signal: sinal }).catch(() => undefined);
    }
  }
}
