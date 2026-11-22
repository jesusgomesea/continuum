// Dinheiro em centavos: o que cada regra garante.
import { describe, expect, it } from 'vitest';
import { ehCentavos, formatarReais, lerReais, multiplicarCentavos, somarCentavos } from '../src/index.ts';

describe('dinheiro em centavos', () => {
  it('só aceita inteiros como centavos (nada de 18.9 guardado como número quebrado)', () => {
    expect(ehCentavos(1890)).toBe(true);
    expect(ehCentavos(-500)).toBe(true);
    expect(ehCentavos(18.9)).toBe(false);
    expect(ehCentavos(Number.NaN)).toBe(false);
    expect(ehCentavos('1890')).toBe(false);
  });

  it('soma sem erro de arredondamento: 10 + 20 centavos dá exatamente 30', () => {
    expect(somarCentavos(10, 20)).toBe(30);
    expect(somarCentavos(1890, 549, 499)).toBe(2938);
    expect(somarCentavos()).toBe(0);
  });

  it('recusa somar um valor que não é centavo inteiro', () => {
    expect(() => somarCentavos(1890, 0.5)).toThrow(/centavos/);
  });

  it('preço × quantidade: inteiro, com meio centavo arredondado para cima', () => {
    expect(multiplicarCentavos(1890, 2)).toBe(3780);
    expect(multiplicarCentavos(1999, 1.25)).toBe(2499); // 2498,75 → 2499
    expect(multiplicarCentavos(1, 0.5)).toBe(1); // meio centavo sobe
    expect(multiplicarCentavos(1890, 0)).toBe(0);
  });

  it('recusa quantidade negativa ou inválida', () => {
    expect(() => multiplicarCentavos(1890, -1)).toThrow(/quantidade/);
    expect(() => multiplicarCentavos(1890, Number.NaN)).toThrow(/quantidade/);
  });

  it('mostra em reais no padrão brasileiro, com ponto no milhar e vírgula nos centavos', () => {
    expect(formatarReais(1890)).toBe('R$ 18,90');
    expect(formatarReais(5)).toBe('R$ 0,05');
    expect(formatarReais(0)).toBe('R$ 0,00');
    expect(formatarReais(123456)).toBe('R$ 1.234,56');
    expect(formatarReais(100000000)).toBe('R$ 1.000.000,00');
    expect(formatarReais(-500)).toBe('-R$ 5,00');
  });

  it('lê o valor digitado pelo operador e devolve centavos', () => {
    expect(lerReais('18,90')).toBe(1890);
    expect(lerReais('18.90')).toBe(1890);
    expect(lerReais('R$ 1.234,56')).toBe(123456);
    expect(lerReais('1234')).toBe(123400);
    expect(lerReais('0,5')).toBe(50);
    expect(lerReais(',99')).toBe(99);
    expect(lerReais('-5,00')).toBe(-500);
  });

  it('"1.234" é lido como mil duzentos e trinta e quatro reais (ponto de milhar, costume brasileiro)', () => {
    expect(lerReais('1.234')).toBe(123400);
  });

  it('recusa texto que não é valor em reais', () => {
    expect(() => lerReais('')).toThrow(/inválido/);
    expect(() => lerReais('abc')).toThrow(/inválido/);
    expect(() => lerReais('18,905')).toThrow(/inválido/);
    expect(() => lerReais('1,2,3')).toThrow(/inválido/);
  });

  it('ida e volta: formatar e ler devolve o mesmo valor', () => {
    for (const v of [0, 1, 99, 1890, 123456, -500]) {
      expect(lerReais(formatarReais(v))).toBe(v);
    }
  });
});
