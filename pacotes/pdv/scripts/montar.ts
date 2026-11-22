// Monta o PDV instalado (Passo 1.5).
//
//   npm run pdv:app   monta e abre o programa (Electron) para testar, sem gerar o .exe
//   npm run pdv:exe   monta e gera pacotes/pdv/dist/executavel/pdv-continuum.exe
//
// Etapas: (1) as telas viram arquivos prontos (Vite) em dist/app/web; (2) o programa principal vira
// um arquivo só (dist/app/principal.mjs); (3) um package.json mínimo descreve o programa;
// (4) o electron-builder junta tudo com o Electron num executável portátil (não precisa instalar).
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'vite';

const pastaPdv = path.resolve(import.meta.dirname, '..');
const pastaApp = path.join(pastaPdv, 'dist', 'app');
const versaoElectron = (JSON.parse(readFileSync(path.join(pastaPdv, 'package.json'), 'utf8')) as { devDependencies: Record<string, string> })
  .devDependencies['electron']?.replace(/^[^\d]*/, '');
const modo = process.argv[2] ?? 'exe';

console.log('1/4 Telas…');
rmSync(pastaApp, { recursive: true, force: true });
await build({
  configFile: path.join(pastaPdv, 'vite.config.ts'),
  logLevel: 'warn',
  build: { outDir: path.join(pastaApp, 'web'), emptyOutDir: true },
});

console.log('2/4 Programa principal…');
await build({ configFile: path.join(pastaPdv, 'vite.electron.config.ts') });

console.log('3/4 Descrição do programa…');
mkdirSync(pastaApp, { recursive: true });
writeFileSync(
  path.join(pastaApp, 'package.json'),
  `${JSON.stringify(
    { name: 'continuum-pdv', productName: 'Continuum PDV', version: '0.1.0', description: 'Continuum PDV', author: 'Continuum', main: 'principal.mjs', type: 'module' },
    null,
    2,
  )}\n`,
);

if (modo === 'app') {
  console.log('4/4 Abrindo o programa…');
  const electron = path.join(pastaPdv, '..', '..', 'node_modules', 'electron', 'dist', 'electron.exe');
  spawnSync(electron, [pastaApp], { stdio: 'inherit' });
} else {
  console.log('4/4 Gerando o executável (electron-builder)…');
  const { build: empacotar } = await import('electron-builder');
  await empacotar({
    // O programa já está todo montado em dist/app: o electron-builder olha só para lá,
    // e não leva dependência nenhuma (sem node_modules, sem código-fonte).
    projectDir: pastaApp,
    publish: 'never',
    config: {
      appId: 'br.com.continuum.pdv',
      productName: 'Continuum PDV',
      ...(versaoElectron === undefined ? {} : { electronVersion: versaoElectron }),
      directories: { app: pastaApp, output: path.join(pastaPdv, 'dist', 'executavel') },
      files: ['principal.mjs', 'web/**/*', 'package.json', '!node_modules'],
      npmRebuild: false,
      asar: true,
      // Sem assinatura digital e sem trocar o ícone por enquanto (ponto 6 do PENDENCIAS.md).
      win: { target: [{ target: 'portable', arch: ['x64'] }], signAndEditExecutable: false },
      portable: { artifactName: 'pdv-continuum.exe' },
    },
  });
  console.log(`Pronto: ${path.join(pastaPdv, 'dist', 'executavel', 'pdv-continuum.exe')}`);
}
