// Acesso ao banco SQLite local (caixa.db no PDV, loja.db no agente).
// Reconstruído de OLD/app/dist/banco/sqlite.js. Usa o SQLite que já vem dentro do Node (node:sqlite):
// nada para instalar e nada baixado da internet.
import { DatabaseSync } from 'node:sqlite';
import type { SQLInputValue, SQLOutputValue } from 'node:sqlite';

export type Linha = Record<string, SQLOutputValue>;
export type Parametro = SQLInputValue;

export class BancoSqlite {
  readonly caminho: string;
  #db: DatabaseSync;
  /** Quantas transações estão abertas, uma dentro da outra. */
  #nivel = 0;

  constructor(caminho: string) {
    this.caminho = caminho;
    this.#db = new DatabaseSync(caminho);
    try {
      // busy_timeout: espera outro processo liberar o banco em vez de falhar na hora.
      // synchronous FULL: a gravação só termina depois de estar no disco (queda de energia não perde venda).
      // foreign_keys: o banco confere as ligações entre tabelas (item → venda, venda → sessão...).
      // WAL: o sync lê a fila enquanto o caixa continua vendendo, sem "database is locked".
      this.#db.exec('PRAGMA busy_timeout = 5000; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;');
      if (caminho !== ':memory:') this.#db.exec('PRAGMA journal_mode = WAL;');
    } catch (erro) {
      this.#db.close();
      throw erro;
    }
  }

  /** Executa um ou mais comandos sem parâmetros (ex.: criar tabelas). */
  executar(sql: string): void {
    this.#db.exec(sql);
  }

  /** Executa um comando com parâmetros e devolve quantas linhas foram alteradas. */
  rodar(sql: string, ...parametros: Parametro[]): number {
    return Number(this.#db.prepare(sql).run(...parametros).changes);
  }

  consultar(sql: string, ...parametros: Parametro[]): Linha[] {
    return this.#db.prepare(sql).all(...parametros) as Linha[];
  }

  consultarUma(sql: string, ...parametros: Parametro[]): Linha | undefined {
    return this.#db.prepare(sql).get(...parametros) as Linha | undefined;
  }

  /**
   * Executa a operação numa transação: ou tudo é gravado, ou nada é (ADR 001 do OLD).
   * Dentro de outra transação vira um SAVEPOINT: a falha desfaz só a parte de dentro,
   * e a transação de fora decide o que fazer.
   */
  transacao<T>(operacao: () => T): T {
    const nivel = this.#nivel;
    const ponto = `ponto_${nivel}`;
    this.executar(nivel === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${ponto}`);
    this.#nivel = nivel + 1;
    try {
      const resultado = operacao();
      if (resultado instanceof Promise) {
        throw new TypeError('a operação de uma transação não pode ser assíncrona');
      }
      this.executar(nivel === 0 ? 'COMMIT' : `RELEASE ${ponto}`);
      return resultado;
    } catch (erro) {
      if (nivel === 0) {
        if (this.#db.isTransaction) this.#db.exec('ROLLBACK');
      } else {
        this.#db.exec(`ROLLBACK TO ${ponto}; RELEASE ${ponto}`);
      }
      throw erro;
    } finally {
      this.#nivel = nivel;
    }
  }

  fechar(): void {
    this.#db.close();
  }
}

/** Abre (ou cria) o banco no caminho indicado; ':memory:' cria um banco temporário (testes). */
export function abrirBanco(caminho: string): BancoSqlite {
  return new BancoSqlite(caminho);
}
