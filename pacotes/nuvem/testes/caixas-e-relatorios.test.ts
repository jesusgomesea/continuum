// Passo 2.5: caixas e código de ativação, relatório de vendas e validação do comprovante pelo código.
import { codigoDaVenda, gerarId } from '@continuum/dominio';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACESSOS_DE_DEMONSTRACAO, normalizarCodigo, prepararNuvem } from '../src/index.ts';
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

async function contexto() {
  const dono = await entrar('dono');
  const eu = (await dono('GET', '/v1/eu')).corpo as { cliente: { id: string } };
  const loja = ((await dono('GET', '/v1/erp/loja')).corpo as { lojas: { id: string }[] }).lojas[0]?.id ?? '';
  return { dono, clienteId: eu.cliente.id, loja };
}

describe('caixas (UC17)', () => {
  it('novo caixa recebe o próximo número e um código de ativação de 24 h, guardado só como hash', async () => {
    const { dono, loja, clienteId } = await contexto();
    const r1 = await dono('POST', '/v1/erp/caixas', { lojaId: loja });
    expect(r1.status).toBe(201);
    const c1 = r1.corpo as { id: string; numeroCaixa: number; codigo: string; expiraEm: string };
    expect(c1.numeroCaixa).toBe(1);
    expect(normalizarCodigo(c1.codigo)).toBe(c1.codigo);
    expect(new Date(c1.expiraEm).getTime() - Date.now()).toBeGreaterThan(23 * 3600 * 1000);
    expect(((await dono('POST', '/v1/erp/caixas', { lojaId: loja })).corpo as { numeroCaixa: number }).numeroCaixa).toBe(2);

    const guardado = await nuvem.banco.transacao('continuum_app', clienteId, (tx) => tx.consultarUma<{ codigo_ativacao_hash: string }>('SELECT codigo_ativacao_hash FROM dispositivos WHERE id = $1', c1.id));
    expect(guardado?.codigo_ativacao_hash).not.toContain(c1.codigo.replace('-', ''));

    const lista = ((await dono('GET', '/v1/erp/caixas')).corpo as { caixas: { id: string; situacao: string; loja: string }[] }).caixas;
    expect(lista.find((c) => c.id === c1.id)).toMatchObject({ situacao: 'pendente', loja: 'MERCBAIRRO' });
  });

  it('código novo para caixa pendente; desativar corta o acesso e não aceita código novo', async () => {
    const { dono, loja } = await contexto();
    const { id, codigo } = (await dono('POST', '/v1/erp/caixas', { lojaId: loja })).corpo as { id: string; codigo: string };
    const novo = (await dono('POST', `/v1/erp/caixas/${id}/novo-codigo`)).corpo as { codigo: string };
    expect(novo.codigo).not.toBe(codigo);
    expect((await dono('POST', `/v1/erp/caixas/${id}/desativar`)).status).toBe(200);
    expect((await dono('POST', `/v1/erp/caixas/${id}/novo-codigo`)).status).toBe(409);
  });

  it('número de caixa repetido é recusado; o operador não gerencia caixas', async () => {
    const { dono, loja } = await contexto();
    expect((await dono('POST', '/v1/erp/caixas', { lojaId: loja, numeroCaixa: 1 })).status).toBe(409);
    expect((await (await entrar('operador'))('GET', '/v1/erp/caixas')).status).toBe(403);
  });
});

describe('relatório e validação (UC18, UC19)', () => {
  it('com uma venda no banco: o relatório soma, e o código do comprovante é validado', async () => {
    const { dono, clienteId, loja } = await contexto();
    // Uma venda como chegará do caixa no Passo 3.2 (gravada aqui direto pelo dono do banco).
    const ids = { disp: gerarId(), sessao: gerarId(), venda: gerarId(), produto: gerarId(), item: gerarId(), mov: gerarId() };
    const codigo = codigoDaVenda('MERCBAIRRO', 9, 1, ids.venda);
    await nuvem.banco.transacaoDaPlataforma(async (tx) => {
      await tx.consultar("INSERT INTO dispositivos (id, cliente_id, loja_id, tipo, numero_caixa, situacao) VALUES ($1, $2, $3, 'pdv', 9, 'ativo')", ids.disp, clienteId, loja);
      await tx.consultar("INSERT INTO produtos (id, cliente_id, nome, preco_centavos, unidade, version) VALUES ($1, $2, 'Biscoito', 399, 'un', 1)", ids.produto, clienteId);
      await tx.consultar("INSERT INTO sessoes_caixa (id, cliente_id, dispositivo_id, operador, fundo_centavos, aberta_em) VALUES ($1, $2, $3, 'Ana', 0, now())", ids.sessao, clienteId, ids.disp);
      await tx.consultar(
        `INSERT INTO vendas (id, cliente_id, loja_id, dispositivo_id, sessao_id, codigo, numero, bruto_centavos, desconto_centavos, liquido_centavos, troco_centavos, ocorrido_em)
         VALUES ($1, $2, $3, $4, $5, $6, 1, 798, 0, 798, 202, now())`,
        ids.venda, clienteId, loja, ids.disp, ids.sessao, codigo,
      );
      await tx.consultar("INSERT INTO movimentacoes (id, cliente_id, loja_id, produto_id, tipo, quantidade, venda_id, ocorrido_em) VALUES ($1, $2, $3, $4, 'VENDA', -2, $5, now())", ids.mov, clienteId, loja, ids.produto, ids.venda);
      await tx.consultar('INSERT INTO itens_venda (id, cliente_id, venda_id, posicao, produto_id, quantidade, preco_unitario_centavos, movimentacao_id) VALUES ($1, $2, $3, 1, $4, 2, 399, $5)', ids.item, clienteId, ids.venda, ids.produto, ids.mov);
      await tx.consultar("INSERT INTO pagamentos (id, cliente_id, venda_id, forma, valor_centavos) VALUES ($1, $2, $3, 'dinheiro', 1000)", gerarId(), clienteId, ids.venda);
    });

    const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    const rel = (await dono('GET', `/v1/erp/relatorios/vendas?dia=${hoje}`)).corpo as {
      totais: { vendas: number; liquidoCentavos: number };
      porForma: { forma: string; valorCentavos: number }[];
      maisVendidos: { nome: string; quantidade: number }[];
      porCaixa: { numeroCaixa: number; vendas: number }[];
      trocoCentavos: number;
    };
    expect(rel.totais).toMatchObject({ vendas: 1, liquidoCentavos: 798 });
    expect(rel.porForma).toEqual([{ forma: 'dinheiro', valorCentavos: 1000 }]);
    expect(rel.trocoCentavos).toBe(202);
    expect(rel.maisVendidos).toEqual([{ nome: 'Biscoito', quantidade: 2, valorCentavos: 798 }]);
    expect(rel.porCaixa).toEqual([{ loja: 'MERCBAIRRO', numeroCaixa: 9, vendas: 1, liquidoCentavos: 798 }]);

    const ok = (await dono('GET', `/v1/erp/vendas/validar?codigo=${codigo.toLowerCase()}`)).corpo as { valida: boolean; liquidoCentavos: number; itens: unknown[]; cancelada: unknown };
    expect(ok).toMatchObject({ valida: true, liquidoCentavos: 798, cancelada: null });
    expect(ok.itens).toEqual([{ nome: 'Biscoito', quantidade: 2, precoUnitarioCentavos: 399 }]);

    const adulterado = codigo.slice(0, -4) + (codigo.endsWith('0000') ? '1111' : '0000');
    expect((await dono('GET', `/v1/erp/vendas/validar?codigo=${adulterado}`)).corpo).toMatchObject({ valida: false, motivo: expect.stringMatching(/conferência/) });
    expect((await dono('GET', '/v1/erp/vendas/validar?codigo=MERCBAIRRO-19999-ABCD')).corpo).toMatchObject({ valida: false, motivo: expect.stringMatching(/sincronizar/) });
    expect((await dono('GET', '/v1/erp/vendas/validar?codigo=qualquer')).corpo).toMatchObject({ valida: false, motivo: expect.stringMatching(/Formato/) });
  });

  it('dia sem vendas: relatório zerado, pronto para receber', async () => {
    const { dono } = await contexto();
    const rel = (await dono('GET', '/v1/erp/relatorios/vendas?dia=2020-01-01')).corpo as { totais: { vendas: number }; porForma: unknown[] };
    expect(rel.totais.vendas).toBe(0);
    expect(rel.porForma).toEqual([]);
  });
});
