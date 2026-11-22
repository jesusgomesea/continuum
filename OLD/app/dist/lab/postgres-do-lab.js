import { abrirBancoPostgres } from '../cloud-api/banco-postgres.js';
/** A URL do PostgreSQL apontando para outro banco do mesmo servidor. */
export function urlDoBanco(urlAdmin, nome) {
    const url = new URL(urlAdmin);
    url.pathname = `/${nome}`;
    return url.href;
}
/**
 * Cria o banco da nuvem simulada do LAB, se ainda não existir, e devolve a URL
 * dele. `nome` já vem validado pela configuração (só [a-z0-9_]).
 */
export async function prepararBancoDoLab(urlAdmin, nome) {
    const admin = abrirBancoPostgres(urlAdmin, { maxConexoes: 1 });
    try {
        const existe = await admin.consultarUma('SELECT 1 AS existe FROM pg_database WHERE datname = $1', nome);
        if (existe === undefined) {
            await admin.executar(`CREATE DATABASE ${nome}`);
        }
    }
    finally {
        await admin.fechar();
    }
    return urlDoBanco(urlAdmin, nome);
}
//# sourceMappingURL=postgres-do-lab.js.map