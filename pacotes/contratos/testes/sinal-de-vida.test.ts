// Sinal de vida (heartbeat): o que o Central precisa para mostrar cada caixa ao vivo.
import { describe, expect, it } from 'vitest';
import { lerSinalDeVida } from '../src/index.ts';
import { sinalValido } from './exemplos.ts';

describe('sinal de vida', () => {
  it('um sinal válido passa', () => {
    expect(lerSinalDeVida(sinalValido()).estado).toBe('saudavel');
  });

  it('caixa que ainda não vendeu manda ultimaVendaEm vazio', () => {
    expect(lerSinalDeVida({ ...sinalValido(), ultimaVendaEm: null }).ultimaVendaEm).toBeNull();
  });

  it('estado fora da máquina de estados é recusado', () => {
    expect(() => lerSinalDeVida({ ...sinalValido(), estado: 'quebrado' })).toThrow(/estado/);
  });

  it('fila negativa e caixaAberto que não é sim/não são recusados', () => {
    expect(() => lerSinalDeVida({ ...sinalValido(), filaPendente: -1 })).toThrow(/filaPendente/);
    expect(() => lerSinalDeVida({ ...sinalValido(), caixaAberto: 'sim' })).toThrow(/caixaAberto/);
  });

  it('sem a hora de envio, o Central não sabe há quanto tempo o caixa está sem sinal', () => {
    const { enviadoEm: _e, ...semHora } = sinalValido();
    expect(() => lerSinalDeVida(semHora)).toThrow(/enviadoEm/);
  });
});
