// De ponta a ponta, pela rede: o PDV vende, a fila chega ao agente da loja, o painel mostra a venda
// e o sinal de vida. O agente cai, o caixa continua vendendo; o agente volta e recebe tudo, sem duplicar.
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import path from 'node:path';
import { abrirBancoDoCaixa, Caixa, ligarSincronizacao } from '@continuum/pdv';
import { prepararDemonstracao } from '../../pdv/src/servidor/demonstracao.ts';
import { afterEach, describe, expect, it } from 'vitest';
import { abrirBancoDaLoja, Agente, criarServidorDoAgente, ligar } from '../src/index.ts';
import type { Sincronizacao } from '@continuum/pdv';

const estilos = readFileSync(path.join(import.meta.dirname, '..', '..', 'interface', 'src', 'tokens', 'tokens.css'), 'utf8');
const esperarAte = async (condicao: () => boolean, ms = 8000) => {
  const fim = Date.now() + ms;
  while (!condicao()) {
    if (Date.now() > fim) throw new Error('tempo esgotado esperando a condição');
    await new Promise((ok) => setTimeout(ok, 20));
  }
};
const fechar = (s: Server) => new Promise<void>((ok) => s.close(() => ok()));

const abertos: { servidor?: Server; sync?: Sincronizacao }[] = [];
afterEach(async () => {
  for (const a of abertos.splice(0)) {
    await a.sync?.parar();
    if (a.servidor?.listening) await fechar(a.servidor);
  }
});

function caixaDeDemonstracao(): Caixa {
  const caixa = new Caixa(abrirBancoDoCaixa(':memory:'));
  prepararDemonstracao(caixa);
  caixa.abrirCaixa('Ana', 10000);
  return caixa;
}

function vender(caixa: Caixa, quantidade = 1) {
  const p = caixa.catalogo()[0];
  if (p === undefined) throw new Error('sem produto');
  return caixa.registrarVenda({ itens: [{ produtoId: p.id, quantidade }], pagamentos: [{ forma: 'pix', valorCentavos: p.precoCentavos * quantidade }] }).venda;
}

describe('PDV e agente da loja, pela rede', () => {
  it('a venda chega ao agente; o painel mostra o caixa, a venda e o sinal de vida', async () => {
    const agente = new Agente(abrirBancoDaLoja(':memory:'));
    const servidor = criarServidorDoAgente(agente, { estilos });
    const endereco = await ligar(servidor, 0, '127.0.0.1');
    const caixa = caixaDeDemonstracao();
    const sync = ligarSincronizacao(caixa, endereco, { esperaOciosaMs: 10, intervaloSinalMs: 50 });
    abertos.push({ servidor, sync });

    const venda = vender(caixa, 2);
    await esperarAte(() => caixa.fila.contarPendentes() === 0);
    await sync.enviarSinal();

    const [painel] = agente.painel();
    expect(painel?.dispositivoId).toBe(caixa.identidade().dispositivoId);
    expect(painel?.ultimasVendas[0]).toMatchObject({ codigo: venda.codigo, liquidoCentavos: venda.liquidoCentavos, cancelada: false });
    expect(painel?.vendas.quantidade).toBe(1);
    expect(painel?.sinal).toMatchObject({ caixaAberto: true, filaPendente: 0, estado: 'saudavel', semSinal: false });
    expect(painel?.ultimaSeq).toBe(caixa.fila.todos().at(-1)?.seq);

    // A página e o JSON do painel respondem
    expect(await (await fetch(`${endereco}/`)).text()).toContain('CONTINUUM');
    const json = (await (await fetch(`${endereco}/api/painel`)).json()) as { caixas: unknown[] };
    expect(json.caixas).toHaveLength(1);
  });

  it('agente fora do ar: o caixa vende normalmente e a fila cresce; o agente volta e recebe tudo, uma vez só', async () => {
    const banco = abrirBancoDaLoja(':memory:');
    const agente = new Agente(banco);
    let servidor = criarServidorDoAgente(agente, { estilos });
    const endereco = await ligar(servidor, 0, '127.0.0.1');
    const porta = Number(new URL(endereco).port);
    const caixa = caixaDeDemonstracao();
    const sync = ligarSincronizacao(caixa, endereco, { esperaOciosaMs: 10, intervaloSinalMs: 60_000 });
    abertos.push({ sync });
    await esperarAte(() => caixa.fila.contarPendentes() === 0);

    await fechar(servidor); // o agente caiu
    const vendasNaQueda = [vender(caixa), vender(caixa), vender(caixa)];
    await esperarAte(() => sync.resumo().estado !== 'saudavel', 5000);
    expect(caixa.fila.contarPendentes()).toBeGreaterThan(0);

    servidor = criarServidorDoAgente(agente, { estilos }); // o agente voltou, no mesmo endereço
    await ligar(servidor, porta, '127.0.0.1');
    abertos.push({ servidor });
    await esperarAte(() => caixa.fila.contarPendentes() === 0, 15_000);

    const codigos = agente.painel()[0]?.ultimasVendas.map((v) => v.codigo) ?? [];
    for (const v of vendasNaQueda) expect(codigos).toContain(v.codigo);
    const n = Number(banco.consultarUma('SELECT count(*) AS n FROM eventos_recebidos')?.['n']);
    expect(n).toBe(caixa.fila.todos().length); // nem um a mais, nem um a menos
  }, 30_000);

  it('o agente recusa sinal de vida fora do contrato e rota desconhecida', async () => {
    const agente = new Agente(abrirBancoDaLoja(':memory:'));
    const servidor = criarServidorDoAgente(agente, { estilos });
    const endereco = await ligar(servidor, 0, '127.0.0.1');
    abertos.push({ servidor });
    const r = await fetch(`${endereco}/v1/sinais-de-vida`, { method: 'POST', body: JSON.stringify({ estado: 'quebrado' }) });
    expect(r.status).toBe(400);
    expect((await fetch(`${endereco}/nada`)).status).toBe(404);
    expect((await fetch(`${endereco}/v1/saude`)).status).toBe(200);
  });
});
