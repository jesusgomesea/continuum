import { rmSync } from 'node:fs';
import net from 'node:net';
import { abrirBancoPostgres } from '../cloud-api/banco-postgres.js';
export class LabNoArError extends Error {
    name = 'LabNoArError';
    constructor(porta) {
        super(`o LAB está no ar na porta ${porta}: encerre-o (Ctrl+C no terminal dele) antes de zerar`);
    }
}
/** Há alguém escutando nesta porta de 127.0.0.1? */
export function portaEmUso(porta) {
    return new Promise((resolve) => {
        const conexao = net.connect({ host: '127.0.0.1', port: porta });
        conexao.once('connect', () => {
            conexao.destroy();
            resolve(true);
        });
        conexao.once('error', () => resolve(false));
    });
}
/**
 * `npm run lab:reset` (ADR 013): apaga os bancos SQLite do LAB (com os
 * arquivos do WAL) e o banco da nuvem do LAB no PostgreSQL. O próximo
 * `npm run lab` começa do zero. Recusa com o LAB no ar: no Linux, apagar o
 * arquivo aberto não daria erro, e o LAB seguiria gravando num arquivo sumido.
 */
export async function zerarLab(configuracao) {
    if (configuracao.portas.lab !== 0 && (await portaEmUso(configuracao.portas.lab))) {
        throw new LabNoArError(configuracao.portas.lab);
    }
    const apagados = [];
    for (const banco of [configuracao.bancoAplicacao, configuracao.bancoInterno]) {
        for (const arquivo of [banco, `${banco}-wal`, `${banco}-shm`]) {
            rmSync(arquivo, { force: true });
        }
        apagados.push(banco);
    }
    const admin = abrirBancoPostgres(configuracao.postgresUrl, { maxConexoes: 1 });
    try {
        // Nome já validado pela configuração (só [a-z0-9_]).
        await admin.executar(`DROP DATABASE IF EXISTS ${configuracao.postgresBanco}`);
    }
    finally {
        await admin.fechar();
    }
    apagados.push(`PostgreSQL: ${configuracao.postgresBanco}`);
    return apagados;
}
//# sourceMappingURL=reset.js.map