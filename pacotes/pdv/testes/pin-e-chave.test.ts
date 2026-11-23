// PIN do supervisor e proteção contra clique duplo.
import { AutorizacaoNecessariaError } from '@continuum/dominio';
import { describe, expect, it } from 'vitest';
import { abrirBancoDoCaixa, Caixa, hashDoPin, pinConfere } from '../src/index.ts';
import { prepararDemonstracao } from '../src/servidor/demonstracao.ts';

function caixaAberto() {
  const caixa = new Caixa(abrirBancoDoCaixa(':memory:'));
  prepararDemonstracao(caixa);
  caixa.abrirCaixa('Ana', 0);
  const p = caixa.catalogo()[0];
  if (p === undefined) throw new Error('sem produto');
  return { caixa, p };
}

describe('PIN do supervisor', () => {
  it('o PIN fica guardado só como hash, e confere', () => {
    const hash = hashDoPin('9876');
    expect(hash).not.toContain('9876');
    expect(pinConfere('9876', hash)).toBe(true);
    expect(pinConfere('1234', hash)).toBe(false);
    expect(pinConfere('', hash)).toBe(false);
    expect(() => hashDoPin('12')).toThrow(/4 a 8/);
  });

  it('sem PIN definido pelo ERP, vale o padrão 1234', () => {
    expect(pinConfere('1234', undefined)).toBe(true);
    expect(pinConfere('0000', undefined)).toBe(false);
  });

  it('desconto acima do limite: sem PIN, PIN errado e PIN certo (o definido pelo ERP)', () => {
    const { caixa, p } = caixaAberto();
    caixa.aplicarParametros({ versao: 2, regraEstoque: 'bloquear', limiteDescontoPct: 10, pinSupervisorHash: hashDoPin('9876') });
    const metade = Math.floor(p.precoCentavos / 2);
    const pedido = {
      itens: [{ produtoId: p.id, quantidade: 1 }],
      descontoCentavos: metade,
      pagamentos: [{ forma: 'pix' as const, valorCentavos: p.precoCentavos - metade }],
    };
    expect(() => caixa.registrarVenda(pedido)).toThrow(/exige autorização/);
    expect(() => caixa.registrarVenda({ ...pedido, pinSupervisor: '1234' })).toThrow('PIN do supervisor não confere.');
    expect(caixa.registrarVenda({ ...pedido, pinSupervisor: '9876' }).venda.descontoCentavos).toBe(metade);
  });

  it('a tela não consegue se autorizar sozinha mandando "autorizado: sim"', () => {
    const { caixa, p } = caixaAberto();
    const metade = Math.floor(p.precoCentavos / 2);
    const pedido = {
      itens: [{ produtoId: p.id, quantidade: 1 }],
      descontoCentavos: metade,
      pagamentos: [{ forma: 'pix' as const, valorCentavos: p.precoCentavos - metade }],
      autorizadoPorSupervisor: true,
    };
    expect(() => caixa.registrarVenda(pedido)).toThrow(AutorizacaoNecessariaError);
  });

  it('cancelamento exige o PIN', () => {
    const { caixa, p } = caixaAberto();
    const { venda } = caixa.registrarVenda({ itens: [{ produtoId: p.id, quantidade: 1 }], pagamentos: [{ forma: 'pix', valorCentavos: p.precoCentavos }] });
    expect(() => caixa.cancelarVenda(venda.codigo, 'Desistiu', 'Carla')).toThrow(/exige o PIN/);
    expect(() => caixa.cancelarVenda(venda.codigo, 'Desistiu', 'Carla', '0000')).toThrow(/não confere/);
    caixa.cancelarVenda(venda.codigo, 'Desistiu', 'Carla', '1234');
    expect(caixa.buscarVenda(venda.codigo)?.cancelada).toBe(true);
  });
});

describe('clique duplo (chave da venda)', () => {
  it('a mesma chave duas vezes devolve a mesma venda e não grava outra', () => {
    const { caixa, p } = caixaAberto();
    const pedido = { chave: 'tentativa-0001', itens: [{ produtoId: p.id, quantidade: 1 }], pagamentos: [{ forma: 'pix' as const, valorCentavos: p.precoCentavos }] };
    const primeira = caixa.registrarVenda(pedido);
    const pendentes = caixa.fila.contarPendentes();
    const segunda = caixa.registrarVenda(pedido);

    expect(primeira.repetida).toBe(false);
    expect(segunda.repetida).toBe(true);
    expect(segunda.venda.codigo).toBe(primeira.venda.codigo);
    expect(caixa.ultimasVendas()).toHaveLength(1);
    expect(caixa.fila.contarPendentes()).toBe(pendentes); // nenhum evento a mais
    expect(caixa.saldo(p.id)).toBe(59); // o estoque baixou uma vez só
  });

  it('chaves diferentes são vendas diferentes; chave mal formada é recusada', () => {
    const { caixa, p } = caixaAberto();
    const base = { itens: [{ produtoId: p.id, quantidade: 1 }], pagamentos: [{ forma: 'pix' as const, valorCentavos: p.precoCentavos }] };
    caixa.registrarVenda({ ...base, chave: 'tentativa-0001' });
    caixa.registrarVenda({ ...base, chave: 'tentativa-0002' });
    expect(caixa.ultimasVendas()).toHaveLength(2);
    expect(() => caixa.registrarVenda({ ...base, chave: 'x' })).toThrow(/chave/);
  });
});

describe('PIN do supervisor descendo do ERP', () => {
  it('a alteração de parâmetros com o hash troca o PIN; sem o campo, o PIN definido é mantido', () => {
    const { caixa, p } = caixaAberto();
    const vender = () =>
      caixa.registrarVenda({ itens: [{ produtoId: p.id, quantidade: 1 }], pagamentos: [{ forma: 'pix', valorCentavos: p.precoCentavos }] }).venda;

    caixa.aplicarAlteracao({ seq: 1, entidade: 'parametros', versao: 2, dados: { regraEstoque: 'bloquear', limiteDescontoPct: 10, pinSupervisorHash: hashDoPin('9876') } });
    const primeira = vender();
    expect(() => caixa.cancelarVenda(primeira.codigo, 'Desistiu', 'Carla', '1234')).toThrow(/não confere/);
    caixa.cancelarVenda(primeira.codigo, 'Desistiu', 'Carla', '9876');
    expect(caixa.buscarVenda(primeira.codigo)?.cancelada).toBe(true);

    // Nova versão dos parâmetros sem o PIN: o 9876 continua valendo.
    caixa.aplicarAlteracao({ seq: 2, entidade: 'parametros', versao: 3, dados: { regraEstoque: 'bloquear', limiteDescontoPct: 15 } });
    const segunda = vender();
    expect(() => caixa.cancelarVenda(segunda.codigo, 'Desistiu', 'Carla', '1234')).toThrow(/não confere/);
    caixa.cancelarVenda(segunda.codigo, 'Desistiu', 'Carla', '9876');
  });
});
