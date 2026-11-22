// Testes do PDV:  runtime\node\node.exe --test app\pdv\testes\
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { abrirBanco as abrirBancoReal } from '../../dist/banco/sqlite.js';
import { EstoqueInsuficienteError } from '../../dist/vendas/erros.js';
import { LabVendas } from '../../dist/vendas/lab-vendas.js';
import { CaixaPdv } from '../caixa.js';
import { criarServidorPdv } from '../servidor.js';

const pasta = mkdtempSync(path.join(os.tmpdir(), 'continuum-pdv-'));
// No Windows, um banco aberto trava o arquivo: fecha todos antes de apagar a pasta.
const abertos = [];
const abrirBanco = (arquivo) => {
  const banco = abrirBancoReal(arquivo);
  const fechar = banco.fechar.bind(banco);
  let fechado = false;
  banco.fechar = () => { if (!fechado) { fechado = true; fechar(); } };
  abertos.push(banco);
  return banco;
};
after(() => {
  for (const banco of abertos) banco.fechar();
  rmSync(pasta, { recursive: true, force: true });
});
let n = 0;
const novoArquivo = () => path.join(pasta, `loja-${++n}.db`);
const chave = () => crypto.randomUUID();

function caixaComCatalogo(opcoes = {}) {
  const arquivo = novoArquivo();
  const banco = abrirBanco(arquivo);
  const caixa = new CaixaPdv(banco, opcoes);
  caixa.cadastrarDemo();
  const [cafe, acucar] = caixa.catalogo();
  return { arquivo, banco, caixa, cafe, acucar };
}
const contar = (banco, tabela) => Number(banco.consultarUma(`SELECT count(*) AS n FROM ${tabela}`).n);

describe('venda no PDV', () => {
  test('grava venda, itens, estoque e evento na outbox juntos', () => {
    const { banco, caixa, cafe, acucar } = caixaComCatalogo();
    const eventosAntes = contar(banco, 'outbox');
    const { cupom, repetida } = caixa.registrarVenda(chave(), [{ produtoId: cafe.id, quantidade: 2 }, { produtoId: acucar.id, quantidade: 1 }]);
    assert.equal(repetida, false);
    assert.equal(cupom.numero, 1);
    assert.equal(cupom.totalCentavos, 2 * 1890 + 549);
    assert.equal(contar(banco, 'vendas'), 1);
    assert.equal(contar(banco, 'itens_venda'), 2);
    // venda.registrada + uma movimentação por item
    assert.equal(contar(banco, 'outbox') - eventosAntes, 3);
    const evento = banco.consultarUma('SELECT tipo, dados FROM outbox WHERE seq = ?', cupom.seq);
    assert.equal(evento.tipo, 'venda.registrada');
    assert.equal(JSON.parse(evento.dados).vendaId, cupom.vendaId);
    assert.equal(caixa.catalogo()[0].saldo, 60 - 2);
  });

  test('o cupom passa de pendente para "na nuvem" quando o sync confirma', () => {
    const { arquivo, caixa, cafe } = caixaComCatalogo();
    const lab = new LabVendas(abrirBanco(arquivo)); // outra conexão, como o processo do sync
    const { cupom } = caixa.registrarVenda(chave(), [{ produtoId: cafe.id, quantidade: 1 }]);
    assert.equal(cupom.situacao, 'pendente');
    lab.outbox.marcarSincronizados(cupom.seq); // o que o Sync Engine faz quando a nuvem confirma
    assert.equal(caixa.cupom(cupom.vendaId).situacao, 'nuvem');
    assert.equal(caixa.ultimasVendas()[0].situacao, 'nuvem');
  });

  test('sem estoque, recusa a venda inteira e não grava nada', () => {
    const { banco, caixa, cafe, acucar } = caixaComCatalogo();
    const antes = { vendas: contar(banco, 'vendas'), outbox: contar(banco, 'outbox'), mov: contar(banco, 'movimentacoes') };
    assert.throws(
      () => caixa.registrarVenda(chave(), [{ produtoId: acucar.id, quantidade: 1 }, { produtoId: cafe.id, quantidade: 61 }]),
      EstoqueInsuficienteError,
    );
    assert.deepEqual({ vendas: contar(banco, 'vendas'), outbox: contar(banco, 'outbox'), mov: contar(banco, 'movimentacoes') }, antes);
  });

  test('a mesma chave devolve a mesma venda e não grava outra', () => {
    const { banco, caixa, cafe } = caixaComCatalogo();
    const k = chave();
    const a = caixa.registrarVenda(k, [{ produtoId: cafe.id, quantidade: 1 }]);
    const b = caixa.registrarVenda(k, [{ produtoId: cafe.id, quantidade: 1 }]);
    assert.equal(b.repetida, true);
    assert.equal(b.cupom.vendaId, a.cupom.vendaId);
    assert.equal(contar(banco, 'vendas'), 1);
  });

  test('a idempotência sobrevive a reabrir o caixa (histórico em arquivo)', () => {
    const arquivo = path.join(pasta, 'caixa.jsonl');
    const { banco, caixa, cafe } = caixaComCatalogo({ arquivoCaixa: arquivo });
    const k = chave();
    const a = caixa.registrarVenda(k, [{ produtoId: cafe.id, quantidade: 1 }]);
    const reaberto = new CaixaPdv(banco, { arquivoCaixa: arquivo });
    const b = reaberto.registrarVenda(k, [{ produtoId: cafe.id, quantidade: 1 }]);
    assert.equal(b.repetida, true);
    assert.equal(b.cupom.numero, a.cupom.numero);
    assert.equal(contar(banco, 'vendas'), 1);
  });

  test('o preço vem do cadastro, não do pedido', () => {
    const { caixa, cafe } = caixaComCatalogo();
    const { cupom } = caixa.registrarVenda(chave(), [{ produtoId: cafe.id, quantidade: 1, precoCentavos: 1 }]);
    assert.equal(cupom.totalCentavos, 1890);
  });

  test('chave inválida é recusada antes de gravar', () => {
    const { banco, caixa, cafe } = caixaComCatalogo();
    assert.throws(() => caixa.registrarVenda('x', [{ produtoId: cafe.id, quantidade: 1 }]), /chave/);
    assert.equal(contar(banco, 'vendas'), 0);
  });
});

describe('PDV e LAB no mesmo banco', () => {
  test('duas conexões vendendo alternadas não repetem número de venda nem seq', () => {
    const arquivo = path.join(pasta, 'compartilhado.db');
    const bancoPdv = abrirBanco(arquivo);
    const caixa = new CaixaPdv(bancoPdv);
    caixa.cadastrarDemo();
    const bancoLab = abrirBanco(arquivo); // outra conexão, como o processo do LAB
    const lab = new LabVendas(bancoLab);
    assert.equal(lab.outbox.origemId, caixa.origemId, 'uma origem só por banco');
    const cafe = caixa.catalogo()[0];
    for (let i = 0; i < 20; i++) {
      if (i % 2) caixa.registrarVenda(chave(), [{ produtoId: cafe.id, quantidade: 1 }]);
      else lab.registrarVenda([{ produtoId: cafe.id, quantidade: 1 }]);
    }
    const numeros = bancoPdv.consultar('SELECT numero FROM vendas ORDER BY numero').map((l) => Number(l.numero));
    assert.deepEqual(numeros, Array.from({ length: 20 }, (_, i) => i + 1));
    const seqs = bancoPdv.consultar('SELECT seq FROM outbox ORDER BY seq').map((l) => Number(l.seq));
    assert.deepEqual(seqs, Array.from({ length: seqs.length }, (_, i) => i + 1));
    assert.equal(caixa.catalogo()[0].saldo, 60 - 20);
    bancoLab.fechar();
    bancoPdv.fechar();
  });
});

describe('API do PDV', () => {
  let servidor, base, caixa, cafe;
  before(async () => {
    ({ caixa, cafe } = caixaComCatalogo());
    servidor = criarServidorPdv({ caixa });
    await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${servidor.address().port}`;
  });
  after(() => new Promise((r) => { servidor.close(r); servidor.closeAllConnections(); }));
  const post = (rota, corpo, cabecalhos = { 'x-continuum': 'pdv' }) =>
    fetch(base + rota, { method: 'POST', headers: { 'content-type': 'application/json', ...cabecalhos }, body: JSON.stringify(corpo) });

  test('POST sem o cabeçalho X-Continuum é recusado (403)', async () => {
    const r = await post('/api/pdv/vendas', { chave: chave(), itens: [{ produtoId: cafe.id, quantidade: 1 }] }, {});
    assert.equal(r.status, 403);
  });

  test('venda pela API: 201, e a repetição com a mesma chave: 200', async () => {
    const k = chave();
    const corpo = { chave: k, itens: [{ produtoId: cafe.id, quantidade: 1 }] };
    const a = await post('/api/pdv/vendas', corpo);
    assert.equal(a.status, 201);
    const b = await post('/api/pdv/vendas', corpo);
    assert.equal(b.status, 200);
    assert.equal((await b.json()).repetida, true);
  });

  test('estoque insuficiente: 409 com mensagem legível', async () => {
    const r = await post('/api/pdv/vendas', { chave: chave(), itens: [{ produtoId: cafe.id, quantidade: 9999 }] });
    assert.equal(r.status, 409);
    const corpo = await r.json();
    assert.equal(corpo.codigo, 'estoque-insuficiente');
    assert.match(corpo.erro, /Café/);
  });

  test('JSON inválido: 400; rota desconhecida: 404', async () => {
    const r = await fetch(`${base}/api/pdv/vendas`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-continuum': 'pdv' }, body: '{' });
    assert.equal(r.status, 400);
    assert.equal((await fetch(`${base}/../../segredo`)).status, 404);
  });

  test('status para o Dashboard libera CORS só para 127.0.0.1', async () => {
    const ok = await fetch(`${base}/api/status`, { headers: { origin: 'http://127.0.0.1:3000' } });
    assert.equal(ok.headers.get('access-control-allow-origin'), 'http://127.0.0.1:3000');
    const fora = await fetch(`${base}/api/status`, { headers: { origin: 'http://exemplo.com' } });
    assert.equal(fora.headers.get('access-control-allow-origin'), null);
  });
});
