// @vitest-environment jsdom
// Testes dos componentes do Continuum, num navegador simulado (jsdom).
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Botao, Chip, FaixaDeEstado, NOMES_ESTADO, type EstadoSistema } from '../src/index.ts';

afterEach(() => cleanup());

describe('FaixaDeEstado', () => {
  it('a faixa OFFLINE mostra o nome, o texto de contingência e o estado de erro', () => {
    render(<FaixaDeEstado estado="offline" extra="Contingência ativa" />);
    const faixa = screen.getByRole('status');
    expect(faixa.dataset['estado']).toBe('offline');
    expect(screen.getByText('OFFLINE')).toBeTruthy();
    expect(screen.getByText('Contingência ativa')).toBeTruthy();
    expect(screen.getByText(/nada se perde/)).toBeTruthy();
  });

  it('cada um dos 5 estados tem nome e texto próprios', () => {
    for (const estado of Object.keys(NOMES_ESTADO) as EstadoSistema[]) {
      render(<FaixaDeEstado estado={estado} />);
      expect(screen.getByText(NOMES_ESTADO[estado])).toBeTruthy();
      cleanup();
    }
  });

  it('aceita um texto no lugar do padrão e métricas à direita', () => {
    render(
      <FaixaDeEstado estado="saudavel" detalhe="Tudo em dia na Loja Centro.">
        <span>Fila: 0</span>
      </FaixaDeEstado>,
    );
    expect(screen.getByText('Tudo em dia na Loja Centro.')).toBeTruthy();
    expect(screen.getByText('Fila: 0')).toBeTruthy();
  });
});

describe('Botao e Chip', () => {
  it('o botão desabilitado não pode ser clicado', () => {
    render(<Botao disabled>Finalizar</Botao>);
    const botao = screen.getByRole('button', { name: 'Finalizar' }) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    expect(botao.type).toBe('button'); // nunca envia um formulário sem querer
  });

  it('o chip guarda o tom (o significado) da etiqueta', () => {
    render(<Chip tom="atencao">Pausada</Chip>);
    expect(screen.getByText('Pausada').dataset['tom']).toBe('atencao');
  });
});
