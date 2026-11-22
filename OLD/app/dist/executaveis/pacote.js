import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { trocarIcone } from '../pacote/icone.js';
import { lerPng, montarIco } from '../pacote/imagem.js';
import { destinoPostgres, NODE, POSTGRES, RUNTIME_VC } from '../pacote/montagem.js';
import { escreverZip, extrairZip } from '../pacote/zip.js';
/**
 * `npm run pacote` (ADR 014): monta continuum-portatil/ e continuum-portatil.zip
 * para rodar a demo num Windows x64 sem instalar nada. Roda numa máquina
 * Windows com internet (baixa os zips na primeira vez e guarda no cache).
 */
const USO = `uso: npm run pacote -- [--cache <pasta>] [--saida <pasta>] [--sem-zip]`;
const raizRepositorio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dizer = (linha) => {
    process.stdout.write(`${linha}\n`);
};
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
function sha256(arquivo) {
    return createHash('sha256').update(readFileSync(arquivo)).digest('hex');
}
async function garantir(download, cache) {
    const arquivo = path.join(cache, download.nome);
    if (existsSync(arquivo) && sha256(arquivo) === download.sha256)
        return arquivo;
    dizer(`baixando ${download.url}`);
    mkdirSync(cache, { recursive: true });
    const resposta = await fetch(download.url);
    if (!resposta.ok || resposta.body === null)
        throw new Error(`download falhou: ${download.url} (${resposta.status})`);
    await pipeline(resposta.body, createWriteStream(arquivo));
    const obtido = sha256(arquivo);
    if (obtido !== download.sha256) {
        rmSync(arquivo, { force: true });
        throw new Error(`${download.nome}: SHA-256 não confere (esperado ${download.sha256}, obtido ${obtido})`);
    }
    return arquivo;
}
function tamanhoDe(caminho) {
    const info = statSync(caminho);
    if (!info.isDirectory())
        return info.size;
    return readdirSync(caminho).reduce((soma, nome) => soma + tamanhoDe(path.join(caminho, nome)), 0);
}
/**
 * Lançador do .exe: acha o node.exe e o iniciar.js ao lado e repassa os
 * argumentos. CommonJS, porque é o que o executável único do Node embute.
 */
const STUB = `'use strict';
const { spawn } = require('node:child_process');
const path = require('node:path');
const raiz = path.dirname(process.execPath);
const node = path.join(raiz, 'runtime', 'node', 'node.exe');
const script = path.join(raiz, 'app', 'dist', 'executaveis', 'iniciar.js');
process.title = 'Continuum LAB';
// Ctrl+C e o fechamento do console chegam também ao filho, que encerra tudo; aqui só se espera por ele.
for (const sinal of ['SIGINT', 'SIGBREAK', 'SIGHUP', 'SIGTERM']) process.on(sinal, () => {});
const argumentos = process.argv.slice(2);
const terminar = (codigo) => {
  if (codigo === 0 || argumentos.includes('--verificar')) process.exit(codigo);
  // Aberto com dois cliques, o console sumiria com a mensagem de erro.
  process.stdout.write('\\nAlgo deu errado (veja as mensagens acima). Aperte Enter para fechar.\\n');
  process.stdin.resume();
  process.stdin.once('data', () => process.exit(codigo));
};
const filho = spawn(node, [script, ...argumentos], { stdio: 'inherit', cwd: raiz });
filho.on('error', (erro) => {
  process.stdout.write('não foi possível iniciar ' + node + ': ' + erro.message + '\\n');
  terminar(1);
});
filho.on('exit', (codigo) => terminar(codigo === null ? 1 : codigo));
`;
const LEIA_ME = `Continuum LAB - pacote portátil da demonstração
================================================

1. Copie a pasta continuum-portatil para C:\\continuum
   (evite OneDrive, pendrive e pastas com acento no nome).
2. Dê dois cliques em iniciar-continuum.exe.
   Na primeira vez o banco de dados é criado; pode levar cerca de 1 minuto.
   O painel abre numa janela própria.
3. Para encerrar: feche a janela do painel (ou o console preto, ou Ctrl+C nele).

Se aparecer "O Windows protegeu o computador":
   clique em "Mais informações" e depois em "Executar assim mesmo".

Se o iniciar-continuum.exe for bloqueado, abra o Prompt de Comando nesta pasta e rode:
   runtime\\node\\node.exe app\\dist\\executaveis\\iniciar.js

Para conferir, sem abrir o painel, se tudo funciona nesta máquina:
   iniciar-continuum.exe --verificar
   (leva cerca de 1 minuto; o resultado fica em dados\\logs\\verificacao.json)

Para começar a demo do zero: encerre o Continuum e apague a pasta dados.

Nada é instalado: tudo fica dentro desta pasta. Licenças de terceiros: pasta licencas.
`;
const AVISO_VC = `Runtime do Microsoft Visual C++ (msvcp140.dll, vcruntime140.dll, vcruntime140_1.dll)
em runtime\\postgres\\bin: arquivos redistribuíveis do Microsoft Visual C++ 2015-2022,
copiados ao lado dos binários do PostgreSQL (instalação local ao aplicativo), porque
o zip do PostgreSQL não os traz. Termos da Microsoft para esses arquivos:
https://learn.microsoft.com/cpp/windows/redistributing-visual-cpp-files
`;
async function principal() {
    const { values } = parseArgs({
        options: {
            cache: { type: 'string', default: path.join(raizRepositorio, 'pacote', 'cache') },
            saida: { type: 'string', default: path.join(raizRepositorio, 'pacote', 'saida') },
            'sem-zip': { type: 'boolean', default: false },
            ajuda: { type: 'boolean', default: false },
        },
    });
    if (values.ajuda) {
        dizer(USO);
        return 0;
    }
    if (process.platform !== 'win32') {
        dizer('o pacote é para Windows x64 e precisa ser montado num Windows (runtime do Visual C++ e o .exe)');
        return 1;
    }
    const npm = process.env.npm_execpath;
    if (npm === undefined) {
        dizer(`rode pelo npm: ${USO}`);
        return 1;
    }
    const cache = path.resolve(values.cache);
    const saida = path.resolve(values.saida);
    const raiz = path.join(saida, 'continuum-portatil');
    const licencas = path.join(raiz, 'licencas');
    const zipNode = await garantir(NODE, cache);
    const zipPostgres = await garantir(POSTGRES, cache);
    dizer(`montando ${raiz}`);
    rmSync(raiz, { recursive: true, force: true });
    mkdirSync(licencas, { recursive: true });
    // Node: só o node.exe (o lançador não usa npm) e a licença.
    const pastaNode = NODE.nome.replace(/\.zip$/, '');
    extrairZip(zipNode, (nome) => {
        if (nome === `${pastaNode}/node.exe`)
            return path.join(raiz, 'runtime', 'node', 'node.exe');
        if (nome === `${pastaNode}/LICENSE`)
            return path.join(licencas, 'node-LICENSE.txt');
        return null;
    });
    // PostgreSQL: bin, lib e share; sem pgAdmin, StackBuilder, docs e include.
    const pastaPostgres = path.join(raiz, 'runtime', 'postgres');
    const extraidos = extrairZip(zipPostgres, (nome) => {
        if (nome === 'pgsql/server_license.txt')
            return path.join(licencas, 'postgresql-LICENSE.txt');
        if (nome === 'pgsql/commandlinetools_3rd_party_licenses.txt')
            return path.join(licencas, 'postgresql-terceiros.txt');
        return destinoPostgres(nome, pastaPostgres);
    });
    dizer(`PostgreSQL: ${extraidos} arquivos`);
    const system32 = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
    for (const dll of RUNTIME_VC) {
        const origem = path.join(system32, dll);
        if (!existsSync(origem)) {
            dizer(`falta ${origem}: instale o Visual C++ 2015-2022 x64 na máquina que monta o pacote`);
            return 1;
        }
        cpSync(origem, path.join(pastaPostgres, 'bin', dll));
    }
    writeFileSync(path.join(licencas, 'microsoft-visual-cpp.txt'), AVISO_VC);
    // App: o build (sem os .map), o painel e as dependências de produção.
    const app = path.join(raiz, 'app');
    cpSync(path.join(raizRepositorio, 'dist'), path.join(app, 'dist'), {
        recursive: true,
        filter: (origem) => !origem.endsWith('.map'),
    });
    cpSync(path.join(raizRepositorio, 'src', 'painel'), path.join(app, 'src', 'painel'), { recursive: true });
    for (const arquivo of ['package.json', 'package-lock.json', '.env.demo']) {
        cpSync(path.join(raizRepositorio, arquivo), path.join(app, arquivo));
    }
    const ci = spawnSync(process.execPath, [npm, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
        cwd: app,
        stdio: 'inherit',
    });
    if (ci.status !== 0) {
        dizer('npm ci das dependências de produção falhou');
        return 1;
    }
    // Lançador: executável único gerado por uma cópia do node.exe do pacote com o
    // ícone do Continuum (o executável único herda o ícone de quem o gera).
    const pastaSea = path.join(saida, 'sea');
    rmSync(pastaSea, { recursive: true, force: true });
    mkdirSync(pastaSea, { recursive: true });
    writeFileSync(path.join(pastaSea, 'iniciar.cjs'), STUB);
    const nodeComIcone = path.join(pastaSea, 'node-com-icone.exe');
    cpSync(path.join(raiz, 'runtime', 'node', 'node.exe'), nodeComIcone);
    trocarIcone(nodeComIcone, montarIco(lerPng(readFileSync(path.join(raizRepositorio, 'assets', 'logo.png')))));
    const exe = path.join(raiz, 'iniciar-continuum.exe');
    writeFileSync(path.join(pastaSea, 'sea.json'), JSON.stringify({ main: path.join(pastaSea, 'iniciar.cjs'), output: exe, disableExperimentalSEAWarning: true }));
    const sea = spawnSync(nodeComIcone, ['--build-sea', path.join(pastaSea, 'sea.json')], {
        stdio: 'inherit',
    });
    if (sea.status !== 0 || !existsSync(exe)) {
        dizer('falha ao gerar o iniciar-continuum.exe');
        return 1;
    }
    rmSync(pastaSea, { recursive: true, force: true });
    writeFileSync(path.join(raiz, 'LEIA-ME.txt'), LEIA_ME.replace(/\n/g, '\r\n'));
    dizer(`pasta: ${mb(tamanhoDe(raiz))} (runtime/node ${mb(tamanhoDe(path.join(raiz, 'runtime', 'node')))}, runtime/postgres ${mb(tamanhoDe(pastaPostgres))}, app ${mb(tamanhoDe(app))}, exe ${mb(tamanhoDe(exe))})`);
    if (!values['sem-zip']) {
        const zip = path.join(saida, 'continuum-portatil.zip');
        dizer('compactando…');
        const entradas = escreverZip(raiz, zip, 'continuum-portatil');
        dizer(`zip: ${zip} (${mb(statSync(zip).size)}, ${entradas} arquivos)`);
    }
    return 0;
}
principal().then((codigo) => {
    process.exitCode = codigo;
}, (erro) => {
    process.stderr.write(`[pacote] ${erro instanceof Error ? erro.message : String(erro)}\n`);
    process.exitCode = 1;
});
//# sourceMappingURL=pacote.js.map