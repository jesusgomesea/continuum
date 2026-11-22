// Cartão do Continuum: a "caixa" com título, ícone e uma ação no canto,
// como os cartões do Dashboard (Status do sistema, Sincronização, Fila).
import type { HTMLAttributes, ReactNode } from 'react';
import estilos from './Cartao.module.css';

export interface CartaoProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  titulo?: ReactNode;
  /** Ícone ao lado do título. */
  icone?: ReactNode;
  /** Algo no canto direito do cabeçalho: um Chip, um botão. */
  acao?: ReactNode;
}

export function Cartao({ titulo, icone, acao, className, children, ...resto }: CartaoProps) {
  return (
    <section className={[estilos.cartao, className ?? ''].filter(Boolean).join(' ')} {...resto}>
      {(titulo || acao) && (
        <header className={estilos.cabecalho}>
          {titulo && (
            <h2 className={estilos.titulo}>
              {icone}
              {titulo}
            </h2>
          )}
          {acao}
        </header>
      )}
      {children}
    </section>
  );
}
