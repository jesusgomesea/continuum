// Ativação do caixa (Passo 3.1). Na primeira vez que o PDV abre, ele ainda não sabe quem é:
//   - com o código gerado no ERP (Caixas → Novo caixa), pede à nuvem a credencial, a loja, os parâmetros
//     e o catálogo, e grava tudo no caixa.db;
//   - ou entra no modo demonstração (loja de exemplo, sem ERP), para testar.
// Depois disso, quem abriu o PDV liga o envio da fila (aoAtivar).
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Caixa, PacoteDeAtivacao } from './caixa.ts';
import { prepararDemonstracao } from './servidor/demonstracao.ts';
import { VERSAO_DO_PDV } from './sincronizacao.ts';

export class AtivacaoRecusadaError extends Error {
  override name = 'AtivacaoRecusadaError';
}

/** Pede à nuvem o pacote de ativação e aplica no caixa. */
export async function ativarPelaNuvem(caixa: Caixa, urlNuvem: string, codigo: string): Promise<void> {
  const base = urlNuvem.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(base)) throw new AtivacaoRecusadaError('Endereço da nuvem inválido. Exemplo: https://mercbairro.continuum.app');
  let resposta: Response;
  try {
    resposta = await fetch(`${base}/v1/dispositivos/ativar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ codigo, versaoInstalada: VERSAO_DO_PDV }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new AtivacaoRecusadaError(`Sem conexão com ${base}. A ativação precisa de internet (só ela: depois o caixa vende sem).`);
  }
  const corpo = (await resposta.json().catch(() => ({}))) as { mensagem?: string };
  if (!resposta.ok) throw new AtivacaoRecusadaError(corpo.mensagem ?? `A nuvem recusou (HTTP ${resposta.status}).`);
  caixa.aplicarAtivacao(corpo as PacoteDeAtivacao, base);
}

export function caixaAtivado(caixa: Caixa): boolean {
  try {
    caixa.identidade();
    return true;
  } catch {
    return false;
  }
}

function lerCorpo(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((ok) => {
    let t = '';
    req.setEncoding('utf8');
    req.on('data', (p: string) => (t += p));
    req.on('end', () => {
      try {
        ok(t === '' ? {} : (JSON.parse(t) as Record<string, unknown>));
      } catch {
        ok({});
      }
    });
  });
}

/**
 * Rotas da ativação, antes da API do caixa:
 *   POST /api/ativar         { urlNuvem, codigo }
 *   POST /api/demonstracao   ativa com a loja de exemplo
 */
export function middlewareDeAtivacao(caixa: Caixa, aoAtivar: () => void) {
  return (req: IncomingMessage, res: ServerResponse, seguir: () => void): void => {
    const url = (req.url ?? '').split('?')[0];
    if (req.method !== 'POST' || (url !== '/api/ativar' && url !== '/api/demonstracao')) {
      seguir();
      return;
    }
    const responder = (status: number, corpo: unknown) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(corpo));
    };
    if (caixaAtivado(caixa)) {
      responder(409, { erro: 'JaAtivado', mensagem: 'Este caixa já foi ativado.' });
      return;
    }
    lerCorpo(req)
      .then(async (corpo) => {
        if (url === '/api/demonstracao') prepararDemonstracao(caixa);
        else await ativarPelaNuvem(caixa, String(corpo['urlNuvem'] ?? ''), String(corpo['codigo'] ?? ''));
        aoAtivar();
        responder(200, { ok: true });
      })
      .catch((erro: unknown) => responder(erro instanceof AtivacaoRecusadaError ? 400 : 500, { erro: (erro as Error).name, mensagem: (erro as Error).message }));
  };
}
