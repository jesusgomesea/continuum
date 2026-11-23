// Monta a nuvem instalada para teste (Passo 3.5).
//
//   npm run nuvem:exe   gera pacotes/nuvem/dist/executavel/nuvem-continuum.exe (portátil)
//
// Mesmo caminho do PDV e do agente: telas prontas (Vite), programa num arquivo só e o electron-builder
// juntando com o Electron. Os programas do PostgreSQL vão como "recursos extras" do executável.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import path from 'node:path';
import { build } from 'vite';

const pastaNuvem = path.resolve(import.meta.dirname, '..');
const raizDoProjeto = path.resolve(pastaNuvem, '..', '..');
const pastaApp = path.join(pastaNuvem, 'dist', 'app');
const versaoElectron = (JSON.parse(readFileSync(path.join(pastaNuvem, '..', 'pdv', 'package.json'), 'utf8')) as { devDependencies: Record<string, string> })
  .devDependencies['electron']?.replace(/^[^\d]*/, '');
const exigir = createRequire(import.meta.url);
const programasDoPostgres = path.join(path.dirname(exigir.resolve('@embedded-postgres/windows-x64')), '..', 'native');

console.log('1/4 Telas…');
rmSync(pastaApp, { recursive: true, force: true });
await build({
  root: path.join(pastaNuvem, 'web'),
  configFile: false,
  logLevel: 'warn',
  plugins: [(await import('@vitejs/plugin-react')).default()],
  build: { outDir: path.join(pastaApp, 'web'), emptyOutDir: true },
});

console.log('2/4 Programa principal…');
await build({
  root: pastaNuvem,
  configFile: false,
  logLevel: 'warn',
  ssr: { noExternal: true, target: 'node' },
  build: {
    ssr: path.join(pastaNuvem, 'electron', 'principal.ts'),
    outDir: pastaApp,
    emptyOutDir: false,
    target: 'node22',
    minify: false,
    rollupOptions: {
      // pg-native e pg-cloudflare são opcionais do driver pg e não são usados.
      external: ['electron', 'pg-native', 'pg-cloudflare', ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
      output: { format: 'es', entryFileNames: 'principal.mjs' },
    },
  },
});

console.log('3/4 Descrição do programa…');
mkdirSync(pastaApp, { recursive: true });
writeFileSync(
  path.join(pastaApp, 'package.json'),
  `${JSON.stringify({ name: 'continuum-nuvem', productName: 'Continuum Nuvem', version: '0.1.0', description: 'Continuum Nuvem', author: 'Continuum', main: 'principal.mjs', type: 'module' }, null, 2)}\n`,
);

console.log('4/4 Gerando o executável (electron-builder; leva o PostgreSQL junto, ~110 MB)…');
const { build: empacotar } = await import('electron-builder');
await empacotar({
  projectDir: pastaApp,
  publish: 'never',
  config: {
    appId: 'br.com.continuum.nuvem',
    productName: 'Continuum Nuvem',
    ...(versaoElectron === undefined ? {} : { electronVersion: versaoElectron }),
    directories: { app: pastaApp, output: path.join(pastaNuvem, 'dist', 'executavel') },
    files: ['principal.mjs', 'web/**/*', 'package.json', '!node_modules'],
    extraResources: [{ from: programasDoPostgres, to: 'postgres', filter: ['**/*'] }],
    npmRebuild: false,
    asar: true,
    win: {
        // Instalador (Setup.exe) e versão portátil. Sem certificado: o ícone entra, a assinatura digital não.
        target: [{ target: 'nsis', arch: ['x64'] }, { target: 'portable', arch: ['x64'] }],
        icon: path.join(raizDoProjeto, 'recursos', 'icone.ico'),
        signExecutable: false,
      },
      // Instalação simples, por usuário (não pede senha de administrador): atalhos na área de trabalho e no
      // menu Iniciar, desinstalador no Windows e o programa abre ao terminar.
      nsis: {
        oneClick: true,
        perMachine: false,
        createDesktopShortcut: 'always',
        createStartMenuShortcut: true,
        shortcutName: 'Continuum Nuvem',
        runAfterFinish: true,
        artifactName: 'Continuum-Nuvem-Setup.exe',
        installerIcon: path.join(raizDoProjeto, 'recursos', 'icone.ico'),
        uninstallerIcon: path.join(raizDoProjeto, 'recursos', 'icone.ico'),
      },
    portable: { artifactName: 'nuvem-continuum.exe' },
  },
});
console.log(`Pronto: ${path.join(pastaNuvem, 'dist', 'executavel')} (instalador Continuum-Nuvem-Setup.exe e portátil nuvem-continuum.exe)`);
