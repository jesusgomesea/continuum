// Acesso ao PostgreSQL da nuvem, com o isolamento entre clientes (docs/04, seção 3.4).
//
// Cada pedido roda numa transação que começa dizendo ao banco "este pedido é do cliente X"
// (SET LOCAL app.cliente_id). As regras de Row Level Security do banco ESCONDEM as linhas de outros
// clientes e RECUSAM gravar em nome de outro, mesmo que o programa esqueça um filtro.
//
// Três papéis no banco:
//   continuum           dono: cria as tabelas e roda as migrações (nunca atende pedido)
//   continuum_app       o servidor do ERP: lê e grava, mas só o cliente do pedido
//   continuum_central   o Central: só lê, e enxerga todos os clientes (o consolidado do monitor)
import pg from 'pg';

export type PapelDoBanco = 'continuum_app' | 'continuum_central';

export type Linha = Record<string, unknown>;

/** O que uma transação pode fazer. */
export interface Transacao {
  consultar<T extends Linha = Linha>(sql: string, ...parametros: unknown[]): Promise<T[]>;
  consultarUma<T extends Linha = Linha>(sql: string, ...parametros: unknown[]): Promise<T | undefined>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class BancoNuvem {
  #pool: pg.Pool;

  constructor(url: string, opcoes: { maximoConexoes?: number } = {}) {
    this.#pool = new pg.Pool({ connectionString: url, max: opcoes.maximoConexoes ?? 10 });
  }

  /**
   * Abre uma transação no papel indicado. Com `clienteId`, o banco só mostra e só aceita linhas
   * desse cliente. Ou tudo é gravado, ou nada é.
   */
  async transacao<T>(papel: PapelDoBanco, clienteId: string | null, operacao: (tx: Transacao) => Promise<T>): Promise<T> {
    if (clienteId !== null && !UUID.test(clienteId)) throw new RangeError(`cliente inválido: ${clienteId}`);
    const conexao = await this.#pool.connect();
    try {
      await conexao.query('BEGIN');
      await conexao.query(`SET LOCAL ROLE ${papel}`);
      // set_config(..., true) vale só até o fim desta transação: a conexão volta limpa para o pool.
      await conexao.query("SELECT set_config('app.cliente_id', $1, true)", [clienteId ?? '']);
      const tx: Transacao = {
        consultar: async <L extends Linha>(sql: string, ...p: unknown[]) => (await conexao.query(sql, p)).rows as L[],
        consultarUma: async <L extends Linha>(sql: string, ...p: unknown[]) => (await conexao.query(sql, p)).rows[0] as L | undefined,
      };
      const resultado = await operacao(tx);
      await conexao.query('COMMIT');
      return resultado;
    } catch (erro) {
      await conexao.query('ROLLBACK').catch(() => undefined);
      throw erro;
    } finally {
      conexao.release();
    }
  }

  /**
   * Escrita da PLATAFORMA (o Central cadastrando e parametrizando clientes): roda com o acesso do dono
   * do banco, que enxerga todos os clientes. Use só nas rotas do Central, e sempre gravando a auditoria.
   */
  async transacaoDaPlataforma<T>(operacao: (tx: Transacao) => Promise<T>): Promise<T> {
    const conexao = await this.#pool.connect();
    try {
      await conexao.query('BEGIN');
      const tx: Transacao = {
        consultar: async <L extends Linha>(sql: string, ...p: unknown[]) => (await conexao.query(sql, p)).rows as L[],
        consultarUma: async <L extends Linha>(sql: string, ...p: unknown[]) => (await conexao.query(sql, p)).rows[0] as L | undefined,
      };
      const resultado = await operacao(tx);
      await conexao.query('COMMIT');
      return resultado;
    } catch (erro) {
      await conexao.query('ROLLBACK').catch(() => undefined);
      throw erro;
    } finally {
      conexao.release();
    }
  }

  /** Comandos do dono do banco (migrações). Não use para atender pedidos. */
  async comoDono<T>(operacao: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const conexao = await this.#pool.connect();
    try {
      return await operacao(conexao);
    } finally {
      conexao.release();
    }
  }

  async fechar(): Promise<void> {
    await this.#pool.end();
  }
}
