// Passo 3.2 (formato MEI), de ponta a ponta pela rede: o PDV ativado vende, a fila sobe direto para a
// nuvem com a credencial, e a venda aparece no relatório, no kardex e na validação do ERP.
import { abrirBancoDoCaixa, ativarPelaNuvem, Caixa, destinoDaFila, ligarSincronizacao } from '@continuum/pdv';
import type { Sincronizacao } from '@continuum/pdv';
import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACESSOS_DE_DEMONSTRACAO, criarServidorDaNuvem, prepararNuvem } from '../src/index.ts';
import type { NuvemPreparada, Resposta } from '../src/index.ts';

const portaLivre = () =>
  new Promise<number>((ok) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const porta = (s.address() as AddressInfo).port;
      s.close(() => ok(porta));
    });
  });
const esperarAte = async (condicao: () => boolean | Promise<boolean>, ms = 15_000) => {
  const fim = Date.now() + ms;
  while (!(await condicao())) {
    if (Date.now() > fim) throw new Error('tempo esgotado');
    await new Promise((ok) => setTimeout(ok, 30));
  }
};

/** O sinal de vida é periódico: um que se perde (máquina ocupada) é coberto pelo próximo. Aqui, tenta algumas vezes. */
async function sinalChega(sync: Sincronizacao): Promise<boolean> {
  for (let i = 0; i < 10; i++) {
    if (await sync.enviarSinal()) return true;
    await new Promise((ok) => setTimeout(ok, 300));
  }
  return false;
}

const pasta = mkdtempSync(path.join(tmpdir(), 'continuum-nuvem-'));
let nuvem: NuvemPreparada;
let servidor: Server;
let url: string;
const syncs: Sincronizacao[] = [];

beforeAll(async () => {
  nuvem = await prepararNuvem(pasta, await portaLivre());
  servidor = criarServidorDaNuvem(nuvem.api);
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
}, 60_000);

afterAll(async () => {
  for (const s of syncs) await s.parar();
  await new Promise<void>((ok) => servidor?.close(() => ok()));
  await nuvem?.desligar();
  rmSync(pasta, { recursive: true, force: true });
}, 60_000);

async function dona() {
  let cookie = '';
  const nav = async (metodo: string, caminho: string, corpo?: unknown): Promise<Resposta> => {
    const r = await nuvem.api.tratar({ metodo, caminho, corpo, cabecalhos: { host: 'localhost', cookie } });
    const novo = r.cabecalhos?.['set-cookie'];
    if (novo !== undefined) cookie = novo.split(';')[0] ?? '';
    return r;
  };
  await nav('POST', '/v1/erp/entrar', ACESSOS_DE_DEMONSTRACAO.dono);
  return nav;
}

describe('subida: venda no PDV → relatório do ERP', () => {
  it('a venda, a baixa de estoque, o sinal de vida e o cancelamento chegam ao ERP, sem duplicar', async () => {
    const erp = await dona();
    const { id: produtoId } = (await erp('POST', '/v1/erp/produtos', { nome: 'Arroz 5 kg', precoCentavos: 2790 })).corpo as { id: string };
    const loja = ((await erp('GET', '/v1/erp/loja')).corpo as { lojas: { id: string }[] }).lojas[0]?.id;
    await erp('POST', '/v1/erp/estoque', { produtoId, lojaId: loja, tipo: 'ENTRADA', quantidade: 10, motivo: 'Nota 7' });
    const { codigo, id: dispositivoId } = (await erp('POST', '/v1/erp/caixas', { lojaId: loja })).corpo as { codigo: string; id: string };

    // O PDV ativa e, sem agente informado, envia direto para a nuvem (formato MEI)
    const caixa = new Caixa(abrirBancoDoCaixa(':memory:'));
    await ativarPelaNuvem(caixa, url, codigo);
    const { destino, credencial } = destinoDaFila(caixa, null);
    expect(destino).toBe(url);
    const sync = ligarSincronizacao(caixa, destino, { credencial: credencial as string, esperaOciosaMs: 20, intervaloSinalMs: 60_000 });
    syncs.push(sync);

    caixa.abrirCaixa('João', 5000);
    const { venda } = caixa.registrarVenda({ itens: [{ produtoId, quantidade: 3 }], pagamentos: [{ forma: 'dinheiro', valorCentavos: 10000 }] });
    await esperarAte(() => caixa.fila.contarPendentes() === 0);
    expect(await sinalChega(sync)).toBe(true);

    // Relatório do dia
    const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    const rel = (await erp('GET', `/v1/erp/relatorios/vendas?dia=${hoje}`)).corpo as { totais: { vendas: number; liquidoCentavos: number }; porCaixa: { numeroCaixa: number }[]; trocoCentavos: number };
    expect(rel.totais).toMatchObject({ vendas: 1, liquidoCentavos: 8370 });
    expect(rel.trocoCentavos).toBe(1630);
    expect(rel.porCaixa[0]?.numeroCaixa).toBe(1);

    // Kardex: entrada da nota e a venda, com o código do comprovante; saldo 7
    const kardex = ((await erp('GET', `/v1/erp/produtos/${produtoId}/kardex`)).corpo as { kardex: { tipo: string; saldo: number; codigoVenda: string | null }[] }).kardex;
    expect(kardex.map((k) => [k.tipo, k.saldo, k.codigoVenda])).toEqual([
      ['ENTRADA', 10, null],
      ['VENDA', 7, venda.codigo],
    ]);

    // Validação do comprovante e o caixa com sinal de vida
    expect((await erp('GET', `/v1/erp/vendas/validar?codigo=${venda.codigo}`)).corpo).toMatchObject({ valida: true, liquidoCentavos: 8370 });
    const caixas = ((await erp('GET', '/v1/erp/caixas')).corpo as { caixas: { id: string; caixaAberto: boolean | null }[] }).caixas;
    expect(caixas.find((c) => c.id === dispositivoId)?.caixaAberto).toBe(true);

    // Cancelamento sobe e o relatório tira a venda; o estoque volta
    caixa.cancelarVenda(venda.codigo, 'Cliente desistiu', 'Dona Maria', '1234');
    await esperarAte(() => caixa.fila.contarPendentes() === 0);
    const rel2 = (await erp('GET', `/v1/erp/relatorios/vendas?dia=${hoje}`)).corpo as { totais: { vendas: number }; canceladas: { quantidade: number } };
    expect(rel2.totais.vendas).toBe(0);
    expect(rel2.canceladas.quantidade).toBe(1);
    const produtos = ((await erp('GET', '/v1/erp/produtos')).corpo as { produtos: { id: string; saldo: number }[] }).produtos;
    expect(produtos.find((p) => p.id === produtoId)?.saldo).toBe(10);

    // Nada duplicou: a nuvem tem exatamente os eventos da fila do caixa
    const eu = (await erp('GET', '/v1/eu')).corpo as { cliente: { id: string } };
    const n = await nuvem.banco.transacao('continuum_app', eu.cliente.id, (tx) => tx.consultarUma<{ n: number }>('SELECT count(*)::int AS n FROM eventos_recebidos WHERE origem_id = $1', dispositivoId));
    expect(n?.n).toBe(caixa.fila.todos().length);
  }, 60_000);

  it('caixa desativado no ERP: a nuvem recusa e a fila do caixa para (sem perder nada)', async () => {
    const erp = await dona();
    const loja = ((await erp('GET', '/v1/erp/loja')).corpo as { lojas: { id: string }[] }).lojas[0]?.id;
    const { codigo, id } = (await erp('POST', '/v1/erp/caixas', { lojaId: loja })).corpo as { codigo: string; id: string };
    const caixa = new Caixa(abrirBancoDoCaixa(':memory:'));
    await ativarPelaNuvem(caixa, url, codigo);
    await erp('POST', `/v1/erp/caixas/${id}/desativar`);

    const { destino, credencial } = destinoDaFila(caixa, null);
    const sync = ligarSincronizacao(caixa, destino, { credencial: credencial as string, esperaOciosaMs: 20, intervaloSinalMs: 60_000 });
    syncs.push(sync);
    caixa.abrirCaixa('Intruso', 0);
    await esperarAte(() => sync.resumo().bloqueio !== null);
    expect(sync.resumo().bloqueio).toMatchObject({ motivo: 'origem', status: 403 });
    expect(caixa.fila.contarPendentes()).toBe(1); // a abertura continua guardada no caixa
  }, 60_000);
});
