// @continuum/sync · Fila (outbox), Sync Engine e máquina de estados
//
// - A fila em que nada sai sem confirmação
// - O envio em ordem, em lotes, com nova tentativa progressiva
// - Os estados SAUDÁVEL, DEGRADADO, OFFLINE, RECUPERANDO e SINCRONIZANDO
//
// Reconstruído a partir do OLD. Usado nos dois elos: caixa → agente e agente → nuvem.

/** Nome do pacote (usado pelo teste do esqueleto, Passo 0.1). */
export const PACOTE = 'sync';
