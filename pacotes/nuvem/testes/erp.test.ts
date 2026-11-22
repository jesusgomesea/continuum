// Passo 2.4: ERP do cliente — produtos, preço com versão, estoque, kardex, loja e comprovante.
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACESSOS_DE_DEMONSTRACAO, prepararNuvem } from '../src/index.ts';
import type { NuvemPreparada, Resposta } from '../src/index.ts';

const portaLivre = () =>
  new Promise<number>((ok) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const porta = (s.address() as AddressInfo).port;
      s.close(() => ok(porta));
    });
  });

const pasta = mkdtempSync(path.join(tmpdir(), 'continuum-nuvem-'));
let nuvem: NuvemPreparada;
beforeAll(async () => {
  nuvem = await prepararNuvem(pasta, await portaLivre());
}, 60_000);
afterAll(async () => {
  await nuvem?.desligar();
  rmSync(pasta, { recursive: true, force: true });
}, 60_000);

async function entrar(quem: 'dono' | 'operador') {
  let cookie = '';
  const nav = async (metodo: string, caminho: string, corpo?: unknown): Promise<Resposta> => {
    const r = await nuvem.api.tratar({ metodo, caminho, corpo, cabecalhos: { host: 'localhost', cookie } });
    const novo = r.cabecalhos?.['set-cookie'];
    if (novo !== undefined) cookie = novo.split(';')[0] ?? '';
    return r;
  };
  await nav('POST', '/v1/erp/entrar', ACESSOS_DE_DEMONSTRACAO[quem]);
  return nav;
}

type Produto = { id: string; nome: string; precoCentavos: number; version: number; saldo: number };

describe('ERP: produtos e estoque', () => {
  it('cadastra o café, dá entrada, ajusta e o kardex conta a história com o saldo', async () => {
    const dono = await entrar('dono');
    const r = await dono('POST', '/v1/erp/produtos', { nome: 'Café 500 g', precoCentavos: 1890, unidade: 'un', ean: '7890000000017' });
    expect(r.status).toBe(201);
    const { id } = r.corpo as { id: string };
    const { lojas } = (await dono('GET', '/v1/erp/loja')).corpo as { lojas: { id: string; nome_reduzido: string }[] };
    const loja = lojas[0]?.id;

    expect(await dono('POST', '/v1/erp/estoque', { produtoId: id, lojaId: loja, tipo: 'ENTRADA', quantidade: 24, motivo: 'Nota 123' })).toMatchObject({ status: 201, corpo: { saldo: 24 } });
    expect(await dono('POST', '/v1/erp/estoque', { produtoId: id, lojaId: loja, tipo: 'AJUSTE', quantidade: -2, motivo: 'Quebra' })).toMatchObject({ corpo: { saldo: 22 } });

    const produtos = ((await dono('GET', '/v1/erp/produtos')).corpo as { produtos: Produto[] }).produtos;
    expect(produtos.find((p) => p.id === id)).toMatchObject({ nome: 'Café 500 g', precoCentavos: 1890, saldo: 22, version: 1 });

    const kardex = ((await dono('GET', `/v1/erp/produtos/${id}/kardex`)).corpo as { kardex: { tipo: string; quantidade: number; saldo: number; loja: string }[] }).kardex;
    expect(kardex.map((k) => [k.tipo, k.quantidade, k.saldo, k.loja])).toEqual([
      ['ENTRADA', 24, 24, 'MERCBAIRRO'],
      ['AJUSTE', -2, 22, 'MERCBAIRRO'],
    ]);
  });

  it('ajuste que deixaria negativo, ajuste sem motivo e entrada negativa são recusados', async () => {
    const dono = await entrar('dono');
    const { id } = (await dono('POST', '/v1/erp/produtos', { nome: 'Açúcar 1 kg', precoCentavos: 549 })).corpo as { id: string };
    const loja = ((await dono('GET', '/v1/erp/loja')).corpo as { lojas: { id: string }[] }).lojas[0]?.id;
    expect(await dono('POST', '/v1/erp/estoque', { produtoId: id, lojaId: loja, tipo: 'AJUSTE', quantidade: -1, motivo: 'x' })).toMatchObject({ status: 422 });
    expect(await dono('POST', '/v1/erp/estoque', { produtoId: id, lojaId: loja, tipo: 'AJUSTE', quantidade: 5 })).toMatchObject({ status: 400, corpo: { mensagem: expect.stringMatching(/motivo/) } });
    expect(await dono('POST', '/v1/erp/estoque', { produtoId: id, lojaId: loja, tipo: 'ENTRADA', quantidade: -3 })).toMatchObject({ status: 400 });
  });

  it('alterar o preço sobe a versão; quem editou uma versão antiga é avisado em vez de sobrescrever', async () => {
    const dono = await entrar('dono');
    const { id } = (await dono('POST', '/v1/erp/produtos', { nome: 'Leite 1 L', precoCentavos: 499 })).corpo as { id: string };
    expect(await dono('PUT', `/v1/erp/produtos/${id}`, { nome: 'Leite 1 L', precoCentavos: 529, version: 1 })).toMatchObject({ status: 200, corpo: { version: 2 } });
    expect(await dono('PUT', `/v1/erp/produtos/${id}`, { nome: 'Leite 1 L', precoCentavos: 549, version: 1 })).toMatchObject({ status: 409, corpo: { mensagem: expect.stringMatching(/Outra pessoa/) } });
  });

  it('cada mudança de produto entra na fila de descida para os caixas', async () => {
    const dono = await entrar('dono');
    const { id } = (await dono('POST', '/v1/erp/produtos', { nome: 'Pão de forma', precoCentavos: 899 })).corpo as { id: string };
    await dono('PUT', `/v1/erp/produtos/${id}`, { nome: 'Pão de forma', precoCentavos: 949, version: 1 });
    const eu = (await dono('GET', '/v1/eu')).corpo as { cliente: { id: string } };
    const fila = await nuvem.banco.transacao('continuum_app', eu.cliente.id, (tx) =>
      tx.consultar<{ versao: number; preco: number }>("SELECT versao, (dados->>'precoCentavos')::int AS preco FROM alteracoes WHERE entidade_id = $1 ORDER BY seq", id),
    );
    expect(fila).toEqual([{ versao: 1, preco: 899 }, { versao: 2, preco: 949 }]);
  });

  it('EAN inválido, preço negativo e nome vazio são recusados', async () => {
    const dono = await entrar('dono');
    expect((await dono('POST', '/v1/erp/produtos', { nome: 'X', precoCentavos: 100, ean: '7890000000018' })).status).toBe(400);
    expect((await dono('POST', '/v1/erp/produtos', { nome: 'X', precoCentavos: -1 })).status).toBe(400);
    expect((await dono('POST', '/v1/erp/produtos', { nome: ' ', precoCentavos: 100 })).status).toBe(400);
  });

  it('o operador não cadastra produto nem mexe no estoque', async () => {
    const operador = await entrar('operador');
    expect((await operador('POST', '/v1/erp/produtos', { nome: 'X', precoCentavos: 100 })).status).toBe(403);
    expect((await operador('GET', '/v1/erp/produtos')).status).toBe(403);
  });
});

describe('ERP: loja e comprovante', () => {
  it('o dono muda o comprovante: nova versão de parâmetros e aviso aos caixas', async () => {
    const dono = await entrar('dono');
    const r = await dono('PUT', '/v1/erp/comprovante', { cabecalho: ['Mercadinho do Bairro', 'CNPJ 11.222.333/0001-81'], rodape: 'Volte sempre!' });
    expect(r.status).toBe(200);
    const loja = (await dono('GET', '/v1/erp/loja')).corpo as { comprovante: { rodape: string; largura: number }; lojas: { id: string }[] };
    expect(loja.comprovante).toMatchObject({ rodape: 'Volte sempre!', largura: 80 }); // a largura (do Central) foi mantida
    expect((await dono('PUT', `/v1/erp/lojas/${loja.lojas[0]?.id ?? ''}`, { nome: 'Mercadinho do Bairro - Centro', telefone: '(11) 1234-5678' })).status).toBe(200);
  });
});
