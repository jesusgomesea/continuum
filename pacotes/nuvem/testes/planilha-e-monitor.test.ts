// Leitura da planilha de produtos (importação) e os alertas do monitor do Central: regras puras das telas.
import { describe, expect, it } from 'vitest';
import { lerPlanilhaDeProdutos, lerPrecoDaPlanilha, MODELO_DA_PLANILHA } from '../web/planilha.ts';
import { alertasDoMonitor, FILA_PREOCUPANTE } from '../web/telas/Monitor.tsx';
import { montarCsv } from '../web/componentes/Tabela.tsx';

describe('planilha de produtos', () => {
  it('lê o modelo: colunas pelo nome, preço em reais vira centavos, estoque em números', () => {
    const r = lerPlanilhaDeProdutos(MODELO_DA_PLANILHA);
    expect(r.erro).toBeNull();
    expect(r.linhas).toEqual([
      { linha: 2, nome: 'Café 500 g', precoCentavos: 1890, unidade: 'un', ean: '7891234567895', estoqueMinimo: 10, estoqueInicial: 24 },
      { linha: 3, nome: 'Banana prata', precoCentavos: 699, unidade: 'kg', ean: '', estoqueMinimo: 5, estoqueInicial: 0 },
    ]);
  });

  it('aceita vírgula, tabulação (colado do Excel), aspas e colunas em outra ordem', () => {
    const colado = 'Preço\tProduto\n"1.234,50"\tGeladeira "top"\n';
    expect(lerPlanilhaDeProdutos(colado).linhas[0]).toMatchObject({ nome: 'Geladeira "top"', precoCentavos: 123450 });
    const virgula = 'nome,preco,estoque\n"Arroz, tipo 1",28.90,12\n';
    expect(lerPlanilhaDeProdutos(virgula).linhas[0]).toMatchObject({ nome: 'Arroz, tipo 1', precoCentavos: 2890, estoqueInicial: 12 });
  });

  it('sem as colunas obrigatórias, ou preço que não é número, avisa (o servidor recusa a linha)', () => {
    expect(lerPlanilhaDeProdutos('produto;quantidade\nX;1').erro).toMatch(/nome.*preço/);
    expect(lerPrecoDaPlanilha('R$ 12,90')).toBe(1290);
    expect(lerPrecoDaPlanilha('doze')).toBe('doze');
  });

  it('o CSV exportado usa ";" e protege células com ponto e vírgula ou aspas', () => {
    const csv = montarCsv([{ titulo: 'Nome', valor: (l: { n: string }) => l.n }], [{ n: 'a;b' }, { n: 'diz "oi"' }]);
    expect(csv).toBe('Nome\r\n"a;b"\r\n"diz ""oi"""');
  });
});

describe('alertas do monitor', () => {
  const caixa = (extra: Record<string, unknown>) => ({
    id: String(Math.random()),
    tipo: 'pdv' as const,
    numeroCaixa: 1,
    clienteId: 'c1',
    cliente: 'Mercadinho',
    situacaoCliente: 'ativo',
    loja: 'MERCBAIRRO',
    situacao: 'saudavel',
    filaPendente: 0,
    caixaAberto: true,
    segundosSemSinal: 5,
    vendasHoje: 0,
    vendidoHojeCentavos: 0,
    versao: '0.2.0',
    quedas24h: 0,
    ...extra,
  });
  const monitor = (caixas: ReturnType<typeof caixa>[]) => ({
    resumo: { caixas: caixas.length, saudaveis: 0, comProblema: 0, semSinal: 0, clientes: 1, filaTotal: 0, vendidoHojeCentavos: 0, versaoMaisNova: '0.2.0' },
    caixas,
    agora: new Date().toISOString(),
  });

  it('sem sinal vem primeiro; fila, quedas e versão antiga também viram alerta', () => {
    const a = alertasDoMonitor(
      monitor([caixa({ versao: '0.1.0' }), caixa({ filaPendente: FILA_PREOCUPANTE, quedas24h: 4 }), caixa({ situacao: 'sem-sinal', segundosSemSinal: 600 })]),
    );
    expect(a.map((x) => x.titulo)).toEqual(['Caixa 1 sem sinal', 'Fila acumulando', 'Conexão instável', 'Versão desatualizada']);
  });

  it('tudo saudável: nenhum alerta', () => {
    expect(alertasDoMonitor(monitor([caixa({}), caixa({})]))).toEqual([]);
  });
});
