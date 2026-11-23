// Gráficos simples feitos à mão em SVG (sem biblioteca, nada vem da internet). As cores vêm dos tokens:
// funcionam nos temas claro (ERP) e escuro (Central) sem mudar nada aqui.
import { useState } from 'react';

/** Ordem das cores das séries (formas de pagamento, fatias). Só tokens. */
export const CORES_DAS_SERIES = ['var(--cor-primaria)', 'var(--cor-sucesso)', 'var(--cor-atencao)', 'var(--cor-erro)', 'var(--cor-info)', 'var(--cor-primaria-2)', 'var(--cor-neutra)'];

export interface Barra {
  rotulo: string;
  valor: number;
  /** Texto do balão ao passar o mouse (se não vier, usa o valor formatado). */
  dica?: string;
  destaque?: boolean;
}

/** Barras verticais. O rótulo de baixo aparece a cada "passoDoRotulo" barras para não embolar. */
export function GraficoDeBarras({ barras, formatar, altura = 180, passoDoRotulo = 1, titulo }: { barras: Barra[]; formatar: (v: number) => string; altura?: number; passoDoRotulo?: number; titulo: string }) {
  const [sobre, setSobre] = useState<number | null>(null);
  const maximo = Math.max(1, ...barras.map((b) => b.valor));
  const largura = Math.max(barras.length * 28, 280);
  const base = altura - 4;
  const passo = largura / Math.max(barras.length, 1);
  const atual = sobre === null ? null : barras[sobre];
  return (
    <figure className="grafico">
      <svg viewBox={`0 0 ${largura} ${altura}`} role="img" aria-label={titulo} preserveAspectRatio="none" style={{ height: altura }}>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1="0" x2={largura} y1={base - (base - 8) * f} y2={base - (base - 8) * f} className="grafico-grade" />
        ))}
        {barras.map((b, i) => {
          const h = b.valor <= 0 ? 0 : Math.max(2, ((base - 8) * b.valor) / maximo);
          return (
            <g key={`${b.rotulo}-${i}`} onMouseEnter={() => setSobre(i)} onMouseLeave={() => setSobre(null)} onFocus={() => setSobre(i)} onBlur={() => setSobre(null)} tabIndex={0}>
              <rect x={i * passo} y="0" width={passo} height={altura} fill="transparent" />
              <rect
                x={i * passo + passo * 0.18}
                y={base - h}
                width={passo * 0.64}
                height={h}
                rx="3"
                className={b.destaque === true ? 'grafico-barra destaque' : sobre === i ? 'grafico-barra sobre' : 'grafico-barra'}
              />
            </g>
          );
        })}
      </svg>
      {/* Os rótulos ficam fora do SVG: o SVG estica na largura e deformaria as letras. */}
      <div className="grafico-eixo" style={{ gridTemplateColumns: `repeat(${Math.max(barras.length, 1)}, minmax(0, 1fr))` }} aria-hidden="true">
        {barras.map((b, i) => (
          <span key={`${b.rotulo}-${i}`}>{i % passoDoRotulo === 0 ? b.rotulo : ''}</span>
        ))}
      </div>
      <figcaption className="grafico-legenda" aria-live="polite">
        {atual !== null && atual !== undefined ? (atual.dica ?? `${atual.rotulo}: ${formatar(atual.valor)}`) : `Máximo: ${formatar(maximo === 1 && barras.every((b) => b.valor === 0) ? 0 : maximo)}`}
      </figcaption>
    </figure>
  );
}

export interface Fatia {
  rotulo: string;
  valor: number;
}

/** Rosca (pizza com furo) com a legenda ao lado: participação de cada parte no total. */
export function GraficoDeRosca({ fatias, formatar, titulo }: { fatias: Fatia[]; formatar: (v: number) => string; titulo: string }) {
  const total = fatias.reduce((t, f) => t + Math.max(f.valor, 0), 0);
  const raio = 52;
  const circunferencia = 2 * Math.PI * raio;
  let acumulado = 0;
  return (
    <figure className="rosca">
      <svg viewBox="0 0 140 140" role="img" aria-label={titulo}>
        <circle cx="70" cy="70" r={raio} className="rosca-fundo" />
        {total > 0 &&
          fatias.map((f, i) => {
            const fracao = Math.max(f.valor, 0) / total;
            const tracado = (
              <circle
                key={f.rotulo}
                cx="70"
                cy="70"
                r={raio}
                fill="none"
                stroke={CORES_DAS_SERIES[i % CORES_DAS_SERIES.length]}
                strokeWidth="22"
                strokeDasharray={`${fracao * circunferencia} ${circunferencia}`}
                strokeDashoffset={-acumulado * circunferencia}
                transform="rotate(-90 70 70)"
              />
            );
            acumulado += fracao;
            return tracado;
          })}
        <text x="70" y="68" textAnchor="middle" className="rosca-rotulo">
          {total > 0 ? 'total' : 'sem dados'}
        </text>
        {total > 0 && (
          <text x="70" y="86" textAnchor="middle" className="rosca-total">
            {formatar(total)}
          </text>
        )}
      </svg>
      <ul className="rosca-legenda">
        {fatias.map((f, i) => (
          <li key={f.rotulo}>
            <span className="rosca-cor" style={{ background: CORES_DAS_SERIES[i % CORES_DAS_SERIES.length] }} aria-hidden="true" />
            <span>{f.rotulo}</span>
            <strong>{formatar(f.valor)}</strong>
            <small>{total > 0 ? `${Math.round((f.valor / total) * 100)}%` : ''}</small>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** "↑ 12% vs. ontem": compara dois números e pinta de verde (subiu) ou vermelho (caiu). */
export function Tendencia({ atual, anterior, rotulo }: { atual: number; anterior: number; rotulo: string }) {
  if (anterior === 0 && atual === 0) return <small className="tendencia neutra">— {rotulo}</small>;
  if (anterior === 0) return <small className="tendencia sobe">novo {rotulo}</small>;
  const pct = Math.round(((atual - anterior) / anterior) * 100);
  const classe = pct > 0 ? 'sobe' : pct < 0 ? 'cai' : 'neutra';
  return (
    <small className={`tendencia ${classe}`}>
      {pct > 0 ? '↑' : pct < 0 ? '↓' : '='} {Math.abs(pct)}% {rotulo}
    </small>
  );
}

/** Mini linha (sparkline) para caber dentro de um cartão. */
export function MiniLinha({ valores, titulo }: { valores: number[]; titulo: string }) {
  const max = Math.max(1, ...valores);
  const pontos = valores.map((v, i) => `${(i / Math.max(valores.length - 1, 1)) * 100},${28 - (v / max) * 26}`).join(' ');
  return (
    <svg className="mini-linha" viewBox="0 0 100 30" preserveAspectRatio="none" role="img" aria-label={titulo}>
      <polyline points={pontos} fill="none" />
    </svg>
  );
}
