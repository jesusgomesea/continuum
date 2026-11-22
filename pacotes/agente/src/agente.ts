// O agente da loja: recebe a fila de cada caixa (vendas, caixa aberto, sangria...), guarda tudo no
// loja.db sem duplicar e mostra, ao vivo, a situação de cada caixa (o sinal de vida).
//
// Nesta etapa o agente RECEBE e MOSTRA. Repassar para a nuvem (ERP) entra quando a nuvem existir
// (Passo 2.1, que depende do PostgreSQL), e aplicar o estoque da loja entra quando o catálogo descer
// do ERP (Passos 3.1 e 3.3): até lá, cada caixa tem os seus próprios produtos de demonstração.
import { lerSinalDeVida } from '@continuum/contratos';
import type { SinalDeVida } from '@continuum/contratos';
import { abrirBanco, aplicarMigracoes, receberLote, SQL_RECEBIMENTO } from '@continuum/sync';
import type { BancoSqlite, Migracao, RespostaDoRecebimento } from '@continuum/sync';

export const MIGRACOES_LOJA: readonly Migracao[] = [
  { numero: 1, nome: 'recebimento', sql: SQL_RECEBIMENTO },
  {
    numero: 2,
    nome: 'sinais_de_vida',
    sql: `
      -- Só o último sinal de cada caixa (uma linha, sobrescrita): alimenta o painel.
      CREATE TABLE sinais_de_vida (
        dispositivo_id TEXT PRIMARY KEY,
        dados          TEXT NOT NULL,
        recebido_em    TEXT NOT NULL
      ) STRICT;
      CREATE TABLE config_local (
        chave TEXT PRIMARY KEY,
        valor TEXT NOT NULL
      ) STRICT;
    `,
  },
];

/** Depois de quanto tempo sem sinal o caixa aparece como "sem sinal" no painel. */
export const SEGUNDOS_ATE_SEM_SINAL = 45;

export interface CaixaNoPainel {
  dispositivoId: string;
  /** Até onde a fila deste caixa já chegou ao agente. */
  ultimaSeq: number;
  sinal: (SinalDeVida & { recebidoEm: string; segundosSemSinal: number; semSinal: boolean }) | null;
  vendas: { quantidade: number; liquidoCentavos: number; canceladas: number };
  ultimasVendas: { codigo: string; liquidoCentavos: number; ocorridoEm: string; cancelada: boolean }[];
}

export function abrirBancoDaLoja(caminho: string): BancoSqlite {
  const banco = abrirBanco(caminho);
  aplicarMigracoes(banco, MIGRACOES_LOJA);
  return banco;
}

export class Agente {
  #banco: BancoSqlite;
  #relogio: () => Date;

  constructor(banco: BancoSqlite, opcoes: { relogio?: () => Date } = {}) {
    this.#banco = banco;
    this.#relogio = opcoes.relogio ?? (() => new Date());
  }

  /** Recebe um lote da fila de um caixa (mesmas regras de ordem e duplicidade da nuvem). */
  receberLote(origemId: unknown, corpo: unknown): RespostaDoRecebimento {
    return receberLote(this.#banco, origemId, corpo, { relogio: this.#relogio });
  }

  /** Guarda o último sinal de vida do caixa. Devolve false se o sinal estiver fora do contrato. */
  receberSinal(corpo: unknown): { ok: true } | { ok: false; erro: string } {
    try {
      const sinal = lerSinalDeVida(corpo);
      this.#banco.rodar(
        `INSERT INTO sinais_de_vida (dispositivo_id, dados, recebido_em) VALUES (?, ?, ?)
         ON CONFLICT (dispositivo_id) DO UPDATE SET dados = excluded.dados, recebido_em = excluded.recebido_em`,
        sinal.dispositivoId, JSON.stringify(sinal), this.#relogio().toISOString(),
      );
      return { ok: true };
    } catch (erro) {
      return { ok: false, erro: (erro as Error).message };
    }
  }

  /** A situação de cada caixa da loja: sinal de vida, fila recebida e vendas. */
  painel(): CaixaNoPainel[] {
    const agora = this.#relogio().getTime();
    const ids = new Set<string>([
      ...this.#banco.consultar('SELECT origem_id FROM origens').map((l) => String(l['origem_id'])),
      ...this.#banco.consultar('SELECT dispositivo_id FROM sinais_de_vida').map((l) => String(l['dispositivo_id'])),
    ]);
    return [...ids].map((id) => {
      const origem = this.#banco.consultarUma('SELECT ultima_seq FROM origens WHERE origem_id = ?', id);
      const s = this.#banco.consultarUma('SELECT dados, recebido_em FROM sinais_de_vida WHERE dispositivo_id = ?', id);
      let sinal: CaixaNoPainel['sinal'] = null;
      if (s !== undefined) {
        const recebidoEm = String(s['recebido_em']);
        const segundosSemSinal = Math.max(0, Math.round((agora - new Date(recebidoEm).getTime()) / 1000));
        sinal = { ...(JSON.parse(String(s['dados'])) as SinalDeVida), recebidoEm, segundosSemSinal, semSinal: segundosSemSinal > SEGUNDOS_ATE_SEM_SINAL };
      }
      const canceladas = new Set(
        this.#banco
          .consultar("SELECT json_extract(dados, '$.vendaId') AS v FROM eventos_recebidos WHERE origem_id = ? AND tipo = 'venda.cancelada'", id)
          .map((l) => String(l['v'])),
      );
      const vendas = this.#banco
        .consultar(
          `SELECT json_extract(dados, '$.vendaId') AS venda_id, json_extract(dados, '$.codigo') AS codigo,
                  json_extract(dados, '$.liquidoCentavos') AS liquido, ocorrido_em
           FROM eventos_recebidos WHERE origem_id = ? AND tipo = 'venda.registrada' ORDER BY seq DESC`,
          id,
        )
        .map((l) => ({
          codigo: String(l['codigo']),
          liquidoCentavos: Number(l['liquido']),
          ocorridoEm: String(l['ocorrido_em']),
          cancelada: canceladas.has(String(l['venda_id'])),
        }));
      const validas = vendas.filter((v) => !v.cancelada);
      return {
        dispositivoId: id,
        ultimaSeq: Number(origem?.['ultima_seq'] ?? 0),
        sinal,
        vendas: { quantidade: validas.length, liquidoCentavos: validas.reduce((t, v) => t + v.liquidoCentavos, 0), canceladas: vendas.length - validas.length },
        ultimasVendas: vendas.slice(0, 8),
      };
    });
  }
}
