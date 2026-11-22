// Monta o agente da loja instalado.
//
//   npm run agente:exe   gera pacotes/agente/dist/executavel/agente-continuum.exe (portátil)
//
// Mesmo caminho do PDV (pacotes/pdv/scripts/montar.ts): o programa vira um arquivo só e o
// electron-builder junta com o Electron num executável que não precisa instalar.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { build } from 'vite';

const pastaAgente = path.resolve(import.meta.dirname, '..');
const pastaApp = path.join(pastaAgente, 'dist', 'app');
const versaoElectron = (JSON.parse(readFileSync(path.join(pastaAgente, '..', 'pdv', 'package.json'), 'utf8')) as { devDependencies: Record<string, string> })
  .devDependencies['electron']?.replace(/^[^\d]*/, '');

console.log('1/3 Programa principal…');
rmSync(pastaApp, { recursive: true, force: true });
await build({
  root: pastaAgente,
  configFile: false,
  logLevel: 'warn',
  ssr: { noExternal: true, target: 'node' },
  build: {
    ssr: path.join(pastaAgente, 'electron', 'principal.ts'),
    outDir: pastaApp,
    target: 'node22',
    minify: false,
    rollupOptions: {
      external: ['electron', ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
      output: { format: 'es', entryFileNames: 'principal.mjs' },
    },
  },
});

console.log('2/3 Descrição do programa…');
mkdirSync(pastaApp, { recursive: true });
writeFileSync(
  path.join(pastaApp, 'package.json'),
  `${JSON.stringify({ name: 'continuum-agente', productName: 'Continuum Agente', version: '0.1.0', description: 'Continuum Agente', author: 'Continuum', main: 'principal.mjs', type: 'module' }, null, 2)}\n`,
);

console.log('3/3 Gerando o executável (electron-builder)…');
const { build: empacotar } = await import('electron-builder');
await empacotar({
  projectDir: pastaApp,
  publish: 'never',
  config: {
    appId: 'br.com.continuum.agente',
    productName: 'Continuum Agente',
    ...(versaoElectron === undefined ? {} : { electronVersion: versaoElectron }),
    directories: { app: pastaApp, output: path.join(pastaAgente, 'dist', 'executavel') },
    files: ['principal.mjs', 'package.json', '!node_modules'],
    npmRebuild: false,
    asar: true,
    win: { target: [{ target: 'portable', arch: ['x64'] }], signAndEditExecutable: false },
    portable: { artifactName: 'agente-continuum.exe' },
  },
});
console.log(`Pronto: ${path.join(pastaAgente, 'dist', 'executavel', 'agente-continuum.exe')}`);
