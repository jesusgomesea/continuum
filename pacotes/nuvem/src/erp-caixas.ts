// Rotas do ERP do cliente (Passo 2.5): caixas e ativação (UC17), relatório de vendas (UC18) e validação de
// venda pelo código (UC19).
//
//   GET  /v1/erp/caixas                       caixas e agentes da loja, com o último sinal de vida
//   POST /v1/erp/caixas                       novo caixa: devolve o código de ativação (mostrado uma vez só)
//   POST /v1/erp/caixas/{id}/novo-codigo      código novo para um caixa ainda não ativado (ou vencido)
//   POST /v1/erp/caixas/{id}/desativar        caixa perdido, roubado ou trocado: perde o acesso na hora
//   GET  /v1/erp/relatorios/vendas?dia=AAAA-MM-DD   vendas do dia: total, por forma, mais vendidos, por caixa
//   GET  /v1/erp/vendas/validar?codigo=...    confere um comprovante
import { conferenciaConfere, gerarId, lerCodigoDaVenda } from '@continuum/dominio';
import type { BancoNuvem, Transacao } from './banco.ts';
import { RecusaDaNuvem } from './api.ts';
import type { Rota } from './api.ts';
import { gerarCodigoDeAtivacao, hashDoCodigo, VALIDADE_DO_CODIGO_MS } from './seguranca.ts';

const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

function consulta(caminho: string): URLSearchParams {
  return new URLSearchParams(caminho.split('?')[1] ?? '');
}

async function auditar(tx: Transacao, clienteId: string, autorId: string, acao: string, alvo: string, dados: unknown): Promise<void> {
  await tx.consultar('INSERT INTO auditoria (id, cliente_id, autor_id, acao, alvo, dados) VALUES ($1, $2, $3, $4, $5, $6)', gerarId(), clienteId, autorId, acao, alvo, JSON.stringify(dados));
}

export function rotasDosCaixas(banco: BancoNuvem, segredo: string): Rota {
  return async (ctx, partes) => {
    if (partes[0] !== 'v1' || partes[1] !== 'erp') return null;
    const metodo = ctx.pedido.metodo;
    const [, , recurso, id, acao] = partes;

    // ---------------------------------------------------------------- caixas (UC17, UC05)
    if (recurso === 'caixas' && id === undefined && metodo === 'GET') {
      const s = ctx.exigir('erp.caixas.ativar');
      const caixas = await banco.transacao('continuum_app', s.clienteId, (tx) =>
        tx.consultar(`
          SELECT d.id, d.tipo, d.numero_caixa AS "numeroCaixa", d.situacao, d.codigo_expira_em AS "codigoExpiraEm", d.versao_instalada AS "versaoInstalada",
                 l.nome_reduzido AS loja, sv.estado, sv.fila_pendente AS "filaPendente", sv.caixa_aberto AS "caixaAberto", sv.recebido_em AS "ultimoSinalEm"
          FROM dispositivos d JOIN lojas l ON l.id = d.loja_id LEFT JOIN sinais_de_vida sv ON sv.dispositivo_id = d.id
          ORDER BY l.nome_reduzido, d.tipo DESC, d.numero_caixa`),
      );
      return { status: 200, corpo: { caixas } };
    }

    if (recurso === 'caixas' && id === undefined && metodo === 'POST') {
      const s = ctx.exigir('erp.caixas.ativar');
      const tipo = texto(ctx.corpo['tipo']) || 'pdv';
      if (tipo !== 'pdv' && tipo !== 'agente') throw new RecusaDaNuvem(400, 'Tipo: pdv (caixa) ou agente (computador da loja).');
      const lojaId = texto(ctx.corpo['lojaId']);
      const codigo = gerarCodigoDeAtivacao();
      const resultado = await banco.transacao('continuum_app', s.clienteId, async (tx) => {
        const loja = await tx.consultarUma<{ nome_reduzido: string }>('SELECT nome_reduzido FROM lojas WHERE id = $1', lojaId);
        if (loja === undefined) throw new RecusaDaNuvem(404, 'Loja não encontrada.');
        let numeroCaixa: number | null = null;
        if (tipo === 'pdv') {
          // O próximo número livre da loja (1 a 9): é o dígito do caixa no código da venda.
          const usados = new Set((await tx.consultar<{ n: number }>("SELECT numero_caixa AS n FROM dispositivos WHERE loja_id = $1 AND tipo = 'pdv'", lojaId)).map((l) => l.n));
          const pedido = ctx.corpo['numeroCaixa'] === undefined ? null : Number(ctx.corpo['numeroCaixa']);
          numeroCaixa = pedido ?? [1, 2, 3, 4, 5, 6, 7, 8, 9].find((n) => !usados.has(n)) ?? null;
          if (numeroCaixa === null) throw new RecusaDaNuvem(409, 'A loja já tem 9 caixas (o máximo).');
          if (!Number.isInteger(numeroCaixa) || numeroCaixa < 1 || numeroCaixa > 9) throw new RecusaDaNuvem(400, 'Número do caixa: de 1 a 9.');
          if (usados.has(numeroCaixa)) throw new RecusaDaNuvem(409, `A loja já tem o Caixa ${numeroCaixa}.`);
        }
        const dispositivoId = gerarId();
        const expiraEm = new Date(Date.now() + VALIDADE_DO_CODIGO_MS);
        await tx.consultar(
          `INSERT INTO dispositivos (id, cliente_id, loja_id, tipo, numero_caixa, situacao, codigo_ativacao_hash, codigo_expira_em)
           VALUES ($1, $2, $3, $4, $5, 'pendente', $6, $7)`,
          dispositivoId, s.clienteId, lojaId, tipo, numeroCaixa, hashDoCodigo(codigo, segredo), expiraEm,
        );
        await auditar(tx, s.clienteId as string, s.usuarioId, 'caixa.criado', dispositivoId, { tipo, numeroCaixa, loja: loja.nome_reduzido });
        return { id: dispositivoId, numeroCaixa, expiraEm: expiraEm.toISOString() };
      });
      // O código aparece só agora: no banco fica apenas o hash.
      return { status: 201, corpo: { ...resultado, codigo } };
    }

    if (recurso === 'caixas' && id !== undefined && acao === 'novo-codigo' && metodo === 'POST') {
      const s = ctx.exigir('erp.caixas.ativar');
      const codigo = gerarCodigoDeAtivacao();
      const expiraEm = new Date(Date.now() + VALIDADE_DO_CODIGO_MS);
      await banco.transacao('continuum_app', s.clienteId, async (tx) => {
        const r = await tx.consultar(
          `UPDATE dispositivos SET codigo_ativacao_hash = $2, codigo_expira_em = $3, situacao = 'pendente'
           WHERE id = $1 AND situacao IN ('pendente', 'expirado') RETURNING id`,
          id, hashDoCodigo(codigo, segredo), expiraEm,
        );
        if (r.length === 0) throw new RecusaDaNuvem(409, 'Só dá para gerar código novo para caixa ainda não ativado.');
        await auditar(tx, s.clienteId as string, s.usuarioId, 'caixa.novo-codigo', id, {});
      });
      return { status: 200, corpo: { codigo, expiraEm: expiraEm.toISOString() } };
    }

    if (recurso === 'caixas' && id !== undefined && acao === 'desativar' && metodo === 'POST') {
      const s = ctx.exigir('erp.caixas.ativar');
      await banco.transacao('continuum_app', s.clienteId, async (tx) => {
        const r = await tx.consultar(
          "UPDATE dispositivos SET situacao = 'desativado', credencial_hash = NULL, codigo_ativacao_hash = NULL WHERE id = $1 AND situacao <> 'desativado' RETURNING id",
          id,
        );
        if (r.length === 0) throw new RecusaDaNuvem(404, 'Caixa não encontrado ou já desativado.');
        await auditar(tx, s.clienteId as string, s.usuarioId, 'caixa.desativado', id, {});
      });
      return { status: 200, corpo: { situacao: 'desativado' } };
    }

    // ---------------------------------------------------------------- relatório de vendas (UC18)
    if (recurso === 'relatorios' && id === 'vendas' && metodo === 'GET') {
      const s = ctx.exigir('erp.relatorios.ver');
      const dia = consulta(ctx.pedido.caminho).get('dia') ?? new Date().toISOString().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) throw new RecusaDaNuvem(400, 'Dia no formato AAAA-MM-DD.');
      // O dia é o do horário de Brasília (a loja), não o de Greenwich.
      const filtro = `(v.ocorrido_em AT TIME ZONE 'America/Sao_Paulo')::date = $1::date AND NOT EXISTS (SELECT 1 FROM cancelamentos c WHERE c.venda_id = v.id)`;
      const relatorio = await banco.transacao('continuum_app', s.clienteId, async (tx) => ({
        dia,
        totais: await tx.consultarUma(`
          SELECT count(*)::int AS vendas, COALESCE(sum(v.liquido_centavos), 0)::int AS "liquidoCentavos",
                 COALESCE(sum(v.desconto_centavos), 0)::int AS "descontosCentavos"
          FROM vendas v WHERE ${filtro}`, dia),
        canceladas: await tx.consultarUma(`
          SELECT count(*)::int AS quantidade, COALESCE(sum(v.liquido_centavos), 0)::int AS "liquidoCentavos"
          FROM vendas v JOIN cancelamentos c ON c.venda_id = v.id
          WHERE (v.ocorrido_em AT TIME ZONE 'America/Sao_Paulo')::date = $1::date`, dia),
        porForma: await tx.consultar(`
          SELECT p.forma, sum(p.valor_centavos)::int AS "valorCentavos"
          FROM pagamentos p JOIN vendas v ON v.id = p.venda_id WHERE ${filtro} GROUP BY p.forma ORDER BY 2 DESC`, dia),
        trocoCentavos: Number((await tx.consultarUma<{ t: number }>(`SELECT COALESCE(sum(v.troco_centavos), 0)::int AS t FROM vendas v WHERE ${filtro}`, dia))?.t ?? 0),
        maisVendidos: await tx.consultar(`
          SELECT pr.nome, sum(i.quantidade)::int AS quantidade, sum(i.quantidade * i.preco_unitario_centavos - i.desconto_centavos)::int AS "valorCentavos"
          FROM itens_venda i JOIN vendas v ON v.id = i.venda_id JOIN produtos pr ON pr.id = i.produto_id
          WHERE ${filtro} GROUP BY pr.nome ORDER BY 2 DESC LIMIT 10`, dia),
        porCaixa: await tx.consultar(`
          SELECT l.nome_reduzido AS loja, d.numero_caixa AS "numeroCaixa", count(*)::int AS vendas, sum(v.liquido_centavos)::int AS "liquidoCentavos"
          FROM vendas v JOIN dispositivos d ON d.id = v.dispositivo_id JOIN lojas l ON l.id = v.loja_id
          WHERE ${filtro} GROUP BY l.nome_reduzido, d.numero_caixa ORDER BY 1, 2`, dia),
      }));
      return { status: 200, corpo: relatorio };
    }

    // ---------------------------------------------------------------- validar venda pelo código (UC19)
    if (recurso === 'vendas' && id === 'validar' && metodo === 'GET') {
      const s = ctx.exigir('erp.vendas.validar');
      const digitado = consulta(ctx.pedido.caminho).get('codigo') ?? '';
      const partes = lerCodigoDaVenda(digitado);
      if (partes === null) return { status: 200, corpo: { valida: false, motivo: 'Formato inválido. O código é como MERCBAIRRO-10123-ABCD.' } };
      const codigo = digitado.trim().toUpperCase();
      const resultado = await banco.transacao('continuum_app', s.clienteId, async (tx) => {
        // Procura pela loja, pelo caixa e pelo número; depois confere os 4 caracteres (assim um código
        // adulterado é reconhecido como adulterado, e não como "não encontrado").
        const venda = await tx.consultarUma<{ id: string; liquido_centavos: string; troco_centavos: string; ocorrido_em: Date; documento_cliente: string | null }>(
          `SELECT v.id, v.liquido_centavos, v.troco_centavos, v.ocorrido_em, v.documento_cliente
           FROM vendas v JOIN lojas l ON l.id = v.loja_id JOIN dispositivos d ON d.id = v.dispositivo_id
           WHERE l.nome_reduzido = $1 AND d.numero_caixa = $2 AND v.numero = $3`,
          partes.nomeReduzido, partes.numeroCaixa, partes.numeroVenda,
        );
        if (venda === undefined) {
          // Pode ser venda que ainda não subiu do caixa (sem internet): não é necessariamente falsa.
          return { valida: false, motivo: 'Não encontramos esta venda. Se foi feita há pouco num caixa sem internet, ela aparece quando o caixa sincronizar.' };
        }
        if (!conferenciaConfere(partes, venda.id)) return { valida: false, motivo: 'Os 4 caracteres de conferência não batem: código errado ou adulterado.' };
        const cancelamento = await tx.consultarUma<{ motivo: string; cancelado_em: Date }>('SELECT motivo, cancelado_em FROM cancelamentos WHERE venda_id = $1', venda.id);
        return {
          valida: true,
          codigo,
          ocorridoEm: venda.ocorrido_em,
          liquidoCentavos: Number(venda.liquido_centavos),
          trocoCentavos: Number(venda.troco_centavos),
          itens: await tx.consultar(
            `SELECT pr.nome, i.quantidade::int AS quantidade, i.preco_unitario_centavos::int AS "precoUnitarioCentavos"
             FROM itens_venda i JOIN produtos pr ON pr.id = i.produto_id WHERE i.venda_id = $1 ORDER BY i.posicao`,
            venda.id,
          ),
          pagamentos: await tx.consultar('SELECT forma, valor_centavos::int AS "valorCentavos" FROM pagamentos WHERE venda_id = $1', venda.id),
          cancelada: cancelamento === undefined ? null : { motivo: cancelamento.motivo, canceladaEm: cancelamento.cancelado_em },
        };
      });
      return { status: 200, corpo: resultado };
    }
    return null;
  };
}
