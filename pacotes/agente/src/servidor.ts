// Servidor do agente na rede da loja. Os caixas chamam:
//   GET  /v1/saude                      "estou no ar"
//   POST /v1/origens/{caixa}/eventos    lote da fila do caixa
//   POST /v1/sinais-de-vida             o sinal de vida do caixa (a cada ~15 s)
// E quem está na loja abre no navegador (ou no programa do agente):
//   GET  /                              o painel com cada caixa, ao vivo
//   GET  /api/painel                    os dados do painel em JSON
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Agente } from './agente.ts';
import { paginaDoPainel } from './painel.ts';

const LIMITE_CORPO = 10_000_000; // um lote de 1000 vendas cabe com folga

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
        resolver(Symbol.for('json-invalido'));
      }
    });
    req.on('error', rejeitar);
  });
}

function responder(res: ServerResponse, status: number, corpo: unknown, tipo = 'application/json; charset=utf-8'): void {
  res.statusCode = status;
  res.setHeader('Content-Type', tipo);
  res.end(typeof corpo === 'string' ? corpo : JSON.stringify(corpo));
}

export interface OpcoesDoServidor {
  /** Conteúdo de tokens.css e base.css (a identidade visual), servidos em /estilos.css. */
  estilos: string;
}

export function criarServidorDoAgente(agente: Agente, opcoes: OpcoesDoServidor): Server {
  return createServer((req, res) => {
    const [caminho = '/'] = (req.url ?? '/').split('?');
    const metodo = req.method ?? 'GET';
    if (metodo === 'GET' && caminho === '/v1/saude') return responder(res, 200, { ok: true });
    if (metodo === 'GET' && caminho === '/') return responder(res, 200, paginaDoPainel(), 'text/html; charset=utf-8');
    if (metodo === 'GET' && caminho === '/estilos.css') return responder(res, 200, opcoes.estilos, 'text/css; charset=utf-8');
    if (metodo === 'GET' && caminho === '/api/painel') return responder(res, 200, { caixas: agente.painel(), agora: new Date().toISOString() });

    const lote = /^\/v1\/origens\/([^/]+)\/eventos$/.exec(caminho);
    if (metodo === 'POST' && (lote !== null || caminho === '/v1/sinais-de-vida')) {
      lerCorpo(req)
        .then((corpo) => {
          if (corpo === Symbol.for('json-invalido')) return responder(res, 400, { erro: 'JSON inválido' });
          if (lote !== null) {
            const r = agente.receberLote(decodeURIComponent(lote[1] ?? ''), corpo);
            return responder(res, r.status, r.corpo);
          }
          const r = agente.receberSinal(corpo);
          return r.ok ? responder(res, 200, { ok: true }) : responder(res, 400, { erro: r.erro });
        })
        .catch((erro: unknown) => responder(res, 500, { erro: (erro as Error).message }));
      return;
    }
    responder(res, 404, { erro: `${metodo} ${caminho} não existe` });
  });
}

/** Liga o servidor e devolve o endereço (porta 0 = qualquer porta livre). */
export function ligar(servidor: Server, porta: number, host: string): Promise<string> {
  return new Promise((resolver, rejeitar) => {
    servidor.once('error', rejeitar);
    servidor.listen(porta, host, () => resolver(`http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${(servidor.address() as AddressInfo).port}`));
  });
}
