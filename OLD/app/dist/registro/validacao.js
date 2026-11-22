/** Tipo ou dados de um evento rejeitados antes da gravação. */
export class EventoInvalidoError extends Error {
    name = 'EventoInvalidoError';
}
// Segmentos em minúsculas com hífen (ADR 006), separados por ponto.
const PADRAO_TIPO = /^[a-z][a-z0-9]*(-[a-z0-9]+)*(\.[a-z][a-z0-9]*(-[a-z0-9]+)*)*$/;
export function validarTipo(tipo) {
    if (typeof tipo !== 'string' || !PADRAO_TIPO.test(tipo)) {
        throw new EventoInvalidoError(`tipo de evento inválido: ${JSON.stringify(tipo)} (use minúsculas com hífen, separadas por ponto)`);
    }
}
/**
 * Valida os dados e devolve o JSON que será gravado.
 * Recusa tudo o que o JSON.stringify alteraria em silêncio, para que
 * o evento lido seja exatamente o evento registrado.
 */
export function serializarDados(dados) {
    if (!ehObjetoSimples(dados)) {
        throw new EventoInvalidoError('dados do evento devem ser um objeto JSON');
    }
    verificarValor(dados, 'dados', new Set());
    return JSON.stringify(dados);
}
/** Converte o JSON gravado de volta em dados imutáveis. */
export function desserializarDados(json) {
    return congelar(JSON.parse(json));
}
function verificarValor(valor, caminho, abertos) {
    if (valor === null || typeof valor === 'string' || typeof valor === 'boolean') {
        return;
    }
    if (typeof valor === 'number') {
        if (!Number.isFinite(valor)) {
            throw new EventoInvalidoError(`${caminho}: número não finito (${valor}) não é JSON`);
        }
        return;
    }
    if (Array.isArray(valor)) {
        entrar(valor, caminho, abertos);
        // for com índice (e não forEach) para enxergar posições vazias.
        for (let i = 0; i < valor.length; i++) {
            verificarValor(valor[i], `${caminho}[${i}]`, abertos);
        }
        abertos.delete(valor);
        return;
    }
    if (ehObjetoSimples(valor)) {
        entrar(valor, caminho, abertos);
        if (Object.getOwnPropertySymbols(valor).length > 0) {
            throw new EventoInvalidoError(`${caminho}: chaves do tipo symbol não são JSON`);
        }
        for (const [chave, item] of Object.entries(valor)) {
            verificarValor(item, `${caminho}.${chave}`, abertos);
        }
        abertos.delete(valor);
        return;
    }
    const descricao = typeof valor === 'object' ? Object.prototype.toString.call(valor).slice(8, -1) : typeof valor;
    throw new EventoInvalidoError(`${caminho}: valor do tipo ${descricao} não é JSON`);
}
function entrar(valor, caminho, abertos) {
    if (abertos.has(valor)) {
        throw new EventoInvalidoError(`${caminho}: referência circular`);
    }
    abertos.add(valor);
}
function ehObjetoSimples(valor) {
    if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) {
        return false;
    }
    const prototipo = Object.getPrototypeOf(valor);
    return prototipo === Object.prototype || prototipo === null;
}
function congelar(valor) {
    if (typeof valor === 'object' && valor !== null) {
        for (const item of Object.values(valor)) {
            congelar(item);
        }
        Object.freeze(valor);
    }
    return valor;
}
//# sourceMappingURL=validacao.js.map