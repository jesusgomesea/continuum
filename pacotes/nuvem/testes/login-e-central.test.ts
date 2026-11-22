// Passos 2.2 e 2.3: login da Equipe Continuum e do ERP, perfis, e o Central cadastrando e parametrizando clientes.
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

/** Um "navegador" simples: guarda o cookie da sessão entre os pedidos. */
function navegador(host = 'localhost') {
  let cookie = '';
  return async (metodo: string, caminho: string, corpo?: unknown): Promise<Resposta> => {
    const r = await nuvem.api.tratar({ metodo, caminho, corpo, cabecalhos: { host, cookie } });
    const novo = r.cabecalhos?.['set-cookie'];
    if (novo !== undefined) cookie = novo.split(';')[0] ?? '';
    return r;
  };
}

const a = ACESSOS_DE_DEMONSTRACAO;

describe('login', () => {
  it('Equipe Continuum entra no Central e vê as permissões do Central', async () => {
    const nav = navegador();
    expect((await nav('POST', '/v1/central/entrar', a.central)).status).toBe(200);
    const eu = (await nav('GET', '/v1/eu')).corpo as { perfil: string; cliente: unknown; permissoes: string[] };
    expect(eu.perfil).toBe('equipe');
    expect(eu.cliente).toBeNull();
    expect(eu.permissoes).toContain('central.clientes');
    expect(eu.permissoes).not.toContain('erp.produtos.editar');
  });

  it('o dono entra no ERP pelo domínio e vê o próprio negócio', async () => {
    const nav = navegador();
    expect((await nav('POST', '/v1/erp/entrar', a.dono)).status).toBe(200);
    const eu = (await nav('GET', '/v1/eu')).corpo as { perfil: string; nome: string; cliente: { dominio: string }; permissoes: string[] };
    expect(eu).toMatchObject({ perfil: 'dono', nome: 'Dona Maria', cliente: { dominio: a.dono.dominio } });
    expect(eu.permissoes).toEqual(expect.arrayContaining(['erp.produtos.editar', 'erp.caixas.ativar', 'erp.relatorios.ver']));
  });

  it('o domínio também pode vir do endereço acessado (o caso real)', async () => {
    const nav = navegador(a.dono.dominio);
    expect((await nav('POST', '/v1/erp/entrar', { email: a.dono.email, senha: a.dono.senha })).status).toBe(200);
  });

  it('o operador entra, mas vê só o que é do caixa', async () => {
    const nav = navegador();
    await nav('POST', '/v1/erp/entrar', a.operador);
    const eu = (await nav('GET', '/v1/eu')).corpo as { permissoes: string[] };
    expect(eu.permissoes).toEqual(['pdv.vender']);
  });

  it('senha errada, domínio desconhecido e sem login são recusados', async () => {
    const nav = navegador();
    expect((await nav('POST', '/v1/erp/entrar', { ...a.dono, senha: 'errada123' })).status).toBe(401);
    expect((await nav('POST', '/v1/erp/entrar', { ...a.dono, dominio: 'nao-existe.continuum.app' })).status).toBe(404);
    expect((await nav('POST', '/v1/central/entrar', { email: a.dono.email, senha: a.dono.senha })).status).toBe(401); // dono não é da Equipe
    expect((await nav('GET', '/v1/eu')).status).toBe(401);
  });

  it('sair encerra a sessão', async () => {
    const nav = navegador();
    await nav('POST', '/v1/erp/entrar', a.dono);
    await nav('POST', '/v1/sair');
    expect((await nav('GET', '/v1/eu')).status).toBe(401);
  });
});

describe('Central: clientes', () => {
  const novoCliente = {
    documento: '529.982.247-25',
    nome: 'Ana Souza (MEI)',
    nomeFantasia: 'Padaria da Ana',
    segmento: 'padaria',
    dominio: 'padariadaana.continuum.app',
    loja: { nomeReduzido: 'PADANA', nome: 'Padaria da Ana' },
    dono: { nome: 'Ana Souza', email: 'ana@padaria.com.br', senha: 'paes2026' },
    parametros: { regraEstoque: 'permitir_alerta', limiteDescontoPct: 5, comprovante: { cabecalho: ['Padaria da Ana'], largura: 58 } },
  };

  it('o dono de um cliente não acessa o Central', async () => {
    const nav = navegador();
    await nav('POST', '/v1/erp/entrar', a.dono);
    expect((await nav('GET', '/v1/central/clientes')).status).toBe(403);
    expect((await navegador()('GET', '/v1/central/clientes')).status).toBe(401);
  });

  it('a Equipe cadastra um cliente MEI (CPF) e o dono dele já consegue entrar no ERP', async () => {
    const nav = navegador();
    await nav('POST', '/v1/central/entrar', a.central);
    const r = await nav('POST', '/v1/central/clientes', novoCliente);
    expect(r.status).toBe(201);
    const { id } = r.corpo as { id: string };

    const lista = (await nav('GET', '/v1/central/clientes')).corpo as { clientes: { id: string; tipo_documento: string; lojas: number }[] };
    expect(lista.clientes.find((c) => c.id === id)).toMatchObject({ tipo_documento: 'CPF', lojas: 1 });

    const detalhe = (await nav('GET', `/v1/central/clientes/${id}`)).corpo as { parametros: { regra_estoque: string; comprovante: { largura: number } }; usuarios: { perfil: string }[] };
    expect(detalhe.parametros.regra_estoque).toBe('permitir_alerta');
    expect(detalhe.parametros.comprovante.largura).toBe(58);
    expect(detalhe.usuarios).toEqual([expect.objectContaining({ perfil: 'dono', email: 'ana@padaria.com.br' })]);

    const ana = navegador();
    expect((await ana('POST', '/v1/erp/entrar', { email: 'ana@padaria.com.br', senha: 'paes2026', dominio: novoCliente.dominio })).status).toBe(200);
    const eu = (await ana('GET', '/v1/eu')).corpo as { cliente: { nome: string } };
    expect(eu.cliente.nome).toBe('Ana Souza (MEI)');
  });

  it('cadastro com CPF errado, domínio repetido ou senha fraca é recusado com a explicação', async () => {
    const nav = navegador();
    await nav('POST', '/v1/central/entrar', a.central);
    expect(await nav('POST', '/v1/central/clientes', { ...novoCliente, documento: '529.982.247-26' })).toMatchObject({ status: 400, corpo: { mensagem: expect.stringMatching(/CPF inválido/) } });
    expect(await nav('POST', '/v1/central/clientes', { ...novoCliente, documento: '11.444.777/0001-61' })).toMatchObject({ status: 409 }); // domínio já usado
    expect(await nav('POST', '/v1/central/clientes', { ...novoCliente, dominio: 'x.continuum.app', documento: '11.444.777/0001-61', dono: { ...novoCliente.dono, senha: 'curta' } })).toMatchObject({
      status: 400,
      corpo: { mensagem: expect.stringMatching(/8 caracteres/) },
    });
  });

  it('parametrizar o ERP muda a versão, avisa os caixas (fila de descida) e fica na auditoria', async () => {
    const nav = navegador();
    await nav('POST', '/v1/central/entrar', a.central);
    const lista = (await nav('GET', '/v1/central/clientes')).corpo as { clientes: { id: string; dominio: string }[] };
    const merc = lista.clientes.find((c) => c.dominio === a.dono.dominio);
    if (merc === undefined) throw new Error('cliente de demonstração sumiu');
    const r = await nav('PUT', `/v1/central/clientes/${merc.id}/parametros`, { regraEstoque: 'permitir_alerta', limiteDescontoPct: 15 });
    expect(r).toMatchObject({ status: 200, corpo: { versao: 2 } });
    const descida = await nuvem.banco.transacao('continuum_app', merc.id, (tx) => tx.consultar("SELECT versao FROM alteracoes WHERE entidade = 'parametros'"));
    expect(descida).toEqual([{ versao: 2 }]);
    const auditoria = await nuvem.banco.transacao('continuum_central', null, (tx) => tx.consultar("SELECT acao FROM auditoria WHERE acao = 'parametros.alterados'"));
    expect(auditoria).toHaveLength(1);
  });

  it('cliente suspenso não entra no ERP', async () => {
    const nav = navegador();
    await nav('POST', '/v1/central/entrar', a.central);
    const lista = (await nav('GET', '/v1/central/clientes')).corpo as { clientes: { id: string; dominio: string }[] };
    const ana = lista.clientes.find((c) => c.dominio === 'padariadaana.continuum.app');
    await nav('PUT', `/v1/central/clientes/${ana?.id ?? ''}/situacao`, { situacao: 'suspenso' });
    const r = await navegador()('POST', '/v1/erp/entrar', { email: 'ana@padaria.com.br', senha: 'paes2026', dominio: 'padariadaana.continuum.app' });
    expect(r).toMatchObject({ status: 403, corpo: { mensagem: expect.stringMatching(/suspenso/) } });
  });
});
