// Passo 3.4: o Central vê, ao vivo, cada caixa ativo de cada cliente (sinal de vida, fila, vendas do dia).
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

function navegador() {
  let cookie = '';
  return async (metodo: string, caminho: string, corpo?: unknown): Promise<Resposta> => {
    const r = await nuvem.api.tratar({ metodo, caminho, corpo, cabecalhos: { host: 'localhost', cookie } });
    const novo = r.cabecalhos?.['set-cookie'];
    if (novo !== undefined) cookie = novo.split(';')[0] ?? '';
    return r;
  };
}

type Monitor = { resumo: { caixas: number; saudaveis: number }; caixas: { id: string; situacao: string; cliente: string; caixaAberto: boolean; vendasHoje: number }[] };

describe('monitor ao vivo no Central', () => {
  it('o caixa ativado aparece com o sinal de vida; caixa sem sinal aparece como "sem sinal"', async () => {
    const erp = navegador();
    await erp('POST', '/v1/erp/entrar', ACESSOS_DE_DEMONSTRACAO.dono);
    const { id: produtoId } = (await erp('POST', '/v1/erp/produtos', { nome: 'Água 1,5 L', precoCentavos: 349 })).corpo as { id: string };
    const loja = ((await erp('GET', '/v1/erp/loja')).corpo as { lojas: { id: string }[] }).lojas[0]?.id;
    await erp('POST', '/v1/erp/estoque', { produtoId, lojaId: loja, tipo: 'ENTRADA', quantidade: 5, motivo: 'Nota' });
    const vivo = (await erp('POST', '/v1/erp/caixas', { lojaId: loja })).corpo as { codigo: string; id: string };
    const mudo = (await erp('POST', '/v1/erp/caixas', { lojaId: loja })).corpo as { codigo: string; id: string };

    const caixa = new Caixa(abrirBancoDoCaixa(':memory:'));
    await ativarPelaNuvem(caixa, url, vivo.codigo);
    await ativarPelaNuvem(new Caixa(abrirBancoDoCaixa(':memory:')), url, mudo.codigo); // ativado, mas nunca manda sinal
    const { destino, credencial } = destinoDaFila(caixa, null);
    const sync = ligarSincronizacao(caixa, destino, { credencial: credencial as string, esperaOciosaMs: 20, intervaloSinalMs: 60_000 });
    syncs.push(sync);
    caixa.abrirCaixa('João', 0);
    caixa.registrarVenda({ itens: [{ produtoId, quantidade: 1 }], pagamentos: [{ forma: 'pix', valorCentavos: 349 }] });
    for (let i = 0; i < 200 && caixa.fila.contarPendentes() > 0; i++) await new Promise((ok) => setTimeout(ok, 30));
    expect(await sinalChega(sync)).toBe(true);

    const central = navegador();
    await central('POST', '/v1/central/entrar', ACESSOS_DE_DEMONSTRACAO.central);
    const m = (await central('GET', '/v1/central/monitor')).corpo as Monitor;
    expect(m.caixas.find((c) => c.id === vivo.id)).toMatchObject({ situacao: 'saudavel', cliente: 'Mercadinho do Bairro', caixaAberto: true, vendasHoje: 1 });
    expect(m.caixas.find((c) => c.id === mudo.id)?.situacao).toBe('sem-sinal');
    expect(m.resumo.saudaveis).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it('o monitor é só da Equipe Continuum', async () => {
    const erp = navegador();
    await erp('POST', '/v1/erp/entrar', ACESSOS_DE_DEMONSTRACAO.dono);
    expect((await erp('GET', '/v1/central/monitor')).status).toBe(403);
  });
});
