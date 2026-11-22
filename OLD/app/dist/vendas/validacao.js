import { DadosInvalidosError } from './erros.js';
/** Texto obrigatório: não pode ser vazio nem só espaços. */
export function exigirTexto(valor, campo) {
    if (typeof valor !== 'string' || valor.trim() === '') {
        throw new DadosInvalidosError(`${campo}: informe um texto não vazio`);
    }
    return valor;
}
const REGRAS_INTEIRO = {
    positivo: { aceita: (n) => n > 0, descricao: 'maior que zero' },
    'nao-negativo': { aceita: (n) => n >= 0, descricao: 'maior ou igual a zero' },
    'nao-zero': { aceita: (n) => n !== 0, descricao: 'diferente de zero' },
};
/** Inteiro seguro (ADR 009: dinheiro em centavos, quantidade em unidades). */
export function exigirInteiro(valor, campo, regra) {
    const { aceita, descricao } = REGRAS_INTEIRO[regra];
    if (typeof valor !== 'number' || !Number.isSafeInteger(valor) || !aceita(valor)) {
        throw new DadosInvalidosError(`${campo}: informe um número inteiro ${descricao} (recebido: ${String(valor)})`);
    }
    return valor;
}
//# sourceMappingURL=validacao.js.map