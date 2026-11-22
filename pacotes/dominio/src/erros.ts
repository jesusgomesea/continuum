// Os "nãos" do domínio: cada recusa tem um nome, para a tela mostrar a mensagem certa.
// Reconstruído de OLD/app/dist/vendas/erros.js, mais os erros do caixa v3 (OLD/trabalho-em-andamento).

/** Pedido recusado antes de qualquer conta (quantidade quebrada, item vazio, pagamento a menos...). */
export class DadosInvalidosError extends Error {
  override name = 'DadosInvalidosError';
}

export class ProdutoNaoEncontradoError extends Error {
  override name = 'ProdutoNaoEncontradoError';
  readonly produtoId: string;
  constructor(produtoId: string) {
    super(`Produto não encontrado: ${produtoId}`);
    this.produtoId = produtoId;
  }
}

/** A venda (ou o ajuste) deixaria o saldo negativo, e a regra da loja é bloquear. Nada é gravado. */
export class EstoqueInsuficienteError extends Error {
  override name = 'EstoqueInsuficienteError';
  readonly produtoId: string;
  readonly saldo: number;
  readonly solicitado: number;
  constructor(produtoId: string, saldo: number, solicitado: number) {
    super(`Estoque insuficiente: saldo ${saldo}, pedido ${solicitado} (produto ${produtoId})`);
    this.produtoId = produtoId;
    this.saldo = saldo;
    this.solicitado = solicitado;
  }
}

/** A operação passa do que o operador pode fazer sozinho e exige um supervisor. */
export class AutorizacaoNecessariaError extends Error {
  override name = 'AutorizacaoNecessariaError';
}

/** Venda já cancelada ou que não pode ser cancelada por este caminho. */
export class CancelamentoRecusadoError extends Error {
  override name = 'CancelamentoRecusadoError';
}
