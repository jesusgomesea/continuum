// Liga o agente da loja no terminal (.\dev agente ou npm run agente).
// O banco fica em dados/agente/loja.db (fora do git). Porta: 5180, aberta na rede da loja (0.0.0.0),
// para os caixas de outros computadores alcançarem. Mude com CONTINUUM_AGENTE_PORTA.
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { abrirBancoDaLoja, Agente } from './agente.ts';
import { criarServidorDoAgente, ligar } from './servidor.ts';

const raiz = path.resolve(import.meta.dirname, '..', '..', '..');
const arquivo = process.env['CONTINUUM_AGENTE_BANCO'] ?? path.join(raiz, 'dados', 'agente', 'loja.db');
const porta = Number(process.env['CONTINUUM_AGENTE_PORTA'] ?? 5180);
const tokens = path.join(raiz, 'pacotes', 'interface', 'src', 'tokens');
const estilos = ['tokens.css', 'base.css'].map((f) => readFileSync(path.join(tokens, f), 'utf8')).join('\n');

mkdirSync(path.dirname(arquivo), { recursive: true });
const banco = abrirBancoDaLoja(arquivo);
const servidor = criarServidorDoAgente(new Agente(banco), { estilos });
const endereco = await ligar(servidor, porta, '0.0.0.0');
console.log(`Continuum Agente no ar: ${endereco}  (painel no navegador; os caixas apontam para este endereço)`);
console.log(`Banco da loja: ${arquivo}`);
for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sinal, () => {
    servidor.close();
    banco.fechar();
    process.exit(0);
  });
}
