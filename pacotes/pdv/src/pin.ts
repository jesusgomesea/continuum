// PIN do supervisor: libera desconto acima do limite e cancelamento de venda.
// Guardado só como hash (scrypt com sal), nunca em texto, como o PIN do OLD (docs/04: senhas só como hash).
// Enquanto o ERP não definir um PIN (desce nos parâmetros), vale o PIN padrão do OLD: 1234.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const PIN_PADRAO = '1234';

/** Gera o hash de um PIN: "scrypt$sal$hash" (em hexadecimal). */
export function hashDoPin(pin: string): string {
  if (!/^\d{4,8}$/.test(pin)) throw new RangeError('O PIN deve ter de 4 a 8 números.');
  const sal = randomBytes(16);
  return `scrypt$${sal.toString('hex')}$${scryptSync(pin, sal, 32).toString('hex')}`;
}

/** Confere o PIN digitado com o hash guardado (ou com o PIN padrão, se não houver hash). */
export function pinConfere(pin: string | undefined, hash: string | undefined): boolean {
  if (pin === undefined || pin === '') return false;
  if (hash === undefined) return pin === PIN_PADRAO;
  const [tipo, salHex, hashHex] = hash.split('$');
  if (tipo !== 'scrypt' || salHex === undefined || hashHex === undefined) return false;
  const esperado = Buffer.from(hashHex, 'hex');
  const calculado = scryptSync(pin, Buffer.from(salHex, 'hex'), esperado.length);
  return timingSafeEqual(esperado, calculado);
}
