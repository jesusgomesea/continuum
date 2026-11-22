import pg from 'pg';
/**
 * O PostgreSQL não respondeu ou a conexão caiu. A operação pode ser repetida
 * quando o banco voltar. Atenção: se a conexão caiu durante o COMMIT, não há
 * como saber se ele foi confirmado; repetir só é seguro porque o recebimento
 * de eventos é idempotente (ADR 010).
 */
export class BancoIndisponivelError extends Error {
    name = 'BancoIndisponivelError';
}
/**
 * O comando foi recusado por uma regra do esquema (chave única, chave
 * estrangeira, CHECK, NOT NULL): o dado não cabe no banco como está.
 */
export class RestricaoVioladaError extends Error {
    name = 'RestricaoVioladaError';
}
const ERROS_DE_REDE = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EHOSTUNREACH', 'EAI_AGAIN']);
// SQLSTATE 08xxx: falha de conexão; 57P01 a 57P03: servidor encerrando ou ainda subindo.
const ESTADOS_INDISPONIVEL = /^(08|57P0[123])/;
function indisponivel(erro) {
    if (!(erro instanceof Error)) {
        return false;
    }
    const codigo = erro.code;
    if (typeof codigo === 'string' && (ERROS_DE_REDE.has(codigo) || ESTADOS_INDISPONIVEL.test(codigo))) {
        return true;
    }
    if (erro instanceof AggregateError) {
        return erro.errors.some(indisponivel);
    }
    // O pg avisa algumas quedas só pela mensagem: conexão perdida no meio de um
    // comando, ou comando enviado a uma conexão que já tinha caído.
    return /connection terminated|not queryable|timeout exceeded when trying to connect/i.test(erro.message);
}
function traduzir(erro) {
    if (indisponivel(erro)) {
        return new BancoIndisponivelError(`PostgreSQL indisponível: ${erro.message}`, { cause: erro });
    }
    // SQLSTATE 23xxx: violação de restrição de integridade.
    const codigo = erro?.code;
    if (erro instanceof Error && typeof codigo === 'string' && codigo.startsWith('23')) {
        return new RestricaoVioladaError(erro.message, { cause: erro });
    }
    return erro;
}
// bigint (int8) chega do pg como texto; aqui vira number, desde que seja exato.
const INT8 = 20;
function lerInt8(texto) {
    const numero = Number(texto);
    if (!Number.isSafeInteger(numero)) {
        throw new RangeError(`bigint fora da faixa exata do JavaScript: ${texto}`);
    }
    return numero;
}
const tipos = {
    getTypeParser: ((oid, formato) => oid === INT8 ? lerInt8 : pg.types.getTypeParser(oid, formato)),
};
/** Comandos SQL, disponíveis no banco e dentro de uma transação. */
export class ExecutorPg {
    #alvo;
    constructor(alvo) {
        this.#alvo = alvo;
    }
    /** Executa um ou mais comandos SQL sem parâmetros (ex.: criação de tabelas). */
    async executar(sql) {
        await this.#consulta(sql);
    }
    /** Executa um comando com parâmetros ($1, $2...) e devolve quantas linhas foram alteradas. */
    async rodar(sql, ...parametros) {
        return (await this.#consulta(sql, parametros)).rowCount ?? 0;
    }
    async consultar(sql, ...parametros) {
        return (await this.#consulta(sql, parametros)).rows;
    }
    async consultarUma(sql, ...parametros) {
        return (await this.consultar(sql, ...parametros))[0];
    }
    async #consulta(sql, parametros) {
        try {
            return await this.#alvo.query(sql, parametros);
        }
        catch (erro) {
            throw traduzir(erro);
        }
    }
}
/** Banco da nuvem simulada (ADR 010). Os comandos fora de transação usam qualquer conexão livre. */
export class BancoPostgres extends ExecutorPg {
    #pool;
    constructor(url, opcoes = {}) {
        const pool = new pg.Pool({
            connectionString: url,
            max: opcoes.maxConexoes ?? 10,
            connectionTimeoutMillis: 5000,
            types: tipos,
        });
        // Uma conexão que cai (ex.: PostgreSQL reiniciado) emite 'error': no pool, se
        // estava parada; nela mesma, se estava em uso. O comando em andamento já
        // recebe o erro, e a conexão é descartada. Sem estes ouvintes, o processo cairia.
        pool.on('error', () => { });
        pool.on('connect', (conexao) => conexao.on('error', () => { }));
        super(pool);
        this.#pool = pool;
    }
    /**
     * Executa a operação numa transação, numa conexão só dela: ou tudo é
     * gravado, ou nada é. Usa BEGIN / COMMIT / ROLLBACK explícitos. Se a
     * conexão cair no meio, o PostgreSQL desfaz a transação sozinho.
     */
    async transacao(operacao) {
        let conexao;
        try {
            conexao = await this.#pool.connect();
        }
        catch (erro) {
            throw traduzir(erro);
        }
        let descartar = false;
        try {
            const tx = new ExecutorPg(conexao);
            await tx.executar('BEGIN');
            const resultado = await operacao(tx);
            await tx.executar('COMMIT');
            return resultado;
        }
        catch (erro) {
            try {
                await conexao.query('ROLLBACK');
            }
            catch {
                descartar = true; // a conexão não serve mais; o pool abre outra
            }
            throw traduzir(erro);
        }
        finally {
            conexao.release(descartar);
        }
    }
    async fechar() {
        await this.#pool.end();
    }
}
/** Abre um pool de conexões para a URL `postgresql://usuario:senha@servidor:porta/banco`. */
export function abrirBancoPostgres(url, opcoes) {
    return new BancoPostgres(url, opcoes);
}
//# sourceMappingURL=banco-postgres.js.map