// Regras de venda. Reconstruído de OLD/app/dist/vendas/vendas.js e do caixa v3
// (OLD/trabalho-em-andamento/caixa-v3-operacao-de-caixa.js), agora sem banco: só as regras.
//
// - O preço vem do CADASTRO, nunca do pedido: do operador só se usam produto, quantidade e desconto.
// - A venda é um fato: depois de montada, é congelada (não muda mais). Cancelar não altera a venda:
//   gera um cancelamento e movimentações ESTORNO, que devolvem o estoque.
// - Desconto acima do limite do cliente (padrão 10%) exige supervisor.
// - Pagamento pode ser misto (Pix + dinheiro). Troco só sai de dinheiro.
// - Quem grava tudo junto no banco (venda + baixas + evento na fila) é o Passo 1.2/1.3.
import { codigoDaVenda } from './codigo-venda.ts';
import { documentoDoCliente } from './documentos.ts';
import {
  AutorizacaoNecessariaError,
  CancelamentoRecusadoError,
  DadosInvalidosError,
  ProdutoNaoEncontradoError,
} from './erros.ts';
import { conferirEstoque, exigirInteiroPositivo, exigirTexto } from './estoque.ts';
import type { AlertaEstoque, Movimentacao, RegraEstoque } from './estoque.ts';
import { formatarReais } from './dinheiro.ts';
import type { GeradorDeId } from './id.ts';

export const FORMAS_PAGAMENTO = ['dinheiro', 'debito', 'credito', 'pix'] as const;
export type FormaPagamento = (typeof FORMAS_PAGAMENTO)[number];

/** O que o operador pede: produto, quantidade e, se houver, desconto no item. */
export interface ItemPedido {
  produtoId: string;
  quantidade: number;
  descontoCentavos?: number;
}

export interface PagamentoPedido {
  forma: FormaPagamento;
  valorCentavos: number;
}

/** Tudo o que o caixa sabe na hora de vender. */
export interface PedidoDeVenda {
  itens: readonly ItemPedido[];
  pagamentos: readonly PagamentoPedido[];
  /** Desconto dado no total da venda (além dos descontos dos itens). */
  descontoCentavos?: number;
  /** CPF ou CNPJ digitado (com ou sem pontuação), ou vazio. */
  documentoCliente?: string | null;
  /** Um supervisor autorizou (PIN conferido pela tela). Libera desconto acima do limite. */
  autorizadoPorSupervisor?: boolean;
}

/** O ambiente da venda: de onde vem, o catálogo, o estoque e as regras do cliente. */
export interface ContextoDaVenda {
  lojaId: string;
  sessaoId: string;
  nomeReduzido: string;
  numeroCaixa: number;
  /** O número desta venda no caixa (o último + 1). */
  numero: number;
  /** Preço de cadastro de cada produto. */
  precos: ReadonlyMap<string, number>;
  /** Saldo atual de cada produto (soma das movimentações). */
  saldos: ReadonlyMap<string, number>;
  regraEstoque: RegraEstoque;
  /** Limite de desconto sem supervisor, em % do bruto (padrão do cliente: 10). */
  limiteDescontoPct: number;
  gerarId: GeradorDeId;
}

export interface ItemVenda {
  readonly id: string;
  readonly posicao: number;
  readonly produtoId: string;
  readonly quantidade: number;
  readonly precoUnitarioCentavos: number;
  readonly descontoCentavos: number;
  readonly movimentacaoId: string;
}

export interface Pagamento {
  readonly id: string;
  readonly forma: FormaPagamento;
  readonly valorCentavos: number;
}

/** A venda montada (mesmos campos do evento venda.registrada). Congelada: não muda mais. */
export interface Venda {
  readonly vendaId: string;
  readonly codigo: string;
  readonly numero: number;
  readonly lojaId: string;
  readonly sessaoId: string;
  readonly itens: readonly ItemVenda[];
  readonly pagamentos: readonly Pagamento[];
  readonly brutoCentavos: number;
  readonly descontoCentavos: number;
  readonly liquidoCentavos: number;
  readonly trocoCentavos: number;
  readonly documentoCliente: string | null;
}

export interface ResultadoDaVenda {
  readonly venda: Venda;
  /** Uma baixa (tipo VENDA, quantidade negativa) por item. */
  readonly baixas: readonly Movimentacao[];
  /** Produtos que ficaram negativos (só com a regra 'permitir_alerta'). */
  readonly alertasEstoque: readonly AlertaEstoque[];
}

function exigirCentavos(valor: number, campo: string, minimo: number): number {
  if (!Number.isSafeInteger(valor) || valor < minimo) {
    throw new DadosInvalidosError(`${campo}: informe um inteiro em centavos a partir de ${minimo} (recebido: ${String(valor)})`);
  }
  return valor;
}

/** Congela o objeto e tudo dentro dele: nada pode ser alterado depois. */
function congelar<T>(valor: T): T {
  if (typeof valor === 'object' && valor !== null) {
    for (const item of Object.values(valor)) congelar(item);
    Object.freeze(valor);
  }
  return valor;
}

/**
 * Monta a venda a partir do pedido, conferindo tudo antes: produto, estoque, desconto e pagamento.
 * Se qualquer regra recusar, lança erro e nada é produzido (no banco, nada será gravado).
 */
export function montarVenda(pedido: PedidoDeVenda, ctx: ContextoDaVenda): ResultadoDaVenda {
  // 1. Itens: quantidade inteira, produto existente, preço do cadastro.
  if (!Array.isArray(pedido.itens) || pedido.itens.length === 0) {
    throw new DadosInvalidosError('itens: informe ao menos um item');
  }
  const linhas = pedido.itens.map((item, i) => {
    const quantidade = exigirInteiroPositivo(item.quantidade, `itens[${i}].quantidade`);
    const preco = ctx.precos.get(item.produtoId);
    if (preco === undefined) throw new ProdutoNaoEncontradoError(item.produtoId);
    const desconto = exigirCentavos(item.descontoCentavos ?? 0, `itens[${i}].descontoCentavos`, 0);
    if (desconto > quantidade * preco) {
      throw new DadosInvalidosError(`Desconto do item ${i + 1} maior que o valor do item.`);
    }
    return { produtoId: item.produtoId, quantidade, preco, desconto };
  });

  // 2. Estoque: soma o mesmo produto em vários itens antes de conferir (2 + 3 cafés = 5 cafés).
  const saida = new Map<string, number>();
  for (const l of linhas) saida.set(l.produtoId, (saida.get(l.produtoId) ?? 0) + l.quantidade);
  const alertasEstoque = conferirEstoque(saida, ctx.saldos, ctx.regraEstoque);

  // 3. Totais e desconto.
  const bruto = linhas.reduce((s, l) => s + l.quantidade * l.preco, 0);
  if (!Number.isSafeInteger(bruto)) throw new DadosInvalidosError('Total da venda grande demais para ser exato.');
  const descontoItens = linhas.reduce((s, l) => s + l.desconto, 0);
  const descontoVenda = exigirCentavos(pedido.descontoCentavos ?? 0, 'descontoCentavos', 0);
  const desconto = descontoItens + descontoVenda;
  if (desconto > bruto) throw new DadosInvalidosError('Desconto maior que o valor da venda.');
  // Conta em inteiros: desconto/bruto > limite%  ⇔  desconto × 100 > bruto × limite.
  if (desconto * 100 > bruto * ctx.limiteDescontoPct && pedido.autorizadoPorSupervisor !== true) {
    throw new AutorizacaoNecessariaError(
      `Desconto de ${formatarReais(desconto)} passa de ${ctx.limiteDescontoPct}%: exige autorização do supervisor.`,
    );
  }
  const liquido = bruto - desconto;

  // 4. Pagamento: tem de cobrir o líquido; o que passar é troco, e troco só sai de dinheiro.
  if (!Array.isArray(pedido.pagamentos) || pedido.pagamentos.length === 0) {
    throw new DadosInvalidosError('pagamentos: informe ao menos uma forma de pagamento');
  }
  const pagos = pedido.pagamentos.map((p, i) => {
    if (!(FORMAS_PAGAMENTO as readonly string[]).includes(p.forma)) {
      throw new DadosInvalidosError(`pagamentos[${i}].forma: use ${FORMAS_PAGAMENTO.join(', ')}`);
    }
    return { forma: p.forma, valorCentavos: exigirCentavos(p.valorCentavos, `pagamentos[${i}].valorCentavos`, 1) };
  });
  const pago = pagos.reduce((s, p) => s + p.valorCentavos, 0);
  if (pago < liquido) {
    throw new DadosInvalidosError(`Valor pago (${formatarReais(pago)}) menor que o total (${formatarReais(liquido)}).`);
  }
  const troco = pago - liquido;
  const emDinheiro = pagos.filter((p) => p.forma === 'dinheiro').reduce((s, p) => s + p.valorCentavos, 0);
  if (troco > 0 && troco >= emDinheiro) {
    throw new DadosInvalidosError('Pagamento acima do total só em dinheiro (troco só sai da gaveta).');
  }

  // 5. Documento do cliente (opcional, mas se vier, tem de ser válido).
  let documentoCliente: string | null;
  try {
    documentoCliente = documentoDoCliente(pedido.documentoCliente);
  } catch (erro) {
    throw new DadosInvalidosError((erro as Error).message);
  }

  // 6. Tudo conferido: monta a venda e as baixas, e congela.
  const vendaId = ctx.gerarId();
  const itens: ItemVenda[] = linhas.map((l, i) => ({
    id: ctx.gerarId(),
    posicao: i + 1,
    produtoId: l.produtoId,
    quantidade: l.quantidade,
    precoUnitarioCentavos: l.preco,
    descontoCentavos: l.desconto,
    movimentacaoId: ctx.gerarId(),
  }));
  const venda: Venda = {
    vendaId,
    codigo: codigoDaVenda(ctx.nomeReduzido, ctx.numeroCaixa, ctx.numero, vendaId),
    numero: ctx.numero,
    lojaId: ctx.lojaId,
    sessaoId: ctx.sessaoId,
    itens,
    pagamentos: pagos.map((p) => ({ id: ctx.gerarId(), ...p })),
    brutoCentavos: bruto,
    descontoCentavos: desconto,
    liquidoCentavos: liquido,
    trocoCentavos: troco,
    documentoCliente,
  };
  const baixas: Movimentacao[] = itens.map((item) => ({
    movimentacaoId: item.movimentacaoId,
    lojaId: ctx.lojaId,
    produtoId: item.produtoId,
    tipo: 'VENDA',
    quantidade: -item.quantidade,
    vendaId,
    motivo: null,
  }));
  return congelar({ venda, baixas, alertasEstoque });
}

export interface Cancelamento {
  readonly vendaId: string;
  readonly motivo: string;
  readonly autorizadoPor: string;
}

export interface ResultadoDoCancelamento {
  readonly cancelamento: Cancelamento;
  /** Uma movimentação ESTORNO (positiva) por item: o estoque volta. */
  readonly estornos: readonly Movimentacao[];
}

/**
 * Cancela uma venda SEM alterá-la: produz o cancelamento e os estornos de estoque.
 * Regras (do caixa v3): só uma vez, com motivo e quem autorizou, e no PDV só vendas da sessão aberta
 * (vendas antigas são devolvidas pelo ERP).
 */
export function cancelarVenda(
  venda: Venda,
  dados: { motivo: string; autorizadoPor: string; sessaoAbertaId: string; jaCancelada: boolean; gerarId: GeradorDeId },
): ResultadoDoCancelamento {
  if (dados.jaCancelada) throw new CancelamentoRecusadoError(`A venda ${venda.codigo} já foi cancelada.`);
  if (venda.sessaoId !== dados.sessaoAbertaId) {
    throw new CancelamentoRecusadoError(
      'No PDV só se cancelam vendas da sessão de caixa aberta. Vendas antigas: pelo ERP (devolução).',
    );
  }
  const motivo = exigirTexto(dados.motivo, 'motivo');
  const autorizadoPor = exigirTexto(dados.autorizadoPor, 'autorizadoPor');
  const estornos: Movimentacao[] = venda.itens.map((item) => ({
    movimentacaoId: dados.gerarId(),
    lojaId: venda.lojaId,
    produtoId: item.produtoId,
    tipo: 'ESTORNO',
    quantidade: item.quantidade,
    vendaId: null,
    motivo: `estorno da venda ${venda.codigo}: ${motivo}`,
  }));
  return congelar({ cancelamento: { vendaId: venda.vendaId, motivo, autorizadoPor }, estornos });
}
