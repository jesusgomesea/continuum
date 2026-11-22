/** Entrada recusada antes de gravar (ex.: quantidade não inteira, nome vazio). */
export class DadosInvalidosError extends Error {
    name = 'DadosInvalidosError';
}
export class ProdutoNaoEncontradoError extends Error {
    name = 'ProdutoNaoEncontradoError';
    produtoId;
    constructor(produtoId) {
        super(`produto não encontrado: ${produtoId}`);
        this.produtoId = produtoId;
    }
}
/**
 * A alteração partiu de uma versão que não é mais a atual (ADR 004):
 * outra alteração chegou antes. Nada é sobrescrito.
 */
export class ConflitoDeVersaoError extends Error {
    name = 'ConflitoDeVersaoError';
    produtoId;
    versionEsperada;
    versionAtual;
    constructor(produtoId, versionEsperada, versionAtual) {
        super(`conflito de versão no produto ${produtoId}: esperada ${versionEsperada}, atual ${versionAtual}`);
        this.produtoId = produtoId;
        this.versionEsperada = versionEsperada;
        this.versionAtual = versionAtual;
    }
}
/** A operação deixaria o saldo local negativo (ADR 009). Nada é gravado. */
export class EstoqueInsuficienteError extends Error {
    name = 'EstoqueInsuficienteError';
    produtoId;
    saldo;
    solicitado;
    constructor(produtoId, saldo, solicitado) {
        super(`estoque insuficiente no produto ${produtoId}: saldo ${saldo}, solicitado ${solicitado}`);
        this.produtoId = produtoId;
        this.saldo = saldo;
        this.solicitado = solicitado;
    }
}
//# sourceMappingURL=erros.js.map