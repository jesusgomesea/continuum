// Liga o caixa ao agente da loja: o Sync Engine leva a fila e, a cada 15 segundos, sai o sinal de vida.
// Se o agente estiver fora do ar, o caixa continua vendendo normalmente: a fila só cresce e a faixa
// de estado mostra DEGRADADO e depois OFFLINE. Quando o agente volta, tudo chega, em ordem.
import { MotorDeSync, transporteHttp } from '@continuum/sync';
import type { Transporte } from '@continuum/sync';
import type { Caixa } from './caixa.ts';
import { ligarDescida } from './descida.ts';

export const VERSAO_DO_PDV = '0.1.0';
export const INTERVALO_SINAL_MS = 15_000;
/** Endereço padrão do agente: no mesmo computador (formato MEI ou teste). */
export const AGENTE_PADRAO = 'http://127.0.0.1:5180';

export type ResumoDaSincronizacao = ReturnType<MotorDeSync['resumo']> & { destino: string };

export interface Sincronizacao {
  resumo(): ResumoDaSincronizacao;
  /** Manda o sinal de vida agora (além do automático a cada 15 s). */
  enviarSinal(): Promise<boolean>;
  parar(): Promise<void>;
}

export function ligarSincronizacao(
  caixa: Caixa,
  destino: string,
  opcoes: { transporte?: Transporte; intervaloSinalMs?: number; esperaOciosaMs?: number; backoff?: { inicialMs: number; maximoMs: number }; credencial?: string; intervaloDescidaMs?: number } = {},
): Sincronizacao {
  const { dispositivoId } = caixa.identidade();
  const motor = new MotorDeSync({
    fila: caixa.fila,
    transporte: opcoes.transporte ?? transporteHttp(destino, { timeoutMs: 5000, ...(opcoes.credencial === undefined ? {} : { credencial: opcoes.credencial }) }),
    origemId: dispositivoId,
    backoff: opcoes.backoff ?? { inicialMs: 1000, maximoMs: 30_000 },
    ...(opcoes.esperaOciosaMs === undefined ? {} : { esperaOciosaMs: opcoes.esperaOciosaMs }),
  });

  async function enviarSinal(): Promise<boolean> {
    const ultima = caixa.ultimasVendas(1)[0];
    try {
      const resposta = await fetch(`${destino}/v1/sinais-de-vida`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(opcoes.credencial === undefined ? {} : { authorization: `Bearer ${opcoes.credencial}` }) },
        body: JSON.stringify({
          dispositivoId,
          estado: motor.situacao().estado,
          filaPendente: caixa.fila.contarPendentes(),
          caixaAberto: caixa.sessaoAberta() !== undefined,
          ultimaVendaEm: ultima?.ocorridoEm ?? null,
          versaoPrograma: VERSAO_DO_PDV,
          enviadoEm: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(5000),
      });
      await resposta.arrayBuffer();
      return resposta.ok;
    } catch {
      return false; // sem agente: o sinal se perde, e o próximo cobre (não se guarda histórico)
    }
  }

  motor.iniciar();
  void enviarSinal();
  // Com a credencial (direto na nuvem, formato MEI), o caixa também recebe preços e parâmetros (Passo 3.3).
  const descida = opcoes.credencial === undefined ? null : ligarDescida(caixa, destino, opcoes.credencial, opcoes.intervaloDescidaMs ?? 5000);
  const relogio = setInterval(() => void enviarSinal(), opcoes.intervaloSinalMs ?? INTERVALO_SINAL_MS);
  relogio.unref();

  return {
    resumo: () => ({ ...motor.resumo(), destino }),
    enviarSinal,
    async parar() {
      clearInterval(relogio);
      descida?.parar();
      await motor.parar();
    },
  };
}

/**
 * Para onde vai a fila deste caixa:
 *   1. o agente informado (CONTINUUM_AGENTE_URL ou agente.txt): loja com vários caixas;
 *   2. senão, se o caixa foi ativado pelo ERP, direto para a nuvem com a credencial (formato MEI:
 *      o PDV faz o papel do agente);
 *   3. senão (modo demonstração), o agente deste computador.
 */
export function destinoDaFila(caixa: Caixa, agenteInformado: string | null): { destino: string; credencial?: string } {
  if (agenteInformado !== null) return { destino: agenteInformado };
  const urlNuvem = caixa.configuracao('urlNuvem');
  const credencial = caixa.configuracao('credencial');
  if (urlNuvem !== null && credencial !== null) return { destino: urlNuvem, credencial };
  return { destino: AGENTE_PADRAO };
}
