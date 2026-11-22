// Máquina de estados da conexão (docs/estados.md e ADR 012 do OLD), reconstruída de
// OLD/app/dist/estado/maquina-de-estados.js. Só a parte automática; o modo manual do LAB ficou de fora.
//
//   SAUDÁVEL ──falha──▶ DEGRADADO ──3 falhas──▶ OFFLINE ──sucesso──▶ RECUPERANDO
//      ▲                  │   ▲                                         │
//      │             sucesso  └─────────── falha ◀── SINCRONIZANDO ◀── 5 sucessos
//      └──── fila pequena ─────────────────────────────────┘
//
// Cada envio (ou consulta de saúde) é uma "evidência": sucesso ou falha. O estado muda pelas regras.
// Com fila grande depois de uma queda, passa por SINCRONIZANDO até esvaziar.

export const ESTADOS = ['saudavel', 'degradado', 'offline', 'recuperando', 'sincronizando'] as const;
export type Estado = (typeof ESTADOS)[number];

export interface ParametrosDosEstados {
  /** Falhas seguidas para confirmar a queda (DEGRADADO → OFFLINE). */
  falhasParaOffline: number;
  /** Sucessos seguidos para confiar na volta (RECUPERANDO → SINCRONIZANDO). */
  sucessosParaVoltar: number;
  /** Até quantos eventos pendentes a fila conta como "em dia". */
  limiteFila: number;
}

export const PARAMETROS_PADRAO: ParametrosDosEstados = { falhasParaOffline: 3, sucessosParaVoltar: 5, limiteFila: 10 };

export interface Situacao {
  readonly estado: Estado;
  readonly falhasSeguidas: number;
  readonly sucessosSeguidos: number;
}

export const SITUACAO_INICIAL: Situacao = Object.freeze({ estado: 'saudavel', falhasSeguidas: 0, sucessosSeguidos: 0 });

export type Evidencia = { tipo: 'falha' } | { tipo: 'sucesso'; pendentes: number } | { tipo: 'fila'; pendentes: number };

export interface Transicao {
  readonly de: Estado;
  readonly para: Estado;
  readonly motivo: string;
}

const PERMITIDAS = new Set([
  'saudavel>degradado',
  'degradado>saudavel',
  'degradado>sincronizando',
  'degradado>offline',
  'offline>recuperando',
  'recuperando>offline',
  'recuperando>sincronizando',
  'sincronizando>saudavel',
  'sincronizando>degradado',
]);

export function transicaoPermitida(de: Estado, para: Estado): boolean {
  return PERMITIDAS.has(`${de}>${para}`);
}

/** O envio só acontece nestes estados. Em OFFLINE e RECUPERANDO, só a consulta de saúde. */
export function syncEnvia(estado: Estado): boolean {
  return estado === 'saudavel' || estado === 'degradado' || estado === 'sincronizando';
}

function transicaoDevida(s: Situacao, e: Evidencia, p: ParametrosDosEstados): Transicao | null {
  const t = (para: Estado, motivo: string): Transicao => ({ de: s.estado, para, motivo });
  switch (e.tipo) {
    case 'falha':
      if (s.estado === 'saudavel') return t('degradado', '1ª falha');
      if (s.estado === 'sincronizando') return t('degradado', 'falha durante o envio');
      if (s.estado === 'recuperando') return t('offline', 'falha durante a recuperação');
      if (s.estado === 'degradado' && s.falhasSeguidas >= p.falhasParaOffline) return t('offline', `${s.falhasSeguidas} falhas seguidas`);
      return null;
    case 'sucesso':
      if (s.estado === 'degradado') {
        return e.pendentes > p.limiteFila ? t('sincronizando', `sucesso com ${e.pendentes} eventos na fila`) : t('saudavel', 'sucesso');
      }
      if (s.estado === 'offline') return t('recuperando', '1º sucesso depois da queda');
      if (s.estado === 'recuperando' && s.sucessosSeguidos >= p.sucessosParaVoltar) return t('sincronizando', `${s.sucessosSeguidos} sucessos seguidos`);
      return null;
    case 'fila':
      if (s.estado === 'sincronizando' && e.pendentes <= p.limiteFila) return t('saudavel', `fila com ${e.pendentes} eventos`);
      return null;
  }
}

/** Aplica uma evidência e devolve a situação nova e a transição, se houve. */
export function aplicarEvidencia(
  situacao: Situacao,
  evidencia: Evidencia,
  parametros: ParametrosDosEstados = PARAMETROS_PADRAO,
): { situacao: Situacao; transicao: Transicao | null } {
  let { falhasSeguidas, sucessosSeguidos } = situacao;
  if (evidencia.tipo === 'falha') {
    falhasSeguidas += 1;
    sucessosSeguidos = 0;
  } else if (evidencia.tipo === 'sucesso') {
    sucessosSeguidos += 1;
    falhasSeguidas = 0;
  }
  const base: Situacao = { ...situacao, falhasSeguidas, sucessosSeguidos };
  const transicao = transicaoDevida(base, evidencia, parametros);
  if (transicao === null) return { situacao: Object.freeze(base), transicao: null };
  if (!transicaoPermitida(transicao.de, transicao.para)) {
    throw new Error(`transição proibida: ${transicao.de} → ${transicao.para}`);
  }
  return { situacao: Object.freeze({ ...base, estado: transicao.para }), transicao };
}

/**
 * Quanto esperar depois de `falhas` falhas seguidas (ADR 011 do OLD): dobra a cada falha, de
 * `inicialMs` até `maximoMs`, sorteando entre a metade e o teto para os caixas não reenviarem juntos.
 */
export function calcularEspera(falhas: number, opcoes: { inicialMs: number; maximoMs: number }, aleatorio: () => number = Math.random): number {
  if (!Number.isSafeInteger(falhas) || falhas < 1) throw new RangeError(`falhas inválidas: ${falhas}`);
  const teto = Math.min(opcoes.maximoMs, opcoes.inicialMs * 2 ** Math.min(falhas - 1, 30));
  return Math.round(teto / 2 + (aleatorio() * teto) / 2);
}
