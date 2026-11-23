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

describe('tela de venda: busca, atalhos, notas rápidas, CPF e espera', () => {
  async function abrirCaixa() {
    render(<App />);
    await screen.findByRole('heading', { name: 'Abrir caixa' });
    digitar(/Operador/, 'Ana');
    fireEvent.click(screen.getByRole('button', { name: /Abrir caixa/ }));
    return screen.findByLabelText('Buscar produto');
  }

  it('busca sem acento, Enter com código bipado, F2 quantidade, Delete tira o último', async () => {
    const busca = await abrirCaixa();
    fireEvent.change(busca, { target: { value: 'ACUCAR' } });
    expect(screen.getAllByRole('button', { name: /Açúcar 1 kg/ })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /Café 500 g/ })).toBeNull();

    // Código de barras do café + Enter: entra direto.
    fireEvent.change(busca, { target: { value: '7890000000017' } });
    fireEvent.keyDown(busca, { key: 'Enter' });
    expect(screen.getByTestId('total').textContent).toBe('R$ 18,90');

    // F2: 3 unidades do próximo item.
    fireEvent.keyDown(window, { key: 'F2' });
    fireEvent.change(screen.getByLabelText('Quantas unidades?'), { target: { value: '3' } });
    fireEvent.keyDown(screen.getByLabelText('Quantas unidades?'), { key: 'Enter' });
    fireEvent.change(busca, { target: { value: 'leite' } });
    fireEvent.keyDown(busca, { key: 'Enter' });
    expect(screen.getByTestId('total').textContent).toBe('R$ 33,87'); // 18,90 + 3 × 4,99

    // "2*" na busca também multiplica.
    fireEvent.change(busca, { target: { value: '2*biscoito' } });
    fireEvent.keyDown(busca, { key: 'Enter' });
    expect(screen.getByTestId('total').textContent).toBe('R$ 41,85');

    // Delete tira o último item lançado (o biscoito).
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(screen.getByTestId('total').textContent).toBe('R$ 33,87');
  });

  it('notas rápidas mostram o troco; CPF inválido trava e válido sai na venda', async () => {
    const busca = await abrirCaixa();
    fireEvent.change(busca, { target: { value: '7890000000017' } });
    fireEvent.keyDown(busca, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'R$ 20,00' }));
    expect(screen.getByTestId('resumo-pagamento').textContent).toBe('Troco: R$ 1,10');

    digitar(/CPF do cliente/, '529.982.247-24');
    expect(screen.getByText(/CPF inválido/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /Finalizar venda/ }) as HTMLButtonElement).disabled).toBe(true);
    digitar(/CPF do cliente/, '529.982.247-25');
    expect(screen.getByText('CPF 529.982.247-25')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Finalizar venda/ }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });

  it('F6 põe a venda em espera e ela pode ser retomada', async () => {
    const busca = await abrirCaixa();
    fireEvent.change(busca, { target: { value: '7890000000017' } });
    fireEvent.keyDown(busca, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 'F6' });
    await waitFor(() => expect(screen.getByTestId('total').textContent).toBe('R$ 0,00'));
    await screen.findByRole('button', { name: /Espera \(F6\) · 1/ });

    fireEvent.click(screen.getByRole('button', { name: /Espera \(F6\)/ }));
    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByText('Cliente 1')).toBeTruthy();
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Retomar' }));
    await waitFor(() => expect(screen.getByTestId('total').textContent).toBe('R$ 18,90'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
