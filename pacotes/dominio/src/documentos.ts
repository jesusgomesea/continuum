// Validação de documentos e códigos: CPF, CNPJ e EAN-13.
// Reconstruído de OLD/app/comum/documentos.js, agora em TypeScript com tipos.
//
// Só confere o dígito verificador (a "conta" que os dois últimos números fazem com os outros).
// Não consulta a Receita nem cadastro nenhum: funciona sem internet, no caixa.

/** Tira tudo o que não é dígito: "123.456.789-09" → "12345678909". */
export function soDigitos(texto: string | null | undefined): string {
  return String(texto ?? '').replace(/\D/g, '');
}

/** CPF com 11 dígitos e os 2 dígitos verificadores certos. Rejeita "111.111.111-11" e afins. */
export function cpfValido(texto: string): boolean {
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

/** Os 2 dígitos verificadores do CNPJ para os 12 primeiros dígitos. */
export function dvCnpj(base12: string): string {
  const calc = (base: string, pesos: readonly number[]): number => {
    const soma = [...base].reduce((s, c, i) => s + Number(c) * (pesos[i] ?? 0), 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const d1 = calc(base12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calc(base12 + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${d1}${d2}`;
}

/** CNPJ com 14 dígitos e os 2 dígitos verificadores certos. */
export function cnpjValido(texto: string): boolean {
  const d = soDigitos(texto);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  return dvCnpj(d.slice(0, 12)) === d.slice(12);
}

/**
 * CPF ou CNPJ do cliente, guardado só com dígitos.
 * Vazio → null (o cliente não quis informar). Inválido → erro com a explicação.
 */
export function documentoDoCliente(texto: string | null | undefined): string | null {
  const d = soDigitos(texto);
  if (d === '') return null;
  if (d.length === 11 && cpfValido(d)) return d;
  if (d.length === 14 && cnpjValido(d)) return d;
  throw new RangeError(
    d.length === 14
      ? 'CNPJ inválido (dígito verificador não confere)'
      : 'CPF inválido (dígito verificador não confere)',
  );
}

/** Documento mascarado, como nos comprovantes: ***.456.789-** ou **.345.678/0001-**. */
export function mascararDocumento(d: string | null): string | null {
  if (!d) return null;
  if (d.length === 11) return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
  return `**.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-**`;
}

/** Documento com a pontuação de costume: 123.456.789-09 ou 12.345.678/0001-95. */
export function formatarDocumento(d: string | null): string | null {
  if (!d) return null;
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/** Dígito verificador do EAN-13 (código de barras) para os 12 primeiros dígitos. */
export function dvEan13(base12: string): string {
  const soma = [...base12].reduce((s, c, i) => s + Number(c) * (i % 2 === 0 ? 1 : 3), 0);
  return String((10 - (soma % 10)) % 10);
}

/** Código de barras EAN-13 com 13 dígitos e o último dígito certo. */
export function ean13Valido(texto: string): boolean {
  const d = soDigitos(texto);
  return d.length === 13 && dvEan13(d.slice(0, 12)) === d[12];
}
