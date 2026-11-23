// @continuum/pdv · O PDV instalado (caixa)
//
// - Banco próprio do caixa: vende mesmo sem internet e sem a rede da loja
// - Abrir caixa, registrar venda, comprovante, fechar caixa
// - Programa instalado (Electron), com impressão
//
// Sucessor do PDV do OLD.

/** Nome do pacote (usado pelo teste do esqueleto, Passo 0.1). */
export const PACOTE = 'pdv';

export * from './banco/migracoes.ts';
export * from './caixa.ts';
export * from './sincronizacao.ts';
export * from './pin.ts';
export * from './ativacao.ts';
export * from './descida.ts';
export * from './balanca.ts';
export * from './busca.ts';
