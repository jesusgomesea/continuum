import { abrirBanco } from '../banco/sqlite.js';
import { aplicarEvidencia, alterarModo, confirmarProposta, ESTADOS, exigirTransicaoPermitida, MODOS, SITUACAO_INICIAL, validarParametros, } from './maquina-de-estados.js';
/**
 * Abre o banco interno do Continuum (registro geral e estado, ADR 007 e ADR
 * 012) em modo WAL: o executável do sync e o comando do operador gravam nele
 * ao mesmo tempo, e o busy_timeout de abrirBanco faz um esperar o outro.
 */
export function abrirBancoInterno(caminho) {
    const banco = abrirBanco(caminho);
    banco.executar('PRAGMA journal_mode = WAL');
    return banco;
}
const lista = (valores) => valores.map((v) => `'${v}'`).join(', ');
// Uma linha só (ADR 012). Cada mudança é uma transação que lê, decide, grava
// a linha e grava o evento no registro geral, no mesmo banco.
const ESQUEMA = `
  CREATE TABLE IF NOT EXISTS estado_continuum (
    unica              INTEGER PRIMARY KEY CHECK (unica = 1),
    estado             TEXT    NOT NULL CHECK (estado IN (${lista(ESTADOS)})),
    modo               TEXT    NOT NULL CHECK (modo IN (${lista(MODOS)})),
    falhas_seguidas    INTEGER NOT NULL CHECK (falhas_seguidas >= 0),
    sucessos_seguidos  INTEGER NOT NULL CHECK (sucessos_seguidos >= 0),
    proposta           TEXT,
    bloqueio           TEXT,
    bloqueio_alertado  TEXT,
    alterado_em        TEXT    NOT NULL
  ) STRICT;
`;
/**
 * Estado do Continuum persistido no banco interno (ADR 012). Nada fica em
 * memória: cada operação relê a linha dentro de uma transação BEGIN
 * IMMEDIATE, então dois processos podem usar o mesmo banco. O registro
 * recebido precisa ser do mesmo banco, para que transição e evento sejam
 * gravados juntos.
 */
export class EstadoSqlite {
    #banco;
    #registro;
    #parametros;
    #relogio;
    constructor(banco, registro, opcoes) {
        validarParametros(opcoes.parametros);
        this.#banco = banco;
        this.#registro = registro;
        this.#parametros = opcoes.parametros;
        this.#relogio = opcoes.relogio ?? (() => new Date());
        banco.transacao(() => {
            banco.executar(ESQUEMA);
            banco.rodar(`INSERT OR IGNORE INTO estado_continuum
           (unica, estado, modo, falhas_seguidas, sucessos_seguidos, alterado_em)
         VALUES (1, ?, ?, 0, 0, ?)`, SITUACAO_INICIAL.estado, SITUACAO_INICIAL.modo, this.#relogio().toISOString());
        });
    }
    ler() {
        const linha = this.#banco.consultarUma('SELECT * FROM estado_continuum WHERE unica = 1');
        if (linha === undefined) {
            throw new Error('estado_continuum: linha de estado ausente');
        }
        return lerLinha(linha);
    }
    /** Aplica uma evidência e registra a transição ou a proposta (ADR 012). */
    aplicar(evidencia) {
        return this.#banco.transacao(() => {
            const efeito = aplicarEvidencia(this.ler(), evidencia, this.#parametros);
            this.#gravar(efeito.situacao);
            if (efeito.transicao !== null) {
                this.#registrarTransicao(efeito.transicao, efeito.situacao.modo, false);
            }
            if (efeito.propostaNova !== null) {
                this.#registro.registrar('estado.transicao-proposta', dadosDaTransicao(efeito.propostaNova));
            }
            return efeito;
        });
    }
    /** Em MANUAL, aplica a transição proposta (comando do operador). */
    confirmar() {
        return this.#banco.transacao(() => {
            const efeito = confirmarProposta(this.ler());
            if (efeito.transicao !== null) {
                exigirTransicaoPermitida(efeito.transicao.de, efeito.transicao.para);
                this.#gravar(efeito.situacao);
                this.#registrarTransicao(efeito.transicao, efeito.situacao.modo, true);
            }
            return efeito;
        });
    }
    /** Troca o modo e devolve se trocou; trocar para o mesmo modo não grava nada. */
    alterarModo(modo) {
        if (!MODOS.includes(modo)) {
            throw new RangeError(`modo inválido: ${String(modo)} (use ${MODOS.join(', ')})`);
        }
        return this.#banco.transacao(() => {
            const atual = this.ler();
            if (atual.modo === modo) {
                return false;
            }
            this.#gravar(alterarModo(atual, modo));
            this.#registro.registrar('estado.modo-alterado', { de: atual.modo, para: modo });
            return true;
        });
    }
    /**
     * Grava o bloqueio atual da fila (null quando livre). Um bloqueio diferente
     * do último alertado gera `alerta.fila-bloqueada` no registro geral; o mesmo
     * bloqueio, mesmo depois de reiniciar, não alerta de novo. Devolve se alertou.
     */
    registrarBloqueio(bloqueio) {
        return this.#banco.transacao(() => {
            const chave = bloqueio === null ? null : chaveDoBloqueio(bloqueio);
            const linha = this.#banco.consultarUma('SELECT bloqueio_alertado FROM estado_continuum WHERE unica = 1');
            const alertado = linha?.['bloqueio_alertado'] ?? null;
            const alertar = chave !== null && chave !== alertado;
            this.#banco.rodar('UPDATE estado_continuum SET bloqueio = ?, bloqueio_alertado = ? WHERE unica = 1', bloqueio === null ? null : JSON.stringify(bloqueio), chave);
            if (alertar && bloqueio !== null) {
                this.#registro.registrar('alerta.fila-bloqueada', bloqueio);
            }
            return alertar;
        });
    }
    #gravar(situacao) {
        this.#banco.rodar(`UPDATE estado_continuum SET estado = ?, modo = ?, falhas_seguidas = ?, sucessos_seguidos = ?,
         proposta = ?, alterado_em = ? WHERE unica = 1`, situacao.estado, situacao.modo, situacao.falhasSeguidas, situacao.sucessosSeguidos, situacao.proposta === null ? null : JSON.stringify(situacao.proposta), this.#relogio().toISOString());
    }
    #registrarTransicao(transicao, modo, confirmada) {
        this.#registro.registrar('estado.transicao', { ...dadosDaTransicao(transicao), modo, confirmada });
    }
}
function dadosDaTransicao(t) {
    return { de: t.de, para: t.para, causa: t.causa, motivo: t.motivo };
}
function chaveDoBloqueio(bloqueio) {
    return `${bloqueio.motivo}:${String(bloqueio['seq'] ?? bloqueio['status'] ?? '')}`;
}
function lerJson(valor) {
    return valor === null || valor === undefined ? null : JSON.parse(String(valor));
}
function lerLinha(linha) {
    return Object.freeze({
        estado: String(linha['estado']),
        modo: String(linha['modo']),
        falhasSeguidas: Number(linha['falhas_seguidas']),
        sucessosSeguidos: Number(linha['sucessos_seguidos']),
        proposta: lerJson(linha['proposta']),
        bloqueio: lerJson(linha['bloqueio']),
        alteradoEm: String(linha['alterado_em']),
    });
}
//# sourceMappingURL=estado-sqlite.js.map