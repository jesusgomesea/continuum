import { OutboxSqlite } from '../outbox/outbox-sqlite.js';
import { consultarSaldo, ESQUEMA_ESTOQUE, listarMovimentacoes, registrarAjuste, registrarEntrada, } from './estoque.js';
import { alterarProduto, buscarProduto, criarProduto, ESQUEMA_PRODUTOS, listarProdutos, } from './produtos.js';
import { buscarVenda, ESQUEMA_VENDAS, listarVendas, registrarVenda } from './vendas.js';
/**
 * Sistema de vendas do LAB (Fase 2). Toda operação grava o dado e o evento
 * na outbox na mesma transação do banco local (ADR 001).
 */
export class LabVendas {
    outbox;
    #contexto;
    constructor(banco, opcoes = {}) {
        const relogio = opcoes.relogio ?? (() => new Date());
        this.outbox = new OutboxSqlite(banco, { relogio });
        this.#contexto = { banco, outbox: this.outbox, relogio };
        banco.transacao(() => {
            banco.executar(ESQUEMA_PRODUTOS);
            banco.executar(ESQUEMA_ESTOQUE);
            banco.executar(ESQUEMA_VENDAS);
        });
    }
    criarProduto(novo) {
        return criarProduto(this.#contexto, novo);
    }
    alterarProduto(produtoId, versionEsperada, mudancas) {
        return alterarProduto(this.#contexto, produtoId, versionEsperada, mudancas);
    }
    buscarProduto(produtoId) {
        return buscarProduto(this.#contexto, produtoId);
    }
    produtos() {
        return listarProdutos(this.#contexto);
    }
    registrarEntrada(produtoId, quantidade, motivo) {
        return registrarEntrada(this.#contexto, produtoId, quantidade, motivo);
    }
    registrarAjuste(produtoId, quantidade, motivo) {
        return registrarAjuste(this.#contexto, produtoId, quantidade, motivo);
    }
    saldo(produtoId) {
        return consultarSaldo(this.#contexto, produtoId);
    }
    movimentacoes(produtoId) {
        return listarMovimentacoes(this.#contexto, produtoId);
    }
    registrarVenda(itens) {
        return registrarVenda(this.#contexto, itens);
    }
    buscarVenda(vendaId) {
        return buscarVenda(this.#contexto, vendaId);
    }
    vendas() {
        return listarVendas(this.#contexto);
    }
}
//# sourceMappingURL=lab-vendas.js.map