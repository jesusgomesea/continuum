// @continuum/nuvem · O servidor na nuvem: ERP de cada cliente e Continuum Central
//
// - ERP do cliente, identificado pelo domínio acessado
// - Continuum Central: clientes, parâmetros, atualizações, monitoramento
// - Recebimento e validação dos eventos; isolamento entre clientes
//
// Sucessor da cloud-api e do Dashboard do OLD.

/** Nome do pacote (usado pelo teste do esqueleto, Passo 0.1). */
export const PACOTE = 'nuvem';
export * from './seguranca.ts';
export * from './banco.ts';
export * from './migracoes.ts';
export * from './postgres-local.ts';
export * from './api.ts';
export * from './central.ts';
export * from './demonstracao.ts';
export * from './servidor.ts';
export * from './preparar.ts';
export * from './erp.ts';
export * from './erp-caixas.ts';
export * from './dispositivos.ts';
export * from './recebimento.ts';
