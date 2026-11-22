// PostgreSQL local para DESENVOLVIMENTO e testes (na hospedagem de verdade o banco é outro, Passo 4.2).
// Usa os programas do PostgreSQL 18 que vêm no pacote @embedded-postgres/windows-x64 (baixado pelo npm,
// dentro do projeto: nada instalado no Windows). Faz o papel do PostgreSQL portátil do OLD.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

/** Usuário dono do banco (cria tabelas e roda migrações). O servidor usa outros papéis, sem esse poder. */
export const USUARIO_DONO = 'continuum';

function pastaDosProgramas(): string {
  // No programa instalado (nuvem-continuum.exe), os programas do PostgreSQL vão junto e o caminho vem aqui.
  const informada = process.env['CONTINUUM_POSTGRES_BIN'];
  if (informada !== undefined && informada !== '') return informada;
  // Em desenvolvimento: a entrada do pacote fica em dist/index.js; os programas, em native/bin ao lado.
  const exigir = createRequire(import.meta.url);
  return path.join(path.dirname(exigir.resolve('@embedded-postgres/windows-x64')), '..', 'native', 'bin');
}

function rodar(programa: string, argumentos: string[], opcoes: { semSaida?: boolean } = {}): void {
  // semSaida: o "pg_ctl start" deixa o PostgreSQL rodando, e ele herdaria a saída de texto do comando;
  // o Node ficaria esperando essa saída fechar para sempre. O PostgreSQL já escreve o próprio log em arquivo.
  const r = spawnSync(path.join(pastaDosProgramas(), `${programa}.exe`), argumentos, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120_000,
    ...(opcoes.semSaida === true ? { stdio: 'ignore' as const } : {}),
  });
  if (r.status !== 0) throw new Error(`${programa} falhou: ${(r.stderr || r.stdout || String(r.error ?? `código ${String(r.status)}`)).trim()}`);
}

export interface PostgresLocal {
  /** Endereço de conexão do dono do banco. */
  url: string;
  porta: number;
  parar(): void;
}

/**
 * Cria (se ainda não existir) e liga um PostgreSQL na pasta indicada, ouvindo só neste computador.
 * Senha não é exigida (método "trust") porque só aceita conexões de 127.0.0.1: serve para desenvolver, não para produção.
 */
export function ligarPostgresLocal(pasta: string, porta: number): PostgresLocal {
  const dados = path.join(pasta, 'dados');
  if (!existsSync(path.join(dados, 'PG_VERSION'))) {
    mkdirSync(pasta, { recursive: true });
    rodar('initdb', ['-D', dados, '-U', USUARIO_DONO, '-A', 'trust', '-E', 'UTF8', '--locale=C']);
  }
  // Se ficou ligado de uma vez anterior (o programa foi fechado à força), reaproveita em vez de ligar de novo.
  const status = spawnSync(path.join(pastaDosProgramas(), 'pg_ctl.exe'), ['-D', dados, 'status'], { stdio: 'ignore', windowsHide: true });
  if (status.status !== 0) {
    rodar('pg_ctl', ['-D', dados, '-o', `-p ${porta} -c listen_addresses=127.0.0.1`, '-l', path.join(pasta, 'postgres.log'), '-w', 'start'], { semSaida: true });
  }
  return {
    url: `postgres://${USUARIO_DONO}@127.0.0.1:${porta}/postgres`,
    porta,
    parar: () => rodar('pg_ctl', ['-D', dados, '-m', 'fast', '-w', 'stop']),
  };
}
