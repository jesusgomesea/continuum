// O lado de quem RECEBE a fila (o agente recebendo dos caixas; depois, a nuvem recebendo dos agentes).
// Reconstruído de OLD/app/dist/cloud-api/recebimento.js, agora em SQLite.
//
// Regras, numa transação só por lote:
// - seq já recebida com o mesmo id: "repetido", ignorado (reenvio depois de uma resposta perdida);
// - a seq seguinte à última recebida: gravada e aplicada;
// - buraco na sequência, ou id diferente numa seq já recebida: "fora de ordem" (409), nada do lote fica;
// - evento fora do contrato: lote recusado (400), nada do lote fica.
import { ContratoInvalidoError, lerEvento, lerLista, lerObjeto, lerUuid } from '@continuum/contratos';
import type { Evento } from '@continuum/contratos';
import type { BancoSqlite } from './banco.ts';

/** SQL das tabelas de recebimento, para entrar nas migrações de quem recebe. */
export const SQL_RECEBIMENTO = `
  -- Cada origem (caixa) e até onde já foi recebida.
  CREATE TABLE origens (
    origem_id  TEXT    PRIMARY KEY,
    ultima_seq INTEGER NOT NULL DEFAULT 0 CHECK (ultima_seq >= 0)
  ) STRICT;

  -- Tudo o que chegou, exatamente como chegou: prova e auditoria. (origem, seq) não se repete.
  CREATE TABLE eventos_recebidos (
    origem_id   TEXT    NOT NULL REFERENCES origens (origem_id),
    seq         INTEGER NOT NULL CHECK (seq >= 1),
    id          TEXT    NOT NULL UNIQUE,
    tipo        TEXT    NOT NULL,
    versao      INTEGER NOT NULL,
    dados       TEXT    NOT NULL,
    ocorrido_em TEXT    NOT NULL,
    recebido_em TEXT    NOT NULL,
    PRIMARY KEY (origem_id, seq)
  ) STRICT;
  CREATE TRIGGER eventos_recebidos_imutaveis BEFORE UPDATE ON eventos_recebidos
  BEGIN SELECT RAISE(ABORT, 'eventos_recebidos: registros não são editados'); END;
  CREATE TRIGGER eventos_recebidos_sem_delete BEFORE DELETE ON eventos_recebidos
  BEGIN SELECT RAISE(ABORT, 'eventos_recebidos: registros não são apagados'); END;
`;

export const MAXIMO_EVENTOS_POR_LOTE = 1000;

export interface RespostaDoRecebimento {
  status: number;
  corpo: { ultimaSeq?: number; erro?: string; eventos?: { id: string; resultado: 'aplicado' | 'repetido' }[] };
}

class ForaDeOrdem extends Error {
  readonly ultimaSeq: number;
  constructor(mensagem: string, ultimaSeq: number) {
    super(mensagem);
    this.ultimaSeq = ultimaSeq;
  }
}

/** Confere a forma do lote inteiro antes de tocar no banco. */
function lerLote(corpo: unknown): Evento[] {
  const lista = lerLista(lerObjeto(corpo, 'corpo')['eventos'], 'eventos');
  if (lista.length === 0 || lista.length > MAXIMO_EVENTOS_POR_LOTE) {
    throw new ContratoInvalidoError('eventos', `informe de 1 a ${MAXIMO_EVENTOS_POR_LOTE} eventos`);
  }
  const eventos = lista.map((v, i) => lerEvento(v, `eventos[${i}]`));
  eventos.forEach((e, i) => {
    const anterior = eventos[i - 1];
    if (anterior !== undefined && e.seq !== anterior.seq + 1) {
      throw new ContratoInvalidoError(`eventos[${i}].seq`, `as seqs do lote devem ser seguidas (${anterior.seq} → ${e.seq})`);
    }
  });
  if (new Set(eventos.map((e) => e.id)).size !== eventos.length) throw new ContratoInvalidoError('eventos', 'id repetido no lote');
  return eventos;
}

/**
 * Recebe um lote de uma origem. `aoAplicar` roda para cada evento novo, dentro da mesma transação
 * (ex.: o agente atualiza o painel da loja). Nunca lança por causa do lote: devolve status e corpo.
 */
export function receberLote(
  banco: BancoSqlite,
  origemId: unknown,
  corpo: unknown,
  opcoes: { aoAplicar?: (evento: Evento, origemId: string) => void; relogio?: () => Date } = {},
): RespostaDoRecebimento {
  let origem: string;
  let eventos: Evento[];
  try {
    origem = lerUuid(origemId, 'origemId');
    eventos = lerLote(corpo);
  } catch (erro) {
    if (erro instanceof ContratoInvalidoError) return { status: 400, corpo: { erro: erro.message } };
    throw erro;
  }
  const agora = (opcoes.relogio ?? (() => new Date()))().toISOString();
  try {
    return banco.transacao(() => {
      banco.rodar('INSERT INTO origens (origem_id) VALUES (?) ON CONFLICT (origem_id) DO NOTHING', origem);
      const ultimaAntes = Number(banco.consultarUma('SELECT ultima_seq FROM origens WHERE origem_id = ?', origem)?.['ultima_seq']);
      let ultimaSeq = ultimaAntes;
      const resultados: { id: string; resultado: 'aplicado' | 'repetido' }[] = [];
      for (const e of eventos) {
        if (e.seq <= ultimaSeq) {
          const gravado = banco.consultarUma('SELECT id FROM eventos_recebidos WHERE origem_id = ? AND seq = ?', origem, e.seq)?.['id'];
          if (gravado !== e.id) throw new ForaDeOrdem(`a seq ${e.seq} já foi recebida com outro evento`, ultimaAntes);
          resultados.push({ id: e.id, resultado: 'repetido' });
          continue;
        }
        if (e.seq !== ultimaSeq + 1) throw new ForaDeOrdem(`buraco na sequência: esperada a seq ${ultimaSeq + 1}, recebida ${e.seq}`, ultimaAntes);
        if (banco.consultarUma('SELECT 1 FROM eventos_recebidos WHERE id = ?', e.id) !== undefined) {
          throw new ForaDeOrdem(`o evento ${e.id} já foi recebido em outra posição`, ultimaAntes);
        }
        banco.rodar(
          'INSERT INTO eventos_recebidos (origem_id, seq, id, tipo, versao, dados, ocorrido_em, recebido_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          origem, e.seq, e.id, e.tipo, e.versao, JSON.stringify(e.dados), e.ocorridoEm, agora,
        );
        opcoes.aoAplicar?.(e, origem);
        resultados.push({ id: e.id, resultado: 'aplicado' });
        ultimaSeq = e.seq;
      }
      if (ultimaSeq !== ultimaAntes) banco.rodar('UPDATE origens SET ultima_seq = ? WHERE origem_id = ?', ultimaSeq, origem);
      return { status: 200, corpo: { ultimaSeq, eventos: resultados } };
    });
  } catch (erro) {
    if (erro instanceof ForaDeOrdem) return { status: 409, corpo: { ultimaSeq: erro.ultimaSeq, erro: erro.message } };
    throw erro;
  }
}
