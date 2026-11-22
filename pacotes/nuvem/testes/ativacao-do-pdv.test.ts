// Passo 3.1, de ponta a ponta pela rede: a dona cadastra um produto e cria um caixa no ERP; o PDV novo
// ativa com o código, recebe loja, parâmetros, catálogo e saldo, e vende o produto cadastrado na nuvem.
import { abrirBancoDoCaixa, ativarPelaNuvem, AtivacaoRecusadaError, Caixa } from '@continuum/pdv';
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

const pasta = mkdtempSync(path.join(tmpdir(), 'continuum-nuvem-'));
let nuvem: NuvemPreparada;
let servidor: Server;
let url: string;

beforeAll(async () => {
  nuvem = await prepararNuvem(pasta, await portaLivre());
  servidor = criarServidorDaNuvem(nuvem.api);
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
}, 60_000);

afterAll(async () => {
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

describe('ativação do PDV pela nuvem', () => {
  it('o PDV ativa com o código e vende o produto cadastrado no ERP', async () => {
    const erp = await dona();
    const { id: produtoId } = (await erp('POST', '/v1/erp/produtos', { nome: 'Café 500 g', precoCentavos: 1890, ean: '7890000000017' })).corpo as { id: string };
    const loja = ((await erp('GET', '/v1/erp/loja')).corpo as { lojas: { id: string }[] }).lojas[0]?.id;
    await erp('POST', '/v1/erp/estoque', { produtoId, lojaId: loja, tipo: 'ENTRADA', quantidade: 30, motivo: 'Nota 1' });
    const { codigo } = (await erp('POST', '/v1/erp/caixas', { lojaId: loja })).corpo as { codigo: string };

    const caixa = new Caixa(abrirBancoDoCaixa(':memory:'));
    await ativarPelaNuvem(caixa, url, codigo.toLowerCase().replace('-', ' '));

    expect(caixa.identidade()).toMatchObject({ nomeReduzido: 'MERCBAIRRO', numeroCaixa: 1, lojaId: loja });
    expect(caixa.configuracao('credencial')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(caixa.configuracao('urlNuvem')).toBe(url);
    expect(caixa.configuracaoDoComprovante().cabecalho).toEqual(['Mercadinho do Bairro', 'Rua Exemplo, 123 · Centro']);
    expect(caixa.catalogo()).toEqual([expect.objectContaining({ id: produtoId, nome: 'Café 500 g', precoCentavos: 1890, saldo: 30 })]);
    expect(caixa.fila.contarPendentes()).toBe(0); // o saldo veio da nuvem: não sobe de volta

    caixa.abrirCaixa('João', 10000);
    const { venda } = caixa.registrarVenda({ itens: [{ produtoId, quantidade: 2 }], pagamentos: [{ forma: 'pix', valorCentavos: 3780 }] });
    expect(venda.codigo).toMatch(/^MERCBAIRRO-10001-/);
    expect(caixa.saldo(produtoId)).toBe(28);

    // Na nuvem, o caixa aparece ativo
    const caixas = ((await erp('GET', '/v1/erp/caixas')).corpo as { caixas: { numeroCaixa: number; situacao: string }[] }).caixas;
    expect(caixas.find((c) => c.numeroCaixa === 1)?.situacao).toBe('ativo');
  });

  it('o mesmo código não ativa outro caixa; código errado ou nuvem fora do ar dão mensagem clara', async () => {
    const erp = await dona();
    const loja = ((await erp('GET', '/v1/erp/loja')).corpo as { lojas: { id: string }[] }).lojas[0]?.id;
    const { codigo } = (await erp('POST', '/v1/erp/caixas', { lojaId: loja })).corpo as { codigo: string };
    await ativarPelaNuvem(new Caixa(abrirBancoDoCaixa(':memory:')), url, codigo);

    await expect(ativarPelaNuvem(new Caixa(abrirBancoDoCaixa(':memory:')), url, codigo)).rejects.toThrow(/não encontrado/);
    await expect(ativarPelaNuvem(new Caixa(abrirBancoDoCaixa(':memory:')), url, '2222-2222')).rejects.toThrow(AtivacaoRecusadaError);
    await expect(ativarPelaNuvem(new Caixa(abrirBancoDoCaixa(':memory:')), 'http://127.0.0.1:1', codigo)).rejects.toThrow(/Sem conexão/);
  });
});
