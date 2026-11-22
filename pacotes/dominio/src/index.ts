// @continuum/dominio · Regras de negócio puras do Continuum
//
// - Venda, estoque e caixa: as regras que valem igual no PDV, no agente e na nuvem
// - Dinheiro em centavos, validação de CPF, CNPJ e EAN
// - Código da venda (NOMELOJAREDUZIDO-00000-ABCD)
//
// Não acessa banco, rede nem tela: só regras. Por isso é o pacote mais testado.

/** Nome do pacote (usado pelo teste do esqueleto, Passo 0.1). */
export const PACOTE = 'dominio';
