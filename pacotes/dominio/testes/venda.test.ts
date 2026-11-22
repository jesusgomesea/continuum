// Venda e cancelamento (estorno): o que cada regra garante.
import { describe, expect, it } from 'vitest';
import {
  AutorizacaoNecessariaError,
  CancelamentoRecusadoError,
  cancelarVenda,
  DadosInvalidosError,
  EstoqueInsuficienteError,
  montarVenda,
  ProdutoNaoEncontradoError,
  saldos,
} from '../src/index.ts';
import type { ContextoDaVenda, Movimentacao, PedidoDeVenda } from '../src/index.ts';

const LOJA = '019a0b7c-0000-7000-8000-0000000000b1';
const SESSAO = '019a0b7c-0000-7000-8000-0000000000c1';
const CAFE = '019a0b7c-0000-7000-8000-0000000000a1'; // R$ 18,90
const PAO = '019a0b7c-0000-7000-8000-0000000000a2'; // R$ 8,99

/** Gerador de ids previsível: 019a0b7c-0000-7000-8000-000000000001, ...002, ... */
function sequencia() {
  let n = 0;
  return () => `019a0b7c-0000-7000-8000-${(++n).toString(16).padStart(12, '0')}`;
}

function contexto(extra: Partial<ContextoDaVenda> = {}): ContextoDaVenda {
  return {
    lojaId: LOJA,
    sessaoId: SESSAO,
    nomeReduzido: 'MERCBAIRRO',
    numeroCaixa: 1,
    numero: 123,
    precos: new Map([[CAFE, 1890], [PAO, 899]]),
    saldos: new Map([[CAFE, 10], [PAO, 5]]),
    regraEstoque: 'bloquear',
    limiteDescontoPct: 10,
    gerarId: sequencia(),
    ...extra,
  };
}

const pix = (valorCentavos: number) => ({ forma: 'pix' as const, valorCentavos });
const dinheiro = (valorCentavos: number) => ({ forma: 'dinheiro' as const, valorCentavos });

describe('venda', () => {
  it('2 cafés + 1 pão no Pix: preço do cadastro, totais e código do comprovante', () => {
    const { venda, baixas, alertasEstoque } = montarVenda(
      { itens: [{ produtoId: CAFE, quantidade: 2 }, { produtoId: PAO, quantidade: 1 }], pagamentos: [pix(4679)] },
      contexto(),
    );
    expect(venda.brutoCentavos).toBe(4679);
    expect(venda.liquidoCentavos).toBe(4679);
    expect(venda.trocoCentavos).toBe(0);
    expect(venda.itens.map((i) => [i.posicao, i.precoUnitarioCentavos])).toEqual([[1, 1890], [2, 899]]);
    expect(venda.codigo).toBe('MERCBAIRRO-10123-0001'); // o 1º id gerado é o da venda
    expect(alertasEstoque).toEqual([]);
    // Uma baixa por item, negativa, apontando para a venda e para o item.
    expect(baixas.map((b) => [b.tipo, b.produtoId, b.quantidade, b.vendaId])).toEqual([
      ['VENDA', CAFE, -2, venda.vendaId],
      ['VENDA', PAO, -1, venda.vendaId],
    ]);
    expect(baixas.map((b) => b.movimentacaoId)).toEqual(venda.itens.map((i) => i.movimentacaoId));
  });

  it('a venda montada é congelada: nem a venda, nem os itens, nem os pagamentos mudam', () => {
    const { venda } = montarVenda({ itens: [{ produtoId: CAFE, quantidade: 1 }], pagamentos: [pix(1890)] }, contexto());
    expect(Object.isFrozen(venda)).toBe(true);
    expect(Object.isFrozen(venda.itens[0])).toBe(true);
    expect(() => {
      (venda as { liquidoCentavos: number }).liquidoCentavos = 1;
    }).toThrow(TypeError);
  });

  it('pagamento misto com troco: Pix + dinheiro, o troco sai do dinheiro', () => {
    const { venda } = montarVenda(
      { itens: [{ produtoId: CAFE, quantidade: 2 }, { produtoId: PAO, quantidade: 1 }], pagamentos: [pix(2000), dinheiro(3000)] },
      contexto(),
    );
    expect(venda.trocoCentavos).toBe(321);
    expect(venda.pagamentos.map((p) => p.forma)).toEqual(['pix', 'dinheiro']);
  });

  it('pagamento a menos que o total é recusado', () => {
    expect(() => montarVenda({ itens: [{ produtoId: CAFE, quantidade: 1 }], pagamentos: [dinheiro(1000)] }, contexto())).toThrow(
      /menor que o total/,
    );
  });

  it('pagar a mais no Pix ou no cartão é recusado (não há troco de Pix)', () => {
    expect(() => montarVenda({ itens: [{ produtoId: CAFE, quantidade: 1 }], pagamentos: [pix(2000)] }, contexto())).toThrow(
      /troco só sai da gaveta/,
    );
  });

  it('produto que não está no catálogo é recusado', () => {
    const fantasma = '019a0b7c-0000-7000-8000-0000000000ff';
    expect(() => montarVenda({ itens: [{ produtoId: fantasma, quantidade: 1 }], pagamentos: [pix(1)] }, contexto())).toThrow(
      ProdutoNaoEncontradoError,
    );
  });

  it('venda sem itens, quantidade quebrada ou forma de pagamento estranha é recusada', () => {
    expect(() => montarVenda({ itens: [], pagamentos: [pix(1)] }, contexto())).toThrow(/ao menos um item/);
    expect(() => montarVenda({ itens: [{ produtoId: CAFE, quantidade: 0.5 }], pagamentos: [pix(945)] }, contexto())).toThrow(
      DadosInvalidosError,
    );
    const cheque = { itens: [{ produtoId: CAFE, quantidade: 1 }], pagamentos: [{ forma: 'cheque', valorCentavos: 1890 }] };
    expect(() => montarVenda(cheque as unknown as PedidoDeVenda, contexto())).toThrow(/forma/);
  });

  it('CPF do cliente: guardado só com dígitos; CPF errado recusa a venda', () => {
    const base = { itens: [{ produtoId: CAFE, quantidade: 1 }], pagamentos: [pix(1890)] };
    expect(montarVenda({ ...base, documentoCliente: '529.982.247-25' }, contexto()).venda.documentoCliente).toBe('52998224725');
    expect(montarVenda(base, contexto()).venda.documentoCliente).toBeNull();
    expect(() => montarVenda({ ...base, documentoCliente: '529.982.247-26' }, contexto())).toThrow(/CPF inválido/);
  });
});

describe('desconto', () => {
  const doisCafes = [{ produtoId: CAFE, quantidade: 2 }]; // bruto 3780

  it('até 10% o operador dá sozinho', () => {
    const { venda } = montarVenda({ itens: doisCafes, descontoCentavos: 378, pagamentos: [pix(3402)] }, contexto());
    expect(venda.descontoCentavos).toBe(378);
    expect(venda.liquidoCentavos).toBe(3402);
  });

  it('acima de 10% exige supervisor; com autorização, passa', () => {
    const pedido = { itens: doisCafes, descontoCentavos: 379, pagamentos: [pix(3401)] };
    expect(() => montarVenda(pedido, contexto())).toThrow(AutorizacaoNecessariaError);
    expect(montarVenda({ ...pedido, autorizadoPorSupervisor: true }, contexto()).venda.liquidoCentavos).toBe(3401);
  });

  it('o limite é do cliente (parametrizado no Central)', () => {
    const pedido = { itens: doisCafes, descontoCentavos: 500, pagamentos: [pix(3280)] };
    expect(montarVenda(pedido, contexto({ limiteDescontoPct: 15 })).venda.descontoCentavos).toBe(500);
  });

  it('desconto do item soma com o do total', () => {
    const { venda } = montarVenda(
      { itens: [{ produtoId: CAFE, quantidade: 2, descontoCentavos: 100 }], descontoCentavos: 80, pagamentos: [pix(3600)] },
      contexto(),
    );
    expect(venda.itens[0]?.descontoCentavos).toBe(100);
    expect(venda.descontoCentavos).toBe(180);
  });

  it('desconto maior que o item ou que a venda é recusado, mesmo com supervisor', () => {
    expect(() =>
      montarVenda({ itens: [{ produtoId: CAFE, quantidade: 1, descontoCentavos: 1891 }], pagamentos: [pix(1)] }, contexto()),
    ).toThrow(/maior que o valor do item/);
    expect(() =>
      montarVenda(
        { itens: doisCafes, descontoCentavos: 3781, pagamentos: [pix(1)], autorizadoPorSupervisor: true },
        contexto(),
      ),
    ).toThrow(/maior que o valor da venda/);
  });
});

describe('falta de estoque na venda', () => {
  it('"bloquear": o mesmo produto em dois itens é somado antes de conferir (6 + 5 > 10)', () => {
    expect(() =>
      montarVenda(
        { itens: [{ produtoId: CAFE, quantidade: 6 }, { produtoId: CAFE, quantidade: 5 }], pagamentos: [pix(20790)] },
        contexto(),
      ),
    ).toThrow(EstoqueInsuficienteError);
  });

  it('"permitir_alerta": a venda sai e o alerta mostra o saldo negativo', () => {
    const { venda, alertasEstoque } = montarVenda(
      { itens: [{ produtoId: PAO, quantidade: 7 }], pagamentos: [pix(6293)] },
      contexto({ regraEstoque: 'permitir_alerta' }),
    );
    expect(venda.liquidoCentavos).toBe(6293);
    expect(alertasEstoque).toEqual([{ produtoId: PAO, saldoAntes: 5, saldoDepois: -2 }]);
  });
});

describe('cancelamento (estorno)', () => {
  function vendaDeExemplo() {
    return montarVenda(
      { itens: [{ produtoId: CAFE, quantidade: 2 }, { produtoId: PAO, quantidade: 1 }], pagamentos: [pix(4679)] },
      contexto(),
    );
  }
  const dados = (extra: Partial<Parameters<typeof cancelarVenda>[1]> = {}) => ({
    motivo: 'Cliente desistiu',
    autorizadoPor: 'Ana (supervisora)',
    sessaoAbertaId: SESSAO,
    jaCancelada: false,
    gerarId: sequencia(),
    ...extra,
  });

  it('o estoque volta por ESTORNO e a venda original continua igual, como prova', () => {
    const { venda, baixas } = vendaDeExemplo();
    const copia = JSON.stringify(venda);
    const { cancelamento, estornos } = cancelarVenda(venda, dados());

    expect(JSON.stringify(venda)).toBe(copia);
    expect(cancelamento).toEqual({ vendaId: venda.vendaId, motivo: 'Cliente desistiu', autorizadoPor: 'Ana (supervisora)' });
    expect(estornos.map((e) => [e.tipo, e.produtoId, e.quantidade])).toEqual([
      ['ESTORNO', CAFE, 2],
      ['ESTORNO', PAO, 1],
    ]);
    expect(estornos[0]?.motivo).toBe(`estorno da venda ${venda.codigo}: Cliente desistiu`);

    // Saldo antes da venda = saldo depois da venda + estornos.
    const entradas: Movimentacao[] = [
      { movimentacaoId: 'e1', lojaId: LOJA, produtoId: CAFE, tipo: 'ENTRADA', quantidade: 10, vendaId: null, motivo: null },
      { movimentacaoId: 'e2', lojaId: LOJA, produtoId: PAO, tipo: 'ENTRADA', quantidade: 5, vendaId: null, motivo: null },
    ];
    expect(saldos([...entradas, ...baixas, ...estornos])).toEqual(saldos(entradas));
  });

  it('não cancela duas vezes', () => {
    const { venda } = vendaDeExemplo();
    expect(() => cancelarVenda(venda, dados({ jaCancelada: true }))).toThrow(/já foi cancelada/);
  });

  it('no PDV, só vendas da sessão aberta; as antigas vão pelo ERP', () => {
    const { venda } = vendaDeExemplo();
    expect(() => cancelarVenda(venda, dados({ sessaoAbertaId: '019a0b7c-0000-7000-8000-0000000000c2' }))).toThrow(
      CancelamentoRecusadoError,
    );
  });

  it('precisa de motivo e de quem autorizou', () => {
    const { venda } = vendaDeExemplo();
    expect(() => cancelarVenda(venda, dados({ motivo: '' }))).toThrow(/motivo/);
    expect(() => cancelarVenda(venda, dados({ autorizadoPor: ' ' }))).toThrow(/autorizadoPor/);
  });
});
