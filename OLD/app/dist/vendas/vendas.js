import { gerarId } from '../compartilhado/id.js';
import { DadosInvalidosError, ProdutoNaoEncontradoError } from './erros.js';
import { exigirSaldo, gravarMovimentacao } from './estoque.js';
import { buscarProduto } from './produtos.js';
import { exigirInteiro, exigirTexto } from './validacao.js';
// Uma venda é um fato: não é editada nem apagada. Cancelamento será um ESTORNO.
export const ESQUEMA_VENDAS = `
  CREATE TABLE IF NOT EXISTS vendas (
    id             TEXT    PRIMARY KEY,
    numero         INTEGER NOT NULL UNIQUE CHECK (numero >= 1),
    total_centavos INTEGER NOT NULL CHECK (total_centavos >= 0),
    ocorrido_em    TEXT    NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS itens_venda (
    id                      TEXT    PRIMARY KEY,
    venda_id                TEXT    NOT NULL REFERENCES vendas (id),
    posicao                 INTEGER NOT NULL CHECK (posicao >= 1),
    produto_id              TEXT    NOT NULL REFERENCES produtos (id),
    quantidade              INTEGER NOT NULL CHECK (quantidade > 0),
    preco_unitario_centavos INTEGER NOT NULL CHECK (preco_unitario_centavos >= 0),
    movimentacao_id         TEXT    NOT NULL UNIQUE REFERENCES movimentacoes (id),
    UNIQUE (venda_id, posicao)
  ) STRICT;

  CREATE TRIGGER IF NOT EXISTS vendas_sem_update BEFORE UPDATE ON vendas
  BEGIN SELECT RAISE(ABORT, 'vendas: vendas não são editadas'); END;

  CREATE TRIGGER IF NOT EXISTS vendas_sem_delete BEFORE DELETE ON vendas
  BEGIN SELECT RAISE(ABORT, 'vendas: vendas não são apagadas'); END;

  CREATE TRIGGER IF NOT EXISTS itens_venda_sem_update BEFORE UPDATE ON itens_venda
  BEGIN SELECT RAISE(ABORT, 'itens_venda: itens não são editados'); END;

  CREATE TRIGGER IF NOT EXISTS itens_venda_sem_delete BEFORE DELETE ON itens_venda
  BEGIN SELECT RAISE(ABORT, 'itens_venda: itens não são apagados'); END;
`;
/**
 * Registra a venda numa única transação: a venda, os itens, uma movimentação
 * VENDA por item e os eventos na outbox. Se faltar estoque para qualquer
 * produto (somando os itens do mesmo produto), nada é gravado (ADR 009).
 */
export function registrarVenda(contexto, pedido) {
    if (!Array.isArray(pedido) || pedido.length === 0) {
        throw new DadosInvalidosError('itens: informe ao menos um item');
    }
    const pedidos = pedido.map((item, i) => ({
        produtoId: exigirTexto(item.produtoId, `itens[${i}].produtoId`),
        quantidade: exigirInteiro(item.quantidade, `itens[${i}].quantidade`, 'positivo'),
    }));
    const ocorridoEm = contexto.relogio().toISOString();
    const { banco, outbox } = contexto;
    return banco.transacao(() => {
        const porProduto = new Map();
        for (const { produtoId, quantidade } of pedidos) {
            porProduto.set(produtoId, (porProduto.get(produtoId) ?? 0) + quantidade);
        }
        const precos = new Map();
        for (const [produtoId, quantidade] of porProduto) {
            const produto = buscarProduto(contexto, produtoId);
            if (produto === undefined) {
                throw new ProdutoNaoEncontradoError(produtoId);
            }
            exigirSaldo(contexto, produtoId, quantidade);
            precos.set(produtoId, produto.precoCentavos);
        }
        const vendaId = gerarId();
        const itens = pedidos.map(({ produtoId, quantidade }, i) => Object.freeze({
            id: gerarId(),
            posicao: i + 1,
            produtoId,
            quantidade,
            precoUnitarioCentavos: precos.get(produtoId) ?? 0,
            movimentacaoId: gerarId(),
        }));
        const totalCentavos = itens.reduce((soma, item) => soma + item.quantidade * item.precoUnitarioCentavos, 0);
        if (!Number.isSafeInteger(totalCentavos)) {
            throw new DadosInvalidosError(`total da venda grande demais para ser exato: ${totalCentavos}`);
        }
        const ultimo = banco.consultarUma('SELECT COALESCE(MAX(numero), 0) AS numero FROM vendas');
        const venda = Object.freeze({
            id: vendaId,
            numero: Number(ultimo?.['numero']) + 1,
            totalCentavos,
            ocorridoEm,
            itens: Object.freeze(itens),
        });
        banco.rodar('INSERT INTO vendas (id, numero, total_centavos, ocorrido_em) VALUES (?, ?, ?, ?)', venda.id, venda.numero, venda.totalCentavos, venda.ocorridoEm);
        // A venda entra na outbox antes das movimentações que apontam para ela.
        outbox.adicionar('venda.registrada', {
            vendaId: venda.id,
            numero: venda.numero,
            totalCentavos: venda.totalCentavos,
            itens: itens.map((item) => ({ ...item })),
        });
        for (const item of itens) {
            gravarMovimentacao(contexto, { produtoId: item.produtoId, tipo: 'VENDA', quantidade: -item.quantidade, vendaId, motivo: null }, item.movimentacaoId);
            banco.rodar(`INSERT INTO itens_venda
           (id, venda_id, posicao, produto_id, quantidade, preco_unitario_centavos, movimentacao_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`, item.id, vendaId, item.posicao, item.produtoId, item.quantidade, item.precoUnitarioCentavos, item.movimentacaoId);
        }
        return venda;
    });
}
export function buscarVenda(contexto, vendaId) {
    const linha = contexto.banco.consultarUma('SELECT id, numero, total_centavos, ocorrido_em FROM vendas WHERE id = ?', vendaId);
    return linha === undefined ? undefined : lerVenda(contexto, linha);
}
/** Todas as vendas, em ordem de número. */
export function listarVendas(contexto) {
    const linhas = contexto.banco.consultar('SELECT id, numero, total_centavos, ocorrido_em FROM vendas ORDER BY numero');
    return Object.freeze(linhas.map((linha) => lerVenda(contexto, linha)));
}
function lerVenda(contexto, linha) {
    const id = String(linha['id']);
    const itens = contexto.banco
        .consultar(`SELECT id, posicao, produto_id, quantidade, preco_unitario_centavos, movimentacao_id
       FROM itens_venda WHERE venda_id = ? ORDER BY posicao`, id)
        .map((item) => Object.freeze({
        id: String(item['id']),
        posicao: Number(item['posicao']),
        produtoId: String(item['produto_id']),
        quantidade: Number(item['quantidade']),
        precoUnitarioCentavos: Number(item['preco_unitario_centavos']),
        movimentacaoId: String(item['movimentacao_id']),
    }));
    return Object.freeze({
        id,
        numero: Number(linha['numero']),
        totalCentavos: Number(linha['total_centavos']),
        ocorridoEm: String(linha['ocorrido_em']),
        itens: Object.freeze(itens),
    });
}
//# sourceMappingURL=vendas.js.map