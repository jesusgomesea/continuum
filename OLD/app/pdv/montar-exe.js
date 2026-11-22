// Gera o pdv-continuum.exe na raiz do pacote, como o iniciar-continuum.exe (ADR 014):
// um executável único do Node que acha o Node do pacote e roda app\pdv\iniciar-pdv.js.
//
//   runtime\node\node.exe app\pdv\montar-exe.js
//
// O executável único herda o ícone do node.exe que o gera. Com o pacote `resedit`
// disponível (dependência de desenvolvimento do repositório), usa o logo do
// Continuum; sem ele, fica com o ícone do Node.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dizer = (linha) => process.stdout.write(`${linha}\n`);

/**
 * Lançador embutido (CommonJS, que é o que o executável único aceita). Roda o PDV
 * no runtime\node\continuum-pdv.exe (link para o node.exe): com outro nome, o
 * iniciar-continuum não o encerra ao limpar os node.exe órfãos do pacote.
 */
const STUB = `'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const raiz = path.dirname(process.execPath);
const node = path.join(raiz, 'runtime', 'node', 'node.exe');
const pdv = path.join(raiz, 'runtime', 'node', 'continuum-pdv.exe');
const script = path.join(raiz, 'app', 'pdv', 'iniciar-pdv.js');
process.title = 'Continuum PDV';
for (const sinal of ['SIGINT', 'SIGBREAK', 'SIGHUP', 'SIGTERM']) process.on(sinal, () => {});
const terminar = (codigo) => {
  if (codigo === 0) process.exit(0);
  process.stdout.write('\\nAlgo deu errado (veja as mensagens acima). Aperte Enter para fechar.\\n');
  process.stdin.resume();
  process.stdin.once('data', () => process.exit(codigo));
};
try {
  if (!fs.existsSync(pdv)) {
    try { fs.linkSync(node, pdv); } catch { fs.copyFileSync(node, pdv); }
  }
} catch (erro) {
  process.stdout.write('não foi possível preparar ' + pdv + ': ' + erro.message + '\\n');
  terminar(1);
}
const filho = spawn(pdv, [script, ...process.argv.slice(2)], { stdio: 'inherit', cwd: raiz });
filho.on('error', (erro) => {
  process.stdout.write('não foi possível iniciar ' + pdv + ': ' + erro.message + '\\n');
  terminar(1);
});
filho.on('exit', (codigo) => terminar(codigo === null ? 1 : codigo));
`;

async function principal() {
  const nodeExe = path.join(raiz, 'runtime', 'node', 'node.exe');
  if (!existsSync(nodeExe)) {
    dizer(`node.exe do pacote não encontrado em ${nodeExe}`);
    return 1;
  }
  const pasta = path.join(raiz, 'dados', 'sea-pdv');
  rmSync(pasta, { recursive: true, force: true });
  mkdirSync(pasta, { recursive: true });
  writeFileSync(path.join(pasta, 'pdv.cjs'), STUB);

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

  const exe = path.join(raiz, 'pdv-continuum.exe');
  writeFileSync(path.join(pasta, 'sea.json'), JSON.stringify({ main: path.join(pasta, 'pdv.cjs'), output: exe, disableExperimentalSEAWarning: true }));
  const sea = spawnSync(gerador, ['--build-sea', path.join(pasta, 'sea.json')], { stdio: 'inherit' });
  rmSync(pasta, { recursive: true, force: true });
  if (sea.status !== 0 || !existsSync(exe)) {
    dizer('falha ao gerar o pdv-continuum.exe');
    return 1;
  }
  dizer(`gerado: ${exe}`);
  return 0;
}

principal().then((codigo) => { process.exitCode = codigo; });
