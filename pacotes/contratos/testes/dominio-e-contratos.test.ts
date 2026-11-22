// Domínio e contratos falam a mesma língua: o que as regras de venda (Passo 1.1) produzem
// passa, sem ajuste, na conferência dos eventos (Passo 0.4).
import { cancelarVenda, gerarId, montarVenda } from '@continuum/dominio';
import { describe, expect, it } from 'vitest';
import { lerEvento } from '../src/index.ts';

const LOJA = gerarId();
const SESSAO = gerarId();
const CAFE = gerarId();
const PAO = gerarId();

const envelope = (seq: number, tipo: string, dados: unknown) => ({
  id: gerarId(),
  seq,
  tipo,
  versao: 1,
  ocorridoEm: new Date().toISOString(),
  dados,
});

describe('domínio → contratos', () => {
  it('venda, baixas, cancelamento e estornos viram eventos válidos', () => {
    const { venda, baixas } = montarVenda(
      {
        itens: [{ produtoId: CAFE, quantidade: 2, descontoCentavos: 100 }, { produtoId: PAO, quantidade: 1 }],
        pagamentos: [{ forma: 'pix', valorCentavos: 2000 }, { forma: 'dinheiro', valorCentavos: 3000 }],
        documentoCliente: '529.982.247-25',
      },
      {
        lojaId: LOJA,
        sessaoId: SESSAO,
        nomeReduzido: 'MERCBAIRRO',
        numeroCaixa: 2,
        numero: 1,
        precos: new Map([[CAFE, 1890], [PAO, 899]]),
        saldos: new Map([[CAFE, 10], [PAO, 10]]),
        regraEstoque: 'bloquear',
        limiteDescontoPct: 10,
        gerarId: () => gerarId(),
      },
    );
    const { cancelamento, estornos } = cancelarVenda(venda, {
      motivo: 'Cliente desistiu',
      autorizadoPor: 'Ana',
      sessaoAbertaId: SESSAO,
      jaCancelada: false,
      gerarId: () => gerarId(),
    });

    const eventos = [
      envelope(1, 'venda.registrada', venda),
      ...baixas.map((b, i) => envelope(2 + i, 'estoque.movimentacao-registrada', b)),
      envelope(4, 'venda.cancelada', cancelamento),
      ...estornos.map((e, i) => envelope(5 + i, 'estoque.movimentacao-registrada', e)),
    ];
    for (const e of eventos) expect(() => lerEvento(e)).not.toThrow();
    expect(lerEvento(eventos[0]).tipo).toBe('venda.registrada');
  });
});
