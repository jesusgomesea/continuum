// Servidor HTTP da nuvem: liga a API (api.ts) a um servidor do Node, e serve de "middleware" para o Vite
// (as telas do ERP e do Central em desenvolvimento) no mesmo formato.
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { ApiDaNuvem } from './api.ts';

const LIMITE_CORPO = 2_000_000;

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
        resolver(undefined);
      }
    });
    req.on('error', rejeitar);
  });
}

/** Atende /v1/...; o resto segue para `seguir` (as telas). */
export function middlewareDaNuvem(api: ApiDaNuvem) {
  return (req: IncomingMessage, res: ServerResponse, seguir: () => void): void => {
    const url = req.url ?? '/';
    if (!url.startsWith('/v1/')) {
      seguir();
      return;
    }
    lerCorpo(req)
      .then((corpo) => api.tratar({ metodo: req.method ?? 'GET', caminho: url, corpo, cabecalhos: req.headers }))
      .catch((erro: unknown) => ({ status: 500, corpo: { erro: 'Interno', mensagem: (erro as Error).message }, cabecalhos: {} as Record<string, string> }))
      .then((r) => {
        res.statusCode = r.status;
        for (const [k, v] of Object.entries(r.cabecalhos ?? {})) res.setHeader(k, v);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(r.corpo));
      });
  };
}

export function criarServidorDaNuvem(api: ApiDaNuvem): Server {
  const m = middlewareDaNuvem(api);
  return createServer((req, res) =>
    m(req, res, () => {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ erro: 'RotaDesconhecida' }));
    }),
  );
}
