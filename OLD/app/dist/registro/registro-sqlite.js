import { gerarId } from '../compartilhado/id.js';
import { paraEvento, validarSeqInicial } from './linha-evento.js';
import { serializarDados, validarTipo } from './validacao.js';
// Append-only também no banco: os gatilhos recusam UPDATE e DELETE (ADR 007).
const ESQUEMA = `
  CREATE TABLE IF NOT EXISTS registro_eventos (
    id          TEXT    NOT NULL UNIQUE,
    seq         INTEGER PRIMARY KEY CHECK (seq >= 1),
    tipo        TEXT    NOT NULL,
    ocorrido_em TEXT    NOT NULL,
    dados       TEXT    NOT NULL
  ) STRICT;

  CREATE TRIGGER IF NOT EXISTS registro_eventos_sem_update
  BEFORE UPDATE ON registro_eventos
  BEGIN
    SELECT RAISE(ABORT, 'registro_eventos é append-only: eventos não são editados');
  END;

  CREATE TRIGGER IF NOT EXISTS registro_eventos_sem_delete
  BEFORE DELETE ON registro_eventos
  BEGIN
    SELECT RAISE(ABORT, 'registro_eventos é append-only: eventos não são apagados');
  END;
`;
/**
 * Registro geral em SQLite (ADR 007 e ADR 008).
 * Cada evento é gravado numa transação. Chamado dentro de uma transação
 * do mesmo banco, o evento passa a fazer parte dela: se ela for desfeita,
 * o evento também é, e a seq não avança.
 */
export class RegistroEventosSqlite {
    #banco;
    #relogio;
    constructor(banco, opcoes = {}) {
        this.#banco = banco;
        this.#relogio = opcoes.relogio ?? (() => new Date());
        banco.transacao(() => banco.executar(ESQUEMA));
    }
    registrar(tipo, dados = {}) {
        // Validação antes de abrir a transação, como na versão em memória.
        validarTipo(tipo);
        const dadosJson = serializarDados(dados);
        const ocorridoEm = this.#relogio().toISOString();
        const id = gerarId();
        return this.#banco.transacao(() => {
            // Dentro da transação (BEGIN IMMEDIATE), nenhum outro processo
            // grava entre a leitura da última seq e o INSERT.
            const ultima = this.#banco.consultarUma('SELECT COALESCE(MAX(seq), 0) AS seq FROM registro_eventos');
            const linha = { id, seq: Number(ultima?.['seq']) + 1, tipo, ocorridoEm, dadosJson };
            this.#banco.rodar('INSERT INTO registro_eventos (id, seq, tipo, ocorrido_em, dados) VALUES (?, ?, ?, ?, ?)', linha.id, linha.seq, linha.tipo, linha.ocorridoEm, linha.dadosJson);
            return paraEvento(linha);
        });
    }
    listar(aPartirDaSeq = 1) {
        validarSeqInicial(aPartirDaSeq);
        const linhas = this.#banco.consultar('SELECT id, seq, tipo, ocorrido_em, dados FROM registro_eventos WHERE seq >= ? ORDER BY seq', aPartirDaSeq);
        return Object.freeze(linhas.map((linha) => paraEvento(lerLinha(linha))));
    }
}
function lerLinha(linha) {
    return {
        id: String(linha['id']),
        seq: Number(linha['seq']),
        tipo: String(linha['tipo']),
        ocorridoEm: String(linha['ocorrido_em']),
        dadosJson: String(linha['dados']),
    };
}
//# sourceMappingURL=registro-sqlite.js.map