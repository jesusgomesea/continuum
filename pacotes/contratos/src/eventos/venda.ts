// Eventos de venda: venda.registrada e venda.cancelada (versão 1).
//
// Novidade em relação ao OLD (docs/04-banco-de-dados.md, fim da seção 3.2): a nuvem recebe TUDO o que
// o caixa sabe (desconto, líquido, pagamentos, troco, sessão), e o contrato confere que as contas fecham.
// Venda nunca é editada: cancelar é um evento novo (venda.cancelada), e o estoque volta por ESTORNO.
import { cnpjValido, conferenciaConfere, cpfValido, lerCodigoDaVenda } from '@continuum/dominio';
import {
  ContratoInvalidoError,
  lerInteiro,
  lerLista,
  lerObjeto,
  lerOpcao,
  lerTexto,
  lerUuid,
  ouNull,
  semChavesExtras,
} from '../leitura.ts';

export const FORMAS_PAGAMENTO = ['dinheiro', 'debito', 'credito', 'pix'] as const;
export type FormaPagamento = (typeof FORMAS_PAGAMENTO)[number];

export interface ItemVendido {
  id: string;
  /** 1, 2, 3... na ordem em que o operador passou os produtos. */
  posicao: number;
  produtoId: string;
  quantidade: number;
  /** Preço praticado na hora da venda (o preço do cadastro pode mudar depois). */
  precoUnitarioCentavos: number;
  descontoCentavos: number;
  /** A baixa de estoque deste item (evento estoque.movimentacao-registrada do tipo VENDA). */
  movimentacaoId: string;
}

export interface Pagamento {
  id: string;
  forma: FormaPagamento;
  valorCentavos: number;
}

export interface VendaRegistrada {
  vendaId: string;
  /** Código do comprovante: MERCBAIRRO-10123-ABCD. */
  codigo: string;
  /** Número sequencial da venda no caixa (o mesmo que está no código). */
  numero: number;
  lojaId: string;
  sessaoId: string;
  itens: ItemVendido[];
  pagamentos: Pagamento[];
  /** Soma de quantidade × preço de todos os itens. */
  brutoCentavos: number;
  /** Desconto total: o dos itens mais o dado no total da venda. */
  descontoCentavos: number;
  /** bruto − desconto: o que o cliente pagou. */
  liquidoCentavos: number;
  trocoCentavos: number;
  /** CPF ou CNPJ só com dígitos, ou null se o cliente não informou. */
  documentoCliente: string | null;
}

export interface VendaCancelada {
  vendaId: string;
  motivo: string;
  /** Quem autorizou (supervisor ou dono). */
  autorizadoPor: string;
}

function lerItem(valor: unknown, c: string): ItemVendido {
  const d = lerObjeto(valor, c);
  semChavesExtras(d, c, ['id', 'posicao', 'produtoId', 'quantidade', 'precoUnitarioCentavos', 'descontoCentavos', 'movimentacaoId']);
  const item: ItemVendido = {
    id: lerUuid(d['id'], `${c}.id`),
    posicao: lerInteiro(d['posicao'], `${c}.posicao`, 1),
    produtoId: lerUuid(d['produtoId'], `${c}.produtoId`),
    quantidade: lerInteiro(d['quantidade'], `${c}.quantidade`, 1),
    precoUnitarioCentavos: lerInteiro(d['precoUnitarioCentavos'], `${c}.precoUnitarioCentavos`, 0),
    descontoCentavos: lerInteiro(d['descontoCentavos'], `${c}.descontoCentavos`, 0),
    movimentacaoId: lerUuid(d['movimentacaoId'], `${c}.movimentacaoId`),
  };
  if (item.descontoCentavos > item.quantidade * item.precoUnitarioCentavos) {
    throw new ContratoInvalidoError(`${c}.descontoCentavos`, 'desconto maior que o valor do item');
  }
  return item;
}

function lerPagamento(valor: unknown, c: string): Pagamento {
  const d = lerObjeto(valor, c);
  semChavesExtras(d, c, ['id', 'forma', 'valorCentavos']);
  return {
    id: lerUuid(d['id'], `${c}.id`),
    forma: lerOpcao(d['forma'], `${c}.forma`, FORMAS_PAGAMENTO),
    valorCentavos: lerInteiro(d['valorCentavos'], `${c}.valorCentavos`, 1),
  };
}

function lerDocumento(valor: unknown, c: string): string {
  const ok =
    typeof valor === 'string' &&
    ((/^\d{11}$/.test(valor) && cpfValido(valor)) || (/^\d{14}$/.test(valor) && cnpjValido(valor)));
  if (!ok) throw new ContratoInvalidoError(c, 'CPF ou CNPJ inválido (só dígitos, dígito verificador confere)');
  return valor as string;
}

const somar = (valores: number[]): number => valores.reduce((s, v) => s + v, 0);

export function lerVendaRegistrada(dados: unknown, c = 'dados'): VendaRegistrada {
  const d = lerObjeto(dados, c);
  semChavesExtras(d, c, [
    'vendaId', 'codigo', 'numero', 'lojaId', 'sessaoId', 'itens', 'pagamentos',
    'brutoCentavos', 'descontoCentavos', 'liquidoCentavos', 'trocoCentavos', 'documentoCliente',
  ]);

  const vendaId = lerUuid(d['vendaId'], `${c}.vendaId`);
  const numero = lerInteiro(d['numero'], `${c}.numero`, 1);

  // O código do comprovante precisa bater com o número e com o id da venda.
  const codigo = lerTexto(d['codigo'], `${c}.codigo`);
  const partes = lerCodigoDaVenda(codigo);
  if (partes === null || codigo !== codigo.trim().toUpperCase()) {
    throw new ContratoInvalidoError(`${c}.codigo`, 'formato esperado: MERCBAIRRO-10123-ABCD');
  }
  if (partes.numeroVenda !== numero) {
    throw new ContratoInvalidoError(`${c}.codigo`, `o número no código (${partes.numeroVenda}) não é o da venda (${numero})`);
  }
  if (!conferenciaConfere(partes, vendaId)) {
    throw new ContratoInvalidoError(`${c}.codigo`, 'os 4 caracteres de conferência não batem com o vendaId');
  }

  const itens = lerLista(d['itens'], `${c}.itens`).map((v, i) => lerItem(v, `${c}.itens[${i}]`));
  if (itens.length === 0) throw new ContratoInvalidoError(`${c}.itens`, 'a venda precisa de ao menos um item');
  itens.forEach((item, i) => {
    if (item.posicao !== i + 1) {
      throw new ContratoInvalidoError(`${c}.itens[${i}].posicao`, `esperada a posição ${i + 1}, recebida ${item.posicao}`);
    }
  });

  const pagamentos = lerLista(d['pagamentos'], `${c}.pagamentos`).map((v, i) => lerPagamento(v, `${c}.pagamentos[${i}]`));
  if (pagamentos.length === 0) {
    throw new ContratoInvalidoError(`${c}.pagamentos`, 'a venda precisa de ao menos um pagamento');
  }

  const brutoCentavos = lerInteiro(d['brutoCentavos'], `${c}.brutoCentavos`, 0);
  const descontoCentavos = lerInteiro(d['descontoCentavos'], `${c}.descontoCentavos`, 0);
  const liquidoCentavos = lerInteiro(d['liquidoCentavos'], `${c}.liquidoCentavos`, 0);
  const trocoCentavos = lerInteiro(d['trocoCentavos'], `${c}.trocoCentavos`, 0);

  // As contas da venda precisam fechar, centavo a centavo.
  const somaItens = somar(itens.map((i) => i.quantidade * i.precoUnitarioCentavos));
  if (brutoCentavos !== somaItens) {
    throw new ContratoInvalidoError(`${c}.brutoCentavos`, `${brutoCentavos} não bate com a soma dos itens (${somaItens})`);
  }
  const descontoItens = somar(itens.map((i) => i.descontoCentavos));
  if (descontoCentavos < descontoItens || descontoCentavos > brutoCentavos) {
    throw new ContratoInvalidoError(
      `${c}.descontoCentavos`,
      `deve ficar entre o desconto dos itens (${descontoItens}) e o bruto (${brutoCentavos})`,
    );
  }
  if (liquidoCentavos !== brutoCentavos - descontoCentavos) {
    throw new ContratoInvalidoError(`${c}.liquidoCentavos`, `deve ser bruto − desconto (${brutoCentavos - descontoCentavos})`);
  }
  const pago = somar(pagamentos.map((p) => p.valorCentavos));
  if (pago - trocoCentavos !== liquidoCentavos) {
    throw new ContratoInvalidoError(
      `${c}.pagamentos`,
      `pagamentos (${pago}) − troco (${trocoCentavos}) devem ser iguais ao líquido (${liquidoCentavos})`,
    );
  }
  const emDinheiro = somar(pagamentos.filter((p) => p.forma === 'dinheiro').map((p) => p.valorCentavos));
  if (trocoCentavos > 0 && trocoCentavos >= emDinheiro) {
    throw new ContratoInvalidoError(`${c}.trocoCentavos`, 'só há troco de pagamento em dinheiro, e menor que o valor em dinheiro');
  }

  return {
    vendaId,
    codigo,
    numero,
    lojaId: lerUuid(d['lojaId'], `${c}.lojaId`),
    sessaoId: lerUuid(d['sessaoId'], `${c}.sessaoId`),
    itens,
    pagamentos,
    brutoCentavos,
    descontoCentavos,
    liquidoCentavos,
    trocoCentavos,
    documentoCliente: ouNull(d['documentoCliente'], `${c}.documentoCliente`, lerDocumento),
  };
}

export function lerVendaCancelada(dados: unknown, c = 'dados'): VendaCancelada {
  const d = lerObjeto(dados, c);
  semChavesExtras(d, c, ['vendaId', 'motivo', 'autorizadoPor']);
  return {
    vendaId: lerUuid(d['vendaId'], `${c}.vendaId`),
    motivo: lerTexto(d['motivo'], `${c}.motivo`),
    autorizadoPor: lerTexto(d['autorizadoPor'], `${c}.autorizadoPor`),
  };
}
