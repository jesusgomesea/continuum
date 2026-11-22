import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
/** Usuário do banco portátil: sem senha, só conexões de 127.0.0.1. */
export const USUARIO_PORTATIL = 'continuum';
export class FalhaPostgresPortatilError extends Error {
    constructor(etapa, detalhe) {
        super(`PostgreSQL portátil: falha ao ${etapa}: ${detalhe}`);
        this.name = 'FalhaPostgresPortatilError';
    }
}
const exe = (pg, nome) => path.join(pg.bin, process.platform === 'win32' ? `${nome}.exe` : nome);
/** Argumentos do initdb: UTF-8 e locale C, para não depender do idioma do Windows. */
export function argumentosInitdb(pg) {
    return ['-D', pg.dados, '-U', USUARIO_PORTATIL, '-A', 'trust', '-E', 'UTF8', '--locale=C', '--no-instructions'];
}
/** Argumentos do pg_ctl start: porta própria, só 127.0.0.1, espera o servidor aceitar conexões. */
export function argumentosSubir(pg, porta) {
    return ['start', '-D', pg.dados, '-l', pg.log, '-w', '-t', '60', '-o', `-p ${porta} -c listen_addresses=127.0.0.1`];
}
export function urlPortatil(porta) {
    return `postgres://${USUARIO_PORTATIL}@127.0.0.1:${porta}/postgres`;
}
/**
 * Roda um binário e espera ele terminar. A saída vai para 'ignore' no
 * pg_ctl start: no Windows o servidor herda os canais do pg_ctl, e esperar
 * eles fecharem travaria até o servidor parar.
 */
function rodar(arquivo, argumentos, capturar, limiteMs) {
    return new Promise((resolve, reject) => {
        const filho = spawn(arquivo, argumentos, { stdio: capturar ? ['ignore', 'pipe', 'pipe'] : 'ignore', windowsHide: true });
        let saida = '';
        filho.stdout?.on('data', (parte) => (saida += parte.toString()));
        filho.stderr?.on('data', (parte) => (saida += parte.toString()));
        const relogio = setTimeout(() => {
            filho.kill();
            reject(new Error(`${path.basename(arquivo)} passou de ${limiteMs} ms`));
        }, limiteMs);
        filho.once('error', (erro) => {
            clearTimeout(relogio);
            reject(erro);
        });
        // 'exit', não 'close': com stdio ignorado não há canal para esperar.
        filho.once('exit', (codigo) => {
            clearTimeout(relogio);
            resolve({ codigo, saida: saida.trim() });
        });
    });
}
/** Cria a pasta de dados na primeira execução; devolve true se criou. */
export async function inicializarSeNecessario(pg) {
    if (existsSync(path.join(pg.dados, 'PG_VERSION')))
        return false;
    if (!existsSync(exe(pg, 'initdb'))) {
        throw new FalhaPostgresPortatilError('criar o banco', `initdb não encontrado em ${pg.bin}`);
    }
    mkdirSync(path.dirname(pg.dados), { recursive: true });
    const { codigo, saida } = await rodar(exe(pg, 'initdb'), argumentosInitdb(pg), true, 180_000);
    if (codigo !== 0)
        throw new FalhaPostgresPortatilError('criar o banco (initdb)', saida);
    return true;
}
/**
 * Para um servidor que ficou no ar de uma execução anterior (queda do
 * lançador, console fechado antes do fim). Sem postmaster.pid não há o que parar;
 * um pid velho, de servidor já morto, o próprio PostgreSQL ignora ao subir.
 */
export async function pararSeVivo(pg) {
    if (!existsSync(path.join(pg.dados, 'postmaster.pid')))
        return false;
    const status = await rodar(exe(pg, 'pg_ctl'), ['status', '-D', pg.dados], true, 30_000);
    if (status.codigo !== 0)
        return false;
    await parar(pg);
    return true;
}
export async function subir(pg, porta) {
    mkdirSync(path.dirname(pg.log), { recursive: true });
    const { codigo } = await rodar(exe(pg, 'pg_ctl'), argumentosSubir(pg, porta), false, 90_000);
    if (codigo !== 0) {
        throw new FalhaPostgresPortatilError('subir o servidor (pg_ctl start)', `código ${codigo}; veja ${pg.log}`);
    }
}
export async function parar(pg) {
    const { codigo, saida } = await rodar(exe(pg, 'pg_ctl'), ['stop', '-D', pg.dados, '-m', 'fast', '-w', '-t', '30'], true, 60_000);
    if (codigo !== 0 && existsSync(path.join(pg.dados, 'postmaster.pid'))) {
        throw new FalhaPostgresPortatilError('parar o servidor (pg_ctl stop)', saida);
    }
}
//# sourceMappingURL=postgres-portatil.js.map