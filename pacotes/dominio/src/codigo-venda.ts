// Código da venda: NOMELOJAREDUZIDO-00000-ABCD (docs/01-arquitetura.md, seção "Duas consequências").
//
// Exemplo: MERCBAIRRO-10123-7F3A
//   MERCBAIRRO → nome reduzido da loja (A–Z e 0–9, até 10 caracteres, único no cliente)
//   1          → número do caixa (1 a 9, único por loja): evita que dois caixas sem rede
//                gerem o mesmo código (decisão em aberto nº 1 do PENDENCIAS.md)
//   0123       → número sequencial da venda naquele caixa (pelo menos 4 dígitos; cresce se passar de 9999)
//   7F3A       → 4 últimos caracteres do identificador interno da venda (UUID v7), em maiúsculas.
//                Um código digitado errado (ou inventado) quase nunca bate com outra venda.
//
// Herdado do OLD (OLD/app/pdv/caixa.js), onde o formato era CX01-015855-ABCD.

const PADRAO_NOME = /^[A-Z0-9]{1,10}$/;
const PADRAO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PADRAO_CODIGO = /^([A-Z0-9]{1,10})-([1-9])(\d{4,})-([0-9A-F]{4})$/;

/** As partes de um código de venda já separadas. */
export interface PartesDoCodigo {
  nomeReduzido: string;
  numeroCaixa: number;
  numeroVenda: number;
  conferencia: string;
}

/** Nome reduzido da loja válido: só A–Z e 0–9, de 1 a 10 caracteres (sem acento, sem espaço). */
export function nomeReduzidoValido(nome: string): boolean {
  return PADRAO_NOME.test(nome);
}

/** Os 4 caracteres de conferência tirados do id da venda (os 4 últimos, em maiúsculas). */
export function conferenciaDoId(vendaId: string): string {
  if (!PADRAO_UUID.test(vendaId)) {
    throw new RangeError(`Identificador da venda inválido (esperado um UUID): "${vendaId}"`);
  }
  return vendaId.replace(/-/g, '').slice(-4).toUpperCase();
}

/** Monta o código impresso no comprovante: codigoDaVenda('MERCBAIRRO', 1, 123, id) → 'MERCBAIRRO-10123-ABCD'. */
export function codigoDaVenda(
  nomeReduzido: string,
  numeroCaixa: number,
  numeroVenda: number,
  vendaId: string,
): string {
  if (!nomeReduzidoValido(nomeReduzido)) {
    throw new RangeError(`Nome reduzido da loja inválido: "${nomeReduzido}" (use A–Z e 0–9, até 10 caracteres)`);
  }
  if (!Number.isInteger(numeroCaixa) || numeroCaixa < 1 || numeroCaixa > 9) {
    throw new RangeError(`Número do caixa inválido: ${String(numeroCaixa)} (de 1 a 9)`);
  }
  if (!Number.isSafeInteger(numeroVenda) || numeroVenda < 1) {
    throw new RangeError(`Número da venda inválido: ${String(numeroVenda)} (inteiro a partir de 1)`);
  }
  const numero = String(numeroVenda).padStart(4, '0');
  return `${nomeReduzido}-${numeroCaixa}${numero}-${conferenciaDoId(vendaId)}`;
}

/**
 * Separa um código digitado nas suas partes, ou devolve null se o formato estiver errado.
 * Aceita minúsculas e espaços nas pontas (o operador digita "mercbairro-10123-7f3a ").
 */
export function lerCodigoDaVenda(texto: string): PartesDoCodigo | null {
  const m = PADRAO_CODIGO.exec(texto.trim().toUpperCase());
  if (m === null) return null;
  const [, nomeReduzido, caixa, numero, conferencia] = m;
  if (nomeReduzido === undefined || caixa === undefined || numero === undefined || conferencia === undefined) {
    return null;
  }
  const numeroVenda = Number(numero);
  if (!Number.isSafeInteger(numeroVenda) || numeroVenda < 1) return null;
  return { nomeReduzido, numeroCaixa: Number(caixa), numeroVenda, conferencia };
}

/** Verdadeiro se os 4 caracteres de conferência do código batem com o id da venda encontrada. */
export function conferenciaConfere(partes: PartesDoCodigo, vendaId: string): boolean {
  return partes.conferencia === conferenciaDoId(vendaId);
}
