// Cliente da API do caixa, usado pelas telas. Cada função é um pedido ao servidor local do PDV.
import type { Venda, AlertaEstoque } from '@continuum/dominio';
import type { EstadoDoCaixa } from '../src/servidor/api.ts';
import type { CarrinhoEmEspera, PedidoDoCaixa, Relatorio } from '../src/caixa.ts';

export type { CarrinhoEmEspera, EstadoDoCaixa, Relatorio };

/** Recusa vinda do caixa (estoque, desconto, caixa fechado...), com a mensagem para o operador. */
export class RecusaDoCaixa extends Error {
  override name = 'RecusaDoCaixa';
  readonly tipo: string;
  readonly status: number;
  constructor(tipo: string, mensagem: string, status: number) {
    super(mensagem);
    this.tipo = tipo;
    this.status = status;
  }
}

async function pedir<T>(metodo: 'GET' | 'POST', caminho: string, corpo?: unknown): Promise<T> {
  const resposta = await fetch(caminho, {
    method: metodo,
    headers: corpo === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
  });
  const dados = (await resposta.json()) as { erro?: string; mensagem?: string };
  if (!resposta.ok) throw new RecusaDoCaixa(dados.erro ?? 'Erro', dados.mensagem ?? 'Algo deu errado.', resposta.status);
  return dados as T;
}

export const api = {
  estado: () => pedir<EstadoDoCaixa>('GET', '/api/estado'),
  abrirCaixa: (operador: string, fundoCentavos: number) => pedir<EstadoDoCaixa>('POST', '/api/caixa/abrir', { operador, fundoCentavos }),
  vender: (pedido: PedidoDoCaixa) =>
    pedir<{ venda: Venda; alertasEstoque: AlertaEstoque[]; repetida: boolean; estado: EstadoDoCaixa }>('POST', '/api/vendas', pedido),
  cancelar: (codigo: string, motivo: string, autorizadoPor: string, pin: string) =>
    pedir<EstadoDoCaixa>('POST', `/api/vendas/${encodeURIComponent(codigo)}/cancelar`, { motivo, autorizadoPor, pin }),
  movimentar: (tipo: 'SANGRIA' | 'SUPRIMENTO', valorCentavos: number, motivo: string) =>
    pedir<EstadoDoCaixa>('POST', '/api/caixa/movimentar', { tipo, valorCentavos, motivo }),
  /** Pausa o carrinho (venda em espera): não é venda, não gera evento. */
  guardarEspera: (carrinho: CarrinhoEmEspera, rotulo?: string) => pedir<EstadoDoCaixa>('POST', '/api/espera', { carrinho, rotulo }),
  retomarEspera: (id: string) =>
    pedir<{ carrinho: CarrinhoEmEspera; estado: EstadoDoCaixa }>('POST', `/api/espera/${encodeURIComponent(id)}/retomar`),
  relatorio: () => pedir<Relatorio>('GET', '/api/caixa/relatorio'),
  fechar: (contadoCentavos: number) => pedir<{ relatorio: Relatorio; estado: EstadoDoCaixa }>('POST', '/api/caixa/fechar', { contadoCentavos }),
};
