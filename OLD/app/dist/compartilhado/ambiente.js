import { existsSync } from 'node:fs';
import path from 'node:path';
let carregado = false;
/**
 * Lê uma variável de ambiente. Na primeira chamada, carrega o `.env` da pasta
 * atual, se existir (ADR 006, regra 7). Uma variável já definida no ambiente
 * (por exemplo, pelo GitHub Actions) não é sobrescrita pelo `.env`.
 */
export function lerVariavel(nome) {
    if (!carregado) {
        carregado = true;
        const arquivo = path.resolve('.env');
        if (existsSync(arquivo)) {
            process.loadEnvFile(arquivo);
        }
    }
    const valor = process.env[nome];
    return valor === '' ? undefined : valor;
}
/** Como lerVariavel, mas falha com uma mensagem clara se a variável não existir. */
export function exigirVariavel(nome) {
    const valor = lerVariavel(nome);
    if (valor === undefined) {
        throw new Error(`variável de ambiente ${nome} não definida: crie o .env a partir do .env.example`);
    }
    return valor;
}
//# sourceMappingURL=ambiente.js.map