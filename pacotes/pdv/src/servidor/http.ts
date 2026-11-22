// Liga a API do caixa a um servidor HTTP do Node (o mesmo formato usado pelo Vite e, depois, pelo Electron).
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiDoCaixa } from './api.ts';

const LIMITE_CORPO = 1_000_000; // 1 MB: uma venda tem poucos KB

function lerCorpo(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolver, rejeitar) => {
    let texto = '';
    req.setEncoding('utf8');
    req.on('data', (parte: string) => {
      texto += parte;
      if (texto.length > LIMITE_CORPO) rejeitar(new Error('pedido grande demais'));
    });
    req.on('end', () => {
      try {
        resolver(texto === '' ? undefined : JSON.parse(texto));
      } catch {
        rejeitar(new Error('JSON inválido'));
      }
    });
    req.on('error', rejeitar);
  });
}

/** Trata os pedidos que começam com /api; os outros seguem para `seguir` (as telas). */
export function middlewareDaApi(api: ApiDoCaixa) {
  return (req: IncomingMessage, res: ServerResponse, seguir: () => void): void => {
    const url = req.url ?? '';
    if (!url.startsWith('/api/')) {
      seguir();
      return;
    }
    lerCorpo(req)
      .then((corpo) => api.tratar(req.method ?? 'GET', url, corpo))
      .catch((erro: unknown) => ({ status: 500, corpo: { erro: 'Interno', mensagem: (erro as Error).message } }))
      .then(({ status, corpo }) => {
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(corpo));
      });
  };
}
