// Rotas do ERP do cliente (Passo 2.4): loja e comprovante (UC10), produtos (UC11), preço com versão
// (UC12), entrada e ajuste de estoque (UC13, UC14) e kardex (UC15). Tudo dentro do cliente da sessão.
//
//   GET  /v1/erp/loja                         lojas e configuração do comprovante
//   PUT  /v1/erp/lojas/{id}                   nome, endereço, telefone da loja
//   PUT  /v1/erp/comprovante                  cabeçalho e rodapé do comprovante
//   GET  /v1/erp/produtos                     produtos com o saldo
//   POST /v1/erp/produtos                     cadastra
//   PUT  /v1/erp/produtos/{id}                altera (exige a versão que a tela viu)
//   POST /v1/erp/estoque                      entrada ou ajuste
//   GET  /v1/erp/produtos/{id}/kardex         o histórico do produto, com o saldo linha a linha
import { ean13Valido, gerarId } from '@continuum/dominio';
import type { BancoNuvem, Transacao } from './banco.ts';
import { RecusaDaNuvem } from './api.ts';
import type { Rota } from './api.ts';

type Objeto = Record<string, unknown>;
const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const objeto = (c: unknown): Objeto => (typeof c === 'object' && c !== null && !Array.isArray(c) ? (c as Objeto) : {});
const UNIDADES = ['un', 'kg', 'l'];

export function lerProduto(c: Objeto) {
  const nome = texto(c['nome']);
  if (nome === '') throw new RecusaDaNuvem(400, 'Informe o nome do produto.');
  const precoCentavos = Number(c['precoCentavos']);
  if (!Number.isSafeInteger(precoCentavos) || precoCentavos < 0) throw new RecusaDaNuvem(400, 'Preço inválido (em centavos, sem negativo).');
  const unidade = texto(c['unidade']) || 'un';
  if (!UNIDADES.includes(unidade)) throw new RecusaDaNuvem(400, 'Unidade: un, kg ou l.');
  const ean = texto(c['ean']).replace(/\D/g, '') || null;
  if (ean !== null && !ean13Valido(ean)) throw new RecusaDaNuvem(400, 'Código de barras (EAN-13) inválido: confira os 13 números.');
  const estoqueMinimo = c['estoqueMinimo'] === undefined || c['estoqueMinimo'] === '' ? 0 : Number(c['estoqueMinimo']);
  if (!Number.isSafeInteger(estoqueMinimo) || estoqueMinimo < 0) throw new RecusaDaNuvem(400, 'Estoque mínimo inválido.');
  return { nome, precoCentavos, unidade, ean, estoqueMinimo };
}

/** A mudança vai para a fila de descida: os caixas do cliente recebem o produto novo (Passo 3.3). */
export async function avisarDescidaDoProduto(tx: Transacao, clienteId: string, p: { id: string; version: number; nome: string; precoCentavos: number; unidade: string; ean: string | null }): Promise<void> {
  await tx.consultar(
    "INSERT INTO alteracoes (cliente_id, entidade, entidade_id, versao, dados) VALUES ($1, 'produto', $2, $3, $4)",
    clienteId, p.id, p.version, JSON.stringify({ produtoId: p.id, nome: p.nome, precoCentavos: p.precoCentavos, unidade: p.unidade, ean: p.ean, version: p.version }),
  );
}

async function auditar(tx: Transacao, clienteId: string, autorId: string, acao: string, alvo: string, dados: unknown): Promise<void> {
  await tx.consultar('INSERT INTO auditoria (id, cliente_id, autor_id, acao, alvo, dados) VALUES ($1, $2, $3, $4, $5, $6)', gerarId(), clienteId, autorId, acao, alvo, JSON.stringify(dados));
}

export function rotasDoErp(banco: BancoNuvem): Rota {
  return async (ctx, partes) => {
    if (partes[0] !== 'v1' || partes[1] !== 'erp') return null;
    const recurso = partes[2];
    const id = partes[3];
    const metodo = ctx.pedido.metodo;
    const c = ctx.corpo;

    // ---------------------------------------------------------------- loja e comprovante (UC10)
    if (metodo === 'GET' && recurso === 'loja') {
      const s = ctx.exigir('erp.estoque.consultar');
      return {
        status: 200,
        corpo: await banco.transacao('continuum_app', s.clienteId, async (tx) => ({
          lojas: await tx.consultar('SELECT id, nome_reduzido, nome, endereco, telefone FROM lojas ORDER BY nome_reduzido'),
          comprovante: (await tx.consultarUma<{ comprovante: unknown }>('SELECT comprovante FROM parametros_cliente'))?.comprovante ?? {},
        })),
      };
    }
    if (metodo === 'PUT' && recurso === 'lojas' && id !== undefined) {
      const s = ctx.exigir('erp.loja.configurar');
      const nome = texto(c['nome']);
      if (nome === '') throw new RecusaDaNuvem(400, 'Informe o nome da loja.');
      await banco.transacao('continuum_app', s.clienteId, async (tx) => {
        const r = await tx.consultar('UPDATE lojas SET nome = $2, endereco = $3, telefone = $4 WHERE id = $1 RETURNING id', id, nome, JSON.stringify(objeto(c['endereco'])), texto(c['telefone']) || null);
        if (r.length === 0) throw new RecusaDaNuvem(404, 'Loja não encontrada.');
        await auditar(tx, s.clienteId as string, s.usuarioId, 'loja.alterada', id, { nome });
      });
      return { status: 200, corpo: { ok: true } };
    }
    if (metodo === 'PUT' && recurso === 'comprovante') {
      const s = ctx.exigir('erp.loja.configurar');
      const cabecalho = Array.isArray(c['cabecalho']) ? c['cabecalho'].map(texto).filter(Boolean).slice(0, 5) : [];
      const rodape = texto(c['rodape']);
      const versao = await banco.transacao('continuum_app', s.clienteId, async (tx) => {
        const linha = await tx.consultarUma<{ versao: number; comprovante: Objeto; regra_estoque: string; limite_desconto_pct: number }>(
          `UPDATE parametros_cliente SET comprovante = comprovante || $1::jsonb, versao = versao + 1 RETURNING versao, comprovante, regra_estoque, limite_desconto_pct`,
          JSON.stringify({ cabecalho, rodape }),
        );
        if (linha === undefined) throw new RecusaDaNuvem(404, 'Parâmetros do cliente não encontrados.');
        await tx.consultar("INSERT INTO alteracoes (cliente_id, entidade, entidade_id, versao, dados) VALUES ($1, 'parametros', $1, $2, $3)", s.clienteId, linha.versao, JSON.stringify({ regraEstoque: linha.regra_estoque, limiteDescontoPct: linha.limite_desconto_pct, comprovante: linha.comprovante }));
        await auditar(tx, s.clienteId as string, s.usuarioId, 'comprovante.alterado', s.clienteId as string, { cabecalho, rodape });
        return linha.versao;
      });
      return { status: 200, corpo: { versao } };
    }

    // ---------------------------------------------------------------- produtos (UC11, UC12)
    if (recurso === 'produtos' && id === undefined && metodo === 'GET') {
      const s = ctx.exigir('erp.estoque.consultar');
      const produtos = await banco.transacao('continuum_app', s.clienteId, (tx) =>
        tx.consultar(`
          SELECT p.id, p.nome, p.preco_centavos::int AS "precoCentavos", p.unidade, p.ean, p.estoque_minimo AS "estoqueMinimo", p.version,
                 COALESCE((SELECT sum(m.quantidade) FROM movimentacoes m WHERE m.produto_id = p.id), 0)::int AS saldo
          FROM produtos p ORDER BY p.nome`),
      );
      return { status: 200, corpo: { produtos } };
    }
    if (recurso === 'produtos' && id === undefined && metodo === 'POST') {
      const s = ctx.exigir('erp.produtos.editar');
      const p = lerProduto(c);
      const novo = { id: gerarId(), version: 1, ...p };
      await banco.transacao('continuum_app', s.clienteId, async (tx) => {
        await tx.consultar(
          'INSERT INTO produtos (id, cliente_id, nome, preco_centavos, unidade, ean, estoque_minimo, version) VALUES ($1, $2, $3, $4, $5, $6, $7, 1)',
          novo.id, s.clienteId, p.nome, p.precoCentavos, p.unidade, p.ean, p.estoqueMinimo,
        );
        await avisarDescidaDoProduto(tx, s.clienteId as string, novo);
      });
      return { status: 201, corpo: { id: novo.id } };
    }
    if (recurso === 'produtos' && id !== undefined && partes.length === 4 && metodo === 'PUT') {
      const s = ctx.exigir('erp.produtos.editar');
      const p = lerProduto(c);
      const versionAnterior = Number(c['version']);
      if (!Number.isInteger(versionAnterior)) throw new RecusaDaNuvem(400, 'Informe a versão do produto que você editou.');
      const version = await banco.transacao('continuum_app', s.clienteId, async (tx) => {
        // Só altera se ninguém alterou antes (controle de versão, ADR 004 do OLD): nada é sobrescrito sem aviso.
        const linha = await tx.consultarUma<{ version: number }>(
          `UPDATE produtos SET nome = $3, preco_centavos = $4, unidade = $5, ean = $6, estoque_minimo = $7, version = version + 1, alterado_em = now()
           WHERE id = $1 AND version = $2 RETURNING version`,
          id, versionAnterior, p.nome, p.precoCentavos, p.unidade, p.ean, p.estoqueMinimo,
        );
        if (linha === undefined) {
          const existe = await tx.consultarUma('SELECT version FROM produtos WHERE id = $1', id);
          throw existe === undefined
            ? new RecusaDaNuvem(404, 'Produto não encontrado.')
            : new RecusaDaNuvem(409, 'Outra pessoa alterou este produto enquanto você editava. Recarregue e confira antes de salvar.');
        }
        await avisarDescidaDoProduto(tx, s.clienteId as string, { id, version: linha.version, ...p });
        return linha.version;
      });
      return { status: 200, corpo: { version } };
    }

    // ---------------------------------------------------------------- estoque (UC13, UC14, UC15)
    if (recurso === 'estoque' && metodo === 'POST') {
      const s = ctx.exigir('erp.estoque.movimentar');
      const tipo = texto(c['tipo']);
      if (tipo !== 'ENTRADA' && tipo !== 'AJUSTE') throw new RecusaDaNuvem(400, 'Tipo: ENTRADA ou AJUSTE.');
      const quantidade = Number(c['quantidade']);
      if (!Number.isSafeInteger(quantidade) || quantidade === 0) throw new RecusaDaNuvem(400, 'Quantidade inteira e diferente de zero.');
      if (tipo === 'ENTRADA' && quantidade < 0) throw new RecusaDaNuvem(400, 'Entrada é sempre positiva. Para tirar do estoque, use ajuste.');
      const motivo = texto(c['motivo']);
      if (tipo === 'AJUSTE' && motivo === '') throw new RecusaDaNuvem(400, 'Ajuste precisa de motivo (contagem, quebra, perda...).');
      const produtoId = texto(c['produtoId']);
      const lojaId = texto(c['lojaId']);
      const saldo = await banco.transacao('continuum_app', s.clienteId, async (tx) => {
        const produto = await tx.consultarUma('SELECT id FROM produtos WHERE id = $1 FOR UPDATE', produtoId);
        if (produto === undefined) throw new RecusaDaNuvem(404, 'Produto não encontrado.');
        const loja = await tx.consultarUma('SELECT id FROM lojas WHERE id = $1', lojaId);
        if (loja === undefined) throw new RecusaDaNuvem(404, 'Loja não encontrada.');
        const atual = Number((await tx.consultarUma<{ s: string }>('SELECT COALESCE(sum(quantidade), 0) AS s FROM movimentacoes WHERE produto_id = $1 AND loja_id = $2', produtoId, lojaId))?.s);
        if (quantidade < 0 && atual + quantidade < 0) throw new RecusaDaNuvem(422, `O ajuste deixaria o estoque negativo (saldo na loja: ${atual}).`);
        const movimentacaoId = gerarId();
        await tx.consultar(
          'INSERT INTO movimentacoes (id, cliente_id, loja_id, produto_id, tipo, quantidade, motivo, ocorrido_em) VALUES ($1, $2, $3, $4, $5, $6, $7, now())',
          movimentacaoId, s.clienteId, lojaId, produtoId, tipo, quantidade, motivo || null,
        );
        // Desce para os caixas da loja (Passo 3.3), na mesma transação: o caixa ativado depois já recebe
        // o saldo com esta movimentação e o cursor além dela, então nada conta em dobro.
        await tx.consultar(
          "INSERT INTO alteracoes (cliente_id, entidade, entidade_id, versao, dados) VALUES ($1, 'estoque', $2, 1, $3)",
          s.clienteId, movimentacaoId, JSON.stringify({ movimentacaoId, lojaId, produtoId, tipo, quantidade, motivo: motivo || null }),
        );
        return atual + quantidade;
      });
      return { status: 201, corpo: { saldo } };
    }
    if (recurso === 'produtos' && id !== undefined && partes[4] === 'kardex' && metodo === 'GET') {
      const s = ctx.exigir('erp.estoque.consultar');
      const linhas = await banco.transacao('continuum_app', s.clienteId, (tx) =>
        tx.consultar(`
          SELECT m.ocorrido_em AS "ocorridoEm", m.tipo, m.quantidade::int AS quantidade, m.motivo, l.nome_reduzido AS loja,
                 v.codigo AS "codigoVenda",
                 (sum(m.quantidade) OVER (ORDER BY m.ocorrido_em, m.id))::int AS saldo
          FROM movimentacoes m JOIN lojas l ON l.id = m.loja_id LEFT JOIN vendas v ON v.id = m.venda_id
          WHERE m.produto_id = $1 ORDER BY m.ocorrido_em, m.id`, id),
      );
      return { status: 200, corpo: { kardex: linhas } };
    }
    return null;
  };
}
