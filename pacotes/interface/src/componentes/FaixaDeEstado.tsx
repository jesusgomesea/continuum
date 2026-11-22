// Faixa de estado: a faixa grande do topo do Dashboard (SAUDÁVEL, OFFLINE...).
// É a peça que mais carrega a essência do Continuum: mostrar, abertamente,
// em que situação a operação está. Os 5 estados são os da máquina de estados do OLD.
import { Check, RefreshCw, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import estilos from './FaixaDeEstado.module.css';

export type EstadoSistema = 'saudavel' | 'degradado' | 'offline' | 'recuperando' | 'sincronizando';

export const NOMES_ESTADO: Readonly<Record<EstadoSistema, string>> = {
  saudavel: 'SAUDÁVEL',
  degradado: 'DEGRADADO',
  offline: 'OFFLINE',
  recuperando: 'RECUPERANDO',
  sincronizando: 'SINCRONIZANDO',
};

/** Texto padrão de cada estado (o mesmo do Dashboard do OLD). */
export const DETALHES_ESTADO: Readonly<Record<EstadoSistema, string>> = {
  saudavel: 'Sistema estável · nuvem respondendo, a sincronização envia normalmente.',
  degradado: 'Falhas detectadas, queda ainda não confirmada. A sincronização segue tentando.',
  offline: 'Queda confirmada. A loja continua vendendo; a fila cresce e nada se perde.',
  recuperando: 'A nuvem voltou a responder. Confirmando a estabilidade antes de enviar.',
  sincronizando: 'Nuvem confirmada. Enviando a fila acumulada em lotes.',
};

export interface FaixaDeEstadoProps {
  estado: EstadoSistema;
  /** Texto ao lado do nome do estado, ex.: "Contingência ativa". */
  extra?: ReactNode;
  /** Substitui o texto padrão do estado. */
  detalhe?: ReactNode;
  /** Métricas à direita (ex.: tempo de detecção, vendas na queda). */
  children?: ReactNode;
}

function Icone({ estado }: { estado: EstadoSistema }) {
  if (estado === 'saudavel') return <Check aria-hidden="true" />;
  if (estado === 'sincronizando' || estado === 'recuperando') return <RefreshCw aria-hidden="true" className={estilos.girando} />;
  return <TriangleAlert aria-hidden="true" />;
}

export function FaixaDeEstado({ estado, extra, detalhe, children }: FaixaDeEstadoProps) {
  return (
    <section className={estilos.faixa} data-estado={estado} role="status" aria-live="polite">
      <span className={estilos.icone}>
        <Icone estado={estado} />
      </span>
      <div className={estilos.texto}>
        <div className={estilos.linhaTitulo}>
          <strong className={estilos.nome}>{NOMES_ESTADO[estado]}</strong>
          {extra && <span className={estilos.extra}>{extra}</span>}
        </div>
        <p className={estilos.detalhe}>{detalhe ?? DETALHES_ESTADO[estado]}</p>
      </div>
      {children && <div className={estilos.metricas}>{children}</div>}
    </section>
  );
}
