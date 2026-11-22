// Validação de documentos e códigos (comum ao PDV e ao ERP): CPF, CNPJ e EAN-13.
// Só o dígito verificador: não consulta Receita nem cadastro nenhum.

export const soDigitos = (texto) => String(texto ?? '').replace(/\D/g, '');

export function cpfValido(texto) {
  const d = soDigitos(texto);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  for (const tamanho of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < tamanho; i++) soma += Number(d[i]) * (tamanho + 1 - i);
    const dv = ((soma * 10) % 11) % 10;
    if (dv !== Number(d[tamanho])) return false;
  }
  return true;
}

/** Dígitos verificadores do CNPJ para os 12 primeiros dígitos. */
export function dvCnpj(base12) {
  const calc = (base, pesos) => {
    const soma = [...base].reduce((s, c, i) => s + Number(c) * pesos[i], 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const d1 = calc(base12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calc(base12 + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${d1}${d2}`;
}

export function cnpjValido(texto) {
  const d = soDigitos(texto);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  return dvCnpj(d.slice(0, 12)) === d.slice(12);
}

/** CPF ou CNPJ válido, normalizado só com dígitos; null se vazio; lança se inválido. */
export function documentoDoCliente(texto) {
  const d = soDigitos(texto);
  if (d === '') return null;
  if (d.length === 11 && cpfValido(d)) return d;
  if (d.length === 14 && cnpjValido(d)) return d;
  throw new RangeError(d.length === 14 ? 'CNPJ inválido (dígito verificador não confere)' : 'CPF inválido (dígito verificador não confere)');
}

/** Mostra o documento mascarado, como nos cupons: ***.456.789-** ou **.345.678/0001-**. */
export function mascararDocumento(d) {
  if (!d) return null;
  if (d.length === 11) return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
  return `**.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-**`;
}

export function formatarDocumento(d) {
  if (!d) return null;
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/** Dígito verificador do EAN-13 para os 12 primeiros dígitos. */
export function dvEan13(base12) {
  const soma = [...base12].reduce((s, c, i) => s + Number(c) * (i % 2 === 0 ? 1 : 3), 0);
  return String((10 - (soma % 10)) % 10);
}

export function ean13Valido(texto) {
  const d = soDigitos(texto);
  return d.length === 13 && dvEan13(d.slice(0, 12)) === d[12];
}
