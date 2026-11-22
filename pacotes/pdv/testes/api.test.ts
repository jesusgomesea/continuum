// A API do caixa: cada pedido das telas e cada recusa com o status e a mensagem certos.
import { describe, expect, it } from 'vitest';
import { abrirBancoDoCaixa, Caixa } from '../src/index.ts';
import { criarApi } from '../src/servidor/api.ts';
import type { EstadoDoCaixa } from '../src/servidor/api.ts';
import { CATALOGO_DEMO, ESTOQUE_INICIAL_DEMO, prepararDemonstracao } from '../src/servidor/demonstracao.ts';

function preparar() {
  const caixa = new Caixa(abrirBancoDoCaixa(':memory:'));
  prepararDemonstracao(caixa);
  const api = criarApi(caixa);
  const estado = () => api.tratar('GET', '/api/estado').corpo as EstadoDoCaixa;
  return { caixa, api, estado };
}

describe('API do caixa', () => {
  it('caixa novo vem ativado com o catálogo de demonstração; preparar de novo não duplica', () => {
    const { caixa, estado } = preparar();
    const e = estado();
    expect(e.identidade.nomeReduzido).toBe('MERCBAIRRO');
    expect(e.sessao).toBeNull();
    expect(e.catalogo).toHaveLength(CATALOGO_DEMO.length);
    expect(e.catalogo.every((p) => p.saldo === ESTOQUE_INICIAL_DEMO)).toBe(true);
    expect(prepararDemonstracao(caixa)).toBe(false);
    expect(estado().catalogo).toHaveLength(CATALOGO_DEMO.length);
  });

  it('abre o caixa, vende, cancela, faz sangria e fecha pela API', () => {
    const { api, estado } = preparar();
    expect(api.tratar('POST', '/api/caixa/abrir', { operador: 'Ana', fundoCentavos: 10000 }).status).toBe(200);
    const cafe = estado().catalogo.find((p) => p.nome.startsWith('Café'));
    if (cafe === undefined) throw new Error('café sumiu do catálogo');

    const r = api.tratar('POST', '/api/vendas', {
      itens: [{ produtoId: cafe.id, quantidade: 2 }],
      pagamentos: [{ forma: 'dinheiro', valorCentavos: 5000 }],
    });
    expect(r.status).toBe(200);
    const { venda } = r.corpo as { venda: { codigo: string; trocoCentavos: number } };
    expect(venda.trocoCentavos).toBe(1220);
    expect(estado().ultimasVendas[0]?.codigo).toBe(venda.codigo);

    expect(api.tratar('GET', `/api/vendas/${venda.codigo.toLowerCase()}`).status).toBe(200);
    expect(api.tratar('POST', `/api/vendas/${venda.codigo}/cancelar`, { motivo: 'Desistiu', autorizadoPor: 'Carla' }).status).toBe(200);
    expect(estado().ultimasVendas[0]?.cancelada).toBe(true);

    expect(api.tratar('POST', '/api/caixa/movimentar', { tipo: 'SANGRIA', valorCentavos: 5000, motivo: 'Depósito' }).status).toBe(200);
    const fechado = api.tratar('POST', '/api/caixa/fechar', { contadoCentavos: 5000 });
    expect(fechado.status).toBe(200);
    expect((fechado.corpo as { relatorio: { diferencaCentavos: number } }).relatorio.diferencaCentavos).toBe(0);
    expect(estado().sessao).toBeNull();
  });

  it('cada recusa volta com status e mensagem em português', () => {
    const { api, estado } = preparar();
    const cafe = estado().catalogo[0];
    const vender = (corpo: unknown) => api.tratar('POST', '/api/vendas', corpo);
    const item = [{ produtoId: cafe?.id, quantidade: 1 }];

    expect(vender({ itens: item, pagamentos: [] })).toMatchObject({ status: 409, corpo: { erro: 'OperacaoDeCaixaError' } });

    api.tratar('POST', '/api/caixa/abrir', { operador: 'Ana', fundoCentavos: 0 });
    const preco = cafe?.precoCentavos ?? 0;
    expect(vender({ itens: [{ produtoId: cafe?.id, quantidade: 999 }], pagamentos: [{ forma: 'pix', valorCentavos: preco * 999 }] })).toMatchObject({
      status: 422,
      corpo: { erro: 'EstoqueInsuficienteError' },
    });
    expect(vender({ itens: item, descontoCentavos: preco, pagamentos: [{ forma: 'pix', valorCentavos: 1 }] })).toMatchObject({
      status: 403,
      corpo: { erro: 'AutorizacaoNecessariaError' },
    });
    expect(vender({ itens: item, pagamentos: [{ forma: 'pix', valorCentavos: 1 }] })).toMatchObject({
      status: 400,
      corpo: { mensagem: expect.stringMatching(/menor que o total/) },
    });
    expect(vender({ itens: [{ produtoId: '019a0b7c-0000-7000-8000-0000000000ff', quantidade: 1 }], pagamentos: [] }).status).toBe(404);
    expect(api.tratar('POST', '/api/caixa/abrir', { operador: 'Bia', fundoCentavos: 0 }).status).toBe(409);
    expect(api.tratar('GET', '/api/nada').status).toBe(404);
  });
});
