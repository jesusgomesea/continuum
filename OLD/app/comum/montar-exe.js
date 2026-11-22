// Gera o executável de um aplicativo à parte na raiz do pacote (ADR 014), como o
// iniciar-continuum.exe: um executável único do Node que roda o script do app no
// Node do pacote, sob outro nome de processo (ver comum/processo.js).
//
//   runtime\node\node.exe app\comum\montar-exe.js pdv
//   runtime\node\node.exe app\comum\montar-exe.js erp
//
// O executável único herda o ícone do node.exe que o gera: com o pacote `resedit`
// (dependência de desenvolvimento do repositório), usa o logo do Continuum.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dizer = (linha) => process.stdout.write(`${linha}\n`);

export const APPS = {
  pdv: { exe: 'pdv-continuum.exe', processo: 'continuum-pdv.exe', script: ['app', 'pdv', 'iniciar-pdv.js'], titulo: 'Continuum PDV' },
  erp: { exe: 'erp-continuum.exe', processo: 'continuum-erp.exe', script: ['app', 'erp', 'iniciar-erp.js'], titulo: 'Continuum ERP' },
};

/** Lançador embutido (CommonJS, que é o que o executável único aceita). */
function stub({ processo, script, titulo }) {
  return `'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const raiz = path.dirname(process.execPath);
const node = path.join(raiz, 'runtime', 'node', 'node.exe');
const app = path.join(raiz, 'runtime', 'node', ${JSON.stringify(processo)});
const script = path.join(raiz, ...${JSON.stringify(script)});
process.title = ${JSON.stringify(titulo)};
for (const sinal of ['SIGINT', 'SIGBREAK', 'SIGHUP', 'SIGTERM']) process.on(sinal, () => {});
const terminar = (codigo) => {
  if (codigo === 0) process.exit(0);
  process.stdout.write('\\nAlgo deu errado (veja as mensagens acima). Aperte Enter para fechar.\\n');
  process.stdin.resume();
  process.stdin.once('data', () => process.exit(codigo));
};
try {
  if (!fs.existsSync(app)) {
    try { fs.linkSync(node, app); } catch { fs.copyFileSync(node, app); }
  }
} catch (erro) {
  process.stdout.write('não foi possível preparar ' + app + ': ' + erro.message + '\\n');
  terminar(1);
}
const filho = spawn(app, [script, ...process.argv.slice(2)], { stdio: 'inherit', cwd: raiz });
filho.on('error', (erro) => {
  process.stdout.write('não foi possível iniciar ' + app + ': ' + erro.message + '\\n');
  terminar(1);
});
filho.on('exit', (codigo) => terminar(codigo === null ? 1 : codigo));
`;
}

async function montar(nome) {
  const app = APPS[nome];
  if (!app) { dizer(`aplicativo desconhecido: ${nome} (use ${Object.keys(APPS).join(' ou ')})`); return 1; }
  const nodeExe = path.join(raiz, 'runtime', 'node', 'node.exe');
  if (!existsSync(nodeExe)) { dizer(`node.exe do pacote não encontrado em ${nodeExe}`); return 1; }
  const pasta = path.join(raiz, 'dados', `sea-${nome}`);
  rmSync(pasta, { recursive: true, force: true });
  mkdirSync(pasta, { recursive: true });
  writeFileSync(path.join(pasta, 'app.cjs'), stub(app));

  let gerador = nodeExe;
  try {
    const { trocarIcone } = await import('../dist/pacote/icone.js');
    const { lerPng, montarIco } = await import('../dist/pacote/imagem.js');
    gerador = path.join(pasta, 'node-com-icone.exe');
    cpSync(nodeExe, gerador);
    trocarIcone(gerador, montarIco(lerPng(readFileSync(path.join(raiz, 'app', 'src', 'painel', 'logo.png')))));
    dizer('ícone: logo do Continuum');
  } catch {
    gerador = nodeExe;
    dizer('ícone: o do Node (pacote resedit não instalado)');
  }

  const exe = path.join(raiz, app.exe);
  writeFileSync(path.join(pasta, 'sea.json'), JSON.stringify({ main: path.join(pasta, 'app.cjs'), output: exe, disableExperimentalSEAWarning: true }));
  const sea = spawnSync(gerador, ['--build-sea', path.join(pasta, 'sea.json')], { stdio: 'inherit' });
  rmSync(pasta, { recursive: true, force: true });
  if (sea.status !== 0 || !existsSync(exe)) { dizer(`falha ao gerar o ${app.exe}`); return 1; }
  dizer(`gerado: ${exe}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const nomes = process.argv.slice(2);
  (async () => {
    let codigo = 0;
    for (const nome of nomes.length ? nomes : Object.keys(APPS)) codigo ||= await montar(nome);
    process.exitCode = codigo;
  })();
}
