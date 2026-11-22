// @vitest-environment jsdom
// As telas do PDV num navegador simulado, falando com um caixa de verdade (banco em memória):
// abrir o caixa, fazer uma venda com troco, ver "Venda finalizada" e fechar o caixa.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { abrirBancoDoCaixa, Caixa } from '../src/index.ts';
import { criarApi } from '../src/servidor/api.ts';
import { prepararDemonstracao } from '../src/servidor/demonstracao.ts';
import { App } from '../web/App.tsx';

beforeEach(() => {
  const caixa = new Caixa(abrirBancoDoCaixa(':memory:'));
  prepararDemonstracao(caixa);
  const api = criarApi(caixa);
  // O "servidor": cada fetch das telas vai direto para a API do caixa.
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const corpo = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    const r = api.tratar(init?.method ?? 'GET', url, corpo);
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const digitar = (rotulo: RegExp, texto: string) => fireEvent.change(screen.getByLabelText(rotulo), { target: { value: texto } });

describe('telas do PDV', () => {
  it('abre o caixa, vende 2 cafés com troco e fecha o caixa', async () => {
    render(<App />);

    // Abrir caixa
    await screen.findByRole('heading', { name: 'Abrir caixa' });
    digitar(/Operador/, 'Ana');
    digitar(/Fundo de troco/, '100,00');
    fireEvent.click(screen.getByRole('button', { name: /Abrir caixa/ }));

    // Venda: 2 cafés, pagos com R$ 50,00 em dinheiro
    const cafe = await screen.findByRole('button', { name: /Café 500 g/ });
    fireEvent.click(cafe);
    fireEvent.click(cafe);
    expect(screen.getByTestId('total').textContent).toBe('R$ 37,80');
    digitar(/Valor recebido/, '50,00');
    fireEvent.click(screen.getByRole('button', { name: 'Dinheiro' }));
    expect(screen.getByTestId('resumo-pagamento').textContent).toBe('Troco: R$ 12,20');
    fireEvent.click(screen.getByRole('button', { name: /Finalizar venda/ }));

    // Venda finalizada
    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByTestId('codigo-venda').textContent).toMatch(/^MERCBAIRRO-10001-[0-9A-F]{4}$/);
    expect(within(dialogo).getByTestId('troco').textContent).toBe('R$ 12,20');
    fireEvent.click(within(dialogo).getByRole('button', { name: /Nova venda/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await screen.findByText('Estoque: 58');

    // Fechamento: esperado na gaveta = 100,00 + 37,80
    fireEvent.click(screen.getByRole('button', { name: /Fechamento/ }));
    await waitFor(() => expect(screen.getByTestId('esperado').textContent).toBe('R$ 137,80'));
    digitar(/Dinheiro contado/, '137,80');
    fireEvent.click(screen.getByRole('button', { name: /Fechar caixa/ }));
    await screen.findByRole('heading', { name: 'Caixa fechado' });
    expect(screen.getByTestId('diferenca').textContent).toBe('R$ 0,00');
  });

  it('desconto acima do limite: o caixa recusa sem o PIN do supervisor e aceita com ele', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: 'Abrir caixa' });
    digitar(/Operador/, 'Ana');
    fireEvent.click(screen.getByRole('button', { name: /Abrir caixa/ }));

    fireEvent.click(await screen.findByRole('button', { name: /Café 500 g/ }));
    digitar(/Desconto no total/, '5,00');
    expect(screen.getByLabelText(/PIN do supervisor/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Pix' }));
    fireEvent.click(screen.getByRole('button', { name: /Finalizar venda/ }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/exige autorização do supervisor/);

    // PIN errado: recusado. Com o PIN do supervisor (padrão 1234), a mesma venda passa.
    digitar(/PIN do supervisor/, '0000');
    fireEvent.click(screen.getByRole('button', { name: /Finalizar venda/ }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/PIN do supervisor não confere/));
    digitar(/PIN do supervisor/, '1234');
    fireEvent.click(screen.getByRole('button', { name: /Finalizar venda/ }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });
});

describe('caixa novo (Passo 3.1)', () => {
  it('mostra a tela de ativação; o modo demonstração ativa e leva para abrir o caixa', async () => {
    const caixa = new Caixa(abrirBancoDoCaixa(':memory:')); // sem preparar: caixa novo
    const api = criarApi(caixa);
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url === '/api/demonstracao') {
        prepararDemonstracao(caixa);
        return new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      const corpo = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
      const r = api.tratar(init?.method ?? 'GET', url, corpo);
      return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { 'Content-Type': 'application/json' } });
    });
    render(<App />);
    await screen.findByRole('heading', { name: 'Ativar este caixa' });
    expect(screen.getByLabelText(/Código de ativação/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /modo demonstração/ }));
    await screen.findByRole('heading', { name: 'Abrir caixa' });
  });
});
