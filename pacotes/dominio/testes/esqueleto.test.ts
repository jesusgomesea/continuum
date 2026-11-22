// Teste do esqueleto (Passo 0.1): só confirma que o projeto está ligado.
// As regras de verdade chegam no Passo 0.3.
import { describe, expect, it } from 'vitest';
import { PACOTE } from '../src/index.ts';

describe('esqueleto do projeto', () => {
  it('o pacote dominio responde', () => {
    expect(PACOTE).toBe('dominio');
  });
});
