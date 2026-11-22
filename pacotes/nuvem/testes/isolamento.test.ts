// Passo 2.1: num PostgreSQL de verdade, um cliente NÃO enxerga (nem altera) os dados de outro,
// mesmo que o programa esqueça o filtro. O Central enxerga todos, mas só lê.
import { gerarId } from '@continuum/dominio';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aplicarMigracoesNuvem, BancoNuvem, criarApiDaNuvem, criarServidorDaNuvem, ligarPostgresLocal } from '../src/index.ts';
import type { PostgresLocal } from '../src/index.ts';

const portaLivre = () =>
  new Promise<number>((ok) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const porta = (s.address() as AddressInfo).port;
      s.close(() => ok(porta));
    });
  });

const pasta = mkdtempSync(path.join(tmpdir(), 'continuum-nuvem-'));
let postgres: PostgresLocal;
let banco: BancoNuvem;

const A = { cliente: gerarId(), loja: gerarId(), produto: gerarId() };
const B = { cliente: gerarId(), loja: gerarId(), produto: gerarId() };

beforeAll(async () => {
  postgres = ligarPostgresLocal(pasta, await portaLivre());
  banco = new BancoNuvem(postgres.url);
  await banco.comoDono(async (c) => {
    await aplicarMigracoesNuvem(c);
    // Dois clientes, cada um com a sua loja e o seu café (gravados pelo dono do banco, como fará o Central).
    for (const [x, doc, nome, dominio] of [
      [A, '11222333000181', 'Mercadinho A', 'a.continuum.app'],
      [B, '52998224725', 'Padaria B', 'b.continuum.app'],
    ] as const) {
      await c.query(`INSERT INTO clientes (id, tipo_documento, documento, nome, segmento, dominio) VALUES ($1, $2, $3, $4, 'mercearia', $5)`, [
        x.cliente, doc.length === 14 ? 'CNPJ' : 'CPF', doc, nome, dominio,
      ]);
      await c.query(`INSERT INTO lojas (id, cliente_id, nome_reduzido, nome) VALUES ($1, $2, 'LOJA', $3)`, [x.loja, x.cliente, nome]);
      await c.query(`INSERT INTO produtos (id, cliente_id, nome, preco_centavos, unidade, version) VALUES ($1, $2, $3, 1890, 'un', 1)`, [
        x.produto, x.cliente, `Café de ${nome}`,
      ]);
    }
  });
}, 60_000);

afterAll(async () => {
  await banco?.fechar();
  postgres?.parar();
  rmSync(pasta, { recursive: true, force: true });
}, 60_000);

describe('isolamento entre clientes (Row Level Security)', () => {
  it('o ERP do cliente A enxerga só o que é do A, mesmo pedindo "tudo"', async () => {
    const produtos = await banco.transacao('continuum_app', A.cliente, (tx) => tx.consultar('SELECT id, nome FROM produtos'));
    expect(produtos).toEqual([{ id: A.produto, nome: 'Café de Mercadinho A' }]);
    const clientes = await banco.transacao('continuum_app', A.cliente, (tx) => tx.consultar('SELECT id FROM clientes'));
    expect(clientes).toEqual([{ id: A.cliente }]);
  });

  it('pedir o produto do B pelo id não adianta: para o A, ele não existe', async () => {
    const achado = await banco.transacao('continuum_app', A.cliente, (tx) => tx.consultarUma('SELECT * FROM produtos WHERE id = $1', B.produto));
    expect(achado).toBeUndefined();
  });

  it('o A não consegue alterar o produto do B (nenhuma linha muda)', async () => {
    await banco.transacao('continuum_app', A.cliente, (tx) => tx.consultar('UPDATE produtos SET preco_centavos = 1 WHERE id = $1', B.produto));
    const preco = await banco.transacao('continuum_app', B.cliente, (tx) => tx.consultarUma<{ preco_centavos: string }>('SELECT preco_centavos FROM produtos WHERE id = $1', B.produto));
    expect(preco?.preco_centavos).toBe('1890');
  });

  it('o A não consegue gravar em nome do B: o banco recusa', async () => {
    const tentativa = banco.transacao('continuum_app', A.cliente, (tx) =>
      tx.consultar(`INSERT INTO produtos (id, cliente_id, nome, preco_centavos, unidade, version) VALUES ($1, $2, 'Intruso', 1, 'un', 1)`, gerarId(), B.cliente),
    );
    await expect(tentativa).rejects.toThrow(/row-level security/);
  });

  it('pedido sem cliente informado não enxerga nada', async () => {
    const produtos = await banco.transacao('continuum_app', null, (tx) => tx.consultar('SELECT id FROM produtos'));
    expect(produtos).toEqual([]);
  });

  it('o Central enxerga todos os clientes, mas não grava nada', async () => {
    const produtos = await banco.transacao('continuum_central', null, (tx) => tx.consultar('SELECT id FROM produtos ORDER BY nome'));
    expect(produtos).toHaveLength(2);
    const tentativa = banco.transacao('continuum_central', null, (tx) => tx.consultar('UPDATE produtos SET preco_centavos = 1'));
    await expect(tentativa).rejects.toThrow(/permission denied/);
  });

  it('o servidor do ERP não lê a tabela da Equipe Continuum', async () => {
    const tentativa = banco.transacao('continuum_app', A.cliente, (tx) => tx.consultar('SELECT * FROM equipe_continuum'));
    await expect(tentativa).rejects.toThrow(/permission denied/);
  });
});

describe('estrutura do banco', () => {
  it('migrações não se repetem', async () => {
    expect(await banco.comoDono((c) => aplicarMigracoesNuvem(c))).toEqual([]);
  });

  it('venda nunca é editada nem apagada, nem pelo próprio cliente', async () => {
    const tentativa = banco.transacao('continuum_app', A.cliente, (tx) => tx.consultar('DELETE FROM vendas'));
    await expect(tentativa).resolves.toEqual([]); // sem vendas ainda: nada a apagar
    await banco.comoDono(async (c) => {
      const disp = gerarId();
      const sessao = gerarId();
      await c.query(`INSERT INTO dispositivos (id, cliente_id, loja_id, tipo, numero_caixa) VALUES ($1, $2, $3, 'pdv', 1)`, [disp, A.cliente, A.loja]);
      await c.query(`INSERT INTO sessoes_caixa (id, cliente_id, dispositivo_id, operador, fundo_centavos, aberta_em) VALUES ($1, $2, $3, 'Ana', 0, now())`, [sessao, A.cliente, disp]);
      await c.query(
        `INSERT INTO vendas (id, cliente_id, loja_id, dispositivo_id, sessao_id, codigo, numero, bruto_centavos, desconto_centavos, liquido_centavos, troco_centavos, ocorrido_em)
         VALUES ($1, $2, $3, $4, $5, 'LOJA-10001-ABCD', 1, 1890, 0, 1890, 0, now())`,
        [gerarId(), A.cliente, A.loja, disp, sessao],
      );
    });
    await expect(banco.transacao('continuum_app', A.cliente, (tx) => tx.consultar('DELETE FROM vendas'))).rejects.toThrow(/não são editados nem apagados/);
    await expect(banco.transacao('continuum_app', A.cliente, (tx) => tx.consultar('UPDATE vendas SET liquido_centavos = 0, bruto_centavos = 0'))).rejects.toThrow(
      /não são editados nem apagados/,
    );
  });

  it('documento do cliente e nome reduzido da loja são conferidos pelo banco', async () => {
    await expect(
      banco.comoDono((c) => c.query(`INSERT INTO clientes (id, tipo_documento, documento, nome, segmento, dominio) VALUES ($1, 'CNPJ', '123', 'X', 's', 'x.app')`, [gerarId()])),
    ).rejects.toThrow(/check constraint/);
    await expect(
      banco.comoDono((c) => c.query(`INSERT INTO lojas (id, cliente_id, nome_reduzido, nome) VALUES ($1, $2, 'loja minúscula', 'X')`, [gerarId(), A.cliente])),
    ).rejects.toThrow(/check constraint/);
  });

  it('o servidor responde "estou no ar" com o banco ligado', async () => {
    const servidor = criarServidorDaNuvem(criarApiDaNuvem(banco, { segredo: 'segredo-de-teste-com-mais-de-32-caracteres' }));
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
    const porta = (servidor.address() as AddressInfo).port;
    const r = await fetch(`http://127.0.0.1:${porta}/v1/saude`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, banco: 'ok' });
    await new Promise<void>((ok) => servidor.close(() => ok()));
  });
});
