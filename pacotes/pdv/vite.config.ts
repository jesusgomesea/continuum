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
      const { ligarSincronizacao, destinoDaFila } = await import('./src/sincronizacao.ts');
      const { caixaAtivado, middlewareDeAtivacao } = await import('./src/ativacao.ts');
      type Sync = ReturnType<typeof ligarSincronizacao>;

      mkdirSync(path.dirname(arquivoDoBanco), { recursive: true });
      const banco = abrirBancoDoCaixa(arquivoDoBanco);
      const caixa = new Caixa(banco);
      servidor.config.logger.info(`  Banco do caixa: ${arquivoDoBanco}`);
      // A fila vai para o agente da loja (.\dev agente), mas só depois que o caixa for ativado.
      // Sem agente no ar, o caixa vende do mesmo jeito.
      let sincronizacao: Sync | null = null;
      const ligar = () => {
        const { destino, credencial } = destinoDaFila(caixa, process.env['CONTINUUM_AGENTE_URL'] ?? null);
        sincronizacao ??= ligarSincronizacao(caixa, destino, credencial === undefined ? {} : { credencial });
        servidor.config.logger.info(`  A fila vai para: ${destino}${credencial === undefined ? '' : ' (nuvem, formato MEI)'}`);
      };
      if (caixaAtivado(caixa)) ligar();
      else servidor.config.logger.info('  Caixa novo: abra o PDV e ative com o código do ERP (ou use o modo demonstração).');
      servidor.middlewares.use(middlewareDeAtivacao(caixa, ligar));
      servidor.middlewares.use(middlewareDaApi(criarApi(caixa, () => sincronizacao)));
      servidor.httpServer?.once('close', () => {
        void (sincronizacao?.parar() ?? Promise.resolve()).finally(() => banco.fechar());
      });
    },
  };
}

export default defineConfig({
  root: path.join(import.meta.dirname, 'web'),
  plugins: [react(), apiDoCaixa()],
  server: { port: 5174, strictPort: false, open: true },
});
