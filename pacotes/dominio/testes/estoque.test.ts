// Estoque: o que cada regra garante.
import { describe, expect, it } from 'vitest';
import {
  conferirEstoque,
  DadosInvalidosError,
  EstoqueInsuficienteError,
  gerarId,
  novaEntrada,
  novoAjuste,
  saldoDe,
  saldos,
} from '../src/index.ts';
import type { Movimentacao } from '../src/index.ts';

const LOJA = '019a0b7c-0000-7000-8000-0000000000b1';
const CAFE = '019a0b7c-0000-7000-8000-0000000000a1';
const LEITE = '019a0b7c-0000-7000-8000-0000000000a2';

describe('saldo como soma das movimentações', () => {
  it('entrou 60, vendeu 2, ajustou -1: saldo 57', () => {
    const movs: Movimentacao[] = [
      novaEntrada(gerarId, { lojaId: LOJA, produtoId: CAFE, quantidade: 60, motivo: 'Nota 123' }),
      { movimentacaoId: gerarId(), lojaId: LOJA, produtoId: CAFE, tipo: 'VENDA', quantidade: -2, vendaId: gerarId(), motivo: null },
      novoAjuste(gerarId, { lojaId: LOJA, produtoId: CAFE, quantidade: -1, motivo: 'Quebra', saldoAtual: 58 }),
      novaEntrada(gerarId, { lojaId: LOJA, produtoId: LEITE, quantidade: 10 }),
    ];
    expect(saldoDe(movs, CAFE)).toBe(57);
    expect(saldoDe(movs, LEITE)).toBe(10);
    expect(saldos(movs)).toEqual(new Map([[CAFE, 57], [LEITE, 10]]));
  });

  it('produto sem movimentação tem saldo zero', () => {
    expect(saldoDe([], CAFE)).toBe(0);
  });

  it('movimentação criada é congelada: não dá para editar depois', () => {
    const m = novaEntrada(gerarId, { lojaId: LOJA, produtoId: CAFE, quantidade: 5 });
    expect(Object.isFrozen(m)).toBe(true);
    expect(() => {
      (m as { quantidade: number }).quantidade = 500;
    }).toThrow(TypeError);
  });
});

describe('entrada e ajuste', () => {
  it('entrada precisa de quantidade inteira e positiva', () => {
    expect(() => novaEntrada(gerarId, { lojaId: LOJA, produtoId: CAFE, quantidade: 0 })).toThrow(DadosInvalidosError);
    expect(() => novaEntrada(gerarId, { lojaId: LOJA, produtoId: CAFE, quantidade: -3 })).toThrow(DadosInvalidosError);
    expect(() => novaEntrada(gerarId, { lojaId: LOJA, produtoId: CAFE, quantidade: 1.5 })).toThrow(DadosInvalidosError);
  });

  it('ajuste precisa de motivo', () => {
    expect(() => novoAjuste(gerarId, { lojaId: LOJA, produtoId: CAFE, quantidade: 2, motivo: ' ', saldoAtual: 0 })).toThrow(/motivo/);
  });

  it('ajuste para menos não pode deixar o saldo negativo; para mais, sempre pode', () => {
    expect(() => novoAjuste(gerarId, { lojaId: LOJA, produtoId: CAFE, quantidade: -6, motivo: 'Contagem', saldoAtual: 5 })).toThrow(
      EstoqueInsuficienteError,
    );
    expect(novoAjuste(gerarId, { lojaId: LOJA, produtoId: CAFE, quantidade: -5, motivo: 'Contagem', saldoAtual: 5 }).quantidade).toBe(-5);
    expect(novoAjuste(gerarId, { lojaId: LOJA, produtoId: CAFE, quantidade: 8, motivo: 'Contagem', saldoAtual: -3 }).quantidade).toBe(8);
  });
});

describe('falta de estoque, conforme a regra do cliente', () => {
  const saldosAtuais = new Map([[CAFE, 3]]);

  it('com estoque suficiente, nenhum alerta em nenhuma regra', () => {
    expect(conferirEstoque(new Map([[CAFE, 3]]), saldosAtuais, 'bloquear')).toEqual([]);
    expect(conferirEstoque(new Map([[CAFE, 3]]), saldosAtuais, 'permitir_alerta')).toEqual([]);
  });

  it('"bloquear": recusa a venda e diz o saldo e o pedido', () => {
    try {
      conferirEstoque(new Map([[CAFE, 4]]), saldosAtuais, 'bloquear');
      expect.unreachable();
    } catch (erro) {
      expect(erro).toBeInstanceOf(EstoqueInsuficienteError);
      expect((erro as EstoqueInsuficienteError).saldo).toBe(3);
      expect((erro as EstoqueInsuficienteError).solicitado).toBe(4);
    }
  });

  it('"permitir_alerta": vende e avisa "estoque negativo a conferir"', () => {
    expect(conferirEstoque(new Map([[CAFE, 4], [LEITE, 1]]), saldosAtuais, 'permitir_alerta')).toEqual([
      { produtoId: CAFE, saldoAntes: 3, saldoDepois: -1 },
      { produtoId: LEITE, saldoAntes: 0, saldoDepois: -1 },
    ]);
  });
});

describe('identificador UUID v7', () => {
  it('tem o formato de UUID, versão 7, em minúsculas', () => {
    expect(gerarId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('começa com a hora: ids criados depois ficam em ordem', () => {
    const antes = gerarId(Date.UTC(2026, 0, 1));
    const depois = gerarId(Date.UTC(2026, 0, 2));
    expect(antes < depois).toBe(true);
  });

  it('não se repete', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => gerarId()));
    expect(ids.size).toBe(1000);
  });
});
