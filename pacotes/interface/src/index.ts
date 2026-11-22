// @continuum/interface · Identidade visual e componentes do Continuum
//
// - Tokens de design (cores, medidas, tipografia) nos temas claro e escuro
// - Componentes compartilhados por Central, ERP e PDV
// - Layouts: lateral + conteúdo, caixa e telão (próximos passos)
//
// Para usar numa tela: importar os estilos uma vez e os componentes onde precisar.
//   import '@continuum/interface/estilos';   (tokens + base)
//   import { Botao, Cartao } from '@continuum/interface';

/** Nome do pacote (usado pelo teste do esqueleto, Passo 0.1). */
export const PACOTE = 'interface';

export { Botao, type BotaoProps, type VarianteBotao } from './componentes/Botao.tsx';
export { Cartao, type CartaoProps } from './componentes/Cartao.tsx';
export { Chip, type ChipProps, type TomChip } from './componentes/Chip.tsx';
export {
  DETALHES_ESTADO,
  FaixaDeEstado,
  NOMES_ESTADO,
  type EstadoSistema,
  type FaixaDeEstadoProps,
} from './componentes/FaixaDeEstado.tsx';
