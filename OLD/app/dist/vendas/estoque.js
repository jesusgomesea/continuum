import { gerarId } from '../compartilhado/id.js';
import { EstoqueInsuficienteError, ProdutoNaoEncontradoError } from './erros.js';
import { exigirInteiro, exigirTexto } from './validacao.js';
// O sinal da quantidade é coerente com o tipo, e só VENDA aponta para uma venda.
// Movimentações nunca são editadas nem apagadas: erro se corrige com outra movimentação.
export const ESQUEMA_ESTOQUE = `
  CREATE TABLE IF NOT EXISTS movimentacoes (
    id          TEXT    PRIMARY KEY,
    produto_id  TEXT    NOT NULL REFERENCES produtos (id),
    tipo        TEXT    NOT NULL CHECK (tipo IN ('ENTRADA', 'VENDA', 'AJUSTE', 'DEVOLUCAO', 'ESTORNO')),
    quantidade  INTEGER NOT NULL CHECK (quantidade <> 0),
    venda_id    TEXT    REFERENCES vendas (id),
    motivo      TEXT,
    ocorrido_em TEXT    NOT NULL,
    CHECK (tipo NOT IN ('ENTRADA', 'DEVOLUCAO') OR quantidade > 0),
    CHECK (tipo <> 'VENDA' OR quantidade < 0),
    CHECK ((tipo = 'VENDA') = (venda_id IS NOT NULL))
  ) STRICT;

  CREATE INDEX IF NOT EXISTS movimentacoes_por_produto ON movimentacoes (produto_id);

  -- O saldo é a soma das movimentações do produto (ADR 003). Com a quantidade no
  -- índice, a soma lê só o índice, sem abrir cada linha: com 95.000 movimentações
  -- em 3 produtos, de 21 ms para 3,4 ms por produto (docs/resultados/cenario-100000.md).
  CREATE INDEX IF NOT EXISTS movimentacoes_saldo ON movimentacoes (produto_id, quantidade);

  CREATE TRIGGER IF NOT EXISTS movimentacoes_sem_update
  BEFORE UPDATE ON movimentacoes
  BEGIN
    SELECT RAISE(ABORT, 'movimentacoes: movimentações não são editadas (ADR 003)');
  END;

  CREATE TRIGGER IF NOT EXISTS movimentacoes_sem_delete
  BEFORE DELETE ON movimentacoes
  BEGIN
    SELECT RAISE(ABORT, 'movimentacoes: movimentações não são apagadas (ADR 003)');
  END;
`;
export function registrarEntrada(contexto, produtoId, quantidade, motivo) {
    exigirInteiro(quantidade, 'quantidade', 'positivo');
    const motivoValido = motivo === undefined ? null : exigirTexto(motivo, 'motivo');
    return contexto.banco.transacao(() => {
        exigirProduto(contexto, produtoId);
        return gravarMovimentacao(contexto, { produtoId, tipo: 'ENTRADA', quantidade, vendaId: null, motivo: motivoValido });
    });
}
/** Corrige o saldo (ex.: contagem física). Recusado se deixar o saldo negativo (ADR 009). */
export function registrarAjuste(contexto, produtoId, quantidade, motivo) {
    exigirInteiro(quantidade, 'quantidade', 'nao-zero');
    const motivoValido = exigirTexto(motivo, 'motivo');
    return contexto.banco.transacao(() => {
        exigirSaldo(contexto, produtoId, -quantidade);
        return gravarMovimentacao(contexto, { produtoId, tipo: 'AJUSTE', quantidade, vendaId: null, motivo: motivoValido });
    });
}
/** Saldo derivado: sempre a soma das movimentações, nunca um campo gravado (ADR 003). */
export function consultarSaldo(contexto, produtoId) {
    exigirProduto(contexto, produtoId);
    const linha = contexto.banco.consultarUma('SELECT COALESCE(SUM(quantidade), 0) AS saldo FROM movimentacoes WHERE produto_id = ?', produtoId);
    return Number(linha?.['saldo']);
}
/** Movimentações do produto na ordem em que foram gravadas neste banco. */
export function listarMovimentacoes(contexto, produtoId) {
    const linhas = contexto.banco.consultar(`SELECT id, produto_id, tipo, quantidade, venda_id, motivo, ocorrido_em
     FROM movimentacoes WHERE produto_id = ? ORDER BY rowid`, produtoId);
    return Object.freeze(linhas.map(lerMovimentacao));
}
/**
 * Garante, dentro da transação em andamento, que o produto existe e que
 * tirar `saida` unidades não deixa o saldo negativo. Uma saída negativa
 * (ajuste para cima) sempre passa.
 */
export function exigirSaldo(contexto, produtoId, saida) {
    const saldo = consultarSaldo(contexto, produtoId);
    if (saldo - saida < 0) {
        throw new EstoqueInsuficienteError(produtoId, saldo, saida);
    }
}
/**
 * Grava a movimentação e o evento na outbox. Deve ser chamada dentro de uma transação.
 * O id pode vir pronto quando outro registro (ex.: o item da venda) já o cita.
 */
export function gravarMovimentacao(contexto, dados, id = gerarId()) {
    const movimentacao = Object.freeze({
        id,
        ...dados,
        ocorridoEm: contexto.relogio().toISOString(),
    });
    contexto.banco.rodar(`INSERT INTO movimentacoes (id, produto_id, tipo, quantidade, venda_id, motivo, ocorrido_em)
     VALUES (?, ?, ?, ?, ?, ?, ?)`, movimentacao.id, movimentacao.produtoId, movimentacao.tipo, movimentacao.quantidade, movimentacao.vendaId, movimentacao.motivo, movimentacao.ocorridoEm);
    contexto.outbox.adicionar('estoque.movimentacao-registrada', {
        movimentacaoId: movimentacao.id,
        produtoId: movimentacao.produtoId,
        tipo: movimentacao.tipo,
        quantidade: movimentacao.quantidade,
        vendaId: movimentacao.vendaId,
        motivo: movimentacao.motivo,
    });
    return movimentacao;
}
function exigirProduto(contexto, produtoId) {
    if (contexto.banco.consultarUma('SELECT 1 FROM produtos WHERE id = ?', produtoId) === undefined) {
        throw new ProdutoNaoEncontradoError(produtoId);
    }
}
function lerMovimentacao(linha) {
    const textoOuNull = (valor) => (valor === null ? null : String(valor));
    return Object.freeze({
        id: String(linha['id']),
        produtoId: String(linha['produto_id']),
        tipo: String(linha['tipo']),
        quantidade: Number(linha['quantidade']),
        vendaId: textoOuNull(linha['venda_id']),
        motivo: textoOuNull(linha['motivo']),
        ocorridoEm: String(linha['ocorrido_em']),
    });
}
//# sourceMappingURL=estoque.js.map