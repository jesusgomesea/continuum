import { LoteInvalidoError } from './erros.js';
// Só a forma canônica, em minúsculas: o PostgreSQL devolve assim, e o id
// recebido é comparado com o gravado (ADR 002).
const PADRAO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// ISO 8601 em UTC com milissegundos, como Date.toISOString() grava na origem.
const PADRAO_INSTANTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
export function lerObjeto(valor, caminho) {
    if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) {
        throw new LoteInvalidoError(`${caminho}: informe um objeto`);
    }
    return valor;
}
export function lerLista(valor, caminho) {
    if (!Array.isArray(valor)) {
        throw new LoteInvalidoError(`${caminho}: informe uma lista`);
    }
    return valor;
}
export function lerUuid(valor, caminho) {
    if (typeof valor !== 'string' || !PADRAO_UUID.test(valor)) {
        throw new LoteInvalidoError(`${caminho}: informe um UUID em minúsculas (recebido: ${JSON.stringify(valor)})`);
    }
    return valor;
}
export function lerUuidOuNull(valor, caminho) {
    return valor === null ? null : lerUuid(valor, caminho);
}
export function lerTexto(valor, caminho) {
    if (typeof valor !== 'string' || valor.trim() === '') {
        throw new LoteInvalidoError(`${caminho}: informe um texto não vazio`);
    }
    return valor;
}
export function lerTextoOuNull(valor, caminho) {
    return valor === null ? null : lerTexto(valor, caminho);
}
/** Inteiro exato (ADR 009) maior ou igual a `minimo`. */
export function lerInteiro(valor, caminho, minimo = Number.MIN_SAFE_INTEGER) {
    if (typeof valor !== 'number' || !Number.isSafeInteger(valor) || valor < minimo) {
        throw new LoteInvalidoError(`${caminho}: informe um número inteiro a partir de ${minimo} (recebido: ${String(valor)})`);
    }
    return valor;
}
export function lerInstante(valor, caminho) {
    // A volta por Date recusa também datas que não existem, como 31 de fevereiro.
    if (typeof valor !== 'string' || !PADRAO_INSTANTE.test(valor) || !mesmoInstante(valor)) {
        throw new LoteInvalidoError(`${caminho}: informe um instante ISO 8601 em UTC (recebido: ${JSON.stringify(valor)})`);
    }
    return valor;
}
function mesmoInstante(texto) {
    const data = new Date(texto);
    return !Number.isNaN(data.getTime()) && data.toISOString() === texto;
}
//# sourceMappingURL=leitura.js.map