// Código da venda, pagamento e consulta:  runtime\node\node.exe --test app\pdv\testes\
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { abrirBanco } from '../../dist/banco/sqlite.js';
import { LabVendas } from '../../dist/vendas/lab-vendas.js';
import { CaixaPdv, codigoDaVenda, siglaDoCaixa } from '../caixa.js';

const pasta = mkdtempSync(path.join(os.tmpdir(), 'continuum-pdv-cod-'));
const abertos = [];
after(() => { for (const b of abertos) b.fechar(); rmSync(pasta, { recursive: true, force: true }); });
let n = 0;
function novo(opcoes = {}) {
  const banco = abrirBanco(path.join(pasta, `loja-${++n}.db`));
  abertos.push(banco);
  const caixa = new CaixaPdv(banco, opcoes);
  caixa.cadastrarDemo();
  return { banco, caixa, cafe: caixa.catalogo()[0] };
}
const chave = () => crypto.randomUUID();
const contar = (banco) => Number(banco.consultarUma('SELECT count(*) AS n FROM vendas').n);

describe('código da venda', () => {
  test('formato CX01-000001-ABCD, com a sigla tirada do nome do caixa', () => {
    assert.equal(siglaDoCaixa('Caixa 01'), 'CX01');
    assert.equal(siglaDoCaixa('Caixa 7'), 'CX07');
    assert.equal(codigoDaVenda('CX01', 15855, '019a0b7c-1111-7222-8333-44445555abcd'), 'CX01-015855-ABCD');
    const { caixa, cafe } = novo();
    const { cupom } = caixa.registrarVenda(chave(), [{ produtoId: cafe.id, quantidade: 1 }]);
    assert.match(cupom.codigo, /^CX01-000001-[0-9A-F]{4}$/);
  });

  test('a consulta valida o código certo e mostra valor, itens, pagamento e situação', () => {
    const { caixa, cafe } = novo();
    const { cupom } = caixa.registrarVenda(chave(), [{ produtoId: cafe.id, quantidade: 2 }], { forma: 'pix' });
    const v = caixa.consultarCodigo(cupom.codigo.toLowerCase());
    assert.equal(v.valida, true);
    assert.equal(v.totalCentavos, 3780);
    assert.deepEqual(v.itens, [{ nome: 'Café', quantidade: 2, precoUnitarioCentavos: 1890 }]);
    assert.equal(v.pagamento.forma, 'pix');
    assert.equal(v.situacao, 'pendente');
    assert.match(v.origem, /PDV/);
  });

  test('código com conferência errada, número inexistente ou formato errado não valida', () => {
    const { caixa, cafe } = novo();
    const { cupom } = caixa.registrarVenda(chave(), [{ produtoId: cafe.id, quantidade: 1 }]);
    const adulterado = cupom.codigo.slice(0, -4) + (cupom.codigo.endsWith('0000') ? '1111' : '0000');
    assert.equal(caixa.consultarCodigo(adulterado).valida, false);
    assert.match(caixa.consultarCodigo(adulterado).motivo, /conferência/);
    assert.match(caixa.consultarCodigo('CX01-999999-ABCD').motivo, /Não existe/);
    assert.match(caixa.consultarCodigo('qualquer coisa').motivo, /Formato/);
  });

  test('venda feita fora do caixa (gerador do LAB) também valida, sem pagamento', () => {
    const { banco, caixa, cafe } = novo();
    const venda = new LabVendas(banco).registrarVenda([{ produtoId: cafe.id, quantidade: 1 }]);
    const v = caixa.consultarCodigo(codigoDaVenda('CX01', venda.numero, venda.id));
    assert.equal(v.valida, true);
    assert.equal(v.pagamento, null);
    assert.match(v.origem, /outra origem/);
  });
});

describe('pagamento', () => {
  test('dinheiro: troco calculado pelo caixa', () => {
    const { caixa, cafe } = novo();
    const { cupom } = caixa.registrarVenda(chave(), [{ produtoId: cafe.id, quantidade: 1 }], { forma: 'dinheiro', recebidoCentavos: 5000 });
    assert.deepEqual(cupom.pagamento, { forma: 'dinheiro', recebidoCentavos: 5000, trocoCentavos: 5000 - 1890 });
  });

  test('dinheiro a menos que o total desfaz a venda inteira', () => {
    const { banco, caixa, cafe } = novo();
    const saldo = caixa.catalogo()[0].saldo;
    assert.throws(() => caixa.registrarVenda(chave(), [{ produtoId: cafe.id, quantidade: 1 }], { forma: 'dinheiro', recebidoCentavos: 1000 }), /menor que o total/);
    assert.equal(contar(banco), 0);
    assert.equal(caixa.catalogo()[0].saldo, saldo, 'o estoque não pode baixar');
  });

  test('forma de pagamento desconhecida é recusada antes de gravar', () => {
    const { banco, caixa, cafe } = novo();
    assert.throws(() => caixa.registrarVenda(chave(), [{ produtoId: cafe.id, quantidade: 1 }], { forma: 'cheque' }), /pagamento.forma/);
    assert.equal(contar(banco), 0);
  });
});
