// A casca de todo evento: id, seq, tipo, versão, quando aconteceu e os dados.
import { describe, expect, it } from 'vitest';
import { conferirEvento, lerEvento, TIPOS_EVENTO, versaoAtual } from '../src/index.ts';
import { envelope, produtoValido } from './exemplos.ts';

describe('envelope do evento', () => {
  it('um evento válido passa e volta com o tipo certo', () => {
    const evento = lerEvento(envelope('produto.criado', produtoValido()));
    expect(evento.tipo).toBe('produto.criado');
    if (evento.tipo === 'produto.criado') expect(evento.dados.precoCentavos).toBe(1890);
  });

  it('o sistema conhece os 8 tipos de evento do MVP, todos na versão 1', () => {
    expect(TIPOS_EVENTO).toEqual([
      'produto.criado',
      'produto.alterado',
      'estoque.movimentacao-registrada',
      'venda.registrada',
      'venda.cancelada',
      'caixa.aberto',
      'caixa.movimentado',
      'caixa.fechado',
    ]);
    for (const tipo of TIPOS_EVENTO) expect(versaoAtual(tipo)).toBe(1);
  });

  it('tipo desconhecido é recusado', () => {
    expect(() => lerEvento(envelope('venda.apagada', {}))).toThrow(/tipo de evento desconhecido/);
  });

  it('versão que o sistema ainda não conhece é recusada (e não lida pela metade)', () => {
    expect(() => lerEvento(envelope('produto.criado', produtoValido(), { versao: 2 }))).toThrow(/versão 2/);
  });

  it('id precisa ser UUID em minúsculas; seq começa em 1', () => {
    expect(() => lerEvento(envelope('produto.criado', produtoValido(), { id: 'abc' }))).toThrow(/evento\.id/);
    expect(() => lerEvento(envelope('produto.criado', produtoValido(), { seq: 0 }))).toThrow(/evento\.seq/);
  });

  it('a data precisa ser um instante real em UTC (31 de fevereiro não existe)', () => {
    expect(() => lerEvento(envelope('produto.criado', produtoValido(), { ocorridoEm: '2026-02-31T10:00:00.000Z' }))).toThrow(/ocorridoEm/);
    expect(() => lerEvento(envelope('produto.criado', produtoValido(), { ocorridoEm: '21/11/2026' }))).toThrow(/ocorridoEm/);
  });

  it('campo a mais (erro de digitação) é recusado em vez de ignorado', () => {
    expect(() => lerEvento(envelope('produto.criado', produtoValido(), { origem: 'x' }))).toThrow(/campo desconhecido/);
    expect(() => lerEvento(envelope('produto.criado', { ...produtoValido(), precoCentavo: 1 }))).toThrow(/dados\.precoCentavo/);
  });

  it('conferirEvento devolve o problema sem lançar erro (para a tela mostrar ao lado do campo)', () => {
    const r = conferirEvento(envelope('produto.criado', { ...produtoValido(), precoCentavos: -1 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.caminho).toBe('evento.dados.precoCentavos');
    expect(conferirEvento(envelope('produto.criado', produtoValido())).ok).toBe(true);
  });
});
