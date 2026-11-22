// API e arquivos do PDV: só o HTTP do Node, sem biblioteca nova.
// Escuta só em 127.0.0.1. Todo POST exige `X-Continuum: pdv` e JSON: uma página
// qualquer aberta no navegador não consegue mandar esse cabeçalho sem um
// preflight de CORS, que o PDV não autoriza (mesma ideia do ADR 013 no LAB).
import { readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DadosInvalidosError, EstoqueInsuficienteError, ProdutoNaoEncontradoError } from '../dist/vendas/erros.js';

export const CABECALHO = 'x-continuum';
export const VALOR_CABECALHO = 'pdv';
const LIMITE_CORPO = 10 * 1024;
const PASTA_WEB = fileURLToPath(new URL('./web/', import.meta.url));
const LOGO = fileURLToPath(new URL('../src/painel/logo.png', import.meta.url));

/** Só estes arquivos são servidos: nada de caminho vindo da URL chega ao disco. */
const ARQUIVOS = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/pdv.css': ['pdv.css', 'text/css; charset=utf-8'],
  '/pdv.js': ['pdv.js', 'text/javascript; charset=utf-8'],
};

class ErroHttp extends Error {
  constructor(status, mensagem, extra = {}) {
    super(mensagem);
    this.status = status;
    this.extra = extra;
  }
}

/**
 * @param caixa CaixaPdv
 * @param lab { situacao(): objeto da /api/situacao do LAB ou null, url: string|null }
 */
export function criarServidorPdv({ caixa, lab = { situacao: () => null, url: null } }) {
  return http.createServer((req, res) => {
    tratar(req, res, caixa, lab).catch((erro) => responderErro(res, erro, caixa));
  });
}

async function tratar(req, res, caixa, lab) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const rota = `${req.method} ${url.pathname}`;

  if (req.method === 'GET' && ARQUIVOS[url.pathname]) {
    const [arquivo, tipo] = ARQUIVOS[url.pathname];
    return enviar(res, 200, readFileSync(path.join(PASTA_WEB, arquivo)), tipo);
  }
  if (rota === 'GET /logo.png') return enviar(res, 200, readFileSync(LOGO), 'image/png');

  // Para o Dashboard: resumo do caixa e consulta por código, lidos de outra porta
  // (CORS só para 127.0.0.1/localhost e só nestes GET; nenhum POST é liberado).
  if (rota === 'GET /api/status') {
    liberarDashboard(req, res);
    return json(res, 200, { ...caixa.resumo(), fila: caixa.fila(), ultimas: caixa.ultimasVendas(8) });
  }
  const consulta = /^\/api\/pdv\/consulta\/([A-Za-z0-9-]{1,40})$/.exec(url.pathname);
  if (req.method === 'GET' && consulta) {
    liberarDashboard(req, res);
    return json(res, 200, caixa.consultarCodigo(consulta[1]));
  }

  if (rota === 'GET /api/pdv/estado') {
    const s = lab.situacao();
    return json(res, 200, {
      caixa: caixa.resumo(),
      produtos: caixa.catalogo(),
      vendas: caixa.ultimasVendas(12),
      fila: caixa.fila(),
      lab: s === null ? null : { url: lab.url, estado: s.estado, queda: s.kryptonita?.queda ?? null, nuvem: s.nuvem !== null, sync: s.sync?.rodando ?? false },
    });
  }

  const cupom = /^\/api\/pdv\/cupons\/([0-9a-f-]{36})$/.exec(url.pathname);
  if (req.method === 'GET' && cupom) {
    const c = caixa.cupom(cupom[1]);
    if (c === null) throw new ErroHttp(404, 'cupom não encontrado neste caixa');
    return json(res, 200, c);
  }

  if (req.method === 'POST') {
    if (req.headers[CABECALHO] !== VALOR_CABECALHO) throw new ErroHttp(403, `cabeçalho ${CABECALHO}: ${VALOR_CABECALHO} obrigatório`);
    if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) throw new ErroHttp(415, 'envie JSON (content-type: application/json)');
    const corpo = await lerJson(req);

    if (url.pathname === '/api/pdv/vendas') {
      const { cupom: c, repetida } = caixa.registrarVenda(corpo.chave, corpo.itens, corpo.pagamento ?? { forma: 'dinheiro' });
      return json(res, repetida ? 200 : 201, { cupom: c, repetida });
    }
    if (url.pathname === '/api/pdv/estoque') {
      if (typeof corpo.produtoId !== 'string') throw new ErroHttp(400, 'produtoId: informe o produto');
      return json(res, 200, { saldo: caixa.repor(corpo.produtoId, corpo.quantidade) });
    }
    if (url.pathname === '/api/pdv/catalogo-demo') {
      return json(res, 200, { criados: caixa.cadastrarDemo() });
    }
  }
  throw new ErroHttp(404, 'rota não encontrada');
}

function liberarDashboard(req, res) {
  const origem = req.headers.origin;
  if (typeof origem === 'string' && /^http:\/\/(127\.0\.0\.1|localhost):\d{1,5}$/.test(origem)) {
    res.setHeader('access-control-allow-origin', origem);
    res.setHeader('vary', 'origin');
  }
}

function lerJson(req) {
  return new Promise((resolve, reject) => {
    let tamanho = 0;
    const partes = [];
    req.on('data', (parte) => {
      tamanho += parte.length;
      if (tamanho > LIMITE_CORPO) {
        reject(new ErroHttp(413, 'pedido grande demais'));
        req.destroy();
        return;
      }
      partes.push(parte);
    });
    req.on('end', () => {
      try {
        const valor = JSON.parse(Buffer.concat(partes).toString('utf8') || '{}');
        if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) throw new Error();
        resolve(valor);
      } catch {
        reject(new ErroHttp(400, 'JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

function responderErro(res, erro, caixa) {
  if (res.headersSent) return res.destroy();
  if (erro instanceof ErroHttp) return json(res, erro.status, { erro: erro.message, ...erro.extra });
  if (erro instanceof EstoqueInsuficienteError) {
    const produto = caixa.catalogo().find((p) => p.id === erro.produtoId);
    const nome = produto?.nome ?? 'produto';
    return json(res, 409, {
      erro: `Estoque insuficiente: ${nome} tem ${erro.saldo}, pedido ${erro.solicitado}. Nada foi gravado.`,
      codigo: 'estoque-insuficiente', produtoId: erro.produtoId, saldo: erro.saldo,
    });
  }
  if (erro instanceof ProdutoNaoEncontradoError) return json(res, 404, { erro: 'Produto não encontrado no cadastro da loja.', codigo: 'produto-nao-encontrado' });
  if (erro instanceof DadosInvalidosError) return json(res, 400, { erro: erro.message, codigo: 'dados-invalidos' });
  // Outro processo (o LAB ou o sync) segurou o banco além do busy_timeout: nada foi gravado, dá para tentar de novo.
  if (/SQLITE_BUSY|database is locked/i.test(String(erro?.message ?? '') + String(erro?.code ?? ''))) {
    return json(res, 503, { erro: 'Banco da loja ocupado. Nada foi gravado: tente de novo.', codigo: 'banco-ocupado' });
  }
  console.error(erro);
  return json(res, 500, { erro: 'erro interno do PDV' });
}

function json(res, status, corpo) {
  enviar(res, status, JSON.stringify(corpo), 'application/json; charset=utf-8');
}

function enviar(res, status, corpo, tipo) {
  res.writeHead(status, {
    'content-type': tipo,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'",
  });
  res.end(corpo);
}

/**
 * Acompanha o LAB pela /api/situacao (só leitura, para mostrar a conexão).
 * O PDV vende com ou sem o LAB: é o Local First. Procura a porta a partir de 3000.
 */
export function acompanharLab({ portas = Array.from({ length: 10 }, (_, i) => 3000 + i), intervaloMs = 1000 } = {}) {
  let porta = null;
  let ultima = null;
  let ocupado = false;
  const consultar = async (p) => {
    const r = await fetch(`http://127.0.0.1:${p}/api/situacao`, { signal: AbortSignal.timeout(800) });
    if (!r.ok) throw new Error(String(r.status));
    const s = await r.json();
    if (typeof s?.estado !== 'string' || typeof s?.kryptonita !== 'object') throw new Error('não é o LAB');
    return s;
  };
  const passo = async () => {
    if (ocupado) return;
    ocupado = true;
    try {
      if (porta !== null) {
        try { ultima = await consultar(porta); return; } catch { porta = null; }
      }
      for (const p of portas) {
        try { ultima = await consultar(p); porta = p; return; } catch { /* próxima */ }
      }
      ultima = null;
    } finally {
      ocupado = false;
    }
  };
  void passo();
  const timer = setInterval(() => void passo(), intervaloMs);
  timer.unref();
  return {
    situacao: () => ultima,
    get url() { return porta === null ? null : `http://127.0.0.1:${porta}`; },
    parar: () => clearInterval(timer),
  };
}
