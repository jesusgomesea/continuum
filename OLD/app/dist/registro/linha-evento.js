import { desserializarDados } from './validacao.js';
export function paraEvento(linha) {
    return Object.freeze({
        id: linha.id,
        seq: linha.seq,
        tipo: linha.tipo,
        ocorridoEm: linha.ocorridoEm,
        dados: desserializarDados(linha.dadosJson),
    });
}
export function validarSeqInicial(aPartirDaSeq) {
    if (!Number.isSafeInteger(aPartirDaSeq) || aPartirDaSeq < 1) {
        throw new RangeError(`seq inicial inválida: ${aPartirDaSeq} (use um inteiro a partir de 1)`);
    }
}
//# sourceMappingURL=linha-evento.js.map