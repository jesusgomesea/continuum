// Teste de queda (Passo 4.1) no trecho caixa → nuvem (formato MEI): dois caixas ativados vendem enquanto
// o Kryptonita derruba conexões, perde respostas e deixa a nuvem fora do ar. Depois a rede volta e a
// conferência prova, no PostgreSQL: cada evento de cada caixa chegou, uma vez só, e cada venda está no ERP.
import { abrirBancoDoCaixa, ativarPelaNuvem, Caixa, ligarSincronizacao } from '@continuum/pdv';
import type { Sincronizacao } from '@continuum/pdv';
import { falhasAleatorias, iniciarKryptonita } from '@continuum/sync';
import type { Kryptonita } from '@continuum/sync';
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
const espera = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

const pasta = mkdtempSync(path.join(tmpdir(), 'continuum-nuvem-'));
let nuvem: NuvemPreparada;
let servidor: Server;
let url: string;
let kryptonita: Kryptonita;
const syncs: Sincronizacao[] = [];

beforeAll(async () => {
  nuvem = await prepararNuvem(pasta, await portaLivre());
  servidor = criarServidorDaNuvem(nuvem.api);
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  kryptonita = await iniciarKryptonita(url);
}, 60_000);

afterAll(async () => {
  for (const s of syncs) await s.parar();
  await kryptonita?.fechar();
  await new Promise<void>((ok) => {
    servidor?.closeAllConnections();
    servidor?.close(() => ok());
  });
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

describe('teste de queda: caixas → nuvem', () => {
  it('com falhas aleatórias e queda total da nuvem, nada se perde e nada duplica', async () => {
    const erp = await dona();
    const loja = ((await erp('GET', '/v1/erp/loja')).corpo as { lojas: { id: string }[] }).lojas[0]?.id;
    const { id: produtoId } = (await erp('POST', '/v1/erp/produtos', { nome: 'Biscoito', precoCentavos: 399 })).corpo as { id: string };
    await erp('POST', '/v1/erp/estoque', { produtoId, lojaId: loja, tipo: 'ENTRADA', quantidade: 1000, motivo: 'Estoque do teste' });

    // Dois caixas ativados pela nuvem, mas falando com ela ATRAVÉS do Kryptonita
    const caixas: { caixa: Caixa; id: string }[] = [];
    for (let i = 0; i < 2; i++) {
      const { codigo, id } = (await erp('POST', '/v1/erp/caixas', { lojaId: loja })).corpo as { codigo: string; id: string };
      const caixa = new Caixa(abrirBancoDoCaixa(':memory:'));
      await ativarPelaNuvem(caixa, url, codigo);
      const credencial = caixa.configuracao('credencial') as string;
      syncs.push(ligarSincronizacao(caixa, kryptonita.url, { credencial, esperaOciosaMs: 5, intervaloSinalMs: 60_000, backoff: { inicialMs: 20, maximoMs: 300 } }));
      caixa.abrirCaixa(`Operador ${i + 1}`, 0);
      caixas.push({ caixa, id });
    }

    let vendas = 0;
    const vender = (caixa: Caixa, n: number) => {
      const { venda } = caixa.registrarVenda({ itens: [{ produtoId, quantidade: 1 + (n % 2) }], pagamentos: [{ forma: 'pix', valorCentavos: 399 * (1 + (n % 2)) }] });
      vendas += 1;
      if (n % 6 === 2) caixa.cancelarVenda(venda.codigo, 'Teste de queda', 'Supervisor', '1234');
    };

    kryptonita.decidir = falhasAleatorias(0.5); // metade dos pedidos falha
    for (let n = 0; n < 15; n++) {
      for (const { caixa } of caixas) vender(caixa, n);
      await espera(5);
    }
    kryptonita.decidir = () => 'derrubar'; // queda total: a loja continua vendendo
    for (let n = 15; n < 22; n++) {
      for (const { caixa } of caixas) vender(caixa, n);
      await espera(5);
    }
    kryptonita.decidir = () => 'normal'; // a internet voltou
    for (let i = 0; i < 600 && caixas.some(({ caixa }) => caixa.fila.contarPendentes() > 0); i++) await espera(50);

    // Conferência no PostgreSQL, caixa a caixa
    const eu = (await erp('GET', '/v1/eu')).corpo as { cliente: { id: string } };
    for (const { caixa, id } of caixas) {
      expect(caixa.fila.contarPendentes()).toBe(0);
      const naNuvem = await nuvem.banco.transacao('continuum_app', eu.cliente.id, (tx) =>
        tx.consultar<{ seq: string; id: string }>('SELECT seq, id FROM eventos_recebidos WHERE origem_id = $1 ORDER BY seq', id),
      );
      expect(naNuvem.map((e) => [Number(e.seq), e.id])).toEqual(caixa.fila.todos().map((e) => [e.seq, e.id]));
    }
    const vendasNaNuvem = await nuvem.banco.transacao('continuum_app', eu.cliente.id, (tx) => tx.consultarUma<{ n: number }>('SELECT count(*)::int AS n FROM vendas'));
    expect(vendasNaNuvem?.n).toBe(vendas);
    const falhas = kryptonita.contagem.derrubar + kryptonita.contagem['perder-resposta'] + kryptonita.contagem.indisponivel;
    expect(falhas).toBeGreaterThan(0);

    // O estoque da nuvem bate com o que os caixas venderam e estornaram
    const saldo = ((await erp('GET', '/v1/erp/produtos')).corpo as { produtos: { id: string; saldo: number }[] }).produtos.find((p) => p.id === produtoId)?.saldo;
    const vendidoLiquido = caixas.reduce((t, { caixa }) => t + (1000 - caixa.saldo(produtoId)), 0);
    expect(saldo).toBe(1000 - vendidoLiquido);
  }, 120_000);
});
