// Caixa do PDV. A regra de venda e de estoque é a do LAB (LabVendas e
// gravarMovimentacao), sem cópia: cada venda grava venda, itens, baixa de estoque e
// evento na outbox numa transação só (ADR 001), e o Sync Engine do LAB envia.
// Este módulo acrescenta o que é do caixa, no banco próprio dele (pdv.db):
// sessão (abertura, sangria, suprimento, fechamento), pagamento misto, desconto,
// documento do cliente, cancelamento por estorno, EAN e idempotência.
//
// Desconto: a nuvem recalcula o total da venda pela soma dos itens a preço de
// cadastro, então a venda (vendas.db) guarda o BRUTO; desconto e LÍQUIDO ficam no
// caixa, como "vendas brutas - descontos = vendas líquidas" na contabilidade.
// Cancelamento: a venda não se apaga; o estoque volta por movimentação ESTORNO
// (sincronizada) e o caixa marca a venda como cancelada.
import { createHash } from 'node:crypto';
import { gerarId } from '../dist/compartilhado/id.js';
import { DadosInvalidosError } from '../dist/vendas/erros.js';
import { gravarMovimentacao } from '../dist/vendas/estoque.js';
import { LabVendas } from '../dist/vendas/lab-vendas.js';
import { documentoDoCliente, dvEan13, mascararDocumento } from '../comum/documentos.js';
import { conferePin, migrarHistoricoJsonl, prepararBancoCaixa } from './banco-caixa.js';

/** Quantos eventos para trás procurar o evento de uma venda recém-gravada (seq é a chave primária). */
const JANELA_SEQ = 5000;
const PADRAO_CHAVE = /^[A-Za-z0-9-]{8,64}$/;
const PADRAO_CODIGO = /^(CX\d{2})-(\d{6,9})-([0-9A-F]{4})$/;
/** Desconto acima disto (fração do bruto) exige o PIN do supervisor. */
export const LIMITE_DESCONTO = 0.1;
export const FORMAS_PAGAMENTO = Object.freeze({ dinheiro: 'Dinheiro', debito: 'Débito', credito: 'Crédito', pix: 'Pix' });

/** Catálogo de demonstração. Café, Açúcar e Leite são os mesmos do gerador do LAB. */
export const CATALOGO_DEMO = Object.freeze([
  { nome: 'Café', precoCentavos: 1_890 },
  { nome: 'Açúcar', precoCentavos: 549 },
  { nome: 'Leite', precoCentavos: 499 },
  { nome: 'Pão de forma', precoCentavos: 899 },
  { nome: 'Arroz 5 kg', precoCentavos: 2_790 },
  { nome: 'Feijão 1 kg', precoCentavos: 849 },
  { nome: 'Óleo de soja', precoCentavos: 799 },
  { nome: 'Macarrão', precoCentavos: 479 },
  { nome: 'Biscoito', precoCentavos: 399 },
  { nome: 'Refrigerante 2 L', precoCentavos: 999 },
  { nome: 'Água 1,5 L', precoCentavos: 349 },
  { nome: 'Sabão em pó', precoCentavos: 1_590 },
]);
const ESTOQUE_INICIAL_DEMO = 60;

/** Caixa fechado: nada de venda, sangria ou suprimento. */
export class CaixaFechadoError extends Error {
  name = 'CaixaFechadoError';
  constructor(mensagem = 'Caixa fechado: abra o caixa para vender.') { super(mensagem); }
}
/** A operação exige o PIN do supervisor e ele não veio ou não confere. */
export class AutorizacaoNegadaError extends Error {
  name = 'AutorizacaoNegadaError';
}

const reais = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const inteiro = (v, campo, minimo = 0) => {
  if (!Number.isSafeInteger(v) || v < minimo) throw new DadosInvalidosError(`${campo}: informe um inteiro em centavos a partir de ${minimo}`);
  return v;
};
const texto = (v, campo, max = 200) => {
  const t = typeof v === 'string' ? v.trim() : '';
  if (t.length < 3 || t.length > max) throw new DadosInvalidosError(`${campo}: informe de 3 a ${max} caracteres`);
  return t;
};

/** Sigla do caixa no código da venda: "Caixa 01" -> "CX01". */
export function siglaDoCaixa(nome) {
  const digitos = String(nome).replace(/\D/g, '').slice(-2);
  return `CX${(digitos || '1').padStart(2, '0')}`;
}

/**
 * Código da venda para o cliente e para a conferência no Dashboard:
 * CX01-015855-7F3A = caixa, número da venda na loja e 4 caracteres do id da venda.
 * Os 4 caracteres impedem que um número digitado errado (ou inventado) valide outra venda.
 */
export function codigoDaVenda(sigla, numero, vendaId) {
  return `${sigla}-${String(numero).padStart(6, '0')}-${vendaId.replace(/-/g, '').slice(-4).toUpperCase()}`;
}

/** EAN-13 estável para um produto sem código de barras: prefixo 789 (Brasil) + hash do id. */
export function eanSugerido(produtoId, tentativa = 0) {
  const h = createHash('sha256').update(`${produtoId}:${tentativa}`).digest();
  const corpo = String(h.readUInt32BE(0) % 1_000_000_000).padStart(9, '0');
  const base = `789${corpo}`;
  return base + dvEan13(base);
}

export class CaixaPdv {
  #loja;
  #caixa;
  #lab;
  #ctx;
  #relogio;
  nome;
  sigla;

  /**
   * @param bancoLoja BancoSqlite do vendas.db (o mesmo do LAB)
   * @param opcoes.bancoCaixa BancoSqlite do pdv.db (obrigatório)
   * @param opcoes.arquivoLegado histórico .jsonl da versão anterior, migrado uma vez
   */
  constructor(bancoLoja, opcoes = {}) {
    if (!opcoes.bancoCaixa) throw new TypeError('bancoCaixa é obrigatório');
    this.#loja = bancoLoja;
    this.#caixa = opcoes.bancoCaixa;
    this.#relogio = opcoes.relogio ?? (() => new Date());
    this.#lab = new LabVendas(bancoLoja, { relogio: this.#relogio });
    this.#ctx = { banco: bancoLoja, outbox: this.#lab.outbox, relogio: this.#relogio };
    this.nome = opcoes.nome ?? 'Caixa 01';
    this.sigla = siglaDoCaixa(this.nome);
    prepararBancoCaixa(this.#caixa);
    migrarHistoricoJsonl(this.#caixa, bancoLoja, opcoes.arquivoLegado, this.nome);
    this.#recuperarCancelamentos();
  }

  get origemId() {
    return this.#lab.outbox.origemId;
  }

  // ================================================================ sessão de caixa
  sessaoAtual() {
    const s = this.#caixa.consultarUma('SELECT * FROM sessoes WHERE caixa = ? AND fechada_em IS NULL', this.nome);
    if (s === undefined) return null;
    const r = this.relatorio(String(s['id']));
    return { id: r.sessaoId, operador: r.operador, abertaEm: r.abertaEm, fundoCentavos: r.fundoCentavos, dinheiroEmCaixaCentavos: r.dinheiroEsperadoCentavos, vendas: r.vendas, liquidoCentavos: r.liquidoCentavos };
  }

  abrirCaixa(operador, fundoCentavos) {
    const nome = texto(operador, 'operador', 60);
    inteiro(fundoCentavos, 'fundo de troco');
    if (this.sessaoAtual() !== null) throw new DadosInvalidosError('O caixa já está aberto.');
    this.#caixa.rodar('INSERT INTO sessoes (id, caixa, operador, aberta_em, fundo_centavos) VALUES (?, ?, ?, ?, ?)',
      gerarId(), this.nome, nome, this.#agora(), fundoCentavos);
    return this.sessaoAtual();
  }

  /** Sangria: retirada de dinheiro da gaveta (ex.: levar ao cofre). Não pode passar do que há em dinheiro. */
  sangria(valorCentavos, motivo) {
    return this.#movimento('SANGRIA', valorCentavos, motivo);
  }

  /** Suprimento: reforço de dinheiro para troco. */
  suprimento(valorCentavos, motivo) {
    return this.#movimento('SUPRIMENTO', valorCentavos, motivo);
  }

  #movimento(tipo, valorCentavos, motivo) {
    const sessao = this.#exigirSessao();
    inteiro(valorCentavos, 'valor', 1);
    const m = texto(motivo, 'motivo');
    if (tipo === 'SANGRIA' && valorCentavos > sessao.dinheiroEmCaixaCentavos) {
      throw new DadosInvalidosError(`Sangria de ${reais(valorCentavos)} maior que o dinheiro no caixa (${reais(sessao.dinheiroEmCaixaCentavos)}).`);
    }
    this.#caixa.rodar('INSERT INTO movimentos (id, sessao_id, tipo, valor_centavos, motivo, operador, em) VALUES (?, ?, ?, ?, ?, ?, ?)',
      gerarId(), sessao.id, tipo, valorCentavos, m, sessao.operador, this.#agora());
    return this.sessaoAtual();
  }

  /** Fecha o caixa com o dinheiro contado na gaveta; a diferença é a quebra de caixa. */
  fecharCaixa(contadoCentavos) {
    const sessao = this.#exigirSessao();
    inteiro(contadoCentavos, 'valor contado');
    const r = this.relatorio(sessao.id);
    const final = { ...r, contadoCentavos, diferencaCentavos: contadoCentavos - r.dinheiroEsperadoCentavos, fechadaEm: this.#agora() };
    this.#caixa.rodar('UPDATE sessoes SET fechada_em = ?, contado_centavos = ?, esperado_centavos = ?, relatorio = ? WHERE id = ?',
      final.fechadaEm, contadoCentavos, r.dinheiroEsperadoCentavos, JSON.stringify(final), sessao.id);
    return final;
  }

  /** Relatório da sessão (o "fechamento de caixa"): totais por forma, descontos, cancelamentos, gaveta. */
  relatorio(sessaoId) {
    const s = this.#caixa.consultarUma('SELECT * FROM sessoes WHERE id = ?', sessaoId);
    if (s === undefined) throw new DadosInvalidosError('sessão de caixa não encontrada');
    if (s['relatorio'] != null) return JSON.parse(String(s['relatorio']));
    const vendas = this.#caixa.consultar('SELECT * FROM vendas_caixa WHERE sessao_id = ?', sessaoId).map(lerVendaCaixa);
    const validas = vendas.filter((v) => v.canceladaEm === null);
    const canceladas = vendas.filter((v) => v.canceladaEm !== null);
    const porForma = Object.fromEntries(Object.keys(FORMAS_PAGAMENTO).map((f) => [f, 0]));
    for (const v of validas) {
      for (const p of v.pagamentos) porForma[p.forma] += p.valorCentavos;
      porForma.dinheiro -= v.trocoCentavos; // o troco sai do dinheiro recebido
    }
    const movs = this.#caixa.consultar('SELECT tipo, valor_centavos, motivo, em FROM movimentos WHERE sessao_id = ? ORDER BY em', sessaoId);
    const somar = (tipo) => movs.filter((m) => m['tipo'] === tipo).reduce((a, m) => a + Number(m['valor_centavos']), 0);
    const sangrias = somar('SANGRIA');
    const suprimentos = somar('SUPRIMENTO');
    const fundo = Number(s['fundo_centavos']);
    const liquido = validas.reduce((a, v) => a + v.liquidoCentavos, 0);
    return {
      sessaoId: String(s['id']),
      caixa: String(s['caixa']),
      operador: String(s['operador']),
      abertaEm: String(s['aberta_em']),
      fundoCentavos: fundo,
      vendas: validas.length,
      brutoCentavos: validas.reduce((a, v) => a + v.brutoCentavos, 0),
      descontoCentavos: validas.reduce((a, v) => a + v.descontoCentavos, 0),
      liquidoCentavos: liquido,
      ticketMedioCentavos: validas.length ? Math.round(liquido / validas.length) : 0,
      porForma,
      canceladas: { quantidade: canceladas.length, valorCentavos: canceladas.reduce((a, v) => a + v.liquidoCentavos, 0) },
      sangriasCentavos: sangrias,
      suprimentosCentavos: suprimentos,
      movimentos: movs.map((m) => ({ tipo: String(m['tipo']), valorCentavos: Number(m['valor_centavos']), motivo: String(m['motivo']), em: String(m['em']) })),
      dinheiroEsperadoCentavos: fundo + porForma.dinheiro + suprimentos - sangrias,
    };
  }

  /** Sessões fechadas mais recentes (para reimprimir o fechamento). */
  sessoesFechadas(limite = 10) {
    return this.#caixa.consultar('SELECT relatorio FROM sessoes WHERE caixa = ? AND fechada_em IS NOT NULL ORDER BY fechada_em DESC LIMIT ?', this.nome, limite)
      .map((l) => JSON.parse(String(l['relatorio'])));
  }

  // ================================================================ catálogo
  /** Produtos com saldo atual (soma das movimentações, ADR 003) e EAN-13. */
  catalogo() {
    const eans = new Map(this.#caixa.consultar('SELECT produto_id, ean FROM eans').map((l) => [String(l['produto_id']), String(l['ean'])]));
    return this.#lab.produtos().map((p, i) => ({
      id: p.id,
      codigo: String(i + 1).padStart(3, '0'),
      ean: eans.get(p.id) ?? this.#criarEan(p.id),
      nome: p.nome,
      precoCentavos: p.precoCentavos,
      saldo: this.#lab.saldo(p.id),
    }));
  }

  #criarEan(produtoId) {
    for (let t = 0; t < 20; t++) {
      if (this.#caixa.rodar('INSERT OR IGNORE INTO eans (produto_id, ean) VALUES (?, ?)', produtoId, eanSugerido(produtoId, t)) === 1) break;
      const ja = this.#caixa.consultarUma('SELECT ean FROM eans WHERE produto_id = ?', produtoId);
      if (ja) break;
    }
    const linha = this.#caixa.consultarUma('SELECT ean FROM eans WHERE produto_id = ?', produtoId);
    if (!linha) throw new Error('não foi possível gerar um EAN único');
    return String(linha['ean']);
  }

  repor(produtoId, quantidade) {
    this.#lab.registrarEntrada(produtoId, quantidade, `reposição pelo PDV (${this.nome})`);
    return this.#lab.saldo(produtoId);
  }

  cadastrarDemo() {
    return this.#loja.transacao(() => {
      const existentes = new Set(this.#lab.produtos().map((p) => p.nome));
      let criados = 0;
      for (const novo of CATALOGO_DEMO) {
        if (existentes.has(novo.nome)) continue;
        const produto = this.#lab.criarProduto(novo);
        this.#lab.registrarEntrada(produto.id, ESTOQUE_INICIAL_DEMO, 'estoque inicial do PDV');
        criados += 1;
      }
      return criados;
    });
  }

  // ================================================================ venda
  /**
   * Registra a venda. A mesma chave devolve a mesma venda (clique duplo, nova
   * tentativa depois de uma resposta perdida), sem gravar outra.
   * O preço vem do cadastro: do pedido só se usam produto, quantidade e desconto.
   *
   * @param itens [{ produtoId, quantidade, descontoCentavos? }]
   * @param opcoes { pagamentos: [{ forma, valorCentavos }], descontoCentavos?, documento?, pin? }
   */
  registrarVenda(chave, itens, opcoes = {}) {
    if (typeof chave !== 'string' || !PADRAO_CHAVE.test(chave)) {
      throw new DadosInvalidosError('chave: informe a chave de idempotência da venda (8 a 64 letras, números ou hífen)');
    }
    const repetida = this.#caixa.consultarUma('SELECT * FROM vendas_caixa WHERE chave = ?', chave);
    if (repetida !== undefined) return { cupom: this.#cupom(lerVendaCaixa(repetida)), repetida: true };
    const sessao = this.#exigirSessao();
    if (!Array.isArray(itens) || itens.length === 0) throw new DadosInvalidosError('itens: informe ao menos um item');
    const pedido = itens.map((item) => ({ produtoId: item?.produtoId, quantidade: item?.quantidade }));
    const descontosItens = itens.map((item, i) => inteiro(item?.descontoCentavos ?? 0, `itens[${i}].descontoCentavos`));
    const descontoVenda = inteiro(opcoes.descontoCentavos ?? 0, 'descontoCentavos');
    let documento;
    try { documento = documentoDoCliente(opcoes.documento); } catch (erro) { throw new DadosInvalidosError(erro.message); }
    const pagamentos = lerPagamentos(opcoes.pagamentos);

    // Venda, conferência de desconto e pagamento e localização do evento numa transação
    // só do banco da loja (a interna vira SAVEPOINT): qualquer recusa desfaz tudo.
    const r = this.#loja.transacao(() => {
      const venda = this.#lab.registrarVenda(pedido);
      const bruto = venda.totalCentavos;
      venda.itens.forEach((item, i) => {
        if (descontosItens[i] > item.quantidade * item.precoUnitarioCentavos) {
          throw new DadosInvalidosError(`Desconto do item ${i + 1} maior que o valor do item.`);
        }
      });
      const descItens = descontosItens.reduce((a, d) => a + d, 0);
      if (descItens + descontoVenda > bruto) throw new DadosInvalidosError('Desconto maior que o valor da venda.');
      const desconto = descItens + descontoVenda;
      if (desconto > bruto * LIMITE_DESCONTO && !conferePin(this.#caixa, opcoes.pin)) {
        throw new AutorizacaoNegadaError(`Desconto de ${reais(desconto)} passa de ${LIMITE_DESCONTO * 100}%: exige o PIN do supervisor.`);
      }
      const liquido = bruto - desconto;
      const troco = conferirPagamento(pagamentos, liquido);
      return { venda, bruto, desconto, liquido, troco, seq: this.#seqDoEvento(venda.id) };
    });

    const nomes = new Map(this.#lab.produtos().map((p) => [p.id, p.nome]));
    const v = r.venda;
    const registro = {
      chave,
      vendaId: v.id,
      numero: v.numero,
      codigo: codigoDaVenda(this.sigla, v.numero, v.id),
      sessaoId: sessao.id,
      caixa: this.nome,
      operador: sessao.operador,
      brutoCentavos: r.bruto,
      descontoCentavos: r.desconto,
      liquidoCentavos: r.liquido,
      pagamentos,
      trocoCentavos: r.troco,
      documento,
      itens: v.itens.map((i, n) => ({
        produtoId: i.produtoId,
        nome: nomes.get(i.produtoId) ?? i.produtoId,
        quantidade: i.quantidade,
        precoUnitarioCentavos: i.precoUnitarioCentavos,
        descontoCentavos: descontosItens[n],
      })),
      seq: r.seq,
      ocorridoEm: v.ocorridoEm,
      canceladaEm: null,
      cancelamento: null,
    };
    // A venda já está no banco da loja (commit acima); o registro do caixa vem depois.
    this.#caixa.rodar(
      `INSERT INTO vendas_caixa (chave, venda_id, numero, codigo, sessao_id, caixa, operador, bruto_centavos, desconto_centavos,
         liquido_centavos, pagamentos, troco_centavos, documento, itens, seq, ocorrido_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      registro.chave, registro.vendaId, registro.numero, registro.codigo, registro.sessaoId, registro.caixa, registro.operador,
      registro.brutoCentavos, registro.descontoCentavos, registro.liquidoCentavos, JSON.stringify(pagamentos), registro.trocoCentavos,
      documento, JSON.stringify(registro.itens), registro.seq, registro.ocorridoEm,
    );
    return { cupom: this.#cupom(registro), repetida: false };
  }

  // ================================================================ cancelamento (estorno)
  /**
   * Cancela uma venda deste caixa, da sessão aberta, com motivo e PIN do supervisor.
   * O estoque volta por movimentação ESTORNO (sincronizada com a nuvem); a venda
   * continua existindo, marcada como cancelada no caixa. Repetir devolve o mesmo.
   */
  cancelarVenda(codigoTexto, motivo, pin) {
    const codigo = String(codigoTexto ?? '').trim().toUpperCase();
    const linha = this.#caixa.consultarUma('SELECT * FROM vendas_caixa WHERE codigo = ?', codigo);
    if (linha === undefined) throw new DadosInvalidosError(`A venda ${codigo || '(sem código)'} não é deste caixa.`);
    const reg = lerVendaCaixa(linha);
    if (reg.canceladaEm !== null) return { cupom: this.#cupom(reg), repetida: true };
    const sessao = this.#exigirSessao();
    if (reg.sessaoId !== sessao.id) throw new DadosInvalidosError('No PDV só se cancelam vendas da sessão de caixa aberta. Vendas antigas: pelo ERP (devolução).');
    const m = texto(motivo, 'motivo');
    if (!conferePin(this.#caixa, pin)) throw new AutorizacaoNegadaError('PIN do supervisor não confere.');

    const movimentacoes = this.#loja.transacao(() => reg.itens.map((i) => gravarMovimentacao(this.#ctx, {
      produtoId: i.produtoId, tipo: 'ESTORNO', quantidade: i.quantidade, vendaId: null, motivo: motivoEstorno(codigo, m),
    }).id));
    const cancelamento = { motivo: m, operador: sessao.operador, autorizadoPor: 'supervisor (PIN)', movimentacoes, reembolso: reembolso(reg) };
    this.#caixa.rodar('UPDATE vendas_caixa SET cancelada_em = ?, cancelamento = ? WHERE chave = ?', this.#agora(), JSON.stringify(cancelamento), reg.chave);
    return { cupom: this.#cupom(lerVendaCaixa(this.#caixa.consultarUma('SELECT * FROM vendas_caixa WHERE chave = ?', reg.chave))), repetida: false };
  }

  /**
   * Queda entre o estorno (vendas.db) e a marcação no caixa (pdv.db): na próxima
   * abertura, uma venda da sessão aberta com ESTORNO no banco da loja é marcada.
   */
  #recuperarCancelamentos() {
    const sessao = this.#caixa.consultarUma('SELECT id FROM sessoes WHERE caixa = ? AND fechada_em IS NULL', this.nome);
    if (sessao === undefined) return;
    for (const l of this.#caixa.consultar('SELECT * FROM vendas_caixa WHERE sessao_id = ? AND cancelada_em IS NULL', sessao['id'])) {
      const reg = lerVendaCaixa(l);
      const movs = this.#loja.consultar("SELECT id, motivo FROM movimentacoes WHERE tipo = 'ESTORNO' AND motivo LIKE ?", `estorno da venda ${reg.codigo}:%`);
      if (movs.length === 0) continue;
      const cancelamento = { motivo: String(movs[0]['motivo']).split(': ').slice(1).join(': ') || 'recuperado', operador: reg.operador, autorizadoPor: 'recuperado na abertura', movimentacoes: movs.map((x) => String(x['id'])), reembolso: reembolso(reg) };
      this.#caixa.rodar('UPDATE vendas_caixa SET cancelada_em = ?, cancelamento = ? WHERE chave = ?', this.#agora(), JSON.stringify(cancelamento), reg.chave);
    }
  }

  // ================================================================ consultas
  ultimasVendas(limite = 12) {
    const linhas = this.#caixa.consultar('SELECT * FROM vendas_caixa WHERE caixa = ? ORDER BY numero DESC LIMIT ?', this.nome, limite).map(lerVendaCaixa);
    const situacao = this.#situacoes(linhas.map((v) => v.seq));
    return linhas.map((v) => this.#cupom(v, situacao));
  }

  cupom(vendaId) {
    const l = this.#caixa.consultarUma('SELECT * FROM vendas_caixa WHERE venda_id = ?', vendaId);
    return l === undefined ? null : this.#cupom(lerVendaCaixa(l));
  }

  /**
   * Confere uma venda pelo código: existe na loja, os 4 caracteres batem com o id,
   * e em que pé está. Vale para qualquer venda da loja; os dados do caixa (pagamento,
   * desconto, cancelamento) aparecem quando a venda é deste caixa.
   */
  consultarCodigo(textoCodigo) {
    const codigo = String(textoCodigo ?? '').trim().toUpperCase();
    const m = PADRAO_CODIGO.exec(codigo);
    if (m === null) return { valida: false, codigo, motivo: 'Formato inválido. Use CX01-000123-ABCD.' };
    const numero = Number(m[2]);
    const linha = this.#loja.consultarUma('SELECT id, numero, total_centavos, ocorrido_em FROM vendas WHERE numero = ?', numero);
    if (linha === undefined) return { valida: false, codigo, motivo: `Não existe venda nº ${numero} nesta loja.` };
    const vendaId = String(linha['id']);
    if (codigoDaVenda(m[1], numero, vendaId) !== codigo) {
      return { valida: false, codigo, motivo: 'Os 4 caracteres de conferência não batem com a venda: código errado ou adulterado.' };
    }
    const evento = this.#loja.consultarUma(
      "SELECT seq, sincronizado_em FROM outbox WHERE tipo = 'venda.registrada' AND json_extract(dados, '$.vendaId') = ?", vendaId);
    const base = {
      valida: true,
      codigo,
      vendaId,
      numero,
      ocorridoEm: String(linha['ocorrido_em']),
      seq: evento === undefined ? null : Number(evento['seq']),
      situacao: evento?.['sincronizado_em'] == null ? 'pendente' : 'nuvem',
      sincronizadoEm: evento?.['sincronizado_em'] == null ? null : String(evento['sincronizado_em']),
    };
    const doCaixa = this.#caixa.consultarUma('SELECT * FROM vendas_caixa WHERE venda_id = ?', vendaId);
    if (doCaixa !== undefined) {
      const c = this.#cupom(lerVendaCaixa(doCaixa));
      return { ...c, ...base, origem: `PDV · ${c.caixa}${c.operador ? ` · ${c.operador}` : ''}` };
    }
    const itens = this.#loja.consultar(
      `SELECT i.quantidade, i.preco_unitario_centavos, p.nome FROM itens_venda i
       JOIN produtos p ON p.id = i.produto_id WHERE i.venda_id = ? ORDER BY i.posicao`, vendaId,
    ).map((l) => ({ nome: String(l['nome']), quantidade: Number(l['quantidade']), precoUnitarioCentavos: Number(l['preco_unitario_centavos']), descontoCentavos: 0 }));
    const total = Number(linha['total_centavos']);
    return { ...base, itens, brutoCentavos: total, descontoCentavos: 0, totalCentavos: total, pagamentos: null, trocoCentavos: 0, documento: null, cancelada: null, caixa: null, operador: null, origem: 'outra origem da loja (gerador do LAB ou outro caixa)' };
  }

  fila() {
    return this.#lab.outbox.contarPendentes();
  }

  resumo() {
    const sessao = this.sessaoAtual();
    const ultima = this.#caixa.consultarUma('SELECT * FROM vendas_caixa WHERE caixa = ? ORDER BY numero DESC LIMIT 1', this.nome);
    const u = ultima === undefined ? null : lerVendaCaixa(ultima);
    return {
      caixa: this.nome,
      sigla: this.sigla,
      sessao,
      vendas: sessao?.vendas ?? 0,
      totalCentavos: sessao?.liquidoCentavos ?? 0,
      ultima: u === null ? null : { numero: u.numero, codigo: u.codigo, ocorridoEm: u.ocorridoEm, totalCentavos: u.liquidoCentavos, cancelada: u.canceladaEm !== null },
    };
  }

  // ================================================================ interno
  #exigirSessao() {
    const s = this.sessaoAtual();
    if (s === null) throw new CaixaFechadoError();
    return s;
  }

  #agora() {
    return this.#relogio().toISOString();
  }

  #seqDoEvento(vendaId) {
    const linha = this.#loja.consultarUma(
      `SELECT seq FROM outbox
       WHERE seq > (SELECT COALESCE(MAX(seq), 0) FROM outbox) - ?
         AND tipo = 'venda.registrada' AND json_extract(dados, '$.vendaId') = ?
       ORDER BY seq DESC LIMIT 1`, JANELA_SEQ, vendaId);
    return linha === undefined ? null : Number(linha['seq']);
  }

  #situacoes(seqs) {
    const validas = seqs.filter((s) => Number.isSafeInteger(s));
    const mapa = new Map();
    if (validas.length === 0) return mapa;
    const linhas = this.#loja.consultar(`SELECT seq, sincronizado_em FROM outbox WHERE seq IN (${validas.map(() => '?').join(', ')})`, ...validas);
    for (const l of linhas) mapa.set(Number(l['seq']), l['sincronizado_em'] == null ? null : String(l['sincronizado_em']));
    return mapa;
  }

  #cupom(r, situacao = this.#situacoes([r.seq])) {
    const sincronizadoEm = situacao.get(r.seq) ?? null;
    return {
      vendaId: r.vendaId,
      numero: r.numero,
      codigo: r.codigo,
      caixa: r.caixa,
      operador: r.operador,
      ocorridoEm: r.ocorridoEm,
      itens: r.itens,
      brutoCentavos: r.brutoCentavos,
      descontoCentavos: r.descontoCentavos,
      totalCentavos: r.liquidoCentavos,
      pagamentos: r.pagamentos,
      trocoCentavos: r.trocoCentavos,
      documento: mascararDocumento(r.documento),
      seq: r.seq,
      situacao: sincronizadoEm === null ? 'pendente' : 'nuvem',
      sincronizadoEm,
      cancelada: r.canceladaEm === null ? null : { em: r.canceladaEm, motivo: r.cancelamento?.motivo ?? null, reembolso: r.cancelamento?.reembolso ?? null },
    };
  }
}

// ---------------------------------------------------------------- funções puras
function lerVendaCaixa(l) {
  return {
    chave: String(l['chave']),
    vendaId: String(l['venda_id']),
    numero: Number(l['numero']),
    codigo: String(l['codigo']),
    sessaoId: l['sessao_id'] == null ? null : String(l['sessao_id']),
    caixa: String(l['caixa']),
    operador: l['operador'] == null ? null : String(l['operador']),
    brutoCentavos: Number(l['bruto_centavos']),
    descontoCentavos: Number(l['desconto_centavos']),
    liquidoCentavos: Number(l['liquido_centavos']),
    pagamentos: JSON.parse(String(l['pagamentos'])),
    trocoCentavos: Number(l['troco_centavos']),
    documento: l['documento'] == null ? null : String(l['documento']),
    itens: JSON.parse(String(l['itens'])),
    seq: l['seq'] == null ? null : Number(l['seq']),
    ocorridoEm: String(l['ocorrido_em']),
    canceladaEm: l['cancelada_em'] == null ? null : String(l['cancelada_em']),
    cancelamento: l['cancelamento'] == null ? null : JSON.parse(String(l['cancelamento'])),
  };
}

function lerPagamentos(lista) {
  if (lista === undefined || lista === null) return [];
  if (!Array.isArray(lista) || lista.length > 4) throw new DadosInvalidosError('pagamentos: informe de 1 a 4 formas de pagamento');
  return lista.map((p, i) => {
    if (!Object.hasOwn(FORMAS_PAGAMENTO, p?.forma)) throw new DadosInvalidosError(`pagamentos[${i}].forma: use ${Object.keys(FORMAS_PAGAMENTO).join(', ')}`);
    return { forma: p.forma, valorCentavos: inteiro(p.valorCentavos, `pagamentos[${i}].valorCentavos`, 1) };
  });
}

/**
 * Regras do pagamento misto: cartão e Pix não passam do total (não há troco em cartão);
 * a soma cobre o total; o troco, se houver, sai do dinheiro. Devolve o troco.
 */
function conferirPagamento(pagamentos, liquido) {
  const naoDinheiro = pagamentos.filter((p) => p.forma !== 'dinheiro').reduce((a, p) => a + p.valorCentavos, 0);
  const dinheiro = pagamentos.filter((p) => p.forma === 'dinheiro').reduce((a, p) => a + p.valorCentavos, 0);
  if (naoDinheiro > liquido) throw new DadosInvalidosError(`Cartão e Pix (${reais(naoDinheiro)}) passam do total (${reais(liquido)}): troco só em dinheiro.`);
  const pago = naoDinheiro + dinheiro;
  if (pago < liquido) throw new DadosInvalidosError(`Pagamento incompleto: faltam ${reais(liquido - pago)}. Nada foi gravado.`);
  return pago - liquido;
}

/** O que volta ao cliente num cancelamento: o que ele pagou, com o dinheiro já sem o troco. */
function reembolso(reg) {
  const porForma = {};
  for (const p of reg.pagamentos) porForma[p.forma] = (porForma[p.forma] ?? 0) + p.valorCentavos;
  if (porForma.dinheiro !== undefined) porForma.dinheiro -= reg.trocoCentavos;
  return porForma;
}

const motivoEstorno = (codigo, motivo) => `estorno da venda ${codigo}: ${motivo}`;
