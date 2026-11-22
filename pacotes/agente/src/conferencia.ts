// Conferência "nada se perdeu": compara a fila de cada caixa com o que o agente recebeu.
// Reconstruído da ideia de OLD/app/dist/lab/conferencia.js.
//
// Para cada caixa: o agente tem de ter TODOS os eventos da fila do caixa, cada um UMA vez só,
// na mesma ordem (seq), com o mesmo id, o mesmo tipo e os mesmos dados.
import type { Fila } from '@continuum/sync';
import type { BancoSqlite } from '@continuum/sync';

export interface ResultadoDaConferencia {
  caixa: string;
  eventosNoCaixa: number;
  eventosNoAgente: number;
  pendentesNoCaixa: number;
  divergencias: string[];
}

export function conferirCaixaComAgente(caixaId: string, fila: Fila, bancoDoAgente: BancoSqlite): ResultadoDaConferencia {
  const noCaixa = fila.todos();
  const noAgente = bancoDoAgente.consultar('SELECT seq, id, tipo, dados FROM eventos_recebidos WHERE origem_id = ? ORDER BY seq', caixaId);
  const divergencias: string[] = [];
  if (noCaixa.length !== noAgente.length) divergencias.push(`${noCaixa.length} eventos no caixa, ${noAgente.length} no agente`);
  const distintos = new Set(noAgente.map((l) => Number(l['seq']))).size;
  if (distintos !== noAgente.length) divergencias.push(`${noAgente.length - distintos} eventos duplicados no agente`);
  noCaixa.forEach((e, i) => {
    const a = noAgente[i];
    if (a === undefined) return;
    const igual = Number(a['seq']) === e.seq && a['id'] === e.id && a['tipo'] === e.tipo && a['dados'] === JSON.stringify(e.dados);
    if (!igual && divergencias.length < 10) divergencias.push(`seq ${e.seq}: o agente tem algo diferente do caixa`);
  });
  const pendentes = fila.contarPendentes();
  if (pendentes > 0) divergencias.push(`${pendentes} eventos ainda pendentes no caixa`);
  return { caixa: caixaId, eventosNoCaixa: noCaixa.length, eventosNoAgente: noAgente.length, pendentesNoCaixa: pendentes, divergencias };
}
