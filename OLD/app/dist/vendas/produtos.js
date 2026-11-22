import { gerarId } from '../compartilhado/id.js';
import { ConflitoDeVersaoError, DadosInvalidosError, ProdutoNaoEncontradoError } from './erros.js';
import { exigirInteiro, exigirTexto } from './validacao.js';
export const ESQUEMA_PRODUTOS = `
  CREATE TABLE IF NOT EXISTS produtos (
    id             TEXT    PRIMARY KEY,
    nome           TEXT    NOT NULL CHECK (trim(nome) <> ''),
    preco_centavos INTEGER NOT NULL CHECK (preco_centavos >= 0),
    version        INTEGER NOT NULL CHECK (version >= 1),
    criado_em      TEXT    NOT NULL,
    alterado_em    TEXT    NOT NULL
  ) STRICT;
`;
export function criarProduto(contexto, novo) {
    const nome = exigirTexto(novo.nome, 'nome');
    const precoCentavos = exigirInteiro(novo.precoCentavos, 'precoCentavos', 'nao-negativo');
    const agora = contexto.relogio().toISOString();
    const produto = Object.freeze({
        id: gerarId(),
        nome,
        precoCentavos,
        version: 1,
        criadoEm: agora,
        alteradoEm: agora,
    });
    const { banco, outbox } = contexto;
    banco.transacao(() => {
        banco.rodar(`INSERT INTO produtos (id, nome, preco_centavos, version, criado_em, alterado_em)
       VALUES (?, ?, ?, ?, ?, ?)`, produto.id, produto.nome, produto.precoCentavos, produto.version, produto.criadoEm, produto.alteradoEm);
        outbox.adicionar('produto.criado', {
            produtoId: produto.id,
            nome: produto.nome,
            precoCentavos: produto.precoCentavos,
            version: produto.version,
        });
    });
    return produto;
}
/**
 * Altera o cadastro a partir da versão que o chamador tinha em mãos (ADR 004).
 * Se outra alteração chegou antes, lança ConflitoDeVersaoError e nada é gravado.
 */
export function alterarProduto(contexto, produtoId, versionEsperada, mudancas) {
    exigirInteiro(versionEsperada, 'versionEsperada', 'positivo');
    if (mudancas.nome === undefined && mudancas.precoCentavos === undefined) {
        throw new DadosInvalidosError('informe ao menos uma mudança (nome ou precoCentavos)');
    }
    const nome = mudancas.nome === undefined ? undefined : exigirTexto(mudancas.nome, 'nome');
    const precoCentavos = mudancas.precoCentavos === undefined
        ? undefined
        : exigirInteiro(mudancas.precoCentavos, 'precoCentavos', 'nao-negativo');
    const agora = contexto.relogio().toISOString();
    const { banco, outbox } = contexto;
    return banco.transacao(() => {
        const atual = buscarProduto(contexto, produtoId);
        if (atual === undefined) {
            throw new ProdutoNaoEncontradoError(produtoId);
        }
        if (atual.version !== versionEsperada) {
            throw new ConflitoDeVersaoError(produtoId, versionEsperada, atual.version);
        }
        const alterado = Object.freeze({
            ...atual,
            nome: nome ?? atual.nome,
            precoCentavos: precoCentavos ?? atual.precoCentavos,
            version: atual.version + 1,
            alteradoEm: agora,
        });
        // O "AND version = ?" protege mesmo se a leitura acima ficar fora da transação um dia.
        const alteradas = banco.rodar(`UPDATE produtos SET nome = ?, preco_centavos = ?, version = ?, alterado_em = ?
       WHERE id = ? AND version = ?`, alterado.nome, alterado.precoCentavos, alterado.version, alterado.alteradoEm, produtoId, versionEsperada);
        if (alteradas !== 1) {
            throw new ConflitoDeVersaoError(produtoId, versionEsperada, atual.version);
        }
        outbox.adicionar('produto.alterado', {
            produtoId,
            versionAnterior: versionEsperada,
            version: alterado.version,
            nome: alterado.nome,
            precoCentavos: alterado.precoCentavos,
        });
        return alterado;
    });
}
export function buscarProduto(contexto, produtoId) {
    const linha = contexto.banco.consultarUma('SELECT id, nome, preco_centavos, version, criado_em, alterado_em FROM produtos WHERE id = ?', produtoId);
    return linha === undefined ? undefined : lerProduto(linha);
}
/** Todos os produtos, do mais antigo ao mais novo (UUID v7 ordena pela criação, ADR 002). */
export function listarProdutos(contexto) {
    return contexto.banco
        .consultar('SELECT id, nome, preco_centavos, version, criado_em, alterado_em FROM produtos ORDER BY id')
        .map(lerProduto);
}
function lerProduto(linha) {
    return Object.freeze({
        id: String(linha['id']),
        nome: String(linha['nome']),
        precoCentavos: Number(linha['preco_centavos']),
        version: Number(linha['version']),
        criadoEm: String(linha['criado_em']),
        alteradoEm: String(linha['alterado_em']),
    });
}
//# sourceMappingURL=produtos.js.map