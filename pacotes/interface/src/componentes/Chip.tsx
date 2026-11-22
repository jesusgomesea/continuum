// Chip: a etiqueta de situação ("● Em dia", "● Pausada", "● Contingência").
// O tom diz o significado: sucesso (verde), atenção (âmbar), erro (vermelho), info (azul), neutro.
import type { HTMLAttributes } from 'react';
import estilos from './Chip.module.css';

export type TomChip = 'neutro' | 'sucesso' | 'atencao' | 'erro' | 'info';

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  tom?: TomChip;
  /** Mostra a bolinha antes do texto (padrão: sim). */
  ponto?: boolean;
}

export function Chip({ tom = 'neutro', ponto = true, className, children, ...resto }: ChipProps) {
  const classes = [estilos.chip, estilos[tom], ponto ? estilos.ponto : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <span className={classes} data-tom={tom} {...resto}>
      {children}
    </span>
  );
}
