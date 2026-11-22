// Sinal de vida (heartbeat): o "estou vivo" que PDV e agente mandam a cada ~15 segundos.
//
// Não é um evento da fila: não tem seq, não se guarda histórico e, se um se perder, o próximo cobre.
// A nuvem guarda só o último de cada dispositivo (tabela sinais_de_vida) e o Central mostra ao vivo.
import { lerBooleano, lerInstante, lerInteiro, lerObjeto, lerOpcao, lerTexto, lerUuid, ouNull, semChavesExtras } from './leitura.ts';

/** Estados da conexão, os mesmos da máquina de estados do OLD (docs/estados.md do OLD). */
export const ESTADOS_CONEXAO = ['saudavel', 'degradado', 'offline', 'recuperando', 'sincronizando'] as const;
export type EstadoConexao = (typeof ESTADOS_CONEXAO)[number];

export interface SinalDeVida {
  dispositivoId: string;
  estado: EstadoConexao;
  /** Quantos eventos ainda esperam na fila para subir. */
  filaPendente: number;
  caixaAberto: boolean;
  ultimaVendaEm: string | null;
  /** Versão do programa instalado, como "0.1.0". */
  versaoPrograma: string;
  enviadoEm: string;
}

export function lerSinalDeVida(valor: unknown, c = 'sinal'): SinalDeVida {
  const d = lerObjeto(valor, c);
  semChavesExtras(d, c, ['dispositivoId', 'estado', 'filaPendente', 'caixaAberto', 'ultimaVendaEm', 'versaoPrograma', 'enviadoEm']);
  return {
    dispositivoId: lerUuid(d['dispositivoId'], `${c}.dispositivoId`),
    estado: lerOpcao(d['estado'], `${c}.estado`, ESTADOS_CONEXAO),
    filaPendente: lerInteiro(d['filaPendente'], `${c}.filaPendente`, 0),
    caixaAberto: lerBooleano(d['caixaAberto'], `${c}.caixaAberto`),
    ultimaVendaEm: ouNull(d['ultimaVendaEm'], `${c}.ultimaVendaEm`, lerInstante),
    versaoPrograma: lerTexto(d['versaoPrograma'], `${c}.versaoPrograma`),
    enviadoEm: lerInstante(d['enviadoEm'], `${c}.enviadoEm`),
  };
}
