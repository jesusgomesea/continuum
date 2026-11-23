// Gera os três instaladores e junta na pasta instaladores/ (npm run instaladores ou .\dev instaladores).
//   Continuum-Nuvem-Setup.exe   ERP e Central, com o PostgreSQL embutido (para teste e demonstração)
//   Continuum-PDV-Setup.exe     o caixa
//   Continuum-Agente-Setup.exe  o agente da loja (liga junto com o Windows)
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const raiz = path.resolve(import.meta.dirname, '..');
const destino = path.join(raiz, 'instaladores');
mkdirSync(destino, { recursive: true });

for (const [comando, pacote, arquivo] of [
  ['nuvem:exe', 'nuvem', 'Continuum-Nuvem-Setup.exe'],
  ['pdv:exe', 'pdv', 'Continuum-PDV-Setup.exe'],
  ['agente:exe', 'agente', 'Continuum-Agente-Setup.exe'],
] as const) {
  console.log(`\n=== ${arquivo} ===`);
  const r = spawnSync('npm', ['run', comando], { cwd: raiz, stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    console.error(`Falhou ao gerar ${arquivo}.`);
    process.exit(r.status ?? 1);
  }
  copyFileSync(path.join(raiz, 'pacotes', pacote, 'dist', 'executavel', arquivo), path.join(destino, arquivo));
}
console.log(`\nPronto: os três instaladores estão em ${destino}`);
