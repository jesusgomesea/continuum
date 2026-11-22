// Monta o programa principal do PDV instalado num arquivo só (dist/app/principal.mjs), já em
// JavaScript, com as regras, a fila e o banco do caixa dentro. O Electron e o próprio Node ficam de fora.
import { builtinModules } from 'node:module';
import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  root: import.meta.dirname,
  logLevel: 'warn',
  ssr: { noExternal: true, target: 'node' },
  build: {
    ssr: path.join(import.meta.dirname, 'electron', 'principal.ts'),
    outDir: path.join(import.meta.dirname, 'dist', 'app'),
    emptyOutDir: false,
    target: 'node22',
    minify: false,
    rollupOptions: {
      external: ['electron', ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
      output: { format: 'es', entryFileNames: 'principal.mjs' },
    },
  },
});
