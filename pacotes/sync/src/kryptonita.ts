// Kryptonita: um intermediário de rede que provoca falhas de propósito, para provar que nada se perde.
// Reconstruído de OLD/app/dist/kryptonita/kryptonita.js (ADR 013 do OLD).
//
// Fica entre quem envia (o caixa) e quem recebe (o agente; depois, a nuvem). Para cada pedido, decide:
//   normal           repassa ao destino e devolve a resposta
//   derrubar         corta a conexão sem responder (rede caiu)
//   perder-resposta  repassa ao destino (que grava!) mas corta antes de responder (o pior caso)
//   indisponivel     responde 503 (destino sobrecarregado ou em manutenção)
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export type FalhaDeRede = 'normal' | 'derrubar' | 'perder-resposta' | 'indisponivel';

export interface Kryptonita {
  url: string;
  /** Decide a falha de cada pedido (n = 0, 1, 2...). Troque a qualquer momento. */
  decidir: (n: number) => FalhaDeRede;
  readonly contagem: Record<FalhaDeRede, number>;
  fechar(): Promise<void>;
}

export async function iniciarKryptonita(alvo: string): Promise<Kryptonita> {
  let n = 0;
  const contagem: Record<FalhaDeRede, number> = { normal: 0, derrubar: 0, 'perder-resposta': 0, indisponivel: 0 };
  const k: Kryptonita = { url: '', decidir: () => 'normal', contagem, fechar: async () => undefined };

  const servidor = createServer((req, res) => {
    let corpo = '';
    req.setEncoding('utf8');
    req.on('data', (parte: string) => (corpo += parte));
    req.on('end', () => {
      const falha = k.decidir(n++);
      contagem[falha] += 1;
      if (falha === 'derrubar') {
        req.socket.destroy();
        return;
      }
      if (falha === 'indisponivel') {
        res.writeHead(503, { 'content-type': 'application/json' }).end('{"erro":"indisponível (Kryptonita)"}');
        return;
      }
      // Repassa os cabeçalhos do pedido (inclusive a credencial do caixa), menos os que são da conexão.
      const cabecalhos: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (v !== undefined && !['host', 'content-length', 'connection'].includes(k)) cabecalhos[k] = Array.isArray(v) ? v.join(', ') : v;
      }
      fetch(`${alvo}${req.url ?? '/'}`, {
        method: req.method ?? 'GET',
        headers: cabecalhos,
        ...(req.method === 'GET' || req.method === 'HEAD' ? {} : { body: corpo }),
      })
        .then(async (r) => {
          const texto = await r.text();
          if (falha === 'perder-resposta') {
            req.socket.destroy(); // o destino já gravou; o caixa não fica sabendo
            return;
          }
          res.writeHead(r.status, { 'content-type': r.headers.get('content-type') ?? 'application/json' }).end(texto);
        })
        .catch(() => req.socket.destroy()); // destino fora do ar: para o caixa, a rede caiu
    });
  });

  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  k.url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  k.fechar = () =>
    new Promise<void>((ok) => {
      servidor.closeAllConnections();
      servidor.close(() => ok());
    });
  return k;
}

/** Sorteio de falhas: `chance` de 0 a 1 de cada pedido falhar, com o tipo sorteado entre as três falhas. */
export function falhasAleatorias(chance: number, aleatorio: () => number = Math.random): (n: number) => FalhaDeRede {
  const tipos: FalhaDeRede[] = ['derrubar', 'perder-resposta', 'indisponivel'];
  return () => (aleatorio() < chance ? (tipos[Math.floor(aleatorio() * tipos.length)] ?? 'derrubar') : 'normal');
}
