// Gestão no ERP (painel, período, alertas de estoque, usuários, PIN, importação, fechamentos) e
// acompanhamento no Central (ficha, plano e cobrança, suspensão por atraso, auditoria, histórico de conexão).
import { codigoDaVenda, gerarId } from '@continuum/dominio';
import { pinConfere } from '@continuum/pdv';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACESSOS_DE_DEMONSTRACAO, aplicarInadimplencia, coberturaDoPagamento, diasEntre, prepararNuvem, situacaoDoPlano } from '../src/index.ts';
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

async function entrar(quem: 'dono' | 'operador' | 'central', credenciais?: Record<string, string>) {
  let cookie = '';
  const nav = async (metodo: string, caminho: string, corpo?: unknown): Promise<Resposta> => {
    const r = await nuvem.api.tratar({ metodo, caminho, corpo, cabecalhos: { host: 'localhost', cookie } });
    const novo = r.cabecalhos?.['set-cookie'];
    if (novo !== undefined) cookie = novo.split(';')[0] ?? '';
    return r;
  };
  const r = await nav('POST', quem === 'central' ? '/v1/central/entrar' : '/v1/erp/entrar', credenciais ?? ACESSOS_DE_DEMONSTRACAO[quem]);
  return Object.assign(nav, { status: r.status });
}

async function contexto() {
  const dono = await entrar('dono');
  const eu = (await dono('GET', '/v1/eu')).corpo as { cliente: { id: string } };
  const loja = ((await dono('GET', '/v1/erp/loja')).corpo as { lojas: { id: string }[] }).lojas[0]?.id ?? '';
  return { dono, clienteId: eu.cliente.id, loja };
}

const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

/** Uma venda de hoje como chega do caixa, gravada direto no banco (com sessão de caixa fechada). */
async function umaVenda(clienteId: string, loja: string, numeroCaixa: number) {
  const ids = { disp: gerarId(), sessao: gerarId(), venda: gerarId(), produto: gerarId(), item: gerarId(), mov: gerarId() };
  await nuvem.banco.transacaoDaPlataforma(async (tx) => {
    await tx.consultar("INSERT INTO dispositivos (id, cliente_id, loja_id, tipo, numero_caixa, situacao) VALUES ($1, $2, $3, 'pdv', $4, 'ativo')", ids.disp, clienteId, loja, numeroCaixa);
    await tx.consultar("INSERT INTO produtos (id, cliente_id, nome, preco_centavos, unidade, version) VALUES ($1, $2, 'Café 500 g', 1890, 'un', 1)", ids.produto, clienteId);
    await tx.consultar(
      "INSERT INTO sessoes_caixa (id, cliente_id, dispositivo_id, operador, fundo_centavos, aberta_em, fechada_em, contado_centavos, esperado_centavos) VALUES ($1, $2, $3, 'Bia', 5000, now(), now(), 8670, 8780)",
      ids.sessao, clienteId, ids.disp,
    );
    await tx.consultar(
      `INSERT INTO vendas (id, cliente_id, loja_id, dispositivo_id, sessao_id, codigo, numero, bruto_centavos, desconto_centavos, liquido_centavos, troco_centavos, ocorrido_em)
       VALUES ($1, $2, $3, $4, $5, $6, 1, 3780, 0, 3780, 220, now())`,
      ids.venda, clienteId, loja, ids.disp, ids.sessao, codigoDaVenda('MERCBAIRRO', numeroCaixa, 1, ids.venda),
    );
    await tx.consultar("INSERT INTO movimentacoes (id, cliente_id, loja_id, produto_id, tipo, quantidade, venda_id, ocorrido_em) VALUES ($1, $2, $3, $4, 'VENDA', -2, $5, now())", ids.mov, clienteId, loja, ids.produto, ids.venda);
    await tx.consultar('INSERT INTO itens_venda (id, cliente_id, venda_id, posicao, produto_id, quantidade, preco_unitario_centavos, movimentacao_id) VALUES ($1, $2, $3, 1, $4, 2, 1890, $5)', ids.item, clienteId, ids.venda, ids.produto, ids.mov);
    await tx.consultar("INSERT INTO pagamentos (id, cliente_id, venda_id, forma, valor_centavos) VALUES ($1, $2, $3, 'dinheiro', 4000)", gerarId(), clienteId, ids.venda);
  });
  return ids;
}

describe('regras puras', () => {
  it('dias do período, cobertura do pagamento e situação do plano', () => {
    expect(diasEntre('2026-02-27', '2026-03-02')).toEqual(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
    expect(coberturaDoPagamento('2026-11', 10)).toBe('2026-12-10');
    expect(coberturaDoPagamento('2026-12', 5)).toBe('2027-01-05');
    expect(situacaoDoPlano(0, null, '2026-11-23').situacao).toBe('isento');
    expect(situacaoDoPlano(9900, null, '2026-11-23').situacao).toBe('sem-registro');
    expect(situacaoDoPlano(9900, '2026-12-20', '2026-11-23')).toEqual({ situacao: 'em-dia', dias: 27 });
    expect(situacaoDoPlano(9900, '2026-11-25', '2026-11-23')).toEqual({ situacao: 'vence-logo', dias: 2 });
    expect(situacaoDoPlano(9900, '2026-11-10', '2026-11-23')).toEqual({ situacao: 'atrasado', dias: 13 });
  });
});

describe('ERP: painel, período e fechamentos', () => {
  it('painel, relatório do período e fechamento de caixa contam a venda de hoje', async () => {
    const { dono, clienteId, loja } = await contexto();
    await umaVenda(clienteId, loja, 8);

    const painel = (await dono('GET', '/v1/erp/painel')).corpo as {
      hoje: { vendas: number; liquidoCentavos: number };
      ultimos30: unknown[];
      porHora: { vendas: number }[];
      maisVendidos: { nome: string }[];
    };
    expect(painel.hoje.vendas).toBeGreaterThanOrEqual(1);
    expect(painel.ultimos30).toHaveLength(30);
    expect(painel.maisVendidos.map((m) => m.nome)).toContain('Café 500 g');

    const dia = hoje();
    const r = (await dono('GET', `/v1/erp/relatorios/periodo?de=${dia}&ate=${dia}&loja=${loja}`)).corpo as {
      totais: { vendas: number; ticketMedioCentavos: number };
      porDia: { dia: string; vendas: number }[];
      porOperador: { operador: string }[];
      porProduto: { nome: string; quantidade: number }[];
    };
    expect(r.porDia).toHaveLength(1);
    expect(r.totais.vendas).toBeGreaterThanOrEqual(1);
    expect(r.totais.ticketMedioCentavos).toBeGreaterThan(0);
    expect(r.porOperador.map((o) => o.operador)).toContain('Bia');
    expect(r.porProduto.find((p) => p.nome === 'Café 500 g')?.quantidade).toBeGreaterThanOrEqual(2);

    expect((await dono('GET', '/v1/erp/relatorios/periodo?de=2026-02-10&ate=2026-01-01')).status).toBe(400);
    expect((await dono('GET', '/v1/erp/relatorios/periodo?de=2020-01-01&ate=2026-01-01')).status).toBe(400);

    const f = (await dono('GET', `/v1/erp/fechamentos?de=${dia}&ate=${dia}`)).corpo as {
      fechamentos: { numeroCaixa: number; operador: string; diferencaCentavos: number; vendas: number; dinheiroCentavos: number }[];
    };
    expect(f.fechamentos.find((x) => x.numeroCaixa === 8)).toMatchObject({ operador: 'Bia', diferencaCentavos: -110, vendas: 1, dinheiroCentavos: 4000 });

    // O operador não vê o painel nem os fechamentos
    const operador = await entrar('operador');
    expect((await operador('GET', '/v1/erp/painel')).status).toBe(403);
  });
});

describe('ERP: estoque, importação e usuários', () => {
  it('alertas: negativo, abaixo do mínimo e a lista de compras', async () => {
    const { dono, loja } = await contexto();
    const { id: acucar } = (await dono('POST', '/v1/erp/produtos', { nome: 'Açúcar 1 kg', precoCentavos: 549, estoqueMinimo: 10 })).corpo as { id: string };
    await dono('POST', '/v1/erp/estoque', { tipo: 'ENTRADA', quantidade: 4, produtoId: acucar, lojaId: loja });
    const a = (await dono('GET', '/v1/erp/estoque/alertas')).corpo as {
      abaixoDoMinimo: { produtoId: string; saldo: number }[];
      negativos: { nome: string; saldo: number }[];
      compras: { produtoId: string; comprar: number }[];
    };
    expect(a.abaixoDoMinimo.find((x) => x.produtoId === acucar)?.saldo).toBe(4);
    expect(a.compras.find((x) => x.produtoId === acucar)?.comprar).toBe(16); // repõe até o dobro do mínimo (20)
  });

  it('importação: com uma linha errada nada entra; corrigida, entra tudo com o estoque inicial', async () => {
    const { dono, loja } = await contexto();
    const linhas = [
      { linha: 2, nome: 'Feijão 1 kg', precoCentavos: 899, unidade: 'un', ean: '7891234567895', estoqueMinimo: 5, estoqueInicial: 30 },
      { linha: 3, nome: '', precoCentavos: 100 },
      { linha: 4, nome: 'Banana', precoCentavos: 699, unidade: 'kg' },
    ];
    const ruim = await dono('POST', '/v1/erp/produtos/importar', { linhas, lojaId: loja });
    expect(ruim.status).toBe(400);
    expect((ruim.corpo as { erros: { linha: number }[] }).erros).toEqual([{ linha: 3, mensagem: 'Informe o nome do produto.' }]);
    const antes = ((await dono('GET', '/v1/erp/produtos')).corpo as { produtos: { nome: string }[] }).produtos;
    expect(antes.some((p) => p.nome === 'Feijão 1 kg')).toBe(false);

    const bom = await dono('POST', '/v1/erp/produtos/importar', { linhas: [linhas[0], linhas[2]], lojaId: loja });
    expect(bom.status).toBe(201);
    expect(bom.corpo).toEqual({ importados: 2 });
    const depois = ((await dono('GET', '/v1/erp/produtos')).corpo as { produtos: { nome: string; saldo: number }[] }).produtos;
    expect(depois.find((p) => p.nome === 'Feijão 1 kg')?.saldo).toBe(30);
    // EAN já cadastrado: recusado na segunda vez
    const repetido = await dono('POST', '/v1/erp/produtos/importar', { linhas: [linhas[0]], lojaId: loja });
    expect((repetido.corpo as { erros: { mensagem: string }[] }).erros[0]?.mensagem).toMatch(/já cadastrado/);
  });

  it('usuários: o dono cria, o novo entra, e o último dono não pode ser rebaixado', async () => {
    const { dono } = await contexto();
    const email = `gerente-${Date.now()}@mercbairro.com.br`;
    expect((await dono('POST', '/v1/erp/usuarios', { nome: 'Gil', email, perfil: 'gerente', senha: 'curta' })).status).toBe(400);
    const criado = await dono('POST', '/v1/erp/usuarios', { nome: 'Gil', email, perfil: 'gerente', senha: 'gerente2026' });
    expect(criado.status).toBe(201);
    expect((await dono('POST', '/v1/erp/usuarios', { nome: 'Gil 2', email, perfil: 'gerente', senha: 'gerente2026' })).status).toBe(409);
    const gil = await entrar('dono', { email, senha: 'gerente2026', dominio: ACESSOS_DE_DEMONSTRACAO.dono.dominio });
    expect(gil.status).toBe(200);
    expect(((await gil('GET', '/v1/eu')).corpo as { perfil: string }).perfil).toBe('gerente');
    expect((await gil('GET', '/v1/erp/usuarios')).status).toBe(403);

    const { usuarios, eu } = (await dono('GET', '/v1/erp/usuarios')).corpo as { usuarios: { id: string; perfil: string }[]; eu: string };
    expect((await dono('PUT', `/v1/erp/usuarios/${eu}`, { ativo: false })).status).toBe(409);
    // Desativado não entra mais
    const id = (criado.corpo as { id: string }).id;
    expect((await dono('PUT', `/v1/erp/usuarios/${id}`, { ativo: false })).status).toBe(200);
    expect((await entrar('dono', { email, senha: 'gerente2026', dominio: ACESSOS_DE_DEMONSTRACAO.dono.dominio })).status).toBe(403);
    expect(usuarios.some((u) => u.perfil === 'dono')).toBe(true);
  });
});

describe('ERP: PIN do supervisor', () => {
  it('o PIN vira hash no formato do caixa e desce nos parâmetros', async () => {
    const { dono, clienteId } = await contexto();
    expect((await dono('PUT', '/v1/erp/pin', { pin: '1111' })).status).toBe(400);
    expect((await dono('PUT', '/v1/erp/pin', { pin: '12a4' })).status).toBe(400);
    expect((await dono('PUT', '/v1/erp/pin', { pin: '4826' })).status).toBe(200);
    expect((await dono('GET', '/v1/erp/pin')).corpo).toEqual({ definido: true });
    const desceu = await nuvem.banco.transacao('continuum_app', clienteId, (tx) =>
      tx.consultarUma<{ dados: { pinSupervisorHash: string } }>("SELECT dados FROM alteracoes WHERE entidade = 'parametros' ORDER BY seq DESC LIMIT 1"),
    );
    const hash = desceu?.dados.pinSupervisorHash ?? '';
    expect(hash).not.toContain('4826');
    expect(pinConfere('4826', hash)).toBe(true);
    expect(pinConfere('1234', hash)).toBe(false);
  });
});

describe('Central: ficha, plano, cobrança e auditoria', () => {
  it('pagamento registrado cobre até o próximo vencimento; atraso além da tolerância suspende e pagar reativa', async () => {
    const { clienteId } = await contexto();
    const central = await entrar('central');
    expect((await central('PUT', `/v1/central/clientes/${clienteId}/plano`, { plano: 'loja', mensalidadeCentavos: 14900, diaVencimento: 10 })).status).toBe(200);
    const pago = await central('POST', `/v1/central/clientes/${clienteId}/pagamentos`, { referencia: '2026-01', valorCentavos: 14900 });
    expect(pago.corpo).toMatchObject({ pagoAte: '2026-02-10' });
    expect((await central('POST', `/v1/central/clientes/${clienteId}/pagamentos`, { referencia: '2026-01', valorCentavos: 14900 })).status).toBe(409);

    // Pago só até fevereiro de 2026: passou da tolerância, a suspensão automática pega
    expect(await aplicarInadimplencia(nuvem.banco)).toBeGreaterThanOrEqual(1);
    const lista = (await central('GET', '/v1/central/clientes')).corpo as { clientes: { id: string; situacao: string; suspenso_por: string; pagamento: { situacao: string } }[] };
    expect(lista.clientes.find((c) => c.id === clienteId)).toMatchObject({ situacao: 'suspenso', suspenso_por: 'inadimplencia', pagamento: { situacao: 'atrasado' } });
    expect((await entrar('dono')).status).toBe(403);

    // Paga o mês corrente: volta a funcionar na hora
    const mes = hoje().slice(0, 7);
    expect((await central('POST', `/v1/central/clientes/${clienteId}/pagamentos`, { referencia: mes, valorCentavos: 14900 })).corpo).toMatchObject({ reativado: true });
    expect((await entrar('dono')).status).toBe(200);

    const ficha = (await central('GET', `/v1/central/clientes/${clienteId}/ficha`)).corpo as { plano: { situacao: string }; pagamentos: unknown[]; caixas: unknown[] };
    expect(['em-dia', 'vence-logo']).toContain(ficha.plano.situacao);
    expect(ficha.pagamentos).toHaveLength(2);

    const auditoria = (await central('GET', `/v1/central/auditoria?cliente=${clienteId}&limite=50`)).corpo as { registros: { acao: string; autor: string }[] };
    expect(auditoria.registros.map((r) => r.acao)).toEqual(expect.arrayContaining(['plano.alterado', 'pagamento.registrado', 'cliente.suspenso-por-atraso']));
    expect(auditoria.registros.find((r) => r.acao === 'cliente.suspenso-por-atraso')?.autor).toBe('Sistema (automático)');

    // O ERP não acessa as rotas do Central
    expect((await (await entrar('dono'))('GET', '/v1/central/auditoria')).status).toBe(403);
  });

  it('o histórico de conexão grava o primeiro sinal e a mudança de estado', async () => {
    const { clienteId, loja } = await contexto();
    const disp = gerarId();
    await nuvem.banco.transacaoDaPlataforma((tx) =>
      tx.consultar("INSERT INTO dispositivos (id, cliente_id, loja_id, tipo, numero_caixa, situacao, credencial_hash) VALUES ($1, $2, $3, 'pdv', 7, 'ativo', NULL)", disp, clienteId, loja),
    );
    // Sinais direto no banco do jeito que o recebimento grava (o recebimento HTTP já tem teste próprio)
    const central = await entrar('central');
    const antes = ((await central('GET', '/v1/central/monitor/historico?horas=1')).corpo as { eventos: unknown[] }).eventos.length;
    await nuvem.banco.transacao('continuum_app', clienteId, (tx) =>
      tx.consultar("INSERT INTO eventos_de_conexao (id, cliente_id, dispositivo_id, tipo, estado_anterior, estado, segundos_sem_sinal) VALUES ($1, $2, $3, 'retorno', 'saudavel', 'recuperando', 300)", gerarId(), clienteId, disp),
    );
    const h = (await central('GET', '/v1/central/monitor/historico?horas=1')).corpo as { eventos: { dispositivoId: string; segundosSemSinal: number }[] };
    expect(h.eventos.length).toBe(antes + 1);
    expect(h.eventos[0]).toMatchObject({ dispositivoId: disp, segundosSemSinal: 300 });
    const monitor = (await central('GET', '/v1/central/monitor')).corpo as { caixas: { id: string; quedas24h: number }[] };
    expect(monitor.caixas.find((c) => c.id === disp)?.quedas24h).toBe(1);
  });
});
