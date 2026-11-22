// Roteiro de um dia de caixa completo, num caixa.db de verdade (arquivo no disco).
// Abre o caixa, vende (com desconto, pagamento misto e troco), recusa venda sem estoque, cancela,
// faz suprimento e sangria, fecha o caixa e confere: a gaveta, o estoque e a fila de eventos.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lerEvento } from '@continuum/contratos';
import { AutorizacaoNecessariaError, CancelamentoRecusadoError, DadosInvalidosError, EstoqueInsuficienteError, gerarId } from '@continuum/dominio';
import type { BancoSqlite } from '@continuum/sync';
import { afterAll, describe, expect, it } from 'vitest';
import { abrirBancoDoCaixa, Caixa, OperacaoDeCaixaError } from '../src/index.ts';

const pasta = mkdtempSync(join(tmpdir(), 'continuum-caixa-'));
const abertos: BancoSqlite[] = [];
afterAll(() => {
  for (const b of abertos) b.fechar();
  rmSync(pasta, { recursive: true, force: true });
});

/** Relógio de teste: cada consulta anda 1 minuto, a partir das 8h de 21/11/2026 (UTC). */
function relogioDeTeste() {
  let t = Date.UTC(2026, 10, 21, 8, 0, 0);
  return () => new Date((t += 60_000));
}

const IDENTIDADE = { dispositivoId: gerarId(), lojaId: gerarId(), nomeReduzido: 'MERCBAIRRO', numeroCaixa: 1 };
const CAFE = gerarId();
const PAO = gerarId();

function abrir(arquivo: string): Caixa {
  const banco = abrirBancoDoCaixa(join(pasta, arquivo));
  abertos.push(banco);
  return new Caixa(banco, { relogio: relogioDeTeste() });
}

describe('um dia de caixa completo', () => {
  const caixa = abrir('caixa.db');

  it('preparação: ativa o caixa, recebe parâmetros, produtos e estoque inicial', () => {
    expect(() => caixa.abrirCaixa('Ana', 0)).toThrow(/não ativado/);
    caixa.ativar(IDENTIDADE);
    expect(() => caixa.ativar(IDENTIDADE)).toThrow(/já foi ativado/);
    caixa.aplicarParametros({ versao: 1, regraEstoque: 'bloquear', limiteDescontoPct: 10 });
    caixa.receberProduto({ produtoId: CAFE, nome: 'Café 500 g', precoCentavos: 1890, unidade: 'un', ean: '4006381333931', version: 1 });
    caixa.receberProduto({ produtoId: PAO, nome: 'Pão de forma', precoCentavos: 899, unidade: 'un', ean: null, version: 1 });
    caixa.registrarEntrada(CAFE, 10, 'estoque inicial');
    caixa.registrarEntrada(PAO, 5, 'estoque inicial');
    expect([caixa.saldo(CAFE), caixa.saldo(PAO)]).toEqual([10, 5]);
  });

  it('com o caixa fechado não se vende', () => {
    expect(() => caixa.registrarVenda({ itens: [{ produtoId: CAFE, quantidade: 1 }], pagamentos: [{ forma: 'pix', valorCentavos: 1890 }] })).toThrow(
      OperacaoDeCaixaError,
    );
  });

  it('abre o caixa com R$ 100,00 de fundo; abrir de novo é recusado', () => {
    expect(caixa.abrirCaixa('Ana', 10000).operador).toBe('Ana');
    expect(() => caixa.abrirCaixa('Bia', 10000)).toThrow(/já está aberto/);
  });

  it('venda 1: 2 cafés + 1 pão, Pix + dinheiro, com troco', () => {
    const { venda } = caixa.registrarVenda({
      itens: [{ produtoId: CAFE, quantidade: 2 }, { produtoId: PAO, quantidade: 1 }],
      pagamentos: [{ forma: 'pix', valorCentavos: 2000 }, { forma: 'dinheiro', valorCentavos: 3000 }],
      documentoCliente: '529.982.247-25',
    });
    expect(venda.codigo).toMatch(/^MERCBAIRRO-10001-[0-9A-F]{4}$/);
    expect([venda.liquidoCentavos, venda.trocoCentavos]).toEqual([4679, 321]);
  });

  it('venda 2: 1 café com 10% de desconto, em dinheiro; 11% sem supervisor é recusado', () => {
    const umCafe = [{ produtoId: CAFE, quantidade: 1 }];
    expect(() => caixa.registrarVenda({ itens: umCafe, descontoCentavos: 208, pagamentos: [{ forma: 'dinheiro', valorCentavos: 2000 }] })).toThrow(
      AutorizacaoNecessariaError,
    );
    const { venda } = caixa.registrarVenda({ itens: umCafe, descontoCentavos: 189, pagamentos: [{ forma: 'dinheiro', valorCentavos: 2000 }] });
    expect(venda.numero).toBe(2); // a tentativa recusada não gastou número
    expect([venda.liquidoCentavos, venda.trocoCentavos]).toEqual([1701, 299]);
  });

  it('venda sem estoque é recusada e não deixa rastro: nem venda, nem baixa, nem evento', () => {
    const eventosAntes = caixa.fila.contarPendentes();
    expect(() => caixa.registrarVenda({ itens: [{ produtoId: CAFE, quantidade: 20 }], pagamentos: [{ forma: 'pix', valorCentavos: 37800 }] })).toThrow(
      EstoqueInsuficienteError,
    );
    expect(caixa.fila.contarPendentes()).toBe(eventosAntes);
    expect(caixa.saldo(CAFE)).toBe(7);
  });

  it('venda 3 no crédito e o cancelamento dela: o estoque volta e a venda continua lá', () => {
    const { venda } = caixa.registrarVenda({ itens: [{ produtoId: PAO, quantidade: 1 }], pagamentos: [{ forma: 'credito', valorCentavos: 899 }] });
    expect(venda.numero).toBe(3);
    expect(caixa.saldo(PAO)).toBe(3);

    caixa.cancelarVenda(venda.codigo.toLowerCase(), 'Cliente desistiu', 'Carla (supervisora)');
    expect(caixa.saldo(PAO)).toBe(4);
    expect(caixa.buscarVenda(venda.codigo)).toMatchObject({ cancelada: true, venda: { liquidoCentavos: 899 } });
    expect(() => caixa.cancelarVenda(venda.codigo, 'de novo', 'Carla')).toThrow(CancelamentoRecusadoError);
  });

  it('suprimento entra na gaveta; sangria não passa do que há na gaveta', () => {
    caixa.movimentarCaixa('SUPRIMENTO', 5000, 'Troco extra');
    // Gaveta: fundo 10000 + dinheiro 2679 + 1701 + suprimento 5000 = 19380.
    expect(() => caixa.movimentarCaixa('SANGRIA', 20000, 'Depósito')).toThrow(DadosInvalidosError);
    caixa.movimentarCaixa('SANGRIA', 15000, 'Depósito no banco');
    expect(caixa.relatorioParcial().esperadoCentavos).toBe(4380);
  });

  it('fecha o caixa: totais por forma, desconto, cancelada e a falta de R$ 0,80 na gaveta', () => {
    const r = caixa.fecharCaixa(4300);
    expect(r).toEqual({
      vendas: { quantidade: 2, liquidoCentavos: 6380 },
      descontosCentavos: 189,
      porForma: { dinheiro: 4380, debito: 0, credito: 0, pix: 2000 },
      canceladas: { quantidade: 1, liquidoCentavos: 899 },
      sangriasCentavos: 15000,
      suprimentosCentavos: 5000,
      fundoCentavos: 10000,
      esperadoCentavos: 4380,
      contadoCentavos: 4300,
      diferencaCentavos: -80,
    });
    expect(caixa.sessaoAberta()).toBeUndefined();
  });

  it('depois de fechado: não vende, e a sessão fechada não pode ser alterada nem pelo banco', () => {
    expect(() => caixa.registrarVenda({ itens: [{ produtoId: CAFE, quantidade: 1 }], pagamentos: [{ forma: 'pix', valorCentavos: 1890 }] })).toThrow(
      /Caixa fechado/,
    );
    const banco = abertos[0];
    expect(() => banco?.rodar('UPDATE sessoes_caixa SET contado_centavos = 4380')).toThrow(/sessão fechada não muda/);
    expect(() => banco?.rodar('UPDATE vendas SET liquido_centavos = 0')).toThrow(/não são editados/);
    expect(() => banco?.rodar('DELETE FROM movimentacoes')).toThrow(/não são apagados/);
  });

  it('a fila tem os 15 eventos do dia, em ordem, todos dentro do contrato', () => {
    const eventos = caixa.fila.todos();
    expect(eventos.map((e) => e.seq)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    for (const { sincronizadoEm: _s, ...evento } of eventos) expect(() => lerEvento(evento)).not.toThrow();
    expect(eventos.map((e) => e.tipo)).toEqual([
      'estoque.movimentacao-registrada', // entrada café
      'estoque.movimentacao-registrada', // entrada pão
      'caixa.aberto',
      'venda.registrada', // venda 1
      'estoque.movimentacao-registrada',
      'estoque.movimentacao-registrada',
      'venda.registrada', // venda 2
      'estoque.movimentacao-registrada',
      'venda.registrada', // venda 3
      'estoque.movimentacao-registrada',
      'venda.cancelada',
      'estoque.movimentacao-registrada', // estorno
      'caixa.movimentado', // suprimento
      'caixa.movimentado', // sangria
      'caixa.fechado',
    ]);
  });

  it('no dia seguinte (banco reaberto): estoque, vendas e numeração continuam de onde pararam', () => {
    abertos[0]?.fechar();
    abertos.shift();
    const amanha = abrir('caixa.db');
    expect([amanha.saldo(CAFE), amanha.saldo(PAO)]).toEqual([7, 4]);
    amanha.abrirCaixa('Bia', 10000);
    const { venda } = amanha.registrarVenda({ itens: [{ produtoId: CAFE, quantidade: 1 }], pagamentos: [{ forma: 'debito', valorCentavos: 1890 }] });
    expect(venda.codigo).toMatch(/^MERCBAIRRO-10004-/);
    expect(amanha.fila.contarPendentes()).toBe(18);
  });
});

describe('regra "permitir com alerta" e parâmetros', () => {
  it('com a regra do cliente trocada, o caixa vende sem estoque e devolve o alerta', () => {
    const caixa = abrir('alerta.db');
    caixa.ativar({ ...IDENTIDADE, dispositivoId: gerarId(), numeroCaixa: 2 });
    caixa.aplicarParametros({ versao: 1, regraEstoque: 'bloquear', limiteDescontoPct: 10 });
    caixa.aplicarParametros({ versao: 2, regraEstoque: 'permitir_alerta', limiteDescontoPct: 10 });
    caixa.aplicarParametros({ versao: 1, regraEstoque: 'bloquear', limiteDescontoPct: 10 }); // antiga: ignorada
    expect(caixa.parametros().regraEstoque).toBe('permitir_alerta');

    caixa.receberProduto({ produtoId: CAFE, nome: 'Café', precoCentavos: 1890, unidade: 'un', ean: null, version: 1 });
    caixa.abrirCaixa('Ana', 0);
    const { venda, alertasEstoque } = caixa.registrarVenda({
      itens: [{ produtoId: CAFE, quantidade: 2 }],
      pagamentos: [{ forma: 'pix', valorCentavos: 3780 }],
    });
    expect(venda.codigo).toMatch(/^MERCBAIRRO-20001-/); // caixa 2
    expect(alertasEstoque).toEqual([{ produtoId: CAFE, saldoAntes: 0, saldoDepois: -2 }]);
    expect(caixa.saldo(CAFE)).toBe(-2);
  });

  it('produto recebido de novo só muda se a versão for mais nova', () => {
    const caixa = abrir('catalogo.db');
    caixa.ativar({ ...IDENTIDADE, dispositivoId: gerarId() });
    caixa.receberProduto({ produtoId: CAFE, nome: 'Café', precoCentavos: 1890, unidade: 'un', ean: null, version: 2 });
    caixa.receberProduto({ produtoId: CAFE, nome: 'Café', precoCentavos: 1500, unidade: 'un', ean: null, version: 1 });
    caixa.registrarEntrada(CAFE, 1);
    caixa.abrirCaixa('Ana', 0);
    expect(caixa.registrarVenda({ itens: [{ produtoId: CAFE, quantidade: 1 }], pagamentos: [{ forma: 'pix', valorCentavos: 1890 }] }).venda.brutoCentavos).toBe(1890);
  });
});
