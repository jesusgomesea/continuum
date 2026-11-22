import { gerarId } from '../compartilhado/id.js';
import { paraEvento, validarSeqInicial } from './linha-evento.js';
import { serializarDados, validarTipo } from './validacao.js';
/**
 * Registro geral em memória (ADR 007, Fase 1).
 * Não sobrevive ao fim do processo: serve para testes e para
 * fixar o comportamento que a versão em SQLite deve repetir.
 */
export class RegistroEventosEmMemoria {
    #linhas = [];
    #relogio;
    constructor(opcoes = {}) {
        this.#relogio = opcoes.relogio ?? (() => new Date());
    }
    registrar(tipo, dados = {}) {
        // Tudo que pode falhar acontece antes de gravar: ou o evento
        // entra inteiro, ou nada entra e a seq não avança.
        validarTipo(tipo);
        const dadosJson = serializarDados(dados);
        const ocorridoEm = this.#relogio().toISOString();
        const linha = {
            id: gerarId(),
            seq: this.#linhas.length + 1,
            tipo,
            ocorridoEm,
            dadosJson,
        };
        this.#linhas.push(linha);
        return paraEvento(linha);
    }
    listar(aPartirDaSeq = 1) {
        validarSeqInicial(aPartirDaSeq);
        return Object.freeze(this.#linhas.slice(aPartirDaSeq - 1).map(paraEvento));
    }
}
//# sourceMappingURL=registro-em-memoria.js.map