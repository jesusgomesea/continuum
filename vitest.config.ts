// Onde ficam os testes: na pasta testes/ de cada pacote, em arquivos *.test.ts ou *.test.tsx.
// Testes de tela declaram no topo "// @vitest-environment jsdom" (um navegador simulado).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['pacotes/*/testes/**/*.test.{ts,tsx}'],
  },
});
