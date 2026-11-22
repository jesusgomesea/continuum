import { LoteInvalidoError } from './erros.js';
import { lerInteiro, lerLista, lerObjeto, lerTexto, lerTextoOuNull, lerUuid, lerUuidOuNull, } from './leitura.js';
const TIPOS_MOVIMENTACAO = new Set(['ENTRADA', 'VENDA', 'AJUSTE', 'DEVOLUCAO', 'ESTORNO']);
/** Confere os dados do evento conforme o tipo, antes de abrir a transação. */
export function lerFato(tipo, dados, caminho) {
    const d = lerObjeto(dados, caminho);
    switch (tipo) {
        case 'produto.criado':
            return {
                tipo,
                produtoId: lerUuid(d['produtoId'], `${caminho}.produtoId`),
                nome: lerTexto(d['nome'], `${caminho}.nome`),
                precoCentavos: lerInteiro(d['precoCentavos'], `${caminho}.precoCentavos`, 0),
                version: lerInteiro(d['version'], `${caminho}.version`, 1),
            };
        case 'produto.alterado': {
            const versionAnterior = lerInteiro(d['versionAnterior'], `${caminho}.versionAnterior`, 1);
            const version = lerInteiro(d['version'], `${caminho}.version`, 1);
            if (version !== versionAnterior + 1) {
                throw new LoteInvalidoError(`${caminho}.version: deve ser versionAnterior + 1 (ADR 004)`);
            }
            return {
                tipo,
                produtoId: lerUuid(d['produtoId'], `${caminho}.produtoId`),
                versionAnterior,
                version,
                nome: lerTexto(d['nome'], `${caminho}.nome`),
                precoCentavos: lerInteiro(d['precoCentavos'], `${caminho}.precoCentavos`, 0),
            };
        }
        case 'estoque.movimentacao-registrada': {
            const tipoMovimentacao = lerTexto(d['tipo'], `${caminho}.tipo`);
            if (!TIPOS_MOVIMENTACAO.has(tipoMovimentacao)) {
                throw new LoteInvalidoError(`${caminho}.tipo: tipo de movimentação desconhecido: ${tipoMovimentacao}`);
            }
            const quantidade = lerInteiro(d['quantidade'], `${caminho}.quantidade`);
            if (quantidade === 0) {
                throw new LoteInvalidoError(`${caminho}.quantidade: não pode ser zero (ADR 003)`);
            }
            return {
                tipo,
                movimentacaoId: lerUuid(d['movimentacaoId'], `${caminho}.movimentacaoId`),
                produtoId: lerUuid(d['produtoId'], `${caminho}.produtoId`),
                tipoMovimentacao,
                quantidade,
                vendaId: lerUuidOuNull(d['vendaId'], `${caminho}.vendaId`),
                motivo: lerTextoOuNull(d['motivo'], `${caminho}.motivo`),
            };
        }
        case 'venda.registrada': {
            const itens = lerLista(d['itens'], `${caminho}.itens`).map((valor, i) => lerItem(valor, `${caminho}.itens[${i}]`));
            if (itens.length === 0) {
                throw new LoteInvalidoError(`${caminho}.itens: a venda precisa de ao menos um item`);
            }
            const totalCentavos = lerInteiro(d['totalCentavos'], `${caminho}.totalCentavos`, 0);
            const soma = itens.reduce((total, item) => total + item.quantidade * item.precoUnitarioCentavos, 0);
            if (soma !== totalCentavos) {
                throw new LoteInvalidoError(`${caminho}.totalCentavos: ${totalCentavos} não bate com a soma dos itens (${soma})`);
            }
            return {
                tipo,
                vendaId: lerUuid(d['vendaId'], `${caminho}.vendaId`),
                numero: lerInteiro(d['numero'], `${caminho}.numero`, 1),
                totalCentavos,
                itens,
            };
        }
        default:
            throw new LoteInvalidoError(`${caminho}: a nuvem não conhece o tipo de evento ${JSON.stringify(tipo)}`);
    }
}
function lerItem(valor, caminho) {
    const item = lerObjeto(valor, caminho);
    return {
        id: lerUuid(item['id'], `${caminho}.id`),
        posicao: lerInteiro(item['posicao'], `${caminho}.posicao`, 1),
        produtoId: lerUuid(item['produtoId'], `${caminho}.produtoId`),
        quantidade: lerInteiro(item['quantidade'], `${caminho}.quantidade`, 1),
        precoUnitarioCentavos: lerInteiro(item['precoUnitarioCentavos'], `${caminho}.precoUnitarioCentavos`, 0),
        movimentacaoId: lerUuid(item['movimentacaoId'], `${caminho}.movimentacaoId`),
    };
}
/**
 * Aplica o fato aos dados consolidados, dentro da transação do lote.
 * Devolve 'conflito' quando um produto.alterado não parte da version atual
 * da nuvem: o conflito é registrado e o produto fica como está (ADR 004).
 */
export async function aplicarFato(tx, fato, contexto) {
    const { origemId, eventoId, ocorridoEm } = contexto;
    switch (fato.tipo) {
        case 'produto.criado':
            await tx.rodar(`INSERT INTO produtos (id, nome, preco_centavos, version, criado_em, alterado_em)
         VALUES ($1, $2, $3, $4, $5, $5)`, fato.produtoId, fato.nome, fato.precoCentavos, fato.version, ocorridoEm);
            return 'aplicado';
        case 'produto.alterado': {
            const alteradas = await tx.rodar(`UPDATE produtos SET nome = $1, preco_centavos = $2, version = $3, alterado_em = $4
         WHERE id = $5 AND version = $6`, fato.nome, fato.precoCentavos, fato.version, ocorridoEm, fato.produtoId, fato.versionAnterior);
            if (alteradas === 1) {
                return 'aplicado';
            }
            const atual = await tx.consultarUma('SELECT version FROM produtos WHERE id = $1', fato.produtoId);
            await tx.rodar(`INSERT INTO conflitos (evento_id, produto_id, version_esperada, version_atual) VALUES ($1, $2, $3, $4)`, eventoId, fato.produtoId, fato.versionAnterior, atual === undefined ? null : Number(atual['version']));
            return 'conflito';
        }
        case 'estoque.movimentacao-registrada':
            await tx.rodar(`INSERT INTO movimentacoes (id, produto_id, tipo, quantidade, venda_id, motivo, ocorrido_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`, fato.movimentacaoId, fato.produtoId, fato.tipoMovimentacao, fato.quantidade, fato.vendaId, fato.motivo, ocorridoEm);
            return 'aplicado';
        case 'venda.registrada':
            await tx.rodar(`INSERT INTO vendas (id, origem_id, numero, total_centavos, ocorrido_em) VALUES ($1, $2, $3, $4, $5)`, fato.vendaId, origemId, fato.numero, fato.totalCentavos, ocorridoEm);
            for (const item of fato.itens) {
                await tx.rodar(`INSERT INTO itens_venda
             (id, venda_id, posicao, produto_id, quantidade, preco_unitario_centavos, movimentacao_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`, item.id, fato.vendaId, item.posicao, item.produtoId, item.quantidade, item.precoUnitarioCentavos, item.movimentacaoId);
            }
            return 'aplicado';
    }
}
//# sourceMappingURL=aplicacao.js.map