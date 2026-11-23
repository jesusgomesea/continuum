// Leitura da planilha de produtos para a importação: CSV salvo do Excel (separador ";" ou ","), ou colado
// direto da planilha (separador tabulação). A primeira linha é o cabeçalho; as colunas são reconhecidas
// pelo nome, em qualquer ordem: nome, preço, unidade, código de barras, estoque mínimo, estoque inicial.

export interface LinhaDeProduto {
  linha: number;
  nome: string;
  precoCentavos: number | string;
  unidade: string;
  ean: string;
  estoqueMinimo: number | string;
  estoqueInicial: number | string;
}

const sem = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

const NOMES_DAS_COLUNAS: Record<keyof Omit<LinhaDeProduto, 'linha'>, string[]> = {
  nome: ['nome', 'produto', 'descricao'],
  precoCentavos: ['preco', 'precovenda', 'valor', 'precors', 'precoreais'],
  unidade: ['unidade', 'un', 'und', 'medida'],
  ean: ['ean', 'codigodebarras', 'codigobarras', 'codbarras', 'gtin', 'codigo'],
  estoqueMinimo: ['estoqueminimo', 'minimo', 'min'],
  estoqueInicial: ['estoqueinicial', 'estoque', 'quantidade', 'qtd', 'saldo'],
};

/** "R$ 1.234,56" → 123456; "12.90" → 1290. Devolve o texto original se não for um preço (o servidor recusa com a linha). */
export function lerPrecoDaPlanilha(t: string): number | string {
  const limpo = t.replace(/r\$|\s/gi, '');
  if (limpo === '') return '';
  const numero = limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo;
  if (!/^\d+(\.\d{1,2})?$/.test(numero)) return t;
  return Math.round(Number(numero) * 100);
}

function separarLinha(linha: string, separador: string): string[] {
  const celulas: string[] = [];
  let atual = '';
  let aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    // Aspas só abrem no começo da célula; no meio de uma célula sem aspas, são texto comum.
    if (c === '"' && !aspas && atual.trim() === '') {
      aspas = true;
      atual = '';
    } else if (c === '"' && aspas) {
      if (linha[i + 1] === '"') {
        atual += '"';
        i++;
      } else aspas = false;
    } else if (c === separador && !aspas) {
      celulas.push(atual);
      atual = '';
    } else atual += c;
  }
  celulas.push(atual);
  return celulas.map((x) => x.trim());
}

export function lerPlanilhaDeProdutos(texto: string): { linhas: LinhaDeProduto[]; colunasReconhecidas: string[]; erro: string | null } {
  const todas = texto.replace(/^﻿/, '').split(/\r?\n/);
  const cabecalho = todas[0] ?? '';
  const separador = cabecalho.includes('\t') ? '\t' : cabecalho.split(';').length >= cabecalho.split(',').length ? ';' : ',';
  const titulos = separarLinha(cabecalho, separador).map(sem);
  const indice = {} as Record<keyof typeof NOMES_DAS_COLUNAS, number>;
  for (const [campo, nomes] of Object.entries(NOMES_DAS_COLUNAS) as [keyof typeof NOMES_DAS_COLUNAS, string[]][]) {
    indice[campo] = titulos.findIndex((t) => nomes.includes(t));
  }
  if (indice.nome < 0 || indice.precoCentavos < 0) return { linhas: [], colunasReconhecidas: [], erro: 'A primeira linha precisa ter pelo menos as colunas "nome" e "preço".' };
  const valor = (celulas: string[], campo: keyof typeof NOMES_DAS_COLUNAS) => (indice[campo] < 0 ? '' : (celulas[indice[campo]] ?? ''));
  const linhas: LinhaDeProduto[] = [];
  todas.slice(1).forEach((bruta, i) => {
    if (bruta.trim() === '') return;
    const c = separarLinha(bruta, separador);
    const inteiro = (t: string) => (t === '' ? 0 : /^\d+$/.test(t) ? Number(t) : t);
    linhas.push({
      linha: i + 2,
      nome: valor(c, 'nome'),
      precoCentavos: lerPrecoDaPlanilha(valor(c, 'precoCentavos')),
      unidade: valor(c, 'unidade').toLowerCase() || 'un',
      ean: valor(c, 'ean').replace(/\D/g, ''),
      estoqueMinimo: inteiro(valor(c, 'estoqueMinimo')),
      estoqueInicial: inteiro(valor(c, 'estoqueInicial')),
    });
  });
  const nomes: Record<keyof typeof indice, string> = { nome: 'nome', precoCentavos: 'preço', unidade: 'unidade', ean: 'código de barras', estoqueMinimo: 'estoque mínimo', estoqueInicial: 'estoque inicial' };
  const colunasReconhecidas = (Object.keys(indice) as (keyof typeof indice)[]).filter((k) => indice[k] >= 0).map((k) => nomes[k]);
  return { linhas, colunasReconhecidas, erro: linhas.length === 0 ? 'A planilha não tem produtos abaixo do cabeçalho.' : null };
}

/** Modelo para baixar e preencher. */
export const MODELO_DA_PLANILHA = 'nome;preço;unidade;código de barras;estoque mínimo;estoque inicial\r\nCafé 500 g;18,90;un;7891234567895;10;24\r\nBanana prata;6,99;kg;;5;0\r\n';
