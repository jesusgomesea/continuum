/** Lote malformado ou com evento que não pode ser aplicado: nada foi gravado (HTTP 400). */
export class LoteInvalidoError extends Error {
    name = 'LoteInvalidoError';
}
/**
 * Lote fora da ordem da origem (ADR 010): lacuna na seq, ou id que não bate
 * com o que já foi recebido. Nada foi gravado (HTTP 409). `ultimaSeq` diz de
 * onde o envio deve continuar.
 */
export class ForaDeOrdemError extends Error {
    name = 'ForaDeOrdemError';
    ultimaSeq;
    constructor(mensagem, ultimaSeq) {
        super(mensagem);
        this.ultimaSeq = ultimaSeq;
    }
}
//# sourceMappingURL=erros.js.map