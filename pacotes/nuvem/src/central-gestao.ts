// Rotas de acompanhamento do Continuum Central: histórico de conexão dos caixas, auditoria, ficha do cliente
// e plano/cobrança (com suspensão automática de quem atrasa demais). Tudo exige a sessão da Equipe.
//
//   GET  /v1/central/monitor/historico?horas=24     quedas e mudanças de estado dos caixas
//   GET  /v1/central/auditoria?cliente=&limite=      quem mudou o quê e quando (Equipe, ERP e caixas)
//   GET  /v1/central/clientes/{id}/ficha             lojas, caixas, vendas de 30 dias, quedas, plano, auditoria
//   PUT  /v1/central/clientes/{id}/plano             plano, mensalidade e dia de vencimento
//   POST /v1/central/clientes/{id}/pagamentos        registra o pagamento de um mês (e reativa, se foi suspenso por isso)
import { gerarId } from '@continuum/dominio';
import type { BancoNuvem, Transacao } from './banco.ts';
import { RecusaDaNuvem } from './api.ts';
import type { Rota } from './api.ts';

const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Depois de quantos dias de atraso o ERP do cliente é suspenso sozinho. */
export const DIAS_DE_TOLERANCIA = 10;
/** Quantos dias antes do vencimento a situação vira "vence logo". */
export const DIAS_DE_AVISO = 5;
/** Autor das ações automáticas na auditoria (não é uma pessoa). */
export const AUTOR_SISTEMA = '00000000-0000-7000-8000-000000000000';
export const PLANOS = ['mvp', 'essencial', 'loja', 'rede'] as const;

export type SituacaoDoPlano = 'isento' | 'sem-registro' | 'em-dia' | 'vence-logo' | 'atrasado';

/**
 * A situação de pagamento do cliente. "pagoAte" é até quando o último pagamento cobre (AAAA-MM-DD).
 * Sem mensalidade: isento. Com mensalidade e sem nenhum pagamento: sem registro (nunca suspende sozinho).
 */
export function situacaoDoPlano(mensalidadeCentavos: number, pagoAte: string | null, hoje: string): { situacao: SituacaoDoPlano; dias: number } {
  if (mensalidadeCentavos <= 0) return { situacao: 'isento', dias: 0 };
  if (pagoAte === null) return { situacao: 'sem-registro', dias: 0 };
  const dias = Math.round((Date.parse(`${pagoAte}T00:00:00Z`) - Date.parse(`${hoje}T00:00:00Z`)) / 86_400_000);
  if (dias < 0) return { situacao: 'atrasado', dias: -dias };
  if (dias <= DIAS_DE_AVISO) return { situacao: 'vence-logo', dias };
  return { situacao: 'em-dia', dias };
}

/** Até quando o pagamento de um mês cobre: o vencimento do mês seguinte ao da referência. */
export function coberturaDoPagamento(referencia: string, diaVencimento: number): string {
  const [ano, mes] = referencia.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(ano, mes, diaVencimento)).toISOString().slice(0, 10);
}

async function auditar(tx: Transacao, autorId: string, clienteId: string | null, acao: string, alvo: string, dados: unknown): Promise<void> {
  await tx.consultar('INSERT INTO auditoria (id, cliente_id, autor_id, acao, alvo, dados) VALUES ($1, $2, $3, $4, $5, $6)', gerarId(), clienteId, autorId, acao, alvo, JSON.stringify(dados));
}

/**
 * Suspende quem passou da tolerância de atraso. Só clientes com mensalidade e com pagamento registrado
 * (quem nunca teve cobrança configurada não é suspenso por engano). Devolve quantos foram suspensos.
 */
export async function aplicarInadimplencia(banco: BancoNuvem): Promise<number> {
  return banco.transacaoDaPlataforma(async (tx) => {
    const suspensos = await tx.consultar<{ id: string }>(`
      UPDATE clientes SET situacao = 'suspenso', suspenso_por = 'inadimplencia'
      WHERE situacao = 'ativo' AND mensalidade_centavos > 0 AND pago_ate IS NOT NULL
        AND pago_ate < (now() AT TIME ZONE 'America/Sao_Paulo')::date - ${DIAS_DE_TOLERANCIA}
      RETURNING id`);
    for (const s of suspensos) await auditar(tx, AUTOR_SISTEMA, s.id, 'cliente.suspenso-por-atraso', s.id, { tolerancia: DIAS_DE_TOLERANCIA });
    return suspensos.length;
  });
}

export function rotasDaGestaoDoCentral(banco: BancoNuvem): Rota {
  return async (ctx, partes) => {
    if (partes[0] !== 'v1' || partes[1] !== 'central') return null;
    const metodo = ctx.pedido.metodo;
    const q = new URLSearchParams(ctx.pedido.caminho.split('?')[1] ?? '');

    // ---------------------------------------------------------------- histórico de conexão
    if (partes[2] === 'monitor' && partes[3] === 'historico' && metodo === 'GET') {
      ctx.exigir('central.monitor');
      const horas = Math.min(Math.max(Number(q.get('horas') ?? 24) || 24, 1), 24 * 30);
      const eventos = await banco.transacao('continuum_central', null, (tx) =>
        tx.consultar(`
          SELECT e.id, e.tipo, e.estado_anterior AS "estadoAnterior", e.estado, e.segundos_sem_sinal AS "segundosSemSinal", e.em,
                 e.dispositivo_id AS "dispositivoId", d.tipo AS "tipoDispositivo", d.numero_caixa AS "numeroCaixa",
                 l.nome_reduzido AS loja, COALESCE(c.nome_fantasia, c.nome) AS cliente, c.id AS "clienteId"
          FROM eventos_de_conexao e JOIN dispositivos d ON d.id = e.dispositivo_id JOIN lojas l ON l.id = d.loja_id JOIN clientes c ON c.id = e.cliente_id
          WHERE e.em > now() - make_interval(hours => $1)
          ORDER BY e.em DESC LIMIT 300`, horas),
      );
      return { status: 200, corpo: { horas, eventos } };
    }

    // ---------------------------------------------------------------- auditoria
    if (partes[2] === 'auditoria' && partes.length === 3 && metodo === 'GET') {
      ctx.exigir('central.clientes');
      const cliente = texto(q.get('cliente')) || null;
      const limite = Math.min(Math.max(Number(q.get('limite') ?? 100) || 100, 1), 500);
      const registros = await banco.transacao('continuum_central', null, (tx) =>
        tx.consultar(`
          SELECT a.id, a.acao, a.alvo, a.dados, a.em, a.cliente_id AS "clienteId", COALESCE(c.nome_fantasia, c.nome) AS cliente,
                 CASE WHEN a.autor_id = '${AUTOR_SISTEMA}' THEN 'Sistema (automático)'
                      ELSE COALESCE(eq.nome || ' (Equipe)', u.nome || ' (' || u.perfil || ')',
                                    CASE WHEN d.tipo = 'pdv' THEN 'Caixa ' || d.numero_caixa ELSE 'Agente da loja' END, 'desconhecido') END AS autor
          FROM auditoria a
          LEFT JOIN clientes c ON c.id = a.cliente_id
          LEFT JOIN equipe_continuum eq ON eq.id = a.autor_id
          LEFT JOIN usuarios u ON u.id = a.autor_id
          LEFT JOIN dispositivos d ON d.id = a.autor_id
          WHERE ($1::uuid IS NULL OR a.cliente_id = $1::uuid)
          ORDER BY a.em DESC LIMIT $2`, cliente, limite),
      );
      return { status: 200, corpo: { registros } };
    }

    if (partes[2] !== 'clientes' || partes[3] === undefined) return null;
    const id = partes[3];

    // ---------------------------------------------------------------- ficha do cliente
    if (partes[4] === 'ficha' && metodo === 'GET') {
      ctx.exigir('central.clientes');
      const ficha = await banco.transacao('continuum_central', null, async (tx) => {
        const cliente = await tx.consultarUma<{ mensalidade_centavos: string; pago_ate: string | null; hoje: string }>(
          `SELECT c.*, to_char(c.pago_ate, 'YYYY-MM-DD') AS pago_ate, to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD') AS hoje FROM clientes c WHERE c.id = $1`,
          id,
        );
        if (cliente === undefined) throw new RecusaDaNuvem(404, 'Cliente não encontrado.');
        return {
          cliente,
          plano: situacaoDoPlano(Number(cliente.mensalidade_centavos), cliente.pago_ate, cliente.hoje),
          caixas: await tx.consultar(`
            SELECT d.id, d.tipo, d.numero_caixa AS "numeroCaixa", d.situacao, l.nome_reduzido AS loja, d.versao_instalada AS "versaoInstalada",
                   sv.estado, sv.versao, sv.fila_pendente AS "filaPendente", sv.recebido_em AS "ultimoSinalEm",
                   floor(extract(epoch FROM now() - sv.recebido_em))::int AS "segundosSemSinal",
                   (SELECT count(*)::int FROM eventos_de_conexao e WHERE e.dispositivo_id = d.id AND e.tipo = 'retorno' AND e.em > now() - interval '7 days') AS "quedas7d"
            FROM dispositivos d JOIN lojas l ON l.id = d.loja_id LEFT JOIN sinais_de_vida sv ON sv.dispositivo_id = d.id
            WHERE d.cliente_id = $1 ORDER BY l.nome_reduzido, d.tipo DESC, d.numero_caixa`, id),
          vendas30: await tx.consultar(`
            SELECT to_char((v.ocorrido_em AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD') AS dia, count(*)::int AS vendas, sum(v.liquido_centavos)::int AS "liquidoCentavos"
            FROM vendas v WHERE v.cliente_id = $1 AND v.ocorrido_em > now() - interval '30 days'
              AND NOT EXISTS (SELECT 1 FROM cancelamentos x WHERE x.venda_id = v.id)
            GROUP BY 1 ORDER BY 1`, id),
          produtos: Number((await tx.consultarUma<{ n: number }>('SELECT count(*)::int AS n FROM produtos WHERE cliente_id = $1', id))?.n ?? 0),
          usuarios: Number((await tx.consultarUma<{ n: number }>('SELECT count(*)::int AS n FROM usuarios WHERE cliente_id = $1 AND ativo', id))?.n ?? 0),
          pagamentos: await tx.consultar(`
            SELECT p.referencia, p.valor_centavos::int AS "valorCentavos", p.pago_em AS "pagoEm", eq.nome AS "registradoPor"
            FROM pagamentos_plano p LEFT JOIN equipe_continuum eq ON eq.id = p.registrado_por
            WHERE p.cliente_id = $1 ORDER BY p.referencia DESC LIMIT 12`, id),
        };
      });
      return { status: 200, corpo: ficha };
    }

    // ---------------------------------------------------------------- plano e cobrança
    if (partes[4] === 'plano' && metodo === 'PUT') {
      const sessao = ctx.exigir('central.clientes');
      const plano = texto(ctx.corpo['plano']) || 'mvp';
      if (!(PLANOS as readonly string[]).includes(plano)) throw new RecusaDaNuvem(400, `Plano: ${PLANOS.join(', ')}.`);
      const mensalidade = Number(ctx.corpo['mensalidadeCentavos'] ?? 0);
      if (!Number.isSafeInteger(mensalidade) || mensalidade < 0) throw new RecusaDaNuvem(400, 'Mensalidade inválida (em centavos, sem negativo).');
      const dia = Number(ctx.corpo['diaVencimento'] ?? 10);
      if (!Number.isInteger(dia) || dia < 1 || dia > 28) throw new RecusaDaNuvem(400, 'Dia de vencimento: de 1 a 28.');
      await banco.transacaoDaPlataforma(async (tx) => {
        const r = await tx.consultar('UPDATE clientes SET plano = $2, mensalidade_centavos = $3, dia_vencimento = $4 WHERE id = $1 RETURNING id', id, plano, mensalidade, dia);
        if (r.length === 0) throw new RecusaDaNuvem(404, 'Cliente não encontrado.');
        await auditar(tx, sessao.usuarioId, id, 'plano.alterado', id, { plano, mensalidadeCentavos: mensalidade, diaVencimento: dia });
      });
      return { status: 200, corpo: { ok: true } };
    }

    if (partes[4] === 'pagamentos' && metodo === 'POST') {
      const sessao = ctx.exigir('central.clientes');
      const referencia = texto(ctx.corpo['referencia']);
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(referencia)) throw new RecusaDaNuvem(400, 'Mês de referência no formato AAAA-MM.');
      const valor = Number(ctx.corpo['valorCentavos']);
      if (!Number.isSafeInteger(valor) || valor <= 0) throw new RecusaDaNuvem(400, 'Valor pago inválido.');
      const corpo = await banco.transacaoDaPlataforma(async (tx) => {
        const cliente = await tx.consultarUma<{ dia_vencimento: number; situacao: string; suspenso_por: string | null }>('SELECT dia_vencimento, situacao, suspenso_por FROM clientes WHERE id = $1 FOR UPDATE', id);
        if (cliente === undefined) throw new RecusaDaNuvem(404, 'Cliente não encontrado.');
        if ((await tx.consultarUma('SELECT 1 FROM pagamentos_plano WHERE cliente_id = $1 AND referencia = $2', id, referencia)) !== undefined) {
          throw new RecusaDaNuvem(409, `O pagamento de ${referencia} já foi registrado.`);
        }
        await tx.consultar('INSERT INTO pagamentos_plano (id, cliente_id, referencia, valor_centavos, registrado_por) VALUES ($1, $2, $3, $4, $5)', gerarId(), id, referencia, valor, sessao.usuarioId);
        const cobertura = coberturaDoPagamento(referencia, cliente.dia_vencimento);
        const linha = await tx.consultarUma<{ pago_ate: string }>(
          "UPDATE clientes SET pago_ate = GREATEST(COALESCE(pago_ate, $2::date), $2::date) WHERE id = $1 RETURNING to_char(pago_ate, 'YYYY-MM-DD') AS pago_ate",
          id, cobertura,
        );
        // Suspenso por atraso e agora em dia: volta a funcionar na hora. Suspensão feita pela Equipe continua.
        let reativado = false;
        if (cliente.situacao === 'suspenso' && cliente.suspenso_por === 'inadimplencia' && (linha?.pago_ate ?? '') >= new Date().toISOString().slice(0, 10)) {
          await tx.consultar("UPDATE clientes SET situacao = 'ativo', suspenso_por = NULL WHERE id = $1", id);
          reativado = true;
        }
        await auditar(tx, sessao.usuarioId, id, 'pagamento.registrado', id, { referencia, valorCentavos: valor, reativado });
        return { pagoAte: linha?.pago_ate, reativado };
      });
      return { status: 201, corpo };
    }
    return null;
  };
}
