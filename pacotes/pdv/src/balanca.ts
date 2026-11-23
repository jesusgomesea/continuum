// Etiqueta de balança: o código de barras que a balança da loja imprime para o produto pesado
// (frios, carnes, hortifrúti). É um EAN-13 de "uso interno" (começa com 2) que carrega o produto E o peso.
//
// Convenção adotada no Continuum (a mais comum nas balanças brasileiras, ex.: Toledo, Filizola):
//
//     2  CCCC  0  PPPPPP  D
//     │   │    │    │     └─ dígito verificador do EAN-13 (a mesma conta de qualquer código de barras)
//     │   │    │    └─────── peso em GRAMAS, 6 dígitos (000350 = 350 g; até 999,999 kg)
//     │   │    └──────────── separador fixo: 0
//     │   └───────────────── código do produto na balança, 4 dígitos
//     └───────────────────── prefixo 2: código de uso interno da loja
//
// Como o caixa sabe QUAL produto é? O produto pesado é cadastrado no ERP com unidade 'kg' e com o EAN
// "da etiqueta vazia": 2 + CCCC + 0 + 000000 + D (peso zero). O caixa casa os 6 primeiros dígitos
// (2CCCC0) da etiqueta lida com os 6 primeiros do EAN cadastrado. Assim não precisa de campo novo no
// cadastro nem no contrato.
//
// Este arquivo só tem contas (sem banco, sem tela): roda no servidor do caixa, nas telas e nos testes.
import { dvEan13, soDigitos } from '@continuum/dominio';

export interface EtiquetaDeBalanca {
  /** O código do produto na balança, 4 dígitos (ex.: "0123"). */
  codigoProduto: string;
  /** Os 6 primeiros dígitos (2CCCC0): é o que casa com o EAN cadastrado do produto. */
  prefixo: string;
  /** Peso em gramas (inteiro). */
  pesoGramas: number;
}

/**
 * Lê uma etiqueta de balança. Devolve undefined se o texto não for uma etiqueta no formato acima
 * (não começa com 2, não tem 13 dígitos, separador diferente de 0, dígito verificador errado ou peso zero).
 * Um EAN comum (789...) devolve undefined: a tela trata como código de barras normal.
 */
export function lerEtiquetaDeBalanca(texto: string): EtiquetaDeBalanca | undefined {
  const d = String(texto ?? '').trim();
  if (!/^\d{13}$/.test(d)) return undefined;
  if (d[0] !== '2' || d[5] !== '0') return undefined;
  if (dvEan13(d.slice(0, 12)) !== d[12]) return undefined;
  const pesoGramas = Number(d.slice(6, 12));
  if (pesoGramas <= 0) return undefined;
  return { codigoProduto: d.slice(1, 5), prefixo: d.slice(0, 6), pesoGramas };
}

/** O EAN "da etiqueta vazia" para cadastrar o produto pesado no ERP: 2 + código + 0 + 000000 + D. */
export function eanDoProdutoDeBalanca(codigoProduto: string): string {
  const codigo = soDigitos(codigoProduto);
  if (!/^\d{1,4}$/.test(codigo)) throw new RangeError('Código de balança: de 1 a 4 números.');
  const base = `2${codigo.padStart(4, '0')}0000000`;
  return base + dvEan13(base);
}

/** Acha, no catálogo, o produto pesado (unidade 'kg') da etiqueta. */
export function produtoDaEtiqueta<P extends { ean: string | null; unidade: string }>(
  catalogo: readonly P[],
  etiqueta: EtiquetaDeBalanca,
): P | undefined {
  return catalogo.find((p) => p.unidade === 'kg' && p.ean !== null && p.ean.startsWith(etiqueta.prefixo));
}

/**
 * Quanto da etiqueta o caixa consegue lançar HOJE. A quantidade da venda é inteira em todo o
 * Continuum (regra do dominio, contrato venda.registrada, colunas INTEGER do banco), e o preço do
 * produto 'kg' é por quilo: então só cabe peso em quilos inteiros (1000 g → 1, 2000 g → 2).
 * Peso quebrado (350 g) devolve null: a tela avisa o operador em vez de cobrar errado.
 */
export function quantidadeDaEtiqueta(etiqueta: EtiquetaDeBalanca): number | null {
  return etiqueta.pesoGramas % 1000 === 0 ? etiqueta.pesoGramas / 1000 : null;
}

/** Peso para mostrar ao operador: 350 g → "0,350 kg". */
export function formatarPeso(gramas: number): string {
  return `${(gramas / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg`;
}
