// Rotas de gestão do ERP do cliente: o painel do dono, relatórios por período, alertas e lista de compras
// do estoque (UC20), usuários (UC16), PIN do supervisor, importação de produtos e fechamentos de caixa.
// Tudo dentro do cliente da sessão (o isolamento do banco garante).
//
//   GET  /v1/erp/painel                               números do dia, 30 dias, horas, formas, estoque baixo, caixas
//   GET  /v1/erp/relatorios/periodo?de=&ate=&loja=    vendas de um período (por dia, forma, produto, caixa, hora, operador)
//   GET  /v1/erp/estoque/alertas                      negativos, abaixo do mínimo e a lista de compras
//   GET  /v1/erp/usuarios                             quem acessa o ERP e o caixa
//   POST /v1/erp/usuarios                             novo usuário
//   PUT  /v1/erp/usuarios/{id}                        nome, perfil, ativo, nova senha
//   GET  /v1/erp/pin                                  se o PIN do supervisor já foi definido
//   PUT  /v1/erp/pin                                  define o PIN (desce para os caixas, só o hash)
//   POST /v1/erp/produtos/importar                    cadastra vários produtos de uma planilha (tudo ou nada)
//   GET  /v1/erp/fechamentos?de=&ate=                 aberturas e fechamentos de caixa, com a diferença na gaveta
import { gerarId } from '@continuum/dominio';
import type { BancoNuvem, Transacao } from './banco.ts';
import { RecusaDaNuvem } from './api.ts';
import type { Rota } from './api.ts';
import { avisarDescidaDoProduto, lerProduto } from './erp.ts';
import { hashDaSenha, hashDoPinDoSupervisor, senhaAceitavel } from './seguranca.ts';

type Objeto = Record<string, unknown>;
const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const objeto = (c: unknown): Objeto => (typeof c === 'object' && c !== null && !Array.isArray(c) ? (c as Objeto) : {});
const PADRAO_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PERFIS_DO_ERP = ['dono', 'gerente', 'supervisor', 'operador'] as const;

/** O dia é o de Brasília (o da loja), não o de Greenwich. */
const DIA_DA_VENDA = "(v.ocorrido_em AT TIME ZONE 'America/Sao_Paulo')::date";
const HOJE = "(now() AT TIME ZONE 'America/Sao_Paulo')::date";
const NAO_CANCELADA = 'NOT EXISTS (SELECT 1 FROM cancelamentos x WHERE x.venda_id = v.id)';
/** Mais tempo que isso sem sinal: o caixa conta como "sem sinal" (mesmo limite do monitor do Central). */
const SEGUNDOS_SEM_SINAL = 45;
/** A lista de compras sugere repor até o dobro do estoque mínimo. */
const FATOR_DE_REPOSICAO = 2;
export const MAXIMO_LINHAS_IMPORTACAO = 5000;

function consulta(caminho: string): URLSearchParams {
  return new URLSearchParams(caminho.split('?')[1] ?? '');
}

function lerDia(v: string | null, campo: string): string {
  if (v === null || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) throw new RecusaDaNuvem(400, `${campo}: data no formato AAAA-MM-DD.`);
  return v;
}

/** Lista os dias de "de" até "ate" (inclusive), para os gráficos não pularem dia sem venda. */
export function diasEntre(de: string, ate: string): string[] {
  const dias: string[] = [];
  for (let t = Date.parse(`${de}T00:00:00Z`); t <= Date.parse(`${ate}T00:00:00Z`); t += 86_400_000) dias.push(new Date(t).toISOString().slice(0, 10));
  return dias;
}

async function auditar(tx: Transacao, clienteId: string, autorId: string, acao: string, alvo: string, dados: unknown): Promise<void> {
  await tx.consultar('INSERT INTO auditoria (id, cliente_id, autor_id, acao, alvo, dados) VALUES ($1, $2, $3, $4, $5, $6)', gerarId(), clienteId, autorId, acao, alvo, JSON.stringify(dados));
}

export function rotasDaGestao(banco: BancoNuvem): Rota {
  return async (ctx, partes) => {
    if (partes[0] !== 'v1' || partes[1] !== 'erp') return null;
    const metodo = ctx.pedido.metodo;
    const [, , recurso, id] = partes;
    const c = ctx.corpo;

    // ---------------------------------------------------------------- painel do dono
    if (recurso === 'painel' && metodo === 'GET' && partes.length === 3) {
      const s = ctx.exigir('erp.relatorios.ver');
      const corpo = await banco.transacao('continuum_app', s.clienteId, async (tx) => {
        const hoje = (await tx.consultarUma<{ d: string }>(`SELECT to_char(${HOJE}, 'YYYY-MM-DD') AS d`))?.d ?? '';
        const linhas = await tx.consultar<{ dia: string; vendas: number; liquido: number }>(`
          SELECT to_char(${DIA_DA_VENDA}, 'YYYY-MM-DD') AS dia, count(*)::int AS vendas, COALESCE(sum(v.liquido_centavos), 0)::int AS liquido
          FROM vendas v WHERE ${DIA_DA_VENDA} >= ${HOJE} - 29 AND ${NAO_CANCELADA} GROUP BY 1`);
        const porDia = new Map(linhas.map((l) => [l.dia, l]));
        const inicio = new Date(Date.parse(`${hoje}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
        const ultimos30 = diasEntre(inicio, hoje).map((dia) => ({ dia, vendas: porDia.get(dia)?.vendas ?? 0, liquidoCentavos: porDia.get(dia)?.liquido ?? 0 }));
        const doDia = (atras: number) => ultimos30[ultimos30.length - 1 - atras] ?? { dia: '', vendas: 0, liquidoCentavos: 0 };
        const soma = (n: number) => ultimos30.slice(-n).reduce((t, d) => ({ vendas: t.vendas + d.vendas, liquidoCentavos: t.liquidoCentavos + d.liquidoCentavos }), { vendas: 0, liquidoCentavos: 0 });
        return {
          hoje: doDia(0),
          ontem: doDia(1),
          semanaPassada: doDia(7),
          ultimos7: soma(7),
          ultimos30Totais: soma(30),
          ultimos30,
          porHora: await tx.consultar(`
            SELECT extract(hour FROM v.ocorrido_em AT TIME ZONE 'America/Sao_Paulo')::int AS hora, count(*)::int AS vendas, sum(v.liquido_centavos)::int AS "liquidoCentavos"
            FROM vendas v WHERE ${DIA_DA_VENDA} = ${HOJE} AND ${NAO_CANCELADA} GROUP BY 1 ORDER BY 1`),
          porForma: await tx.consultar(`
            SELECT p.forma, sum(p.valor_centavos)::int AS "valorCentavos"
            FROM pagamentos p JOIN vendas v ON v.id = p.venda_id WHERE ${DIA_DA_VENDA} >= ${HOJE} - 6 AND ${NAO_CANCELADA} GROUP BY 1 ORDER BY 2 DESC`),
          maisVendidos: await tx.consultar(`
            SELECT pr.nome, sum(i.quantidade)::int AS quantidade, sum(i.quantidade * i.preco_unitario_centavos - i.desconto_centavos)::int AS "valorCentavos"
            FROM itens_venda i JOIN vendas v ON v.id = i.venda_id JOIN produtos pr ON pr.id = i.produto_id
            WHERE ${DIA_DA_VENDA} >= ${HOJE} - 6 AND ${NAO_CANCELADA} GROUP BY pr.nome ORDER BY 3 DESC LIMIT 5`),
          estoque: await tx.consultarUma(`
            WITH saldos AS (
              SELECT p.id, p.estoque_minimo, COALESCE((SELECT sum(m.quantidade) FROM movimentacoes m WHERE m.produto_id = p.id), 0) AS saldo FROM produtos p)
            SELECT count(*) FILTER (WHERE saldo < 0)::int AS negativos,
                   count(*) FILTER (WHERE saldo >= 0 AND estoque_minimo > 0 AND saldo <= estoque_minimo)::int AS abaixo,
                   count(*)::int AS produtos
            FROM saldos`),
          estoqueBaixo: await tx.consultar(`
            SELECT * FROM (
              SELECT p.id, p.nome, p.unidade, p.estoque_minimo AS "estoqueMinimo",
                     COALESCE((SELECT sum(m.quantidade) FROM movimentacoes m WHERE m.produto_id = p.id), 0)::int AS saldo
              FROM produtos p) x
            WHERE saldo < 0 OR ("estoqueMinimo" > 0 AND saldo <= "estoqueMinimo") ORDER BY saldo - "estoqueMinimo", nome LIMIT 8`),
          caixas: await tx.consultarUma(`
            SELECT count(*)::int AS ativos,
                   count(*) FILTER (WHERE sv.recebido_em IS NULL OR now() - sv.recebido_em > interval '${SEGUNDOS_SEM_SINAL} seconds')::int AS "semSinal",
                   count(*) FILTER (WHERE sv.caixa_aberto AND now() - sv.recebido_em <= interval '${SEGUNDOS_SEM_SINAL} seconds')::int AS abertos,
                   COALESCE(sum(sv.fila_pendente), 0)::int AS "filaPendente"
            FROM dispositivos d LEFT JOIN sinais_de_vida sv ON sv.dispositivo_id = d.id
            WHERE d.situacao = 'ativo' AND d.tipo = 'pdv'`),
        };
      });
      return { status: 200, corpo };
    }

    // ---------------------------------------------------------------- relatório por período
    if (recurso === 'relatorios' && id === 'periodo' && metodo === 'GET') {
      const s = ctx.exigir('erp.relatorios.ver');
      const q = consulta(ctx.pedido.caminho);
      const de = lerDia(q.get('de'), 'De');
      const ate = lerDia(q.get('ate'), 'Até');
      if (de > ate) throw new RecusaDaNuvem(400, 'A data inicial é depois da final.');
      if (diasEntre(de, ate).length > 366) throw new RecusaDaNuvem(400, 'Período de no máximo um ano.');
      const loja = texto(q.get('loja')) || null;
      // $1 = de, $2 = até, $3 = loja (ou nula = todas)
      const filtro = `${DIA_DA_VENDA} BETWEEN $1::date AND $2::date AND ($3::uuid IS NULL OR v.loja_id = $3::uuid)`;
      const corpo = await banco.transacao('continuum_app', s.clienteId, async (tx) => {
        const totais = await tx.consultarUma<{ vendas: number; liquidoCentavos: number; descontosCentavos: number; trocoCentavos: number }>(`
          SELECT count(*)::int AS vendas, COALESCE(sum(v.liquido_centavos), 0)::int AS "liquidoCentavos",
                 COALESCE(sum(v.desconto_centavos), 0)::int AS "descontosCentavos", COALESCE(sum(v.troco_centavos), 0)::int AS "trocoCentavos"
          FROM vendas v WHERE ${filtro} AND ${NAO_CANCELADA}`, de, ate, loja);
        const linhasPorDia = await tx.consultar<{ dia: string; vendas: number; liquidoCentavos: number }>(`
          SELECT to_char(${DIA_DA_VENDA}, 'YYYY-MM-DD') AS dia, count(*)::int AS vendas, sum(v.liquido_centavos)::int AS "liquidoCentavos"
          FROM vendas v WHERE ${filtro} AND ${NAO_CANCELADA} GROUP BY 1`, de, ate, loja);
        const mapa = new Map(linhasPorDia.map((l) => [l.dia, l]));
        const vendas = totais?.vendas ?? 0;
        return {
          de,
          ate,
          totais: { ...totais, ticketMedioCentavos: vendas === 0 ? 0 : Math.round((totais?.liquidoCentavos ?? 0) / vendas) },
          canceladas: await tx.consultarUma(`
            SELECT count(*)::int AS quantidade, COALESCE(sum(v.liquido_centavos), 0)::int AS "liquidoCentavos"
            FROM vendas v JOIN cancelamentos c ON c.venda_id = v.id WHERE ${filtro}`, de, ate, loja),
          porDia: diasEntre(de, ate).map((dia) => ({ dia, vendas: mapa.get(dia)?.vendas ?? 0, liquidoCentavos: mapa.get(dia)?.liquidoCentavos ?? 0 })),
          porForma: await tx.consultar(`
            SELECT p.forma, count(DISTINCT v.id)::int AS vendas, sum(p.valor_centavos)::int AS "valorCentavos"
            FROM pagamentos p JOIN vendas v ON v.id = p.venda_id WHERE ${filtro} AND ${NAO_CANCELADA} GROUP BY 1 ORDER BY 3 DESC`, de, ate, loja),
          porProduto: await tx.consultar(`
            SELECT pr.nome, pr.unidade, sum(i.quantidade)::int AS quantidade, count(DISTINCT v.id)::int AS vendas,
                   sum(i.quantidade * i.preco_unitario_centavos - i.desconto_centavos)::int AS "valorCentavos"
            FROM itens_venda i JOIN vendas v ON v.id = i.venda_id JOIN produtos pr ON pr.id = i.produto_id
            WHERE ${filtro} AND ${NAO_CANCELADA} GROUP BY pr.nome, pr.unidade ORDER BY 5 DESC`, de, ate, loja),
          porCaixa: await tx.consultar(`
            SELECT l.nome_reduzido AS loja, d.numero_caixa AS "numeroCaixa", count(*)::int AS vendas, sum(v.liquido_centavos)::int AS "liquidoCentavos"
            FROM vendas v JOIN dispositivos d ON d.id = v.dispositivo_id JOIN lojas l ON l.id = v.loja_id
            WHERE ${filtro} AND ${NAO_CANCELADA} GROUP BY l.nome_reduzido, d.numero_caixa ORDER BY 1, 2`, de, ate, loja),
          porHora: await tx.consultar(`
            SELECT extract(hour FROM v.ocorrido_em AT TIME ZONE 'America/Sao_Paulo')::int AS hora, count(*)::int AS vendas, sum(v.liquido_centavos)::int AS "liquidoCentavos"
            FROM vendas v WHERE ${filtro} AND ${NAO_CANCELADA} GROUP BY 1 ORDER BY 1`, de, ate, loja),
          porOperador: await tx.consultar(`
            SELECT s.operador, count(*)::int AS vendas, sum(v.liquido_centavos)::int AS "liquidoCentavos"
            FROM vendas v JOIN sessoes_caixa s ON s.id = v.sessao_id WHERE ${filtro} AND ${NAO_CANCELADA} GROUP BY 1 ORDER BY 3 DESC`, de, ate, loja),
          lojas: await tx.consultar('SELECT id, nome_reduzido AS "nomeReduzido" FROM lojas ORDER BY nome_reduzido'),
        };
      });
      return { status: 200, corpo };
    }

    // ---------------------------------------------------------------- alertas de estoque e lista de compras (UC20)
    if (recurso === 'estoque' && id === 'alertas' && metodo === 'GET') {
      const s = ctx.exigir('erp.estoque.consultar');
      const linhas = await banco.transacao('continuum_app', s.clienteId, (tx) =>
        tx.consultar<{ produtoId: string; nome: string; unidade: string; ean: string | null; estoqueMinimo: number; lojaId: string; loja: string; saldo: number; ultimaMovimentacaoEm: string | null }>(`
          SELECT p.id AS "produtoId", p.nome, p.unidade, p.ean, p.estoque_minimo AS "estoqueMinimo", l.id AS "lojaId", l.nome_reduzido AS loja,
                 COALESCE(sum(m.quantidade), 0)::int AS saldo, max(m.ocorrido_em) AS "ultimaMovimentacaoEm"
          FROM produtos p CROSS JOIN lojas l LEFT JOIN movimentacoes m ON m.produto_id = p.id AND m.loja_id = l.id
          GROUP BY p.id, l.id ORDER BY p.nome, l.nome_reduzido`),
      );
      const negativos = linhas.filter((l) => l.saldo < 0);
      const abaixoDoMinimo = linhas.filter((l) => l.saldo >= 0 && l.estoqueMinimo > 0 && l.saldo <= l.estoqueMinimo);
      const compras = [...negativos, ...abaixoDoMinimo]
        .filter((l) => l.estoqueMinimo > 0 || l.saldo < 0)
        .map((l) => ({ ...l, comprar: Math.max(l.estoqueMinimo * FATOR_DE_REPOSICAO - l.saldo, 1) }))
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
      return {
        status: 200,
        corpo: { negativos, abaixoDoMinimo, compras, semMinimo: new Set(linhas.filter((l) => l.estoqueMinimo === 0).map((l) => l.produtoId)).size, fatorDeReposicao: FATOR_DE_REPOSICAO },
      };
    }

    // ---------------------------------------------------------------- usuários (UC16)
    if (recurso === 'usuarios' && metodo === 'GET' && id === undefined) {
      const s = ctx.exigir('erp.usuarios.gerenciar');
      const usuarios = await banco.transacao('continuum_app', s.clienteId, (tx) => tx.consultar('SELECT id, nome, email, perfil, ativo FROM usuarios ORDER BY ativo DESC, nome'));
      return { status: 200, corpo: { usuarios, eu: s.usuarioId } };
    }
    if (recurso === 'usuarios' && metodo === 'POST' && id === undefined) {
      const s = ctx.exigir('erp.usuarios.gerenciar');
      const nome = texto(c['nome']);
      if (nome === '') throw new RecusaDaNuvem(400, 'Informe o nome.');
      const email = texto(c['email']).toLowerCase();
      if (!PADRAO_EMAIL.test(email)) throw new RecusaDaNuvem(400, 'E-mail inválido.');
      const perfil = texto(c['perfil']);
      if (!(PERFIS_DO_ERP as readonly string[]).includes(perfil)) throw new RecusaDaNuvem(400, 'Perfil: dono, gerente, supervisor ou operador.');
      const senha = texto(c['senha']);
      const fraca = senhaAceitavel(senha);
      if (fraca !== null) throw new RecusaDaNuvem(400, fraca);
      const novoId = gerarId();
      await banco.transacao('continuum_app', s.clienteId, async (tx) => {
        if ((await tx.consultarUma('SELECT 1 FROM usuarios WHERE lower(email) = $1', email)) !== undefined) throw new RecusaDaNuvem(409, 'Já existe um usuário com este e-mail.');
        await tx.consultar('INSERT INTO usuarios (id, cliente_id, nome, email, senha_hash, perfil) VALUES ($1, $2, $3, $4, $5, $6)', novoId, s.clienteId, nome, email, hashDaSenha(senha), perfil);
        await auditar(tx, s.clienteId as string, s.usuarioId, 'usuario.criado', novoId, { nome, email, perfil });
      });
      return { status: 201, corpo: { id: novoId } };
    }
    if (recurso === 'usuarios' && metodo === 'PUT' && id !== undefined && partes.length === 4) {
      const s = ctx.exigir('erp.usuarios.gerenciar');
      await banco.transacao('continuum_app', s.clienteId, async (tx) => {
        const atual = await tx.consultarUma<{ nome: string; perfil: string; ativo: boolean }>('SELECT nome, perfil, ativo FROM usuarios WHERE id = $1 FOR UPDATE', id);
        if (atual === undefined) throw new RecusaDaNuvem(404, 'Usuário não encontrado.');
        const nome = c['nome'] === undefined ? atual.nome : texto(c['nome']);
        if (nome === '') throw new RecusaDaNuvem(400, 'Informe o nome.');
        const perfil = c['perfil'] === undefined ? atual.perfil : texto(c['perfil']);
        if (!(PERFIS_DO_ERP as readonly string[]).includes(perfil)) throw new RecusaDaNuvem(400, 'Perfil: dono, gerente, supervisor ou operador.');
        const ativo = c['ativo'] === undefined ? atual.ativo : c['ativo'] === true;
        if (id === s.usuarioId && (perfil !== atual.perfil || !ativo)) throw new RecusaDaNuvem(409, 'Você não pode mudar o seu próprio perfil nem se desativar.');
        if (atual.perfil === 'dono' && atual.ativo && (perfil !== 'dono' || !ativo)) {
          const donos = Number((await tx.consultarUma<{ n: number }>("SELECT count(*)::int AS n FROM usuarios WHERE perfil = 'dono' AND ativo"))?.n ?? 0);
          if (donos <= 1) throw new RecusaDaNuvem(409, 'O negócio precisa de pelo menos um dono ativo.');
        }
        const senha = texto(c['senha']);
        if (senha !== '') {
          const fraca = senhaAceitavel(senha);
          if (fraca !== null) throw new RecusaDaNuvem(400, fraca);
          await tx.consultar('UPDATE usuarios SET senha_hash = $2 WHERE id = $1', id, hashDaSenha(senha));
        }
        await tx.consultar('UPDATE usuarios SET nome = $2, perfil = $3, ativo = $4 WHERE id = $1', id, nome, perfil, ativo);
        await auditar(tx, s.clienteId as string, s.usuarioId, 'usuario.alterado', id, { nome, perfil, ativo, trocouSenha: senha !== '' });
      });
      return { status: 200, corpo: { ok: true } };
    }

    // ---------------------------------------------------------------- PIN do supervisor
    if (recurso === 'pin' && partes.length === 3 && metodo === 'GET') {
      const s = ctx.exigir('erp.loja.configurar');
      const linha = await banco.transacao('continuum_app', s.clienteId, (tx) => tx.consultarUma<{ definido: boolean }>('SELECT pin_supervisor_hash IS NOT NULL AS definido FROM parametros_cliente'));
      return { status: 200, corpo: { definido: linha?.definido === true } };
    }
    if (recurso === 'pin' && partes.length === 3 && metodo === 'PUT') {
      const s = ctx.exigir('erp.loja.configurar');
      const pin = texto(c['pin']);
      if (!/^\d{4,8}$/.test(pin)) throw new RecusaDaNuvem(400, 'O PIN deve ter de 4 a 8 números.');
      if (/^(\d)\1+$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) throw new RecusaDaNuvem(400, 'PIN fácil demais (números repetidos ou em sequência). Escolha outro.');
      const hash = hashDoPinDoSupervisor(pin);
      const versao = await banco.transacao('continuum_app', s.clienteId, async (tx) => {
        const linha = await tx.consultarUma<{ versao: number; regra_estoque: string; limite_desconto_pct: number; comprovante: unknown }>(
          'UPDATE parametros_cliente SET pin_supervisor_hash = $1, versao = versao + 1 RETURNING versao, regra_estoque, limite_desconto_pct, comprovante',
          hash,
        );
        if (linha === undefined) throw new RecusaDaNuvem(404, 'Parâmetros do cliente não encontrados.');
        // Desce para os caixas só o hash: o caixa confere o PIN digitado sem nunca saber o PIN.
        await tx.consultar(
          "INSERT INTO alteracoes (cliente_id, entidade, entidade_id, versao, dados) VALUES ($1, 'parametros', $1, $2, $3)",
          s.clienteId, linha.versao, JSON.stringify({ regraEstoque: linha.regra_estoque, limiteDescontoPct: linha.limite_desconto_pct, comprovante: linha.comprovante, pinSupervisorHash: hash }),
        );
        await auditar(tx, s.clienteId as string, s.usuarioId, 'pin.alterado', s.clienteId as string, {});
        return linha.versao;
      });
      return { status: 200, corpo: { versao } };
    }

    // ---------------------------------------------------------------- importar produtos de uma planilha
    if (recurso === 'produtos' && id === 'importar' && metodo === 'POST') {
      const s = ctx.exigir('erp.produtos.editar');
      const linhas = Array.isArray(c['linhas']) ? (c['linhas'] as unknown[]) : [];
      if (linhas.length === 0) throw new RecusaDaNuvem(400, 'A planilha não tem produtos.');
      if (linhas.length > MAXIMO_LINHAS_IMPORTACAO) throw new RecusaDaNuvem(400, `No máximo ${MAXIMO_LINHAS_IMPORTACAO} produtos por vez.`);
      const lojaId = texto(c['lojaId']) || null;
      const erros: { linha: number; mensagem: string }[] = [];
      const lidos: (ReturnType<typeof lerProduto> & { estoqueInicial: number })[] = [];
      const eans = new Map<string, number>();
      linhas.forEach((bruta, i) => {
        const l = objeto(bruta);
        const numero = Number(l['linha'] ?? i + 2); // a linha 1 da planilha é o cabeçalho
        try {
          // Na planilha o preço é em reais: a tela já converte; se não conseguiu, a mensagem fala em reais.
          if (typeof l['precoCentavos'] !== 'number') throw new RecusaDaNuvem(400, `Preço inválido ("${String(l['precoCentavos'] ?? '')}"): use, por exemplo, 12,90.`);
          const p = lerProduto(l);
          const estoqueInicial = l['estoqueInicial'] === undefined || l['estoqueInicial'] === '' ? 0 : Number(l['estoqueInicial']);
          if (!Number.isSafeInteger(estoqueInicial) || estoqueInicial < 0) throw new RecusaDaNuvem(400, 'Estoque inicial inválido (número inteiro, sem negativo).');
          if (p.ean !== null) {
            const repetido = eans.get(p.ean);
            if (repetido !== undefined) throw new RecusaDaNuvem(400, `Código de barras repetido na planilha (linha ${repetido}).`);
            eans.set(p.ean, numero);
          }
          lidos.push({ ...p, estoqueInicial });
        } catch (erro) {
          erros.push({ linha: numero, mensagem: (erro as Error).message });
        }
      });
      if (lidos.some((p) => p.estoqueInicial > 0)) {
        ctx.exigir('erp.estoque.movimentar');
        if (lojaId === null) throw new RecusaDaNuvem(400, 'Escolha a loja que recebe o estoque inicial.');
      }
      const resultado = await banco.transacao('continuum_app', s.clienteId, async (tx) => {
        if (lojaId !== null && (await tx.consultarUma('SELECT 1 FROM lojas WHERE id = $1', lojaId)) === undefined) throw new RecusaDaNuvem(404, 'Loja não encontrada.');
        if (eans.size > 0) {
          const existentes = await tx.consultar<{ ean: string; nome: string }>('SELECT ean, nome FROM produtos WHERE ean = ANY($1::text[])', [...eans.keys()]);
          for (const e of existentes) erros.push({ linha: eans.get(e.ean) ?? 0, mensagem: `Código de barras já cadastrado em "${e.nome}".` });
        }
        // Tudo ou nada: com qualquer erro, nada é cadastrado e a tela mostra cada linha a corrigir.
        if (erros.length > 0) return null;
        for (const p of lidos) {
          const novo = { id: gerarId(), version: 1, ...p };
          await tx.consultar(
            'INSERT INTO produtos (id, cliente_id, nome, preco_centavos, unidade, ean, estoque_minimo, version) VALUES ($1, $2, $3, $4, $5, $6, $7, 1)',
            novo.id, s.clienteId, p.nome, p.precoCentavos, p.unidade, p.ean, p.estoqueMinimo,
          );
          await avisarDescidaDoProduto(tx, s.clienteId as string, novo);
          if (p.estoqueInicial > 0 && lojaId !== null) {
            const movimentacaoId = gerarId();
            await tx.consultar(
              "INSERT INTO movimentacoes (id, cliente_id, loja_id, produto_id, tipo, quantidade, motivo, ocorrido_em) VALUES ($1, $2, $3, $4, 'ENTRADA', $5, 'estoque inicial (importação)', now())",
              movimentacaoId, s.clienteId, lojaId, novo.id, p.estoqueInicial,
            );
            await tx.consultar(
              "INSERT INTO alteracoes (cliente_id, entidade, entidade_id, versao, dados) VALUES ($1, 'estoque', $2, 1, $3)",
              s.clienteId, movimentacaoId, JSON.stringify({ movimentacaoId, lojaId, produtoId: novo.id, tipo: 'ENTRADA', quantidade: p.estoqueInicial, motivo: 'estoque inicial (importação)' }),
            );
          }
        }
        await auditar(tx, s.clienteId as string, s.usuarioId, 'produtos.importados', s.clienteId as string, { quantidade: lidos.length });
        return lidos.length;
      });
      if (resultado === null) return { status: 400, corpo: { erro: 'Planilha', mensagem: `${erros.length} linha(s) com problema. Nada foi cadastrado.`, erros: erros.sort((a, b) => a.linha - b.linha) } };
      return { status: 201, corpo: { importados: resultado } };
    }

    // ---------------------------------------------------------------- fechamentos de caixa
    if (recurso === 'fechamentos' && metodo === 'GET' && partes.length === 3) {
      const s = ctx.exigir('erp.relatorios.ver');
      const q = consulta(ctx.pedido.caminho);
      const de = lerDia(q.get('de'), 'De');
      const ate = lerDia(q.get('ate'), 'Até');
      const fechamentos = await banco.transacao('continuum_app', s.clienteId, (tx) =>
        tx.consultar(`
          SELECT s.id, l.nome_reduzido AS loja, d.numero_caixa AS "numeroCaixa", s.operador,
                 s.fundo_centavos::int AS "fundoCentavos", s.aberta_em AS "abertaEm", s.fechada_em AS "fechadaEm",
                 s.contado_centavos::int AS "contadoCentavos", s.esperado_centavos::int AS "esperadoCentavos",
                 (s.contado_centavos - s.esperado_centavos)::int AS "diferencaCentavos",
                 COALESCE((SELECT sum(m.valor_centavos) FROM movimentos_caixa m WHERE m.sessao_id = s.id AND m.tipo = 'SANGRIA'), 0)::int AS "sangriasCentavos",
                 COALESCE((SELECT sum(m.valor_centavos) FROM movimentos_caixa m WHERE m.sessao_id = s.id AND m.tipo = 'SUPRIMENTO'), 0)::int AS "suprimentosCentavos",
                 (SELECT count(*) FROM vendas v WHERE v.sessao_id = s.id AND ${NAO_CANCELADA})::int AS vendas,
                 COALESCE((SELECT sum(v.liquido_centavos) FROM vendas v WHERE v.sessao_id = s.id AND ${NAO_CANCELADA}), 0)::int AS "vendidoCentavos",
                 COALESCE((SELECT sum(p.valor_centavos) FROM pagamentos p JOIN vendas v ON v.id = p.venda_id
                           WHERE v.sessao_id = s.id AND p.forma = 'dinheiro' AND ${NAO_CANCELADA}), 0)::int AS "dinheiroCentavos"
          FROM sessoes_caixa s JOIN dispositivos d ON d.id = s.dispositivo_id JOIN lojas l ON l.id = d.loja_id
          WHERE (s.aberta_em AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN $1::date AND $2::date
          ORDER BY s.aberta_em DESC`, de, ate),
      );
      return { status: 200, corpo: { de, ate, fechamentos } };
    }
    return null;
  };
}
