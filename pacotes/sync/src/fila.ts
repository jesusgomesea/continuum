// A fila (outbox): tudo o que aconteceu no caixa e ainda precisa seguir adiante.
// Reconstruída de OLD/app/dist/outbox/outbox-sqlite.js.
//
// Regras:
// - Regra de ouro (ADR 001 do OLD): chamada dentro da transação da venda, o evento faz parte dela.
//   Venda e evento são gravados juntos, ou nenhum dos dois.
// - Só entra na fila evento que passa no contrato (pacote contratos): nada torto viaja.
// - O evento nunca muda. A única marca permitida é "sincronizado", uma vez só, quando o próximo elo confirma.
// - A seq (1, 2, 3...) nunca se repete, nem depois da limpeza: quem recebe usa a seq para não duplicar.
// - Evento recusado de vez vai para outbox_falhas e BLOQUEIA a fila até alguém analisar (ADR 011 do OLD).
// - Limpeza: eventos já confirmados podem ser apagados depois de 90 dias (o caixa não enche).
import { lerEvento, versaoAtual } from '@continuum/contratos';
import type { Evento, TipoEvento } from '@continuum/contratos';
import { gerarId } from '@continuum/dominio';
import type { BancoSqlite, Linha } from './banco.ts';

/** SQL da fila, para entrar na lista de migrações de cada banco local. */
export const SQL_FILA = `
  CREATE TABLE outbox (
    -- AUTOINCREMENT: a seq nunca é reaproveitada, mesmo depois de apagar eventos antigos.
    seq             INTEGER PRIMARY KEY AUTOINCREMENT,
    id              TEXT    NOT NULL UNIQUE,
    tipo            TEXT    NOT NULL,
    versao          INTEGER NOT NULL CHECK (versao >= 1),
    dados           TEXT    NOT NULL,
    ocorrido_em     TEXT    NOT NULL,
    sincronizado_em TEXT
  ) STRICT;

  -- Só os pendentes: contar a fila e pegar o próximo lote não varre os já enviados.
  CREATE INDEX outbox_pendentes ON outbox (seq) WHERE sincronizado_em IS NULL;

  CREATE TRIGGER outbox_evento_imutavel BEFORE UPDATE OF id, seq, tipo, versao, dados, ocorrido_em ON outbox
  BEGIN SELECT RAISE(ABORT, 'outbox: eventos não são editados'); END;

  CREATE TRIGGER outbox_sincronizado_uma_vez BEFORE UPDATE OF sincronizado_em ON outbox
  WHEN OLD.sincronizado_em IS NOT NULL
  BEGIN SELECT RAISE(ABORT, 'outbox: evento já marcado como sincronizado'); END;

  CREATE TRIGGER outbox_so_apaga_sincronizado BEFORE DELETE ON outbox
  WHEN OLD.sincronizado_em IS NULL
  BEGIN SELECT RAISE(ABORT, 'outbox: evento ainda não sincronizado não pode ser apagado'); END;

  CREATE TABLE outbox_falhas (
    seq       INTEGER PRIMARY KEY REFERENCES outbox (seq),
    status    INTEGER NOT NULL,
    erro      TEXT    NOT NULL,
    falhou_em TEXT    NOT NULL
  ) STRICT;

  CREATE TRIGGER outbox_falhas_imutavel BEFORE UPDATE ON outbox_falhas
  BEGIN SELECT RAISE(ABORT, 'outbox_falhas: falhas não são editadas'); END;
`;

/** Evento na fila: o evento do contrato mais a marca de sincronizado. */
export type EventoNaFila = Evento & { readonly sincronizadoEm: string | null };

export interface Falha {
  readonly seq: number;
  readonly status: number;
  readonly erro: string;
  readonly falhouEm: string;
}

export interface OpcoesDaFila {
  relogio?: () => Date;
  gerarId?: () => string;
}

/** Quantos dias um evento já confirmado fica no caixa antes de poder ser apagado. */
export const DIAS_ATE_LIMPAR = 90;

export class Fila {
  #banco: BancoSqlite;
  #relogio: () => Date;
  #gerarId: () => string;

  constructor(banco: BancoSqlite, opcoes: OpcoesDaFila = {}) {
    this.#banco = banco;
    this.#relogio = opcoes.relogio ?? (() => new Date());
    this.#gerarId = opcoes.gerarId ?? (() => gerarId());
  }

  /**
   * Põe um evento na fila, conferido pelo contrato. Chame dentro da transação do dado
   * (venda, abertura de caixa...): se a transação desfizer, o evento some junto.
   */
  adicionar<T extends TipoEvento>(tipo: T, dados: Extract<Evento, { tipo: T }>['dados']): EventoNaFila {
    const id = this.#gerarId();
    const ocorridoEm = this.#relogio().toISOString();
    const versao = versaoAtual(tipo);
    // Confere ANTES de gravar. A seq definitiva vem do banco; aqui basta uma seq válida.
    const conferido = lerEvento({ id, seq: 1, tipo, versao, ocorridoEm, dados });
    const dadosJson = JSON.stringify(conferido.dados);
    return this.#banco.transacao(() => {
      this.#banco.rodar(
        'INSERT INTO outbox (id, tipo, versao, dados, ocorrido_em) VALUES (?, ?, ?, ?, ?)',
        id, tipo, versao, dadosJson, ocorridoEm,
      );
      const seq = Number(this.#banco.consultarUma('SELECT seq FROM outbox WHERE id = ?', id)?.['seq']);
      return Object.freeze({ ...conferido, seq, sincronizadoEm: null }) as EventoNaFila;
    });
  }

  /** Os primeiros eventos ainda não sincronizados, em ordem, até `limite`. */
  pendentes(limite: number): EventoNaFila[] {
    if (!Number.isSafeInteger(limite) || limite < 1) throw new RangeError(`limite inválido: ${limite}`);
    return this.#banco
      .consultar('SELECT * FROM outbox WHERE sincronizado_em IS NULL ORDER BY seq LIMIT ?', limite)
      .map(lerLinha);
  }

  /** Eventos a partir da seq indicada, enviados ou não (para reenviar o que o destino perdeu). */
  aPartirDe(seq: number, limite: number): EventoNaFila[] {
    return this.#banco.consultar('SELECT * FROM outbox WHERE seq >= ? ORDER BY seq LIMIT ?', seq, limite).map(lerLinha);
  }

  /** Todos os eventos guardados, em ordem (para conferência e testes). */
  todos(): EventoNaFila[] {
    return this.#banco.consultar('SELECT * FROM outbox ORDER BY seq').map(lerLinha);
  }

  contarPendentes(): number {
    return Number(this.#banco.consultarUma('SELECT count(*) AS n FROM outbox WHERE sincronizado_em IS NULL')?.['n']);
  }

  /** O próximo elo confirmou "recebido até a seq N": marca os pendentes até N. Devolve quantos marcou. */
  marcarSincronizados(ateSeq: number): number {
    if (!Number.isSafeInteger(ateSeq) || ateSeq < 0) throw new RangeError(`seq inválida: ${ateSeq}`);
    const agora = this.#relogio().toISOString();
    return this.#banco.transacao(() =>
      this.#banco.rodar('UPDATE outbox SET sincronizado_em = ? WHERE seq <= ? AND sincronizado_em IS NULL', agora, ateSeq),
    );
  }

  /** Grava a recusa definitiva de um evento. A partir daí a fila fica bloqueada. */
  registrarFalha(seq: number, status: number, erro: string): Falha {
    const falhouEm = this.#relogio().toISOString();
    return this.#banco.transacao(() => {
      if (this.#banco.consultarUma('SELECT 1 FROM outbox WHERE seq = ?', seq) === undefined) {
        throw new RangeError(`outbox: não existe evento com seq ${seq}`);
      }
      this.#banco.rodar('INSERT INTO outbox_falhas (seq, status, erro, falhou_em) VALUES (?, ?, ?, ?)', seq, status, erro, falhouEm);
      return Object.freeze({ seq, status, erro, falhouEm });
    });
  }

  falhas(): Falha[] {
    return this.#banco.consultar('SELECT * FROM outbox_falhas ORDER BY seq').map((l) =>
      Object.freeze({ seq: Number(l['seq']), status: Number(l['status']), erro: String(l['erro']), falhouEm: String(l['falhou_em']) }),
    );
  }

  /** Fila parada por evento recusado: nada mais é enviado até a análise. */
  bloqueada(): boolean {
    return this.#banco.consultarUma('SELECT 1 FROM outbox_falhas LIMIT 1') !== undefined;
  }

  /** Apaga os eventos confirmados há mais de 90 dias. Pendentes nunca são apagados. Devolve quantos apagou. */
  limparSincronizados(): number {
    const limite = new Date(this.#relogio().getTime() - DIAS_ATE_LIMPAR * 24 * 60 * 60 * 1000).toISOString();
    return this.#banco.transacao(() =>
      this.#banco.rodar('DELETE FROM outbox WHERE sincronizado_em IS NOT NULL AND sincronizado_em < ?', limite),
    );
  }
}

function lerLinha(l: Linha): EventoNaFila {
  const sincronizadoEm = l['sincronizado_em'];
  return Object.freeze({
    id: String(l['id']),
    seq: Number(l['seq']),
    tipo: String(l['tipo']),
    versao: Number(l['versao']),
    ocorridoEm: String(l['ocorrido_em']),
    dados: JSON.parse(String(l['dados'])) as unknown,
    sincronizadoEm: sincronizadoEm === null || sincronizadoEm === undefined ? null : String(sincronizadoEm),
  }) as EventoNaFila;
}
