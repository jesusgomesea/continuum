// Os dados de cada tipo de evento: exemplos válidos e inválidos.
import { describe, expect, it } from 'vitest';
import {
  lerCaixaAberto,
  lerCaixaFechado,
  lerCaixaMovimentado,
  lerMovimentacaoRegistrada,
  lerProdutoAlterado,
  lerProdutoCriado,
  lerVendaCancelada,
  lerVendaRegistrada,
} from '../src/index.ts';
import { IDS, produtoValido, vendaValida } from './exemplos.ts';

describe('produto', () => {
  it('produto novo válido passa; sem código de barras também', () => {
    expect(lerProdutoCriado(produtoValido()).nome).toBe('Café 500 g');
    expect(lerProdutoCriado({ ...produtoValido(), ean: null }).ean).toBeNull();
  });

  it('preço negativo, preço quebrado, unidade estranha ou EAN errado são recusados', () => {
    expect(() => lerProdutoCriado({ ...produtoValido(), precoCentavos: -1 })).toThrow(/precoCentavos/);
    expect(() => lerProdutoCriado({ ...produtoValido(), precoCentavos: 18.9 })).toThrow(/precoCentavos/);
    expect(() => lerProdutoCriado({ ...produtoValido(), unidade: 'caixa' })).toThrow(/unidade/);
    expect(() => lerProdutoCriado({ ...produtoValido(), ean: '4006381333932' })).toThrow(/EAN-13/);
    expect(() => lerProdutoCriado({ ...produtoValido(), nome: '  ' })).toThrow(/nome/);
  });

  it('produto novo começa na versão 1', () => {
    expect(() => lerProdutoCriado({ ...produtoValido(), version: 2 })).toThrow(/versão 1/);
  });

  it('alteração sobe exatamente uma versão', () => {
    const { version: _v, ...base } = produtoValido();
    expect(lerProdutoAlterado({ ...base, versionAnterior: 1, version: 2 }).version).toBe(2);
    expect(() => lerProdutoAlterado({ ...base, versionAnterior: 1, version: 3 })).toThrow(/versionAnterior \+ 1/);
  });
});

describe('estoque', () => {
  const mov = (extra: Record<string, unknown>) => ({
    movimentacaoId: IDS.mov1, lojaId: IDS.loja, produtoId: IDS.produto,
    tipo: 'ENTRADA', quantidade: 10, vendaId: null, motivo: 'Nota 123', ...extra,
  });

  it('entrada positiva, venda negativa com vendaId, ajuste e estorno passam', () => {
    expect(lerMovimentacaoRegistrada(mov({})).quantidade).toBe(10);
    expect(lerMovimentacaoRegistrada(mov({ tipo: 'VENDA', quantidade: -2, vendaId: IDS.venda })).tipo).toBe('VENDA');
    expect(lerMovimentacaoRegistrada(mov({ tipo: 'AJUSTE', quantidade: -1, motivo: 'Quebra' })).quantidade).toBe(-1);
    expect(lerMovimentacaoRegistrada(mov({ tipo: 'ESTORNO', quantidade: 2 })).tipo).toBe('ESTORNO');
  });

  it('quantidade zero nunca é movimentação', () => {
    expect(() => lerMovimentacaoRegistrada(mov({ quantidade: 0 }))).toThrow(/zero/);
  });

  it('entrada negativa e venda positiva são recusadas', () => {
    expect(() => lerMovimentacaoRegistrada(mov({ quantidade: -5 }))).toThrow(/ENTRADA só pode ser positiva/);
    expect(() => lerMovimentacaoRegistrada(mov({ tipo: 'VENDA', quantidade: 2, vendaId: IDS.venda }))).toThrow(/VENDA só pode ser negativa/);
  });

  it('vendaId só existe na movimentação do tipo VENDA', () => {
    expect(() => lerMovimentacaoRegistrada(mov({ tipo: 'VENDA', quantidade: -1 }))).toThrow(/vendaId/);
    expect(() => lerMovimentacaoRegistrada(mov({ vendaId: IDS.venda }))).toThrow(/vendaId/);
  });

  it('tipo DEVOLUCAO do OLD não existe mais (devolução é estorno)', () => {
    expect(() => lerMovimentacaoRegistrada(mov({ tipo: 'DEVOLUCAO' }))).toThrow(/tipo/);
  });
});

describe('venda', () => {
  it('a venda de exemplo passa, com pagamento misto e troco', () => {
    const v = lerVendaRegistrada(vendaValida());
    expect(v.liquidoCentavos).toBe(4579);
    expect(v.pagamentos).toHaveLength(2);
  });

  it('cliente sem CPF passa; CPF errado é recusado', () => {
    expect(lerVendaRegistrada({ ...vendaValida(), documentoCliente: null }).documentoCliente).toBeNull();
    expect(() => lerVendaRegistrada({ ...vendaValida(), documentoCliente: '52998224726' })).toThrow(/CPF ou CNPJ/);
    expect(() => lerVendaRegistrada({ ...vendaValida(), documentoCliente: '529.982.247-25' })).toThrow(/CPF ou CNPJ/);
  });

  it('o código precisa bater com o número e com o id da venda', () => {
    expect(() => lerVendaRegistrada({ ...vendaValida(), codigo: 'MERCBAIRRO-10124-ABCD' })).toThrow(/número no código/);
    expect(() => lerVendaRegistrada({ ...vendaValida(), codigo: 'MERCBAIRRO-10123-0000' })).toThrow(/conferência/);
    expect(() => lerVendaRegistrada({ ...vendaValida(), codigo: 'mercbairro-10123-abcd' })).toThrow(/formato/);
  });

  it('venda sem itens ou sem pagamento é recusada', () => {
    expect(() => lerVendaRegistrada({ ...vendaValida(), itens: [] })).toThrow(/ao menos um item/);
    expect(() => lerVendaRegistrada({ ...vendaValida(), pagamentos: [] })).toThrow(/ao menos um pagamento/);
  });

  it('itens fora de ordem são recusados', () => {
    const v = vendaValida();
    const itens = v['itens'] as Record<string, unknown>[];
    expect(() => lerVendaRegistrada({ ...v, itens: [itens[1], itens[0]] })).toThrow(/posição 1/);
  });

  it('bruto que não bate com a soma dos itens é recusado', () => {
    expect(() => lerVendaRegistrada({ ...vendaValida(), brutoCentavos: 4680 })).toThrow(/soma dos itens/);
  });

  it('líquido precisa ser bruto − desconto', () => {
    expect(() => lerVendaRegistrada({ ...vendaValida(), liquidoCentavos: 4679 })).toThrow(/bruto − desconto/);
  });

  it('desconto menor que o dos itens ou maior que a venda é recusado', () => {
    expect(() => lerVendaRegistrada({ ...vendaValida(), descontoCentavos: 50, liquidoCentavos: 4629 })).toThrow(/descontoCentavos/);
  });

  it('pagamentos − troco precisam fechar com o líquido', () => {
    expect(() => lerVendaRegistrada({ ...vendaValida(), trocoCentavos: 400 })).toThrow(/pagamentos/);
  });

  it('troco só existe com pagamento em dinheiro', () => {
    const v = vendaValida();
    const soPix = [{ id: IDS.pag1, forma: 'pix', valorCentavos: 5000 }];
    expect(() => lerVendaRegistrada({ ...v, pagamentos: soPix })).toThrow(/troco/);
  });

  it('forma de pagamento desconhecida é recusada', () => {
    const cheque = [{ id: IDS.pag1, forma: 'cheque', valorCentavos: 4579 }];
    expect(() => lerVendaRegistrada({ ...vendaValida(), pagamentos: cheque, trocoCentavos: 0 })).toThrow(/forma/);
  });

  it('cancelamento precisa de motivo e de quem autorizou', () => {
    expect(lerVendaCancelada({ vendaId: IDS.venda, motivo: 'Cliente desistiu', autorizadoPor: 'Ana' }).motivo).toBe('Cliente desistiu');
    expect(() => lerVendaCancelada({ vendaId: IDS.venda, motivo: '', autorizadoPor: 'Ana' })).toThrow(/motivo/);
    expect(() => lerVendaCancelada({ vendaId: IDS.venda, motivo: 'x' })).toThrow(/autorizadoPor/);
  });
});

describe('caixa', () => {
  it('abertura com fundo de troco; fundo negativo é recusado', () => {
    expect(lerCaixaAberto({ sessaoId: IDS.sessao, operador: 'Ana', fundoCentavos: 10000 }).fundoCentavos).toBe(10000);
    expect(() => lerCaixaAberto({ sessaoId: IDS.sessao, operador: 'Ana', fundoCentavos: -1 })).toThrow(/fundoCentavos/);
  });

  it('sangria e suprimento precisam de valor positivo e motivo', () => {
    const base = { movimentoId: IDS.mov1, sessaoId: IDS.sessao, tipo: 'SANGRIA', valorCentavos: 5000, motivo: 'Depósito' };
    expect(lerCaixaMovimentado(base).tipo).toBe('SANGRIA');
    expect(() => lerCaixaMovimentado({ ...base, valorCentavos: 0 })).toThrow(/valorCentavos/);
    expect(() => lerCaixaMovimentado({ ...base, tipo: 'RETIRADA' })).toThrow(/tipo/);
    expect(() => lerCaixaMovimentado({ ...base, motivo: '' })).toThrow(/motivo/);
  });

  it('fechamento guarda o contado e o esperado (a diferença pode existir e aparece no relatório)', () => {
    const f = lerCaixaFechado({ sessaoId: IDS.sessao, contadoCentavos: 9900, esperadoCentavos: 10000 });
    expect(f.esperadoCentavos - f.contadoCentavos).toBe(100);
  });
});
