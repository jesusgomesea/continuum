import { v7 } from 'uuid';
/**
 * Gera um identificador UUID v7 (ADR 002).
 * O id é sempre criado pela aplicação, nunca pelo banco.
 */
export function gerarId() {
    return v7();
}
//# sourceMappingURL=id.js.map