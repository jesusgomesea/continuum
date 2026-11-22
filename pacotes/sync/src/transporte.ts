// Como a fila conversa com o próximo elo (caixa → agente, agente → nuvem), pela rede.
// Reconstruído de OLD/app/dist/sync/cliente-nuvem.js e estado/health-check.js.
//
// O protocolo (igual nos dois elos):
//   POST {destino}/v1/origens/{origemId}/eventos   corpo { eventos: [...] }
//     200 { ultimaSeq }  confirmado até ultimaSeq
//     409 { ultimaSeq }  fora de ordem: o destino tem até ultimaSeq; reenviar a partir dali
//     400 ou 413         lote recusado (algum evento torto): dividir o lote para achar qual
//     outro 4xx          origem recusada (ex.: caixa não autorizado): parar
//     5xx, rede, tempo   temporário: tentar de novo mais tarde
//   GET  {destino}/v1/saude   200 = o destino está no ar
import type { Evento } from '@continuum/contratos';

export type RespostaDoDestino =
  | { classe: 'confirmado'; ultimaSeq: number }
  | { classe: 'temporario'; erro: string }
  | { classe: 'fora-de-ordem'; ultimaSeq: number; erro: string }
  | { classe: 'lote-recusado'; status: number; erro: string }
  | { classe: 'origem-recusada'; status: number; erro: string };

export interface Transporte {
  enviarLote(origemId: string, eventos: readonly Evento[]): Promise<RespostaDoDestino>;
  verificarSaude(): Promise<boolean>;
}

/** Transforma o status e o corpo da resposta numa das classes acima. */
export function classificarResposta(status: number, corpo: unknown): RespostaDoDestino {
  const obj = typeof corpo === 'object' && corpo !== null ? (corpo as Record<string, unknown>) : {};
  const erro = typeof obj['erro'] === 'string' ? obj['erro'] : typeof obj['mensagem'] === 'string' ? obj['mensagem'] : `HTTP ${status}`;
  const ultimaSeq = obj['ultimaSeq'];
  const temUltimaSeq = typeof ultimaSeq === 'number' && Number.isSafeInteger(ultimaSeq) && ultimaSeq >= 0;
  if (status === 200) return temUltimaSeq ? { classe: 'confirmado', ultimaSeq } : { classe: 'temporario', erro: 'resposta sem ultimaSeq' };
  if (status === 409) return temUltimaSeq ? { classe: 'fora-de-ordem', ultimaSeq, erro } : { classe: 'temporario', erro };
  if (status === 400 || status === 413) return { classe: 'lote-recusado', status, erro };
  if (status >= 400 && status < 500) return { classe: 'origem-recusada', status, erro };
  return { classe: 'temporario', erro };
}

/** Transporte pela rede (HTTP). Nunca lança: falha de rede vira "temporário". */
export function transporteHttp(urlBase: string, opcoes: { timeoutMs?: number; credencial?: string } = {}): Transporte {
  const timeoutMs = opcoes.timeoutMs ?? 10_000;
  const cabecalhos: Record<string, string> = { 'content-type': 'application/json' };
  if (opcoes.credencial !== undefined) cabecalhos['authorization'] = `Bearer ${opcoes.credencial}`;
  return {
    async enviarLote(origemId, eventos) {
      try {
        const resposta = await fetch(`${urlBase}/v1/origens/${origemId}/eventos`, {
          method: 'POST',
          headers: cabecalhos,
          body: JSON.stringify({ eventos: eventos.map(({ id, seq, tipo, versao, ocorridoEm, dados }) => ({ id, seq, tipo, versao, ocorridoEm, dados })) }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        const texto = await resposta.text();
        let corpo: unknown;
        try {
          corpo = JSON.parse(texto);
        } catch {
          corpo = undefined;
        }
        return classificarResposta(resposta.status, corpo);
      } catch (erro) {
        return { classe: 'temporario', erro: `sem conexão com ${urlBase} (${(erro as Error).message})` };
      }
    },
    async verificarSaude() {
      try {
        const resposta = await fetch(`${urlBase}/v1/saude`, { signal: AbortSignal.timeout(timeoutMs) });
        await resposta.arrayBuffer();
        return resposta.status === 200;
      } catch {
        return false;
      }
    },
  };
}
