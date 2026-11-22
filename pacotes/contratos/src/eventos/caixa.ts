// Eventos do caixa: caixa.aberto, caixa.movimentado (sangria e suprimento) e caixa.fechado (versão 1).
// Tabelas correspondentes: sessoes_caixa e movimentos_caixa (docs/04-banco-de-dados.md, seção 3.2).
import { lerInteiro, lerObjeto, lerOpcao, lerTexto, lerUuid, semChavesExtras } from '../leitura.ts';

export const TIPOS_MOVIMENTO_CAIXA = ['SANGRIA', 'SUPRIMENTO'] as const;
export type TipoMovimentoCaixa = (typeof TIPOS_MOVIMENTO_CAIXA)[number];

export interface CaixaAberto {
  sessaoId: string;
  operador: string;
  /** Dinheiro deixado na gaveta para troco, na abertura. */
  fundoCentavos: number;
}

export interface CaixaMovimentado {
  movimentoId: string;
  sessaoId: string;
  /** SANGRIA tira dinheiro da gaveta; SUPRIMENTO põe. */
  tipo: TipoMovimentoCaixa;
  valorCentavos: number;
  motivo: string;
}

export interface CaixaFechado {
  sessaoId: string;
  /** O que o operador contou na gaveta. */
  contadoCentavos: number;
  /** O que o sistema calculou que deveria haver. A diferença aparece no relatório. */
  esperadoCentavos: number;
}

export function lerCaixaAberto(dados: unknown, c = 'dados'): CaixaAberto {
  const d = lerObjeto(dados, c);
  semChavesExtras(d, c, ['sessaoId', 'operador', 'fundoCentavos']);
  return {
    sessaoId: lerUuid(d['sessaoId'], `${c}.sessaoId`),
    operador: lerTexto(d['operador'], `${c}.operador`),
    fundoCentavos: lerInteiro(d['fundoCentavos'], `${c}.fundoCentavos`, 0),
  };
}

export function lerCaixaMovimentado(dados: unknown, c = 'dados'): CaixaMovimentado {
  const d = lerObjeto(dados, c);
  semChavesExtras(d, c, ['movimentoId', 'sessaoId', 'tipo', 'valorCentavos', 'motivo']);
  return {
    movimentoId: lerUuid(d['movimentoId'], `${c}.movimentoId`),
    sessaoId: lerUuid(d['sessaoId'], `${c}.sessaoId`),
    tipo: lerOpcao(d['tipo'], `${c}.tipo`, TIPOS_MOVIMENTO_CAIXA),
    valorCentavos: lerInteiro(d['valorCentavos'], `${c}.valorCentavos`, 1),
    motivo: lerTexto(d['motivo'], `${c}.motivo`),
  };
}

export function lerCaixaFechado(dados: unknown, c = 'dados'): CaixaFechado {
  const d = lerObjeto(dados, c);
  semChavesExtras(d, c, ['sessaoId', 'contadoCentavos', 'esperadoCentavos']);
  return {
    sessaoId: lerUuid(d['sessaoId'], `${c}.sessaoId`),
    contadoCentavos: lerInteiro(d['contadoCentavos'], `${c}.contadoCentavos`, 0),
    esperadoCentavos: lerInteiro(d['esperadoCentavos'], `${c}.esperadoCentavos`, 0),
  };
}
