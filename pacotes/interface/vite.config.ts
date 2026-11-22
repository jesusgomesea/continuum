// Servidor da vitrine (.\dev vitrine): mostra os componentes do Continuum no navegador.
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  root: path.join(import.meta.dirname, 'vitrine'),
  plugins: [react()],
  server: { port: 5173, strictPort: false, open: true },
});
