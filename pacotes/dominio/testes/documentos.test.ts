// CPF, CNPJ e EAN-13: o que cada regra garante (mesmo comportamento do OLD).
import { describe, expect, it } from 'vitest';
import {
  cnpjValido,
  cpfValido,
  documentoDoCliente,
  dvCnpj,
  dvEan13,
  ean13Valido,
  formatarDocumento,
  mascararDocumento,
  soDigitos,
} from '../src/index.ts';

describe('documentos', () => {
  it('ignora pontuação: só os dígitos importam', () => {
    expect(soDigitos('529.982.247-25')).toBe('52998224725');
    expect(soDigitos(null)).toBe('');
    expect(soDigitos(undefined)).toBe('');
  });

  it('CPF válido passa, com ou sem pontuação', () => {
    expect(cpfValido('529.982.247-25')).toBe(true);
    expect(cpfValido('52998224725')).toBe(true);
  });

  it('CPF com dígito errado, tamanho errado ou todo repetido não passa', () => {
    expect(cpfValido('529.982.247-26')).toBe(false);
    expect(cpfValido('5299822472')).toBe(false);
    expect(cpfValido('111.111.111-11')).toBe(false);
  });

  it('CNPJ válido passa; dígito errado ou repetido não passa', () => {
    expect(cnpjValido('11.222.333/0001-81')).toBe(true);
    expect(cnpjValido('11.222.333/0001-82')).toBe(false);
    expect(cnpjValido('00.000.000/0000-00')).toBe(false);
    expect(dvCnpj('112223330001')).toBe('81');
  });

  it('documento do cliente: vazio vira "não informado"; válido fica só com dígitos', () => {
    expect(documentoDoCliente('')).toBeNull();
    expect(documentoDoCliente(null)).toBeNull();
    expect(documentoDoCliente('529.982.247-25')).toBe('52998224725');
    expect(documentoDoCliente('11.222.333/0001-81')).toBe('11222333000181');
  });

  it('documento do cliente inválido é recusado com a explicação', () => {
    expect(() => documentoDoCliente('529.982.247-26')).toThrow(/CPF inválido/);
    expect(() => documentoDoCliente('11.222.333/0001-82')).toThrow(/CNPJ inválido/);
  });

  it('no comprovante o documento aparece mascarado (privacidade do cliente)', () => {
    expect(mascararDocumento('52998224725')).toBe('***.982.247-**');
    expect(mascararDocumento('11222333000181')).toBe('**.222.333/0001-**');
    expect(mascararDocumento(null)).toBeNull();
  });

  it('formata com a pontuação de costume', () => {
    expect(formatarDocumento('52998224725')).toBe('529.982.247-25');
    expect(formatarDocumento('11222333000181')).toBe('11.222.333/0001-81');
  });

  it('EAN-13 (código de barras): confere o último dígito', () => {
    expect(ean13Valido('4006381333931')).toBe(true);
    expect(ean13Valido('4006381333932')).toBe(false);
    expect(ean13Valido('400638133393')).toBe(false);
    expect(dvEan13('400638133393')).toBe('1');
  });
});
