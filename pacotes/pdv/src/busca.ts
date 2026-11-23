// Busca rápida de produtos e o aviso de estoque da tela de venda.
// Só contas (sem banco, sem tela): usadas pelas telas do PDV e testadas em pacotes/pdv/testes.

/** A partir de quantas unidades o produto aparece como "estoque baixo" no caixa. */
export const ESTOQUE_BAIXO = 5;

export type NivelDeEstoque = 'normal' | 'baixo' | 'sem';

/** Sem estoque (≤ 0), baixo (≤ ESTOQUE_BAIXO) ou normal. */
export function nivelDeEstoque(saldo: number): NivelDeEstoque {
  if (saldo <= 0) return 'sem';
  if (saldo <= ESTOQUE_BAIXO) return 'baixo';
  return 'normal';
}

/** Texto para comparar: sem acento, sem maiúsculas e sem espaços sobrando ("Açúcar " → "acucar"). */
export function normalizarTexto(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Filtra o catálogo pelo que o operador digitou: cada palavra tem de aparecer no nome (em qualquer
 * ordem: "cafe 500" acha "Café 500 g"), ou o texto é o começo do código de barras.
 */
export function filtrarProdutos<P extends { nome: string; ean: string | null }>(catalogo: readonly P[], termo: string): P[] {
  const t = normalizarTexto(termo);
  if (t === '') return [...catalogo];
  const palavras = t.split(' ');
  const digitos = /^\d+$/.test(t) ? t : null;
  return catalogo.filter((p) => {
    if (digitos !== null && p.ean !== null && p.ean.startsWith(digitos)) return true;
    const nome = normalizarTexto(p.nome);
    return palavras.every((palavra) => nome.includes(palavra));
  });
}

/** O produto do código de barras exato (o que o leitor "bipou"). */
export function produtoPeloCodigo<P extends { ean: string | null }>(catalogo: readonly P[], codigo: string): P | undefined {
  const c = codigo.trim();
  return c === '' ? undefined : catalogo.find((p) => p.ean === c);
}
