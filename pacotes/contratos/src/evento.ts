// O envelope de todo evento da fila (outbox) e o "cardápio" de tipos conhecidos.
//
// Todo evento tem a mesma casca:
//   { id, seq, tipo, versao, ocorridoEm, dados }
// - id:         UUID v7 criado no caixa; a nuvem usa para não gravar o mesmo evento duas vezes
// - seq:        a ordem dentro do dispositivo (1, 2, 3...), sem buracos
// - tipo:       o que aconteceu, como "venda.registrada"
// - versao:     a versão do formato daquele tipo. Se um dia o formato mudar, nasce a versão 2 e a
//               nuvem continua entendendo a 1, para que PDVs desatualizados não parem de vender
// - ocorridoEm: quando aconteceu, em UTC
// - dados:      o conteúdo, conferido pelo contrato do tipo
import {
  ContratoInvalidoError,
  lerInstante,
  lerInteiro,
  lerObjeto,
  lerTexto,
  lerUuid,
  semChavesExtras,
} from './leitura.ts';
import { lerCaixaAberto, lerCaixaFechado, lerCaixaMovimentado } from './eventos/caixa.ts';
import type { CaixaAberto, CaixaFechado, CaixaMovimentado } from './eventos/caixa.ts';
import { lerMovimentacaoRegistrada } from './eventos/estoque.ts';
import type { MovimentacaoRegistrada } from './eventos/estoque.ts';
import { lerProdutoAlterado, lerProdutoCriado } from './eventos/produto.ts';
import type { ProdutoAlterado, ProdutoCriado } from './eventos/produto.ts';
import { lerVendaCancelada, lerVendaRegistrada } from './eventos/venda.ts';
import type { VendaCancelada, VendaRegistrada } from './eventos/venda.ts';

/** Cada tipo de evento e o formato dos seus dados. */
export interface DadosPorTipo {
  'produto.criado': ProdutoCriado;
  'produto.alterado': ProdutoAlterado;
  'estoque.movimentacao-registrada': MovimentacaoRegistrada;
  'venda.registrada': VendaRegistrada;
  'venda.cancelada': VendaCancelada;
  'caixa.aberto': CaixaAberto;
  'caixa.movimentado': CaixaMovimentado;
  'caixa.fechado': CaixaFechado;
}

export type TipoEvento = keyof DadosPorTipo;

/** Um evento já conferido. O TypeScript sabe o formato de `dados` pelo `tipo`. */
export type Evento = {
  [T in TipoEvento]: {
    id: string;
    seq: number;
    tipo: T;
    versao: number;
    ocorridoEm: string;
    dados: DadosPorTipo[T];
  };
}[TipoEvento];

type Leitor<T> = (dados: unknown, caminho: string) => T;

/** O cardápio: para cada tipo, os leitores de cada versão que o sistema entende. */
const CONTRATOS: { [T in TipoEvento]: Record<number, Leitor<DadosPorTipo[T]>> } = {
  'produto.criado': { 1: lerProdutoCriado },
  'produto.alterado': { 1: lerProdutoAlterado },
  'estoque.movimentacao-registrada': { 1: lerMovimentacaoRegistrada },
  'venda.registrada': { 1: lerVendaRegistrada },
  'venda.cancelada': { 1: lerVendaCancelada },
  'caixa.aberto': { 1: lerCaixaAberto },
  'caixa.movimentado': { 1: lerCaixaMovimentado },
  'caixa.fechado': { 1: lerCaixaFechado },
};

/** Todos os tipos de evento conhecidos. */
export const TIPOS_EVENTO = Object.keys(CONTRATOS) as TipoEvento[];

/** Versão atual (a que os PDVs novos gravam) de cada tipo. */
export function versaoAtual(tipo: TipoEvento): number {
  return Math.max(...Object.keys(CONTRATOS[tipo]).map(Number));
}

function ehTipoEvento(tipo: string): tipo is TipoEvento {
  return Object.hasOwn(CONTRATOS, tipo);
}

/**
 * Confere um evento inteiro (casca e dados) e devolve-o com o tipo certo.
 * Lança ContratoInvalidoError dizendo onde está o problema. É a mesma função na tela, no agente e na nuvem.
 */
export function lerEvento(valor: unknown, caminho = 'evento'): Evento {
  const e = lerObjeto(valor, caminho);
  semChavesExtras(e, caminho, ['id', 'seq', 'tipo', 'versao', 'ocorridoEm', 'dados']);
  const tipo = lerTexto(e['tipo'], `${caminho}.tipo`);
  if (!ehTipoEvento(tipo)) {
    throw new ContratoInvalidoError(`${caminho}.tipo`, `tipo de evento desconhecido: ${JSON.stringify(tipo)}`);
  }
  const versao = lerInteiro(e['versao'], `${caminho}.versao`, 1);
  const leitor = (CONTRATOS[tipo] as Record<number, Leitor<unknown>>)[versao];
  if (leitor === undefined) {
    throw new ContratoInvalidoError(`${caminho}.versao`, `a versão ${versao} de "${tipo}" não é conhecida`);
  }
  return {
    id: lerUuid(e['id'], `${caminho}.id`),
    seq: lerInteiro(e['seq'], `${caminho}.seq`, 1),
    tipo,
    versao,
    ocorridoEm: lerInstante(e['ocorridoEm'], `${caminho}.ocorridoEm`),
    dados: leitor(e['dados'], `${caminho}.dados`),
  } as Evento;
}

/** Resultado de conferir sem lançar erro: útil para a tela mostrar a mensagem ao lado do campo. */
export type Conferencia<T> = { ok: true; valor: T } | { ok: false; caminho: string; mensagem: string };

/** Igual a lerEvento, mas devolve o problema em vez de lançar erro. */
export function conferirEvento(valor: unknown): Conferencia<Evento> {
  try {
    return { ok: true, valor: lerEvento(valor) };
  } catch (erro) {
    if (erro instanceof ContratoInvalidoError) {
      return { ok: false, caminho: erro.caminho, mensagem: erro.message };
    }
    throw erro;
  }
}
