// Evento de estoque: estoque.movimentacao-registrada (versão 1).
// O saldo de um produto é a SOMA das movimentações (ADR 003 do OLD); por isso cada uma vira um evento.
import {
  ContratoInvalidoError,
  lerInteiro,
  lerObjeto,
  lerOpcao,
  lerTexto,
  lerUuid,
  ouNull,
  semChavesExtras,
} from '../leitura.ts';

export const TIPOS_MOVIMENTACAO = ['ENTRADA', 'VENDA', 'AJUSTE', 'ESTORNO'] as const;
export type TipoMovimentacao = (typeof TIPOS_MOVIMENTACAO)[number];

export interface MovimentacaoRegistrada {
  movimentacaoId: string;
  lojaId: string;
  produtoId: string;
  tipo: TipoMovimentacao;
  /** Positiva entra no estoque, negativa sai. Nunca zero. */
  quantidade: number;
  /** Só no tipo VENDA. */
  vendaId: string | null;
  motivo: string | null;
}

export function lerMovimentacaoRegistrada(dados: unknown, c = 'dados'): MovimentacaoRegistrada {
  const d = lerObjeto(dados, c);
  semChavesExtras(d, c, ['movimentacaoId', 'lojaId', 'produtoId', 'tipo', 'quantidade', 'vendaId', 'motivo']);
  const tipo = lerOpcao(d['tipo'], `${c}.tipo`, TIPOS_MOVIMENTACAO);
  const quantidade = lerInteiro(d['quantidade'], `${c}.quantidade`);
  const vendaId = ouNull(d['vendaId'], `${c}.vendaId`, lerUuid);

  // As mesmas regras que o banco impõe (docs/04-banco-de-dados.md, seção 3.2).
  if (quantidade === 0) throw new ContratoInvalidoError(`${c}.quantidade`, 'não pode ser zero');
  if (tipo === 'ENTRADA' && quantidade < 0) {
    throw new ContratoInvalidoError(`${c}.quantidade`, 'ENTRADA só pode ser positiva');
  }
  if (tipo === 'VENDA' && quantidade > 0) {
    throw new ContratoInvalidoError(`${c}.quantidade`, 'VENDA só pode ser negativa (o produto sai do estoque)');
  }
  if ((tipo === 'VENDA') !== (vendaId !== null)) {
    throw new ContratoInvalidoError(`${c}.vendaId`, 'obrigatório no tipo VENDA e proibido nos outros tipos');
  }

  return {
    movimentacaoId: lerUuid(d['movimentacaoId'], `${c}.movimentacaoId`),
    lojaId: lerUuid(d['lojaId'], `${c}.lojaId`),
    produtoId: lerUuid(d['produtoId'], `${c}.produtoId`),
    tipo,
    quantidade,
    vendaId,
    motivo: ouNull(d['motivo'], `${c}.motivo`, lerTexto),
  };
}
