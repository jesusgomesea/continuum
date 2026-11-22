import { DatabaseSync } from 'node:sqlite';
const CONTEXTO = Symbol('contextoErroSqlite');
/** O contexto anexado a um erro do BancoSqlite, se houver. */
export function contextoDoErro(erro) {
    return typeof erro === 'object' && erro !== null ? erro[CONTEXTO] : undefined;
}
/** O começo do comando, numa linha: o bastante para saber qual operação era. */
function resumir(sql) {
    const linha = sql.replace(/\s+/g, ' ').trim();
    return linha.length > 80 ? `${linha.slice(0, 77)}...` : linha;
}
export class BancoSqlite {
    #db;
    #caminho;
    /** Quantas transações estão abertas, uma dentro da outra. */
    #nivel = 0;
    constructor(caminho) {
        this.#caminho = caminho;
        this.#db = new DatabaseSync(caminho);
        // busy_timeout primeiro: os pragmas seguintes já leem o banco e, com outro
        // processo segurando o lock, falhariam na hora em vez de esperar.
        // Commit só termina depois de gravado em disco.
        try {
            this.#db.exec('PRAGMA busy_timeout = 5000; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;');
        }
        catch (erro) {
            // Sem isso o arquivo continua aberto por este processo, e ninguém mais consegue apagá-lo.
            this.#db.close();
            throw erro;
        }
    }
    /** Executa um ou mais comandos SQL sem parâmetros (ex.: criação de tabelas). */
    executar(sql) {
        this.#comContexto(sql, () => this.#db.exec(sql));
    }
    /** Executa um comando com parâmetros e devolve quantas linhas foram alteradas. */
    rodar(sql, ...parametros) {
        return this.#comContexto(sql, () => Number(this.#db.prepare(sql).run(...parametros).changes));
    }
    consultar(sql, ...parametros) {
        return this.#comContexto(sql, () => this.#db.prepare(sql).all(...parametros));
    }
    consultarUma(sql, ...parametros) {
        return this.#comContexto(sql, () => this.#db.prepare(sql).get(...parametros));
    }
    /**
     * Executa a operação numa transação: ou tudo é gravado, ou nada é.
     * Usa BEGIN IMMEDIATE / COMMIT / ROLLBACK explícitos. Dentro de outra
     * transação, vira um SAVEPOINT: uma falha desfaz só a parte interna,
     * e a transação externa decide o que fazer.
     */
    transacao(operacao) {
        const nivel = this.#nivel;
        const ponto = `ponto_${nivel}`;
        this.executar(nivel === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${ponto}`);
        this.#nivel = nivel + 1;
        try {
            const resultado = operacao();
            if (resultado instanceof Promise) {
                // O COMMIT aconteceria antes do fim da operação assíncrona.
                throw new TypeError('a operação de uma transação não pode ser assíncrona');
            }
            this.executar(nivel === 0 ? 'COMMIT' : `RELEASE ${ponto}`);
            return resultado;
        }
        catch (erro) {
            if (nivel === 0) {
                // Se o próprio COMMIT falhou e o SQLite já desfez tudo, não há o que desfazer.
                if (this.#db.isTransaction) {
                    this.#db.exec('ROLLBACK');
                }
            }
            else {
                this.#db.exec(`ROLLBACK TO ${ponto}; RELEASE ${ponto}`);
            }
            throw erro;
        }
        finally {
            this.#nivel = nivel;
        }
    }
    fechar() {
        this.#db.close();
    }
    /** Executa e, se falhar, anexa ao erro o banco, o comando e o tempo até a falha. */
    #comContexto(sql, executar) {
        const inicio = Date.now();
        try {
            return executar();
        }
        catch (erro) {
            // Quem anota é o comando que falhou; uma chamada por fora não sobrescreve.
            if (typeof erro === 'object' && erro !== null && contextoDoErro(erro) === undefined) {
                const contexto = { banco: this.#caminho, sql: resumir(sql), esperaMs: Date.now() - inicio };
                Object.defineProperty(erro, CONTEXTO, { value: contexto });
            }
            throw erro;
        }
    }
}
/** Abre (ou cria) o banco no caminho indicado; ':memory:' cria um banco temporário. */
export function abrirBanco(caminho) {
    return new BancoSqlite(caminho);
}
//# sourceMappingURL=sqlite.js.map