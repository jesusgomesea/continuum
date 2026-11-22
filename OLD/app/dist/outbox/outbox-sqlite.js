import { gerarId } from '../compartilhado/id.js';
import { validarSeqInicial } from '../registro/linha-evento.js';
import { desserializarDados, serializarDados, validarTipo } from '../registro/validacao.js';
// O evento nunca muda depois de gravado. A única alteração permitida é marcar
// sincronizado_em, uma única vez, quando a nuvem confirmar (Sync Engine, Fase 4).
const ESQUEMA = `
  CREATE TABLE IF NOT EXISTS outbox (
    id              TEXT    NOT NULL UNIQUE,
    seq             INTEGER PRIMARY KEY CHECK (seq >= 1),
    tipo            TEXT    NOT NULL,
    ocorrido_em     TEXT    NOT NULL,
    dados           TEXT    NOT NULL,
    sincronizado_em TEXT
  ) STRICT;

  -- Só os pendentes: contar a fila e pegar o próximo lote não varre os já
  -- sincronizados, que são quase todos (docs/resultados/cenario-100000.md).
  CREATE INDEX IF NOT EXISTS outbox_pendentes ON outbox (seq) WHERE sincronizado_em IS NULL;

  CREATE TRIGGER IF NOT EXISTS outbox_evento_imutavel
  BEFORE UPDATE OF id, seq, tipo, ocorrido_em, dados ON outbox
  BEGIN
    SELECT RAISE(ABORT, 'outbox: eventos não são editados');
  END;

  CREATE TRIGGER IF NOT EXISTS outbox_sincronizado_uma_vez
  BEFORE UPDATE OF sincronizado_em ON outbox
  WHEN OLD.sincronizado_em IS NOT NULL
  BEGIN
    SELECT RAISE(ABORT, 'outbox: evento já marcado como sincronizado');
  END;

  CREATE TRIGGER IF NOT EXISTS outbox_sem_delete
  BEFORE DELETE ON outbox
  BEGIN
    SELECT RAISE(ABORT, 'outbox: eventos não são apagados');
  END;

  -- Identidade desta origem perante a nuvem (ADR 010): uma linha só, gravada
  -- na primeira execução e nunca mais trocada.
  CREATE TABLE IF NOT EXISTS origem (
    unica     INTEGER PRIMARY KEY CHECK (unica = 1),
    id        TEXT    NOT NULL,
    criada_em TEXT    NOT NULL
  ) STRICT;

  CREATE TRIGGER IF NOT EXISTS origem_imutavel
  BEFORE UPDATE ON origem
  BEGIN
    SELECT RAISE(ABORT, 'origem: a identidade da origem não muda');
  END;

  CREATE TRIGGER IF NOT EXISTS origem_sem_delete
  BEFORE DELETE ON origem
  BEGIN
    SELECT RAISE(ABORT, 'origem: a identidade da origem não é apagada');
  END;

  -- Evento recusado de vez pela nuvem (ADR 011). Enquanto houver linha aqui,
  -- a fila desta origem fica bloqueada. Append-only, como a outbox.
  CREATE TABLE IF NOT EXISTS outbox_falhas (
    seq       INTEGER PRIMARY KEY REFERENCES outbox (seq),
    id        TEXT    NOT NULL,
    status    INTEGER NOT NULL,
    erro      TEXT    NOT NULL,
    falhou_em TEXT    NOT NULL
  ) STRICT;

  CREATE TRIGGER IF NOT EXISTS outbox_falhas_imutavel
  BEFORE UPDATE ON outbox_falhas
  BEGIN
    SELECT RAISE(ABORT, 'outbox_falhas: falhas não são editadas');
  END;

  CREATE TRIGGER IF NOT EXISTS outbox_falhas_sem_delete
  BEFORE DELETE ON outbox_falhas
  BEGIN
    SELECT RAISE(ABORT, 'outbox_falhas: falhas não são apagadas');
  END;
`;
/**
 * Outbox no banco local da aplicação (ADR 001).
 * Chamado dentro de uma transação do mesmo banco, o evento faz parte dela:
 * dado e evento são gravados juntos, ou nenhum dos dois.
 */
export class OutboxSqlite {
    /**
     * Identidade desta origem, UUID v7 (ADR 010): gerada na primeira vez que a
     * outbox é aberta neste banco e a mesma em todas as execuções seguintes.
     * Acompanha a seq dos eventos quando eles vão para a nuvem (ADR 004).
     */
    origemId;
    #banco;
    #relogio;
    constructor(banco, opcoes = {}) {
        this.#banco = banco;
        this.#relogio = opcoes.relogio ?? (() => new Date());
        // WAL (ADR 012): a aplicação grava vendas enquanto o sync, outro processo,
        // lê e marca a outbox. Sem WAL, uma leitura longa do sync bloquearia a
        // venda, que falharia com "database is locked" (fere o ADR 001). O modo
        // fica gravado no arquivo, então vale para todo processo que abrir o banco.
        banco.executar('PRAGMA journal_mode = WAL');
        // BEGIN IMMEDIATE: dois processos abrindo o banco novo ao mesmo tempo não geram duas origens.
        this.origemId = banco.transacao(() => {
            banco.executar(ESQUEMA);
            const existente = banco.consultarUma('SELECT id FROM origem');
            if (existente !== undefined) {
                return String(existente['id']);
            }
            const id = gerarId();
            banco.rodar('INSERT INTO origem (unica, id, criada_em) VALUES (1, ?, ?)', id, this.#relogio().toISOString());
            return id;
        });
    }
    adicionar(tipo, dados = {}) {
        validarTipo(tipo);
        const dadosJson = serializarDados(dados);
        const ocorridoEm = this.#relogio().toISOString();
        const id = gerarId();
        return this.#banco.transacao(() => {
            const ultima = this.#banco.consultarUma('SELECT COALESCE(MAX(seq), 0) AS seq FROM outbox');
            const seq = Number(ultima?.['seq']) + 1;
            this.#banco.rodar('INSERT INTO outbox (id, seq, tipo, ocorrido_em, dados) VALUES (?, ?, ?, ?, ?)', id, seq, tipo, ocorridoEm, dadosJson);
            return Object.freeze({ id, seq, tipo, ocorridoEm, dados: desserializarDados(dadosJson), sincronizadoEm: null });
        });
    }
    /** Lista os eventos em ordem de seq, a partir da seq informada (padrão: 1). */
    listar(aPartirDaSeq = 1) {
        validarSeqInicial(aPartirDaSeq);
        const linhas = this.#banco.consultar('SELECT id, seq, tipo, ocorrido_em, dados, sincronizado_em FROM outbox WHERE seq >= ? ORDER BY seq', aPartirDaSeq);
        return Object.freeze(linhas.map(lerLinha));
    }
    /** Os primeiros eventos ainda não sincronizados, em ordem de seq, até `limite`. */
    pendentes(limite) {
        if (!Number.isSafeInteger(limite) || limite < 1) {
            throw new RangeError(`limite inválido: ${limite} (use um inteiro a partir de 1)`);
        }
        const linhas = this.#banco.consultar('SELECT id, seq, tipo, ocorrido_em, dados, sincronizado_em FROM outbox WHERE sincronizado_em IS NULL ORDER BY seq LIMIT ?', limite);
        return Object.freeze(linhas.map(lerLinha));
    }
    /** Quantos eventos ainda não foram sincronizados (ADR 012: SINCRONIZANDO volta a SAUDÁVEL pelo tamanho da fila). */
    contarPendentes() {
        const linha = this.#banco.consultarUma('SELECT count(*) AS pendentes FROM outbox WHERE sincronizado_em IS NULL');
        return Number(linha?.['pendentes']);
    }
    /**
     * Marca como sincronizados, numa transação, os eventos pendentes com seq
     * até `ateSeq`, confirmada pela nuvem. Os já marcados ficam como estão.
     * Devolve quantos foram marcados agora.
     */
    marcarSincronizados(ateSeq) {
        if (!Number.isSafeInteger(ateSeq) || ateSeq < 0) {
            throw new RangeError(`seq inválida: ${ateSeq} (use um inteiro a partir de 0)`);
        }
        const agora = this.#relogio().toISOString();
        return this.#banco.transacao(() => this.#banco.rodar('UPDATE outbox SET sincronizado_em = ? WHERE seq <= ? AND sincronizado_em IS NULL', agora, ateSeq));
    }
    /** Grava a recusa definitiva de um evento pela nuvem (ADR 011). */
    registrarFalha(seq, status, erro) {
        const falhouEm = this.#relogio().toISOString();
        return this.#banco.transacao(() => {
            const evento = this.#banco.consultarUma('SELECT id FROM outbox WHERE seq = ?', seq);
            if (evento === undefined) {
                throw new RangeError(`outbox: não existe evento com seq ${seq}`);
            }
            const id = String(evento['id']);
            this.#banco.rodar('INSERT INTO outbox_falhas (seq, id, status, erro, falhou_em) VALUES (?, ?, ?, ?, ?)', seq, id, status, erro, falhouEm);
            return Object.freeze({ seq, id, status, erro, falhouEm });
        });
    }
    /** Falhas gravadas, em ordem de seq. Lista vazia: a fila não está bloqueada por evento. */
    falhas() {
        const linhas = this.#banco.consultar('SELECT seq, id, status, erro, falhou_em FROM outbox_falhas ORDER BY seq');
        return Object.freeze(linhas.map((linha) => Object.freeze({
            seq: Number(linha['seq']),
            id: String(linha['id']),
            status: Number(linha['status']),
            erro: String(linha['erro']),
            falhouEm: String(linha['falhou_em']),
        })));
    }
}
function lerLinha(linha) {
    const sincronizadoEm = linha['sincronizado_em'];
    return Object.freeze({
        id: String(linha['id']),
        seq: Number(linha['seq']),
        tipo: String(linha['tipo']),
        ocorridoEm: String(linha['ocorrido_em']),
        dados: desserializarDados(String(linha['dados'])),
        sincronizadoEm: sincronizadoEm === null || sincronizadoEm === undefined ? null : String(sincronizadoEm),
    });
}
//# sourceMappingURL=outbox-sqlite.js.map