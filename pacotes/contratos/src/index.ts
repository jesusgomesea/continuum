// @continuum/contratos · O "idioma" entre PDV, agente, ERP e Central
//
// - Formato de cada evento (produto, estoque, venda, caixa, sinal de vida)
// - Formato das APIs
// - Validações escritas uma vez e usadas pela tela e pelo servidor
//
// Se o formato de um evento muda, muda aqui, com versão.

/** Nome do pacote (usado pelo teste do esqueleto, Passo 0.1). */
export const PACOTE = 'contratos';

export * from './leitura.ts';
export * from './evento.ts';
export * from './sinal-de-vida.ts';
export * from './eventos/produto.ts';
export * from './eventos/estoque.ts';
export * from './eventos/venda.ts';
export * from './eventos/caixa.ts';
