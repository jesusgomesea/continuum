// Serviços do caixa: abrir caixa, vender, cancelar, sangria e suprimento, fechar caixa.
//
// As REGRAS moram no pacote dominio (Passo 1.1); aqui elas são ligadas ao banco do caixa (caixa.db) e
// à fila (Passo 1.2). Toda operação grava os dados e os eventos na MESMA transação: ou tudo, ou nada.
// Sucessor de OLD/trabalho-em-andamento/caixa-v3-operacao-de-caixa.js.
import {
  cancelarVenda as regraDeCancelamento,
  DadosInvalidosError,
  exigirTexto,
  gerarId,
  montarVenda,
  novaEntrada,
} from '@continuum/dominio';
import type { AlertaEstoque, FormaPagamento, Movimentacao, PedidoDeVenda, RegraEstoque, Venda } from '@continuum/dominio';
import type { ProdutoCriado } from '@continuum/contratos';
import { abrirBanco, aplicarMigracoes, Fila } from '@continuum/sync';
import type { BancoSqlite, Linha } from '@continuum/sync';
import { MIGRACOES_CAIXA } from './banco/migracoes.ts';

/** O caixa não está pronto para a operação pedida (não ativado, caixa fechado, já aberto...). */
export class OperacaoDeCaixaError extends Error {
  override name = 'OperacaoDeCaixaError';
}

export interface Identidade {
  dispositivoId: string;
  lojaId: string;
  nomeReduzido: string;
  numeroCaixa: number;
}

export interface ParametrosDoCliente {
  versao: number;
  regraEstoque: RegraEstoque;
  limiteDescontoPct: number;
}

export interface Sessao {
  id: string;
  operador: string;
  fundoCentavos: number;
  abertaEm: string;
}

/** O fechamento de caixa: o que entrou por forma, descontos, cancelamentos e a conferência da gaveta. */
export interface Relatorio {
  vendas: { quantidade: number; liquidoCentavos: number };
  descontosCentavos: number;
  /** Por forma de pagamento; em dinheiro, já sem o troco. */
  porForma: Record<FormaPagamento, number>;
  canceladas: { quantidade: number; liquidoCentavos: number };
  sangriasCentavos: number;
  suprimentosCentavos: number;
  fundoCentavos: number;
  /** fundo + dinheiro das vendas válidas + suprimentos − sangrias. */
  esperadoCentavos: number;
  contadoCentavos: number | null;
  /** contado − esperado: negativo = falta dinheiro; positivo = sobra. */
  diferencaCentavos: number | null;
}

export interface OpcoesDoCaixa {
  relogio?: () => Date;
  gerarId?: () => string;
}

/** Abre (ou cria) o caixa.db e aplica as migrações que faltam. */
export function abrirBancoDoCaixa(caminho: string): BancoSqlite {
  const banco = abrirBanco(caminho);
  aplicarMigracoes(banco, MIGRACOES_CAIXA);
  return banco;
}

const FORMAS: readonly FormaPagamento[] = ['dinheiro', 'debito', 'credito', 'pix'];

export class Caixa {
  readonly fila: Fila;
  #banco: BancoSqlite;
  #relogio: () => Date;
  #gerarId: () => string;

  constructor(banco: BancoSqlite, opcoes: OpcoesDoCaixa = {}) {
    this.#banco = banco;
    this.#relogio = opcoes.relogio ?? (() => new Date());
    this.#gerarId = opcoes.gerarId ?? (() => gerarId());
    this.fila = new Fila(banco, { relogio: this.#relogio, gerarId: this.#gerarId });
  }

  #agora(): string {
    return this.#relogio().toISOString();
  }

  // ============================================================ ativação e parâmetros
  // No produto final, a identidade e os parâmetros chegam pela ativação (Passo 3.1) e pela descida (3.3).

  /** Grava quem é este caixa. Só uma vez: um caixa ativado não troca de identidade. */
  ativar(identidade: Identidade): void {
    this.#banco.transacao(() => {
      if (this.#banco.consultarUma("SELECT 1 FROM config_local WHERE chave = 'dispositivoId'") !== undefined) {
        throw new OperacaoDeCaixaError('Este caixa já foi ativado.');
      }
      for (const [chave, valor] of Object.entries(identidade)) {
        this.#banco.rodar('INSERT INTO config_local (chave, valor) VALUES (?, ?)', chave, String(valor));
      }
      this.#banco.rodar('INSERT INTO sequencia_venda (numero_caixa, ultimo_numero) VALUES (?, 0)', identidade.numeroCaixa);
    });
  }

  identidade(): Identidade {
    const config = new Map(this.#banco.consultar('SELECT chave, valor FROM config_local').map((l) => [String(l['chave']), String(l['valor'])]));
    const dispositivoId = config.get('dispositivoId');
    if (dispositivoId === undefined) throw new OperacaoDeCaixaError('Caixa não ativado: informe o código de ativação.');
    return {
      dispositivoId,
      lojaId: String(config.get('lojaId')),
      nomeReduzido: String(config.get('nomeReduzido')),
      numeroCaixa: Number(config.get('numeroCaixa')),
    };
  }

  /** Guarda uma versão nova dos parâmetros do cliente. Versão antiga ou repetida é ignorada. */
  aplicarParametros(parametros: ParametrosDoCliente): void {
    const { versao, ...dados } = parametros;
    this.#banco.rodar('INSERT OR IGNORE INTO parametros (versao, dados) VALUES (?, ?)', versao, JSON.stringify(dados));
  }

  parametros(): ParametrosDoCliente {
    const linha = this.#banco.consultarUma('SELECT versao, dados FROM parametros ORDER BY versao DESC LIMIT 1');
    // Sem parâmetros recebidos ainda: os padrões do cliente (docs/04, tabela parametros).
    if (linha === undefined) return { versao: 0, regraEstoque: 'bloquear', limiteDescontoPct: 10 };
    return { versao: Number(linha['versao']), ...(JSON.parse(String(linha['dados'])) as Omit<ParametrosDoCliente, 'versao'>) };
  }

  // ============================================================ catálogo e estoque

  /** Produto vindo do ERP (descida). Só grava se for novo ou de versão mais nova (a mudança mais nova vence). */
  receberProduto(produto: Omit<ProdutoCriado, 'version'> & { version: number }): void {
    this.#banco.rodar(
      `INSERT INTO produtos (id, nome, preco_centavos, unidade, ean, version, alterado_em) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET nome = excluded.nome, preco_centavos = excluded.preco_centavos,
         unidade = excluded.unidade, ean = excluded.ean, version = excluded.version, alterado_em = excluded.alterado_em
       WHERE excluded.version > produtos.version`,
      produto.produtoId, produto.nome, produto.precoCentavos, produto.unidade, produto.ean, produto.version, this.#agora(),
    );
  }

  /** Entrada de mercadoria registrada no caixa (estoque inicial, reposição). Gera evento. */
  registrarEntrada(produtoId: string, quantidade: number, motivo?: string): Movimentacao {
    const { lojaId } = this.identidade();
    return this.#banco.transacao(() => {
      this.#exigirProduto(produtoId);
      const mov = novaEntrada(this.#gerarId, { lojaId, produtoId, quantidade, ...(motivo === undefined ? {} : { motivo }) });
      this.#gravarMovimentacao(mov);
      return mov;
    });
  }

  /** Saldo: a soma das movimentações do produto. */
  saldo(produtoId: string): number {
    return Number(this.#banco.consultarUma('SELECT COALESCE(SUM(quantidade), 0) AS s FROM movimentacoes WHERE produto_id = ?', produtoId)?.['s']);
  }

  // ============================================================ sessão de caixa

  /** Abre o caixa com o operador e o fundo de troco. */
  abrirCaixa(operador: string, fundoCentavos: number): Sessao {
    const { dispositivoId } = this.identidade();
    return this.#banco.transacao(() => {
      if (this.#sessaoAberta() !== undefined) throw new OperacaoDeCaixaError('O caixa já está aberto.');
      const sessao: Sessao = { id: this.#gerarId(), operador: exigirTexto(operador, 'operador'), fundoCentavos, abertaEm: this.#agora() };
      this.fila.adicionar('caixa.aberto', { sessaoId: sessao.id, operador: sessao.operador, fundoCentavos });
      this.#banco.rodar(
        'INSERT INTO sessoes_caixa (id, dispositivo_id, operador, fundo_centavos, aberta_em) VALUES (?, ?, ?, ?, ?)',
        sessao.id, dispositivoId, sessao.operador, fundoCentavos, sessao.abertaEm,
      );
      return sessao;
    });
  }

  sessaoAberta(): Sessao | undefined {
    return this.#sessaoAberta();
  }

  /** Sangria (tira dinheiro da gaveta) ou suprimento (põe). A sangria não passa do que há na gaveta. */
  movimentarCaixa(tipo: 'SANGRIA' | 'SUPRIMENTO', valorCentavos: number, motivo: string): void {
    this.#banco.transacao(() => {
      const sessao = this.#exigirSessao();
      if (tipo === 'SANGRIA') {
        const naGaveta = this.#calcularRelatorio(sessao, null).esperadoCentavos;
        if (valorCentavos > naGaveta) {
          throw new DadosInvalidosError(`Sangria maior que o dinheiro na gaveta (${naGaveta} centavos).`);
        }
      }
      const id = this.#gerarId();
      const motivoLimpo = exigirTexto(motivo, 'motivo');
      this.fila.adicionar('caixa.movimentado', { movimentoId: id, sessaoId: sessao.id, tipo, valorCentavos, motivo: motivoLimpo });
      this.#banco.rodar(
        'INSERT INTO movimentos_caixa (id, sessao_id, tipo, valor_centavos, motivo, ocorrido_em) VALUES (?, ?, ?, ?, ?, ?)',
        id, sessao.id, tipo, valorCentavos, motivoLimpo, this.#agora(),
      );
    });
  }

  /** Relatório parcial da sessão aberta (sem a contagem da gaveta). */
  relatorioParcial(): Relatorio {
    return this.#calcularRelatorio(this.#exigirSessao(), null);
  }

  /** Fecha o caixa com o valor contado na gaveta. Depois disso, a sessão não muda mais. */
  fecharCaixa(contadoCentavos: number): Relatorio {
    return this.#banco.transacao(() => {
      const sessao = this.#exigirSessao();
      const relatorio = this.#calcularRelatorio(sessao, contadoCentavos);
      this.fila.adicionar('caixa.fechado', { sessaoId: sessao.id, contadoCentavos, esperadoCentavos: relatorio.esperadoCentavos });
      this.#banco.rodar(
        'UPDATE sessoes_caixa SET fechada_em = ?, contado_centavos = ?, esperado_centavos = ?, relatorio = ? WHERE id = ?',
        this.#agora(), contadoCentavos, relatorio.esperadoCentavos, JSON.stringify(relatorio), sessao.id,
      );
      return relatorio;
    });
  }

  // ============================================================ venda e cancelamento

  /**
   * Registra a venda numa transação só: venda, itens, pagamentos, baixas de estoque e os eventos na fila.
   * Qualquer recusa (estoque, desconto, pagamento) desfaz tudo, inclusive o número da venda.
   */
  registrarVenda(pedido: PedidoDeVenda): { venda: Venda; alertasEstoque: readonly AlertaEstoque[] } {
    const identidade = this.identidade();
    const parametros = this.parametros();
    return this.#banco.transacao(() => {
      const sessao = this.#exigirSessao();
      const ids = [...new Set(pedido.itens.map((i) => i.produtoId))];
      const precos = new Map<string, number>();
      const saldos = new Map<string, number>();
      for (const id of ids) {
        const p = this.#banco.consultarUma('SELECT preco_centavos FROM produtos WHERE id = ?', id);
        if (p !== undefined) precos.set(id, Number(p['preco_centavos']));
        saldos.set(id, this.saldo(id));
      }
      const seq = this.#banco.consultarUma('SELECT ultimo_numero FROM sequencia_venda WHERE numero_caixa = ?', identidade.numeroCaixa);
      const numero = Number(seq?.['ultimo_numero']) + 1;

      const { venda, baixas, alertasEstoque } = montarVenda(pedido, {
        lojaId: identidade.lojaId,
        sessaoId: sessao.id,
        nomeReduzido: identidade.nomeReduzido,
        numeroCaixa: identidade.numeroCaixa,
        numero,
        precos,
        saldos,
        regraEstoque: parametros.regraEstoque,
        limiteDescontoPct: parametros.limiteDescontoPct,
        gerarId: this.#gerarId,
      });

      const agora = this.#agora();
      this.#banco.rodar('UPDATE sequencia_venda SET ultimo_numero = ? WHERE numero_caixa = ?', numero, identidade.numeroCaixa);
      // A venda entra na fila antes das baixas que apontam para ela.
      this.fila.adicionar('venda.registrada', venda);
      this.#banco.rodar(
        `INSERT INTO vendas (id, loja_id, dispositivo_id, sessao_id, codigo, numero, bruto_centavos, desconto_centavos,
           liquido_centavos, troco_centavos, documento_cliente, ocorrido_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        venda.vendaId, venda.lojaId, identidade.dispositivoId, venda.sessaoId, venda.codigo, venda.numero, venda.brutoCentavos,
        venda.descontoCentavos, venda.liquidoCentavos, venda.trocoCentavos, venda.documentoCliente, agora,
      );
      for (const b of baixas) this.#gravarMovimentacao(b);
      for (const i of venda.itens) {
        this.#banco.rodar(
          `INSERT INTO itens_venda (id, venda_id, posicao, produto_id, quantidade, preco_unitario_centavos, desconto_centavos, movimentacao_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          i.id, venda.vendaId, i.posicao, i.produtoId, i.quantidade, i.precoUnitarioCentavos, i.descontoCentavos, i.movimentacaoId,
        );
      }
      for (const p of venda.pagamentos) {
        this.#banco.rodar('INSERT INTO pagamentos (id, venda_id, forma, valor_centavos) VALUES (?, ?, ?, ?)', p.id, venda.vendaId, p.forma, p.valorCentavos);
      }
      return { venda, alertasEstoque };
    });
  }

  /** Busca a venda pelo código do comprovante (aceita minúsculas e espaços). */
  buscarVenda(codigo: string): { venda: Venda; cancelada: boolean } | undefined {
    const linha = this.#banco.consultarUma('SELECT * FROM vendas WHERE codigo = ?', codigo.trim().toUpperCase());
    if (linha === undefined) return undefined;
    const id = String(linha['id']);
    const venda: Venda = {
      vendaId: id,
      codigo: String(linha['codigo']),
      numero: Number(linha['numero']),
      lojaId: String(linha['loja_id']),
      sessaoId: String(linha['sessao_id']),
      itens: this.#banco.consultar('SELECT * FROM itens_venda WHERE venda_id = ? ORDER BY posicao', id).map((i) => ({
        id: String(i['id']),
        posicao: Number(i['posicao']),
        produtoId: String(i['produto_id']),
        quantidade: Number(i['quantidade']),
        precoUnitarioCentavos: Number(i['preco_unitario_centavos']),
        descontoCentavos: Number(i['desconto_centavos']),
        movimentacaoId: String(i['movimentacao_id']),
      })),
      pagamentos: this.#banco.consultar('SELECT * FROM pagamentos WHERE venda_id = ? ORDER BY rowid', id).map((p) => ({
        id: String(p['id']),
        forma: String(p['forma']) as FormaPagamento,
        valorCentavos: Number(p['valor_centavos']),
      })),
      brutoCentavos: Number(linha['bruto_centavos']),
      descontoCentavos: Number(linha['desconto_centavos']),
      liquidoCentavos: Number(linha['liquido_centavos']),
      trocoCentavos: Number(linha['troco_centavos']),
      documentoCliente: linha['documento_cliente'] === null ? null : String(linha['documento_cliente']),
    };
    const cancelada = this.#banco.consultarUma('SELECT 1 FROM cancelamentos WHERE venda_id = ?', id) !== undefined;
    return { venda, cancelada };
  }

  /** Cancela a venda pelo código: a venda fica como estava; o estoque volta por ESTORNO. */
  cancelarVenda(codigo: string, motivo: string, autorizadoPor: string): void {
    this.#banco.transacao(() => {
      const sessao = this.#exigirSessao();
      const achada = this.buscarVenda(codigo);
      if (achada === undefined) throw new DadosInvalidosError(`A venda ${codigo.trim().toUpperCase()} não é deste caixa.`);
      const { cancelamento, estornos } = regraDeCancelamento(achada.venda, {
        motivo,
        autorizadoPor,
        sessaoAbertaId: sessao.id,
        jaCancelada: achada.cancelada,
        gerarId: this.#gerarId,
      });
      this.fila.adicionar('venda.cancelada', cancelamento);
      this.#banco.rodar(
        'INSERT INTO cancelamentos (venda_id, motivo, autorizado_por, cancelado_em) VALUES (?, ?, ?, ?)',
        cancelamento.vendaId, cancelamento.motivo, cancelamento.autorizadoPor, this.#agora(),
      );
      for (const e of estornos) this.#gravarMovimentacao(e);
    });
  }

  // ============================================================ internos

  #gravarMovimentacao(m: Movimentacao): void {
    const { dispositivoId } = this.identidade();
    this.fila.adicionar('estoque.movimentacao-registrada', m);
    this.#banco.rodar(
      `INSERT INTO movimentacoes (id, loja_id, produto_id, tipo, quantidade, venda_id, motivo, dispositivo_id, ocorrido_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      m.movimentacaoId, m.lojaId, m.produtoId, m.tipo, m.quantidade, m.vendaId, m.motivo, dispositivoId, this.#agora(),
    );
  }

  #exigirProduto(produtoId: string): void {
    if (this.#banco.consultarUma('SELECT 1 FROM produtos WHERE id = ?', produtoId) === undefined) {
      throw new DadosInvalidosError(`Produto não encontrado: ${produtoId}`);
    }
  }

  #sessaoAberta(): Sessao | undefined {
    const { dispositivoId } = this.identidade();
    const l = this.#banco.consultarUma('SELECT * FROM sessoes_caixa WHERE dispositivo_id = ? AND fechada_em IS NULL', dispositivoId);
    return l === undefined ? undefined : lerSessao(l);
  }

  #exigirSessao(): Sessao {
    const sessao = this.#sessaoAberta();
    if (sessao === undefined) throw new OperacaoDeCaixaError('Caixa fechado: abra o caixa primeiro.');
    return sessao;
  }

  #calcularRelatorio(sessao: Sessao, contadoCentavos: number | null): Relatorio {
    const vendas = this.#banco.consultar(
      `SELECT v.id, v.liquido_centavos, v.desconto_centavos, v.troco_centavos, c.venda_id IS NOT NULL AS cancelada
       FROM vendas v LEFT JOIN cancelamentos c ON c.venda_id = v.id WHERE v.sessao_id = ?`,
      sessao.id,
    );
    const validas = vendas.filter((v) => Number(v['cancelada']) === 0);
    const canceladas = vendas.filter((v) => Number(v['cancelada']) === 1);
    const soma = (linhas: Linha[], campo: string) => linhas.reduce((s, l) => s + Number(l[campo]), 0);

    const porForma = Object.fromEntries(FORMAS.map((f) => [f, 0])) as Record<FormaPagamento, number>;
    for (const v of validas) {
      for (const p of this.#banco.consultar('SELECT forma, valor_centavos FROM pagamentos WHERE venda_id = ?', String(v['id']))) {
        porForma[String(p['forma']) as FormaPagamento] += Number(p['valor_centavos']);
      }
      porForma.dinheiro -= Number(v['troco_centavos']); // o troco saiu da gaveta
    }

    const movimentos = this.#banco.consultar('SELECT tipo, valor_centavos FROM movimentos_caixa WHERE sessao_id = ?', sessao.id);
    const sangrias = soma(movimentos.filter((m) => m['tipo'] === 'SANGRIA'), 'valor_centavos');
    const suprimentos = soma(movimentos.filter((m) => m['tipo'] === 'SUPRIMENTO'), 'valor_centavos');
    const esperado = sessao.fundoCentavos + porForma.dinheiro + suprimentos - sangrias;

    return {
      vendas: { quantidade: validas.length, liquidoCentavos: soma(validas, 'liquido_centavos') },
      descontosCentavos: soma(validas, 'desconto_centavos'),
      porForma,
      canceladas: { quantidade: canceladas.length, liquidoCentavos: soma(canceladas, 'liquido_centavos') },
      sangriasCentavos: sangrias,
      suprimentosCentavos: suprimentos,
      fundoCentavos: sessao.fundoCentavos,
      esperadoCentavos: esperado,
      contadoCentavos,
      diferencaCentavos: contadoCentavos === null ? null : contadoCentavos - esperado,
    };
  }
}

function lerSessao(l: Linha): Sessao {
  return { id: String(l['id']), operador: String(l['operador']), fundoCentavos: Number(l['fundo_centavos']), abertaEm: String(l['aberta_em']) };
}
