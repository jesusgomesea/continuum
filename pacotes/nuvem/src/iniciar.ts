// Liga a nuvem em desenvolvimento, só a API (npm run nuvem). Para as telas, use npm run erp.
// 1. o PostgreSQL local, com os dados em dados/nuvem/postgres (fora do git), na porta 5433;
// 2. as migrações que faltarem e os dados de demonstração (se o banco estiver vazio);
// 3. o servidor da nuvem na porta 5190.
// Ctrl+C desliga o servidor e o PostgreSQL.
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { prepararNuvem } from './preparar.ts';
import { criarServidorDaNuvem } from './servidor.ts';

const raiz = path.resolve(import.meta.dirname, '..', '..', '..');
const porta = Number(process.env['CONTINUUM_NUVEM_PORTA'] ?? 5190);

const nuvem = await prepararNuvem(path.join(raiz, 'dados', 'nuvem'));
const servidor = criarServidorDaNuvem(nuvem.api);
await new Promise<void>((ok) => servidor.listen(porta, '127.0.0.1', ok));
console.log(`Continuum Nuvem no ar: http://127.0.0.1:${(servidor.address() as AddressInfo).port}/v1/saude`);
for (const linha of nuvem.mensagens) console.log(linha);

for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sinal, () => {
    servidor.close();
    void nuvem.desligar().finally(() => process.exit(0));
  });
}
