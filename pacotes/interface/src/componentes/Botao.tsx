// Botão do Continuum. Variantes: primário (ação principal), secundário, perigo
// (ex.: derrubar a nuvem, cancelar venda) e fantasma (ação discreta).
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import estilos from './Botao.module.css';

export type VarianteBotao = 'primario' | 'secundario' | 'perigo' | 'fantasma';

export interface BotaoProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: VarianteBotao;
  /** Ícone à esquerda do texto (um componente do Lucide, por exemplo). */
  icone?: ReactNode;
  /** Ocupa a largura toda (útil no PDV e no celular). */
  largo?: boolean;
}

export function Botao({ variante = 'primario', icone, largo = false, className, children, type = 'button', ...resto }: BotaoProps) {
  const classes = [estilos.botao, estilos[variante], largo ? estilos.largo : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <button type={type} className={classes} data-variante={variante} {...resto}>
      {icone}
      {children}
    </button>
  );
}
