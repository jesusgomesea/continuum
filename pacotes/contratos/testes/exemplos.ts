// Eventos de exemplo VÁLIDOS, usados pelos testes. Cada teste estraga uma parte e vê o contrato recusar.

export const IDS = {
  evento: '019a0b7c-0000-7000-8000-000000000001',
  produto: '019a0b7c-0000-7000-8000-0000000000a1',
  loja: '019a0b7c-0000-7000-8000-0000000000b1',
  sessao: '019a0b7c-0000-7000-8000-0000000000c1',
  venda: '019a0b7c-1111-7222-8333-44445555abcd', // termina em abcd → conferência ABCD
  item1: '019a0b7c-0000-7000-8000-0000000000d1',
  item2: '019a0b7c-0000-7000-8000-0000000000d2',
  mov1: '019a0b7c-0000-7000-8000-0000000000e1',
  mov2: '019a0b7c-0000-7000-8000-0000000000e2',
  pag1: '019a0b7c-0000-7000-8000-0000000000f1',
  pag2: '019a0b7c-0000-7000-8000-0000000000f2',
  dispositivo: '019a0b7c-0000-7000-8000-000000000099',
} as const;

export const AGORA = '2026-11-21T13:45:00.000Z';

/** Monta o envelope de um evento com os dados dados. */
export function envelope(tipo: string, dados: unknown, extras: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: IDS.evento, seq: 1, tipo, versao: 1, ocorridoEm: AGORA, dados, ...extras };
}

/** Uma venda de 2 cafés (R$ 18,90) + 1 pão (R$ 8,99), R$ 1,00 de desconto, paga com Pix e dinheiro. */
export function vendaValida(): Record<string, unknown> {
  return {
    vendaId: IDS.venda,
    codigo: 'MERCBAIRRO-10123-ABCD',
    numero: 123,
    lojaId: IDS.loja,
    sessaoId: IDS.sessao,
    itens: [
      { id: IDS.item1, posicao: 1, produtoId: IDS.produto, quantidade: 2, precoUnitarioCentavos: 1890, descontoCentavos: 100, movimentacaoId: IDS.mov1 },
      { id: IDS.item2, posicao: 2, produtoId: IDS.produto, quantidade: 1, precoUnitarioCentavos: 899, descontoCentavos: 0, movimentacaoId: IDS.mov2 },
    ],
    // bruto 4679, desconto 100, líquido 4579: 2000 no Pix + 3000 em dinheiro, troco 421.
    pagamentos: [
      { id: IDS.pag1, forma: 'pix', valorCentavos: 2000 },
      { id: IDS.pag2, forma: 'dinheiro', valorCentavos: 3000 },
    ],
    brutoCentavos: 4679,
    descontoCentavos: 100,
    liquidoCentavos: 4579,
    trocoCentavos: 421,
    documentoCliente: '52998224725',
  };
}

export function produtoValido(): Record<string, unknown> {
  return { produtoId: IDS.produto, nome: 'Café 500 g', precoCentavos: 1890, unidade: 'un', ean: '4006381333931', version: 1 };
}

export function sinalValido(): Record<string, unknown> {
  return {
    dispositivoId: IDS.dispositivo,
    estado: 'saudavel',
    filaPendente: 0,
    caixaAberto: true,
    ultimaVendaEm: AGORA,
    versaoPrograma: '0.1.0',
    enviadoEm: AGORA,
  };
}
