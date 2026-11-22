// Regras de estoque. Reconstruído de OLD/app/dist/vendas/estoque.js, agora sem banco: só as regras.
//
// 1. O saldo NÃO é um número guardado: é a SOMA das movimentações (ADR 003 do OLD).
//    Entrou 60, vendeu 2, ajustou -1 → saldo 57. Nada se perde e a história explica o saldo.
// 2. Movimentação nunca é editada nem apagada: erro se corrige com outra movimentação.
// 3. Venda sem estoque depende da regra do cliente (docs/01-arquitetura.md, seção 4):
//    - 'bloquear': recusa a venda (o caixa sabe o saldo);
//    - 'permitir_alerta': vende e avisa "estoque negativo a conferir" (o cliente nunca deixa de vender).
import { DadosInvalidosError, EstoqueInsuficienteError } from './erros.ts';
import type { GeradorDeId } from './id.ts';

export type TipoMovimentacao = 'ENTRADA' | 'VENDA' | 'AJUSTE' | 'ESTORNO';
export type RegraEstoque = 'bloquear' | 'permitir_alerta';

/** Uma movimentação de estoque (mesmos campos do evento estoque.movimentacao-registrada). */
export interface Movimentacao {
  readonly movimentacaoId: string;
  readonly lojaId: string;
  readonly produtoId: string;
  readonly tipo: TipoMovimentacao;
  /** Positiva entra, negativa sai. Nunca zero. */
  readonly quantidade: number;
  /** Só no tipo VENDA. */
  readonly vendaId: string | null;
  readonly motivo: string | null;
}

/** Produto que ficaria (ou ficou) com saldo negativo numa venda permitida com alerta. */
export interface AlertaEstoque {
  readonly produtoId: string;
  readonly saldoAntes: number;
  readonly saldoDepois: number;
}

export function exigirInteiroPositivo(valor: number, campo: string): number {
  if (!Number.isSafeInteger(valor) || valor <= 0) {
    throw new DadosInvalidosError(`${campo}: informe um número inteiro maior que zero (recebido: ${String(valor)})`);
  }
  return valor;
}

export function exigirTexto(valor: string, campo: string): string {
  if (typeof valor !== 'string' || valor.trim() === '') {
    throw new DadosInvalidosError(`${campo}: informe um texto não vazio`);
  }
  return valor.trim();
}

/** Saldo de um produto: a soma das suas movimentações. */
export function saldoDe(movimentacoes: readonly Movimentacao[], produtoId: string): number {
  return movimentacoes.reduce((soma, m) => (m.produtoId === produtoId ? soma + m.quantidade : soma), 0);
}

/** Saldo de todos os produtos de uma vez. */
export function saldos(movimentacoes: readonly Movimentacao[]): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const m of movimentacoes) mapa.set(m.produtoId, (mapa.get(m.produtoId) ?? 0) + m.quantidade);
  return mapa;
}

/**
 * Confere se há estoque para tirar as quantidades pedidas (já somadas por produto).
 * Com 'bloquear', lança EstoqueInsuficienteError no primeiro produto que faltar.
 * Com 'permitir_alerta', devolve a lista de produtos que vão ficar negativos.
 */
export function conferirEstoque(
  saida: ReadonlyMap<string, number>,
  saldosAtuais: ReadonlyMap<string, number>,
  regra: RegraEstoque,
): AlertaEstoque[] {
  const alertas: AlertaEstoque[] = [];
  for (const [produtoId, quantidade] of saida) {
    const saldoAntes = saldosAtuais.get(produtoId) ?? 0;
    const saldoDepois = saldoAntes - quantidade;
    if (saldoDepois >= 0) continue;
    if (regra === 'bloquear') throw new EstoqueInsuficienteError(produtoId, saldoAntes, quantidade);
    alertas.push(Object.freeze({ produtoId, saldoAntes, saldoDepois }));
  }
  return alertas;
}

/** Entrada de mercadoria (nota, reposição): sempre positiva. */
export function novaEntrada(
  gerar: GeradorDeId,
  dados: { lojaId: string; produtoId: string; quantidade: number; motivo?: string },
): Movimentacao {
  return Object.freeze({
    movimentacaoId: gerar(),
    lojaId: dados.lojaId,
    produtoId: dados.produtoId,
    tipo: 'ENTRADA',
    quantidade: exigirInteiroPositivo(dados.quantidade, 'quantidade'),
    vendaId: null,
    motivo: dados.motivo === undefined ? null : exigirTexto(dados.motivo, 'motivo'),
  });
}

/**
 * Ajuste (contagem física, quebra, perda): pode ser para mais ou para menos, sempre com motivo.
 * Um ajuste para menos não pode deixar o saldo negativo (ADR 009 do OLD).
 */
export function novoAjuste(
  gerar: GeradorDeId,
  dados: { lojaId: string; produtoId: string; quantidade: number; motivo: string; saldoAtual: number },
): Movimentacao {
  const { quantidade, saldoAtual } = dados;
  if (!Number.isSafeInteger(quantidade) || quantidade === 0) {
    throw new DadosInvalidosError(`quantidade: informe um inteiro diferente de zero (recebido: ${String(quantidade)})`);
  }
  if (quantidade < 0 && saldoAtual + quantidade < 0) {
    throw new EstoqueInsuficienteError(dados.produtoId, saldoAtual, -quantidade);
  }
  return Object.freeze({
    movimentacaoId: gerar(),
    lojaId: dados.lojaId,
    produtoId: dados.produtoId,
    tipo: 'AJUSTE',
    quantidade,
    vendaId: null,
    motivo: exigirTexto(dados.motivo, 'motivo'),
  });
}
