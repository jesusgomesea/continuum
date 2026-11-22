// Telas da nuvem no navegador (npm run erp): Central e ERP no mesmo endereço, com a API (/v1/...)
// e o PostgreSQL local ligados junto. Os dados ficam em dados/nuvem (fora do git).
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import type { NuvemPreparada } from './src/preparar.ts';

const raizDoProjeto = path.resolve(import.meta.dirname, '..', '..');

// Uma só nuvem por processo: o Vite reinicia o servidor quando arquivos mudam, e cada reinício não pode
// ligar e desligar o PostgreSQL de novo (um desligaria o banco que o outro está usando).
const global = globalThis as { continuumNuvem?: Promise<NuvemPreparada> };

function apiDaNuvem(): Plugin {
  return {
    name: 'continuum-api-da-nuvem',
    async configureServer(servidor) {
      const primeiraVez = global.continuumNuvem === undefined;
      if (primeiraVez) {
        // Carregados aqui para o Vite não tentar levar o banco para o navegador.
        global.continuumNuvem = import('./src/preparar.ts').then(({ prepararNuvem }) => prepararNuvem(path.join(raizDoProjeto, 'dados', 'nuvem')));
        const desligar = () => {
          void global.continuumNuvem?.then((n) => n.desligar()).finally(() => process.exit(0));
        };
        process.once('SIGINT', desligar);
        process.once('SIGTERM', desligar);
      }
      const nuvem = await (global.continuumNuvem as Promise<NuvemPreparada>);
      if (primeiraVez) for (const linha of nuvem.mensagens) servidor.config.logger.info(`  ${linha}`);
      const { middlewareDaNuvem } = await import('./src/servidor.ts');
      servidor.middlewares.use(middlewareDaNuvem(nuvem.api));
    },
  };
}

export default defineConfig({
  root: path.join(import.meta.dirname, 'web'),
  plugins: [react(), apiDaNuvem()],
  server: { port: 5175, strictPort: false, open: true },
});
