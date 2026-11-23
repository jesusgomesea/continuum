// Etiqueta de balança, busca rápida, estoque baixo, CPF no comprovante e venda em espera.
import { dvEan13 } from '@continuum/dominio';
import { describe, expect, it } from 'vitest';
import {
  abrirBancoDoCaixa,
  Caixa,
  eanDoProdutoDeBalanca,
  ESTOQUE_BAIXO,
  filtrarProdutos,
  formatarPeso,
  lerEtiquetaDeBalanca,
  nivelDeEstoque,
  normalizarTexto,
  produtoDaEtiqueta,
  produtoPeloCodigo,
  quantidadeDaEtiqueta,
} from '../src/index.ts';
import { comprovanteHtml } from '../src/comprovante.ts';
import { criarApi } from '../src/servidor/api.ts';
import { prepararDemonstracao } from '../src/servidor/demonstracao.ts';

/** Monta uma etiqueta válida: 2 + código (4) + 0 + peso em gramas (6) + dígito verificador. */
function etiqueta(codigo: string, gramas: number): string {
  const base = `2${codigo}0${String(gramas).padStart(6, '0')}`;
  return base + dvEan13(base);
}

describe('etiqueta de balança', () => {
  it('lê o código do produto e o peso em gramas', () => {
    expect(lerEtiquetaDeBalanca(etiqueta('0123', 350))).toEqual({ codigoProduto: '0123', prefixo: '201230', pesoGramas: 350 });
    expect(lerEtiquetaDeBalanca(` ${etiqueta('9999', 12500)} `)?.pesoGramas).toBe(12500);
  });

  it('recusa o que não é etiqueta: EAN comum, tamanho errado, dígito errado, separador errado, peso zero', () => {
    expect(lerEtiquetaDeBalanca('7890000000017')).toBeUndefined();
    expect(lerEtiquetaDeBalanca('201230000350')).toBeUndefined();
    const boa = etiqueta('0123', 350);
    const digitoErrado = boa.slice(0, 12) + String((Number(boa[12]) + 1) % 10);
    expect(lerEtiquetaDeBalanca(digitoErrado)).toBeUndefined();
    const semSeparador = `201231000350`;
    expect(lerEtiquetaDeBalanca(semSeparador + dvEan13(semSeparador))).toBeUndefined();
    expect(lerEtiquetaDeBalanca(etiqueta('0123', 0))).toBeUndefined();
    expect(lerEtiquetaDeBalanca('abc')).toBeUndefined();
  });

  it('casa com o produto por kg cadastrado com o EAN "da etiqueta vazia"', () => {
    const ean = eanDoProdutoDeBalanca('123');
    expect(ean).toBe(`201230000000${dvEan13('201230000000')}`);
    expect(ean.startsWith('201230')).toBe(true);
    const catalogo = [
      { id: 'a', unidade: 'un', ean: '7890000000017' },
      { id: 'queijo', unidade: 'kg', ean },
      { id: 'outro', unidade: 'kg', ean: eanDoProdutoDeBalanca('124') },
    ];
    const lida = lerEtiquetaDeBalanca(etiqueta('0123', 2000));
    if (lida === undefined) throw new Error('etiqueta não lida');
    expect(produtoDaEtiqueta(catalogo, lida)?.id).toBe('queijo');
    // Produto por unidade com o mesmo começo não serve: só 'kg'.
    expect(produtoDaEtiqueta([{ id: 'x', unidade: 'un', ean }], lida)).toBeUndefined();
    expect(() => eanDoProdutoDeBalanca('12345')).toThrow(/1 a 4/);
  });

  it('quantidade: só quilos inteiros cabem hoje (a quantidade da venda é inteira)', () => {
    const umKg = lerEtiquetaDeBalanca(etiqueta('0123', 1000));
    const doisKg = lerEtiquetaDeBalanca(etiqueta('0123', 2000));
    const quebrado = lerEtiquetaDeBalanca(etiqueta('0123', 350));
    if (umKg === undefined || doisKg === undefined || quebrado === undefined) throw new Error('etiqueta não lida');
    expect(quantidadeDaEtiqueta(umKg)).toBe(1);
    expect(quantidadeDaEtiqueta(doisKg)).toBe(2);
    expect(quantidadeDaEtiqueta(quebrado)).toBeNull();
    expect(formatarPeso(350)).toBe('0,350 kg');
  });
});

describe('busca rápida e estoque baixo', () => {
  const catalogo = [
    { nome: 'Café 500 g', ean: '7890000000017' },
    { nome: 'Açúcar 1 kg', ean: '7890000000024' },
    { nome: 'Pão de forma', ean: null },
  ];

  it('acha por parte do nome, sem acento e sem maiúsculas, em qualquer ordem', () => {
    expect(normalizarTexto('  AÇÚCAR   Cristal ')).toBe('acucar cristal');
    expect(filtrarProdutos(catalogo, 'acuc').map((p) => p.nome)).toEqual(['Açúcar 1 kg']);
    expect(filtrarProdutos(catalogo, 'CAFE').map((p) => p.nome)).toEqual(['Café 500 g']);
    expect(filtrarProdutos(catalogo, '500 cafe').map((p) => p.nome)).toEqual(['Café 500 g']);
    expect(filtrarProdutos(catalogo, 'pao forma')).toHaveLength(1);
    expect(filtrarProdutos(catalogo, '')).toHaveLength(3);
    expect(filtrarProdutos(catalogo, 'feijão')).toHaveLength(0);
  });

  it('acha pelo começo do código de barras e pelo código exato', () => {
    expect(filtrarProdutos(catalogo, '789000000002').map((p) => p.nome)).toEqual(['Açúcar 1 kg']);
    expect(produtoPeloCodigo(catalogo, ' 7890000000017 ')?.nome).toBe('Café 500 g');
    expect(produtoPeloCodigo(catalogo, '7890000000099')).toBeUndefined();
    expect(produtoPeloCodigo(catalogo, '')).toBeUndefined();
  });

  it(`estoque baixo é até ${ESTOQUE_BAIXO}; zero ou negativo é sem estoque`, () => {
    expect(nivelDeEstoque(60)).toBe('normal');
    expect(nivelDeEstoque(ESTOQUE_BAIXO + 1)).toBe('normal');
    expect(nivelDeEstoque(ESTOQUE_BAIXO)).toBe('baixo');
    expect(nivelDeEstoque(1)).toBe('baixo');
    expect(nivelDeEstoque(0)).toBe('sem');
    expect(nivelDeEstoque(-2)).toBe('sem');
  });
});

function caixaAberto() {
  const caixa = new Caixa(abrirBancoDoCaixa(':memory:'));
  prepararDemonstracao(caixa);
  caixa.abrirCaixa('Ana', 0);
  const [a, b] = caixa.catalogo();
  if (a === undefined || b === undefined) throw new Error('sem produto');
  return { caixa, a, b };
}

describe('CPF do cliente na venda', () => {
  it('o CPF validado fica na venda (só dígitos), vai no evento e sai mascarado no comprovante', () => {
    const { caixa, a } = caixaAberto();
    const { venda } = caixa.registrarVenda({
      itens: [{ produtoId: a.id, quantidade: 1 }],
      pagamentos: [{ forma: 'pix', valorCentavos: a.precoCentavos }],
      documentoCliente: '52998224725',
    });
    expect(venda.documentoCliente).toBe('52998224725');
    expect(caixa.buscarVenda(venda.codigo)?.venda.documentoCliente).toBe('52998224725');
    const evento = caixa.fila.pendentes(100).find((e) => e.tipo === 'venda.registrada');
    expect((evento?.dados as { documentoCliente: string | null }).documentoCliente).toBe('52998224725');

    const dados = caixa.dadosDoComprovante(venda.codigo, false);
    if (dados === undefined) throw new Error('sem comprovante');
    const html = comprovanteHtml(dados, caixa.configuracaoDoComprovante());
    expect(html).toContain('CPF do consumidor: ***.982.247-**');
    expect(html).not.toContain('52998224725');
  });

  it('CPF com dígito errado recusa a venda; sem CPF, o comprovante não mostra a linha', () => {
    const { caixa, a } = caixaAberto();
    const pedido = { itens: [{ produtoId: a.id, quantidade: 1 }], pagamentos: [{ forma: 'pix' as const, valorCentavos: a.precoCentavos }] };
    expect(() => caixa.registrarVenda({ ...pedido, documentoCliente: '52998224724' })).toThrow(/CPF inválido/);
    const { venda } = caixa.registrarVenda({ ...pedido, documentoCliente: '' });
    expect(venda.documentoCliente).toBeNull();
    const dados = caixa.dadosDoComprovante(venda.codigo, false);
    if (dados === undefined) throw new Error('sem comprovante');
    expect(comprovanteHtml(dados, caixa.configuracaoDoComprovante())).not.toContain('do consumidor');
  });
});

describe('venda em espera', () => {
  it('guarda o carrinho sem virar venda (nada na fila, estoque intacto) e retoma uma vez só', () => {
    const { caixa, a, b } = caixaAberto();
    const pendentes = caixa.fila.contarPendentes();
    const espera = caixa.guardarEmEspera({ itens: [{ produtoId: a.id, quantidade: 2 }, { produtoId: b.id, quantidade: 1 }], documentoCliente: '529', desconto: '1,00' });
    expect(espera.rotulo).toBe('Cliente 1');
    expect(espera.itens).toBe(3);
    expect(espera.totalCentavos).toBe(2 * a.precoCentavos + b.precoCentavos);
    expect(caixa.fila.contarPendentes()).toBe(pendentes);
    expect(caixa.saldo(a.id)).toBe(a.saldo);
    expect(caixa.ultimasVendas()).toHaveLength(0);
    expect(caixa.vendasEmEspera()).toHaveLength(1);

    const carrinho = caixa.retomarDaEspera(espera.id);
    expect(carrinho).toEqual({ itens: [{ produtoId: a.id, quantidade: 2 }, { produtoId: b.id, quantidade: 1 }], documentoCliente: '529', desconto: '1,00' });
    expect(caixa.vendasEmEspera()).toHaveLength(0);
    expect(() => caixa.retomarDaEspera(espera.id)).toThrow(/não encontrada/);
  });

  it('recusa carrinho vazio, quantidade quebrada e produto desconhecido', () => {
    const { caixa, a } = caixaAberto();
    expect(() => caixa.guardarEmEspera({ itens: [], documentoCliente: '', desconto: '' })).toThrow(/sem itens/);
    expect(() => caixa.guardarEmEspera({ itens: [{ produtoId: a.id, quantidade: 1.5 }], documentoCliente: '', desconto: '' })).toThrow(/inteira/);
    expect(() => caixa.guardarEmEspera({ itens: [{ produtoId: 'nao-existe', quantidade: 1 }], documentoCliente: '', desconto: '' })).toThrow(/não encontrado/);
  });

  it('pela API: aparece no estado e some ao retomar', () => {
    const { caixa, a } = caixaAberto();
    const api = criarApi(caixa);
    const guardar = api.tratar('POST', '/api/espera', { carrinho: { itens: [{ produtoId: a.id, quantidade: 1 }], documentoCliente: '', desconto: '' }, rotulo: 'Dona Maria' });
    expect(guardar.status).toBe(200);
    const estado = guardar.corpo as { emEspera: { id: string; rotulo: string }[] };
    expect(estado.emEspera.map((e) => e.rotulo)).toEqual(['Dona Maria']);
    const id = estado.emEspera[0]?.id ?? '';
    const retomar = api.tratar('POST', `/api/espera/${id}/retomar`);
    expect(retomar.status).toBe(200);
    expect((retomar.corpo as { estado: { emEspera: unknown[] } }).estado.emEspera).toHaveLength(0);
    expect(api.tratar('POST', `/api/espera/${id}/retomar`).status).toBe(400);
  });
});
