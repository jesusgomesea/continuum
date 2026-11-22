// Servidor do PDV no navegador (.\dev pdv): mostra as telas e, no mesmo endereço, responde a API do
// caixa (/api/...). O banco fica em dados/pdv/caixa.db (fora do git). Para começar do zero,
// feche o servidor e apague a pasta dados/pdv.
import react from '@vitejs/plugin-react';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

const raizDoProjeto = path.resolve(import.meta.dirname, '..', '..');
const arquivoDoBanco = process.env['CONTINUUM_PDV_BANCO'] ?? path.join(raizDoProjeto, 'dados', 'pdv', 'caixa.db');

/** Liga a API do caixa dentro do servidor do Vite. */
function apiDoCaixa(): Plugin {
  return {
    name: 'continuum-api-do-caixa',
    async configureServer(servidor) {
      // Carregados aqui (e não no topo) para o Vite não tentar levar o SQLite para o navegador.
      const { abrirBancoDoCaixa, Caixa } = await import('./src/caixa.ts');
      const { criarApi } = await import('./src/servidor/api.ts');
      const { middlewareDaApi } = await import('./src/servidor/http.ts');
      const { prepararDemonstracao } = await import('./src/servidor/demonstracao.ts');

      mkdirSync(path.dirname(arquivoDoBanco), { recursive: true });
      const banco = abrirBancoDoCaixa(arquivoDoBanco);
      const caixa = new Caixa(banco);
      if (prepararDemonstracao(caixa)) servidor.config.logger.info('  Caixa novo: ativado com dados de demonstração.');
      servidor.config.logger.info(`  Banco do caixa: ${arquivoDoBanco}`);
      servidor.middlewares.use(middlewareDaApi(criarApi(caixa)));
      servidor.httpServer?.once('close', () => banco.fechar());
    },
  };
}

export default defineConfig({
  root: path.join(import.meta.dirname, 'web'),
  plugins: [react(), apiDoCaixa()],
  server: { port: 5174, strictPort: false, open: true },
});
