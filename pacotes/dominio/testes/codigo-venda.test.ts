// Código da venda (NOMELOJAREDUZIDO-00000-ABCD): o que cada regra garante.
import { describe, expect, it } from 'vitest';
import {
  codigoDaVenda,
  conferenciaConfere,
  conferenciaDoId,
  lerCodigoDaVenda,
  nomeReduzidoValido,
} from '../src/index.ts';

const ID = '019a0b7c-1111-7222-8333-44445555abcd';

describe('código da venda', () => {
  it('monta nome da loja, caixa + número da venda e 4 caracteres de conferência', () => {
    expect(codigoDaVenda('MERCBAIRRO', 1, 123, ID)).toBe('MERCBAIRRO-10123-ABCD');
    expect(codigoDaVenda('MERCBAIRRO', 2, 123, ID)).toBe('MERCBAIRRO-20123-ABCD');
  });

  it('dois caixas sem rede nunca geram o mesmo código para o mesmo número de venda', () => {
    expect(codigoDaVenda('LOJA', 1, 7, ID)).not.toBe(codigoDaVenda('LOJA', 2, 7, ID));
  });

  it('o número cresce além de 9999 sem quebrar o formato', () => {
    expect(codigoDaVenda('LOJA', 3, 12345, ID)).toBe('LOJA-312345-ABCD');
    expect(lerCodigoDaVenda('LOJA-312345-ABCD')).toEqual({
      nomeReduzido: 'LOJA',
      numeroCaixa: 3,
      numeroVenda: 12345,
      conferencia: 'ABCD',
    });
  });

  it('a conferência vem dos 4 últimos caracteres do id da venda, em maiúsculas', () => {
    expect(conferenciaDoId(ID)).toBe('ABCD');
    expect(() => conferenciaDoId('nao-e-uuid')).toThrow(/UUID/);
  });

  it('nome reduzido da loja: só A–Z e 0–9, até 10 caracteres', () => {
    expect(nomeReduzidoValido('MERCBAIRRO')).toBe(true);
    expect(nomeReduzidoValido('LOJA2')).toBe(true);
    expect(nomeReduzidoValido('MERCADINHO1')).toBe(false); // 11 caracteres
    expect(nomeReduzidoValido('MERC BAIRRO')).toBe(false);
    expect(nomeReduzidoValido('PADARIAJOÃO')).toBe(false);
    expect(nomeReduzidoValido('merc')).toBe(false);
    expect(nomeReduzidoValido('')).toBe(false);
  });

  it('recusa montar código com loja, caixa ou número inválidos', () => {
    expect(() => codigoDaVenda('merc bairro', 1, 1, ID)).toThrow(/Nome reduzido/);
    expect(() => codigoDaVenda('LOJA', 0, 1, ID)).toThrow(/caixa/);
    expect(() => codigoDaVenda('LOJA', 10, 1, ID)).toThrow(/caixa/);
    expect(() => codigoDaVenda('LOJA', 1, 0, ID)).toThrow(/venda/);
    expect(() => codigoDaVenda('LOJA', 1, 1.5, ID)).toThrow(/venda/);
  });

  it('lê o código digitado em minúsculas e com espaços', () => {
    expect(lerCodigoDaVenda('  mercbairro-10123-abcd ')).toEqual({
      nomeReduzido: 'MERCBAIRRO',
      numeroCaixa: 1,
      numeroVenda: 123,
      conferencia: 'ABCD',
    });
  });

  it('código com formato errado não é lido', () => {
    expect(lerCodigoDaVenda('qualquer coisa')).toBeNull();
    expect(lerCodigoDaVenda('MERCBAIRRO-00123-ABCD')).toBeNull(); // caixa 0 não existe
    expect(lerCodigoDaVenda('MERCBAIRRO-1012-ABCD')).toBeNull(); // número curto demais
    expect(lerCodigoDaVenda('MERCBAIRRO-10000-ABCD')).toBeNull(); // venda nº 0 não existe
    expect(lerCodigoDaVenda('MERCBAIRRO-10123-ABCG')).toBeNull(); // G não é hexadecimal
  });

  it('código adulterado ou digitado errado não confere com a venda', () => {
    const partes = lerCodigoDaVenda(codigoDaVenda('MERCBAIRRO', 1, 123, ID));
    expect(partes).not.toBeNull();
    if (partes === null) return;
    expect(conferenciaConfere(partes, ID)).toBe(true);
    expect(conferenciaConfere({ ...partes, conferencia: '0000' }, ID)).toBe(false);
    expect(conferenciaConfere(partes, '019a0b7c-1111-7222-8333-444455550000')).toBe(false);
  });
});
