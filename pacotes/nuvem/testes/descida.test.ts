// Passo 3.3, de ponta a ponta pela rede: preço alterado no ERP, produto novo e parâmetros mudados no
// Central chegam ao caixa em segundos, em ordem, uma vez só.
import { abrirBancoDoCaixa, ativarPelaNuvem, baixarAlteracoes, Caixa, destinoDaFila, ligarSincronizacao } from '@continuum/pdv';
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
const esperarAte = async (condicao: () => boolean, ms = 10_000) => {
  const fim = Date.now() + ms;
  while (!condicao()) {
    if (Date.now() > fim) throw new Error('tempo esgotado');
    await new Promise((ok) => setTimeout(ok, 30));
  }
};

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

describe('descida: ERP → caixa', () => {
  it('preço alterado, produto novo e parâmetros do Central chegam ao caixa', async () => {
    const erp = navegador();
    await erp('POST', '/v1/erp/entrar', ACESSOS_DE_DEMONSTRACAO.dono);
    const { id: leite } = (await erp('POST', '/v1/erp/produtos', { nome: 'Leite 1 L', precoCentavos: 499 })).corpo as { id: string };
    const loja = ((await erp('GET', '/v1/erp/loja')).corpo as { lojas: { id: string }[] }).lojas[0]?.id;
    const { codigo } = (await erp('POST', '/v1/erp/caixas', { lojaId: loja })).corpo as { codigo: string };

    const caixa = new Caixa(abrirBancoDoCaixa(':memory:'));
    await ativarPelaNuvem(caixa, url, codigo);
    const { destino, credencial } = destinoDaFila(caixa, null);
    const sync = ligarSincronizacao(caixa, destino, { credencial: credencial as string, esperaOciosaMs: 20, intervaloSinalMs: 60_000, intervaloDescidaMs: 50 });
    syncs.push(sync);
    const preco = (id: string) => caixa.catalogo().find((p) => p.id === id)?.precoCentavos;
    expect(preco(leite)).toBe(499);

    // O dono muda o preço no ERP
    await erp('PUT', `/v1/erp/produtos/${leite}`, { nome: 'Leite 1 L', precoCentavos: 549, version: 1 });
    await esperarAte(() => preco(leite) === 549);

    // E cadastra um produto novo
    const { id: pao } = (await erp('POST', '/v1/erp/produtos', { nome: 'Pão de forma', precoCentavos: 899 })).corpo as { id: string };
    await esperarAte(() => preco(pao) === 899);

    // A Equipe muda os parâmetros do cliente no Central
    const central = navegador();
    await central('POST', '/v1/central/entrar', ACESSOS_DE_DEMONSTRACAO.central);
    const eu = (await erp('GET', '/v1/eu')).corpo as { cliente: { id: string } };
    await central('PUT', `/v1/central/clientes/${eu.cliente.id}/parametros`, { regraEstoque: 'permitir_alerta', limiteDescontoPct: 20, comprovante: { largura: 58, cabecalho: ['Mercadinho'] } });
    await esperarAte(() => caixa.parametros().limiteDescontoPct === 20);
    expect(caixa.parametros().regraEstoque).toBe('permitir_alerta');
    expect(caixa.configuracaoDoComprovante().largura).toBe(58);

    // Sem estoque e com "permitir com alerta" vindo do Central, o caixa vende o pão (alerta de negativo)
    caixa.abrirCaixa('João', 0);
    const { alertasEstoque } = caixa.registrarVenda({ itens: [{ produtoId: pao, quantidade: 1 }], pagamentos: [{ forma: 'pix', valorCentavos: 899 }] });
    expect(alertasEstoque).toHaveLength(1);

    // Rodar de novo não reaplica nada (o cursor avançou)
    expect(await baixarAlteracoes(caixa, destino, credencial as string)).toBe(0);
  }, 60_000);

  it('sem credencial válida, a nuvem não entrega as mudanças', async () => {
    const r = await fetch(`${url}/v1/alteracoes?desde=0`, { headers: { authorization: 'Bearer credencial-falsa' } });
    expect(r.status).toBe(403);
  });
});
