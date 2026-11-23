// Comprovante da venda, em HTML pronto para imprimir em bobina de 58 ou 80 mm (ou ver na tela).
//
// Não é cupom fiscal (NFC-e fica fora do MVP: PENDENCIAS.md, ponto 4). É o comprovante do Continuum,
// com o código da venda, que o ERP valida (UC19).
// Sem cores: papel térmico só imprime preto. A largura da bobina vem dos parâmetros do cliente.
import { formatarReais, mascararDocumento } from '@continuum/dominio';
import type { FormaPagamento, Venda } from '@continuum/dominio';

export type LarguraBobina = 58 | 80;

/** Cabeçalho e rodapé do comprovante, configurados no ERP (desce com os parâmetros). */
export interface ConfiguracaoComprovante {
  cabecalho: string[];
  rodape: string;
  largura: LarguraBobina;
}

export const COMPROVANTE_PADRAO: ConfiguracaoComprovante = {
  cabecalho: ['Continuum PDV'],
  rodape: 'Obrigado pela preferência!',
  largura: 80,
};

export interface DadosDoComprovante {
  venda: Venda;
  nomes: ReadonlyMap<string, string>;
  ocorridoEm: string;
  operador: string;
  numeroCaixa: number;
  cancelada: boolean;
  reimpressao: boolean;
}

const FORMAS: Record<FormaPagamento, string> = { dinheiro: 'Dinheiro', debito: 'Débito', credito: 'Crédito', pix: 'Pix' };

/** Escapa o texto para HTML (nome de produto com "<" não vira código). */
function esc(texto: string): string {
  return texto.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

/** Data e hora no horário de Brasília, como no papel: 21/11/2026 14:35. */
function dataHora(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(iso));
}

const linha = (esquerda: string, direita: string, classe = '') =>
  `<div class="l ${classe}"><span>${esc(esquerda)}</span><span>${esc(direita)}</span></div>`;

/** Monta a página do comprovante. `imprimir` abre a janela de impressão ao carregar. */
export function comprovanteHtml(d: DadosDoComprovante, config: ConfiguracaoComprovante, imprimir = false): string {
  const { venda } = d;
  const itens = venda.itens
    .map((i) => {
      const nome = d.nomes.get(i.produtoId) ?? 'Produto';
      const total = i.quantidade * i.precoUnitarioCentavos;
      const desconto = i.descontoCentavos > 0 ? linha('  desconto', `-${formatarReais(i.descontoCentavos)}`) : '';
      return `<div class="item"><div>${i.posicao}. ${esc(nome)}</div>${linha(`  ${i.quantidade} x ${formatarReais(i.precoUnitarioCentavos)}`, formatarReais(total))}${desconto}</div>`;
    })
    .join('');
  const pagamentos = venda.pagamentos.map((p) => linha(FORMAS[p.forma], formatarReais(p.valorCentavos))).join('');
  // CPF (11 dígitos) ou CNPJ (14) do consumidor, mascarado: o papel fica com o cliente e pode se perder.
  const tipoDocumento = venda.documentoCliente?.length === 14 ? 'CNPJ' : 'CPF';
  const documento =
    venda.documentoCliente === null ? '' : `<p>${tipoDocumento} do consumidor: ${esc(mascararDocumento(venda.documentoCliente) ?? '')}</p>`;
  const larguraMm = config.largura === 58 ? 48 : 72; // área útil de impressão de cada bobina

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Comprovante ${esc(venda.codigo)}</title>
<style>
  @page { size: ${config.largura}mm auto; margin: 2mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Consolas, 'Cascadia Mono', monospace; font-size: ${config.largura === 58 ? 10 : 12}px; line-height: 1.35; }
  .papel { width: ${larguraMm}mm; margin: 0 auto; padding: 2mm 0; }
  .centro { text-align: center; }
  .forte { font-weight: 700; }
  .grande { font-size: 1.4em; }
  .l { display: flex; justify-content: space-between; gap: 2mm; }
  .l span:first-child { white-space: pre; overflow: hidden; text-overflow: ellipsis; }
  .item { margin-bottom: 1mm; }
  hr { border: 0; border-top: 1px dashed; margin: 2mm 0; }
  p { margin: 0; }
  .aviso { border: 1px solid; padding: 1mm; margin: 2mm 0; text-align: center; font-weight: 700; }
  .botoes { display: flex; gap: 8px; justify-content: center; margin: 16px; font-family: system-ui, sans-serif; }
  .botoes button { min-height: 44px; padding: 0 16px; font: inherit; cursor: pointer; }
  @media print { .botoes { display: none; } }
</style>
</head>
<body>
<div class="botoes">
  <button type="button" onclick="window.print()">Imprimir</button>
  <button type="button" onclick="window.close()">Fechar</button>
</div>
<main class="papel">
  <div class="centro">${config.cabecalho.map((c, i) => `<p class="${i === 0 ? 'forte grande' : ''}">${esc(c)}</p>`).join('')}</div>
  <hr>
  <p class="centro forte">COMPROVANTE DE VENDA</p>
  <p class="centro">Não é documento fiscal</p>
  ${d.reimpressao ? '<p class="aviso">REIMPRESSÃO</p>' : ''}
  ${d.cancelada ? '<p class="aviso">VENDA CANCELADA (ESTORNADA)</p>' : ''}
  <hr>
  ${itens}
  <hr>
  ${linha('Subtotal', formatarReais(venda.brutoCentavos))}
  ${venda.descontoCentavos > 0 ? linha('Desconto', `-${formatarReais(venda.descontoCentavos)}`) : ''}
  ${linha('TOTAL', formatarReais(venda.liquidoCentavos), 'forte grande')}
  <hr>
  ${pagamentos}
  ${venda.trocoCentavos > 0 ? linha('Troco', formatarReais(venda.trocoCentavos), 'forte') : ''}
  <hr>
  ${documento}
  <p>${esc(dataHora(d.ocorridoEm))} · Caixa ${d.numeroCaixa} · ${esc(d.operador)}</p>
  <p class="centro forte grande">${esc(venda.codigo)}</p>
  <p class="centro">Use este código para conferir a venda.</p>
  <hr>
  <p class="centro">${esc(config.rodape)}</p>
</main>
${imprimir ? '<script>window.addEventListener("load", () => window.print());</script>' : ''}
</body>
</html>`;
}
