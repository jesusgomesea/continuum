// Caixa do PDV: a regra de negócio é a do LAB (LabVendas), sem cópia.
// Cada venda grava venda, itens, movimentações de estoque e o evento na outbox
// numa transação só (ADR 001); o envio para a nuvem é do Sync Engine do LAB.
// Este módulo só acrescenta o que é do caixa: idempotência por chave, o cupom e
// a situação de cada cupom na fila (pendente ou já na nuvem).
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DadosInvalidosError } from '../dist/vendas/erros.js';
import { LabVendas } from '../dist/vendas/lab-vendas.js';

/** Quantos eventos para trás procurar o evento de uma venda recém-gravada (seq é a chave primária). */
const JANELA_SEQ = 5000;
/** Vendas do caixa guardadas em memória (cupons e idempotência). */
const VENDAS_EM_MEMORIA = 500;
/** Chave de idempotência: UUID ou texto parecido, gerado pelo caixa (navegador). */
const PADRAO_CHAVE = /^[A-Za-z0-9-]{8,64}$/;

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
export const FORMAS_PAGAMENTO = Object.freeze({ dinheiro: 'Dinheiro', cartao: 'Cartão', pix: 'Pix' });

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
const PADRAO_CODIGO = /^(CX\d{2})-(\d{6,9})-([0-9A-F]{4})$/;

const reais = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export class CaixaPdv {
  #banco;
  #lab;
  #arquivo;
  #vendas = []; // registros do caixa, do mais antigo ao mais novo
  #porChave = new Map();
  nome;

  /**
   * @param banco BancoSqlite do banco local da loja (o mesmo vendas.db do LAB)
   * @param opcoes.arquivoCaixa arquivo .jsonl com as vendas deste caixa (null: só memória)
   */
  constructor(banco, opcoes = {}) {
    this.#banco = banco;
    this.#lab = new LabVendas(banco, { relogio: opcoes.relogio });
    this.#arquivo = opcoes.arquivoCaixa ?? null;
    this.nome = opcoes.nome ?? 'Caixa 01';
    this.sigla = siglaDoCaixa(this.nome);
    this.#carregar();
  }

  get origemId() {
    return this.#lab.outbox.origemId;
  }

  /** Produtos com o saldo atual (sempre a soma das movimentações, ADR 003). */
  catalogo() {
    return this.#lab.produtos().map((p, i) => ({
      id: p.id,
      codigo: String(i + 1).padStart(3, '0'),
      nome: p.nome,
      precoCentavos: p.precoCentavos,
      saldo: this.#lab.saldo(p.id),
    }));
  }

  /**
   * Registra a venda. A mesma chave devolve a mesma venda (clique duplo, nova
   * tentativa depois de uma resposta perdida), sem gravar outra.
   * O preço vem do cadastro: do pedido só se usam produto e quantidade.
   */
  registrarVenda(chave, itens, pagamento = { forma: 'dinheiro' }) {
    if (typeof chave !== 'string' || !PADRAO_CHAVE.test(chave)) {
      throw new DadosInvalidosError('chave: informe a chave de idempotência da venda (8 a 64 letras, números ou hífen)');
    }
    const repetida = this.#porChave.get(chave);
    if (repetida !== undefined) return { cupom: this.#cupom(repetida), repetida: true };
    if (!Array.isArray(itens)) throw new DadosInvalidosError('itens: informe uma lista de itens');
    const pedido = itens.map((item) => ({ produtoId: item?.produtoId, quantidade: item?.quantidade }));
    const forma = pagamento?.forma;
    if (!Object.hasOwn(FORMAS_PAGAMENTO, forma)) {
      throw new DadosInvalidosError(`pagamento.forma: use ${Object.keys(FORMAS_PAGAMENTO).join(', ')}`);
    }
    const recebido = pagamento.recebidoCentavos;
    if (recebido !== undefined && recebido !== null && (!Number.isSafeInteger(recebido) || recebido < 0)) {
      throw new DadosInvalidosError('pagamento.recebidoCentavos: informe um inteiro em centavos');
    }

    // Venda, conferência do pagamento e localização do evento numa transação só
    // (a interna vira SAVEPOINT): dinheiro a menos desfaz a venda inteira.
    const { venda, seq } = this.#banco.transacao(() => {
      const venda = this.#lab.registrarVenda(pedido);
      if (forma === 'dinheiro' && recebido != null && recebido < venda.totalCentavos) {
        throw new DadosInvalidosError(`Valor recebido (${reais(recebido)}) menor que o total (${reais(venda.totalCentavos)}). Nada foi gravado.`);
      }
      return { venda, seq: this.#seqDoEvento(venda.id) };
    });
    const recebidoFinal = forma === 'dinheiro' ? (recebido ?? venda.totalCentavos) : venda.totalCentavos;
    const nomes = new Map(this.#lab.produtos().map((p) => [p.id, p.nome]));
    const registro = {
      chave,
      vendaId: venda.id,
      numero: venda.numero,
      totalCentavos: venda.totalCentavos,
      ocorridoEm: venda.ocorridoEm,
      seq,
      codigo: codigoDaVenda(this.sigla, venda.numero, venda.id),
      pagamento: { forma, recebidoCentavos: recebidoFinal, trocoCentavos: recebidoFinal - venda.totalCentavos },
      itens: venda.itens.map((i) => ({
        produtoId: i.produtoId,
        nome: nomes.get(i.produtoId) ?? i.produtoId,
        quantidade: i.quantidade,
        precoUnitarioCentavos: i.precoUnitarioCentavos,
      })),
    };
    this.#guardar(registro, true);
    return { cupom: this.#cupom(registro), repetida: false };
  }

  /** Entrada de estoque (reposição): movimentação ENTRADA com evento, pela regra do LAB. */
  repor(produtoId, quantidade) {
    this.#lab.registrarEntrada(produtoId, quantidade, `reposição pelo PDV (${this.nome})`);
    return this.#lab.saldo(produtoId);
  }

  /** Cadastra os produtos de demonstração que faltam, com estoque inicial. Devolve quantos criou. */
  cadastrarDemo() {
    return this.#banco.transacao(() => {
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

  /** As últimas vendas deste caixa, da mais nova para a mais antiga, com a situação na fila. */
  ultimasVendas(limite = 12) {
    const recentes = this.#vendas.slice(-limite).reverse();
    const situacao = this.#situacoes(recentes.map((v) => v.seq));
    return recentes.map((v) => this.#cupom(v, situacao));
  }

  /** Um cupom pela venda, com a situação atual. */
  cupom(vendaId) {
    const registro = this.#vendas.find((v) => v.vendaId === vendaId);
    return registro === undefined ? null : this.#cupom(registro);
  }

  /**
   * Confere uma venda pelo código (CX01-015855-7F3A): existe na loja, os 4
   * caracteres batem com o id, e em que pé está na fila. Vale para qualquer venda
   * da loja; pagamento e caixa só aparecem quando a venda é deste caixa.
   */
  consultarCodigo(texto) {
    const codigo = String(texto ?? '').trim().toUpperCase();
    const m = PADRAO_CODIGO.exec(codigo);
    if (m === null) return { valida: false, codigo, motivo: 'Formato inválido. Use CX01-000123-ABCD.' };
    const numero = Number(m[2]);
    const linha = this.#banco.consultarUma('SELECT id, numero, total_centavos, ocorrido_em FROM vendas WHERE numero = ?', numero);
    if (linha === undefined) return { valida: false, codigo, motivo: `Não existe venda nº ${numero} nesta loja.` };
    const vendaId = String(linha['id']);
    if (codigoDaVenda(m[1], numero, vendaId) !== codigo) {
      return { valida: false, codigo, motivo: 'Os 4 caracteres de conferência não batem com a venda: código errado ou adulterado.' };
    }
    const itens = this.#banco.consultar(
      `SELECT i.quantidade, i.preco_unitario_centavos, p.nome FROM itens_venda i
       JOIN produtos p ON p.id = i.produto_id WHERE i.venda_id = ? ORDER BY i.posicao`, vendaId,
    ).map((l) => ({ nome: String(l['nome']), quantidade: Number(l['quantidade']), precoUnitarioCentavos: Number(l['preco_unitario_centavos']) }));
    const evento = this.#banco.consultarUma(
      `SELECT seq, sincronizado_em FROM outbox WHERE tipo = 'venda.registrada' AND json_extract(dados, '$.vendaId') = ?`, vendaId,
    );
    const doCaixa = this.#vendas.find((v) => v.vendaId === vendaId);
    return {
      valida: true,
      codigo,
      vendaId,
      numero,
      totalCentavos: Number(linha['total_centavos']),
      ocorridoEm: String(linha['ocorrido_em']),
      itens,
      seq: evento === undefined ? null : Number(evento['seq']),
      situacao: evento?.['sincronizado_em'] == null ? 'pendente' : 'nuvem',
      sincronizadoEm: evento?.['sincronizado_em'] == null ? null : String(evento['sincronizado_em']),
      caixa: doCaixa ? this.nome : null,
      pagamento: doCaixa?.pagamento ?? null,
      origem: doCaixa ? `PDV · ${this.nome}` : 'outra origem da loja (gerador do LAB ou outro caixa)',
    };
  }

  /** Eventos da loja ainda não confirmados pela nuvem (de todos os processos, não só do caixa). */
  fila() {
    return this.#lab.outbox.contarPendentes();
  }

  resumo() {
    const ultima = this.#vendas.at(-1);
    return {
      caixa: this.nome,
      sigla: this.sigla,
      vendas: this.#vendas.length,
      totalCentavos: this.#vendas.reduce((s, v) => s + v.totalCentavos, 0),
      ultima: ultima === undefined ? null : {
        numero: ultima.numero, codigo: ultima.codigo ?? codigoDaVenda(this.sigla, ultima.numero, ultima.vendaId),
        ocorridoEm: ultima.ocorridoEm, totalCentavos: ultima.totalCentavos,
      },
    };
  }

  // ---------------------------------------------------------------- interno
  #seqDoEvento(vendaId) {
    const linha = this.#banco.consultarUma(
      `SELECT seq FROM outbox
       WHERE seq > (SELECT COALESCE(MAX(seq), 0) FROM outbox) - ?
         AND tipo = 'venda.registrada' AND json_extract(dados, '$.vendaId') = ?
       ORDER BY seq DESC LIMIT 1`,
      JANELA_SEQ,
      vendaId,
    );
    return linha === undefined ? null : Number(linha['seq']);
  }

  #situacoes(seqs) {
    const validas = seqs.filter((s) => Number.isSafeInteger(s));
    const mapa = new Map();
    if (validas.length === 0) return mapa;
    const linhas = this.#banco.consultar(
      `SELECT seq, sincronizado_em FROM outbox WHERE seq IN (${validas.map(() => '?').join(', ')})`,
      ...validas,
    );
    for (const l of linhas) mapa.set(Number(l['seq']), l['sincronizado_em'] == null ? null : String(l['sincronizado_em']));
    return mapa;
  }

  #cupom(registro, situacao = this.#situacoes([registro.seq])) {
    const sincronizadoEm = situacao.get(registro.seq) ?? null;
    return {
      vendaId: registro.vendaId,
      numero: registro.numero,
      totalCentavos: registro.totalCentavos,
      ocorridoEm: registro.ocorridoEm,
      seq: registro.seq,
      codigo: registro.codigo ?? codigoDaVenda(this.sigla, registro.numero, registro.vendaId),
      pagamento: registro.pagamento ?? null,
      itens: registro.itens,
      caixa: this.nome,
      situacao: sincronizadoEm === null ? 'pendente' : 'nuvem',
      sincronizadoEm,
    };
  }

  #guardar(registro, gravar) {
    this.#vendas.push(registro);
    this.#porChave.set(registro.chave, registro);
    if (this.#vendas.length > VENDAS_EM_MEMORIA) {
      const saiu = this.#vendas.shift();
      this.#porChave.delete(saiu.chave);
    }
    if (gravar && this.#arquivo !== null) {
      try {
        mkdirSync(path.dirname(this.#arquivo), { recursive: true });
        appendFileSync(this.#arquivo, `${JSON.stringify(registro)}\n`);
      } catch (erro) {
        // A venda já está gravada no banco da loja; perder o histórico do caixa não perde a venda.
        console.error(`aviso: não foi possível guardar o cupom ${registro.numero} em ${this.#arquivo}: ${erro.message}`);
      }
    }
  }

  #carregar() {
    if (this.#arquivo === null || !existsSync(this.#arquivo)) return;
    const linhas = readFileSync(this.#arquivo, 'utf8').split('\n').filter(Boolean).slice(-VENDAS_EM_MEMORIA);
    const lidos = [];
    for (const linha of linhas) {
      try {
        const r = JSON.parse(linha);
        if (typeof r.chave === 'string' && typeof r.vendaId === 'string') lidos.push(r);
      } catch {
        // linha cortada (queda de energia no meio da escrita): ignora só ela
      }
    }
    if (lidos.length === 0) return;
    // Banco da loja zerado (lab:reset) com o histórico do caixa para trás: só vale o que o banco tem.
    const existem = new Set(
      this.#banco
        .consultar(`SELECT id FROM vendas WHERE id IN (${lidos.map(() => '?').join(', ')})`, ...lidos.map((r) => r.vendaId))
        .map((l) => String(l['id'])),
    );
    for (const r of lidos) if (existem.has(r.vendaId)) this.#guardar(r, false);
  }
}
