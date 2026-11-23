// Recebimento da fila dos dispositivos na nuvem (Passo 3.2). Mesmas regras do recebimento do OLD e do
// agente (pacotes/sync/src/recebimento.ts), agora no PostgreSQL e já aplicando cada fato nas tabelas do cliente.
//
//   POST /v1/origens/{dispositivo}/eventos   { eventos: [...] }   Authorization: Bearer {credencial}
//   POST /v1/sinais-de-vida                  { ...sinal }          Authorization: Bearer {credencial}
//
// Quem envia se identifica pela credencial recebida na ativação (Passo 3.1). Caixa desativado: recusado.
import { ContratoInvalidoError, lerEvento, lerLista, lerObjeto, lerSinalDeVida } from '@continuum/contratos';
import type { Evento } from '@continuum/contratos';
import type { BancoNuvem, Transacao } from './banco.ts';
import { RecusaDaNuvem } from './api.ts';
import type { PedidoHttp, Rota } from './api.ts';
import { gerarId } from '@continuum/dominio';
import { hashDaCredencial } from './seguranca.ts';

/** Mesmo limite do monitor (central.ts): mais que isso sem sinal conta como queda. */
const SEGUNDOS_SEM_SINAL = 45;

export const MAXIMO_EVENTOS_POR_LOTE = 1000;

type Dispositivo = {
  id: string;
  cliente_id: string;
  loja_id: string;
};

class ForaDeOrdem extends Error {
  readonly ultimaSeq: number;
  constructor(mensagem: string, ultimaSeq: number) {
    super(mensagem);
    this.ultimaSeq = ultimaSeq;
  }
}

function credencialDoPedido(p: PedidoHttp): string {
  const v = p.cabecalhos?.['authorization'];
  const t = Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
  return t.replace(/^Bearer\s+/i, '').trim();
}

async function identificar(banco: BancoNuvem, p: PedidoHttp): Promise<Dispositivo> {
  const credencial = credencialDoPedido(p);
  if (credencial === '') throw new RecusaDaNuvem(401, 'Dispositivo sem credencial: ative o caixa com o código do ERP.');
  const d = await banco.transacaoDaPlataforma((tx) =>
    tx.consultarUma<Dispositivo>("SELECT id, cliente_id, loja_id FROM dispositivos WHERE credencial_hash = $1 AND situacao = 'ativo'", hashDaCredencial(credencial)),
  );
  if (d === undefined) throw new RecusaDaNuvem(403, 'Credencial inválida ou caixa desativado.');
  return d;
}

/** Aplica um fato nas tabelas do cliente (dentro da transação do lote). */
async function aplicar(tx: Transacao, e: Evento, d: Dispositivo): Promise<void> {
  const c = d.cliente_id;
  switch (e.tipo) {
    case 'caixa.aberto':
      await tx.consultar(
        'INSERT INTO sessoes_caixa (id, cliente_id, dispositivo_id, operador, fundo_centavos, aberta_em) VALUES ($1, $2, $3, $4, $5, $6)',
        e.dados.sessaoId, c, d.id, e.dados.operador, e.dados.fundoCentavos, e.ocorridoEm,
      );
      return;
    case 'caixa.movimentado':
      await tx.consultar(
        'INSERT INTO movimentos_caixa (id, cliente_id, sessao_id, tipo, valor_centavos, motivo, ocorrido_em) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        e.dados.movimentoId, c, e.dados.sessaoId, e.dados.tipo, e.dados.valorCentavos, e.dados.motivo, e.ocorridoEm,
      );
      return;
    case 'caixa.fechado':
      await tx.consultar(
        'UPDATE sessoes_caixa SET fechada_em = $2, contado_centavos = $3, esperado_centavos = $4 WHERE id = $1 AND fechada_em IS NULL',
        e.dados.sessaoId, e.ocorridoEm, e.dados.contadoCentavos, e.dados.esperadoCentavos,
      );
      return;
    case 'venda.registrada': {
      const v = e.dados;
      await tx.consultar(
        `INSERT INTO vendas (id, cliente_id, loja_id, dispositivo_id, sessao_id, codigo, numero, bruto_centavos, desconto_centavos,
           liquido_centavos, troco_centavos, documento_cliente, ocorrido_em) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        v.vendaId, c, v.lojaId, d.id, v.sessaoId, v.codigo, v.numero, v.brutoCentavos, v.descontoCentavos, v.liquidoCentavos, v.trocoCentavos, v.documentoCliente, e.ocorridoEm,
      );
      for (const i of v.itens) {
        await tx.consultar(
          `INSERT INTO itens_venda (id, cliente_id, venda_id, posicao, produto_id, quantidade, preco_unitario_centavos, desconto_centavos, movimentacao_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          i.id, c, v.vendaId, i.posicao, i.produtoId, i.quantidade, i.precoUnitarioCentavos, i.descontoCentavos, i.movimentacaoId,
        );
      }
      for (const p of v.pagamentos) {
        await tx.consultar('INSERT INTO pagamentos (id, cliente_id, venda_id, forma, valor_centavos) VALUES ($1, $2, $3, $4, $5)', p.id, c, v.vendaId, p.forma, p.valorCentavos);
      }
      return;
    }
    case 'venda.cancelada':
      await tx.consultar(
        'INSERT INTO cancelamentos (venda_id, cliente_id, motivo, autorizado_por, cancelado_em) VALUES ($1, $2, $3, $4, $5)',
        e.dados.vendaId, c, e.dados.motivo, e.dados.autorizadoPor, e.ocorridoEm,
      );
      return;
    case 'estoque.movimentacao-registrada': {
      const m = e.dados;
      await tx.consultar(
        `INSERT INTO movimentacoes (id, cliente_id, loja_id, produto_id, tipo, quantidade, venda_id, motivo, dispositivo_id, ocorrido_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        m.movimentacaoId, c, m.lojaId, m.produtoId, m.tipo, m.quantidade, m.vendaId, m.motivo, d.id, e.ocorridoEm,
      );
      return;
    }
    case 'produto.criado':
    case 'produto.alterado':
      // Produto nasce no ERP e desce para o caixa; o caixa não cria produto. Fica só no registro.
      return;
  }
}

function lerLote(corpo: unknown): Evento[] {
  const lista = lerLista(lerObjeto(corpo, 'corpo')['eventos'], 'eventos');
  if (lista.length === 0 || lista.length > MAXIMO_EVENTOS_POR_LOTE) throw new ContratoInvalidoError('eventos', `informe de 1 a ${MAXIMO_EVENTOS_POR_LOTE} eventos`);
  const eventos = lista.map((v, i) => lerEvento(v, `eventos[${i}]`));
  eventos.forEach((e, i) => {
    const anterior = eventos[i - 1];
    if (anterior !== undefined && e.seq !== anterior.seq + 1) throw new ContratoInvalidoError(`eventos[${i}].seq`, 'as seqs do lote devem ser seguidas');
  });
  return eventos;
}

export function rotasDoRecebimento(banco: BancoNuvem): Rota {
  return async (ctx, partes) => {
    // Descida (Passo 3.3): GET /v1/alteracoes?desde=N  →  o que mudou no cliente depois do nº N
    // (produtos, preços, parâmetros), em ordem. O dispositivo guarda o último nº que aplicou.
    if (ctx.pedido.metodo === 'GET' && partes[0] === 'v1' && partes[1] === 'alteracoes' && partes.length === 2) {
      const d = await identificar(banco, ctx.pedido);
      const busca = new URLSearchParams(ctx.pedido.caminho.split('?')[1] ?? '');
      const desde = Number(busca.get('desde') ?? 0);
      if (!Number.isSafeInteger(desde) || desde < 0) throw new RecusaDaNuvem(400, 'desde: número a partir de 0.');
      const alteracoes = await banco.transacao('continuum_app', d.cliente_id, async (tx) => {
        const linhas = await tx.consultar<{ seq: string; entidade: string; versao: number; dados: unknown }>(
          'SELECT seq, entidade, versao, dados FROM alteracoes WHERE seq > $1 ORDER BY seq LIMIT 500',
          desde,
        );
        const ultima = linhas.at(-1);
        if (ultima !== undefined) {
          await tx.consultar(
            `INSERT INTO cursores_descida (dispositivo_id, cliente_id, ultima_seq) VALUES ($1, $2, $3)
             ON CONFLICT (dispositivo_id) DO UPDATE SET ultima_seq = excluded.ultima_seq`,
            d.id, d.cliente_id, Number(ultima.seq),
          );
        }
        return linhas.map((l) => ({ seq: Number(l.seq), entidade: l.entidade, versao: l.versao, dados: l.dados }));
      });
      return { status: 200, corpo: { alteracoes } };
    }

    if (ctx.pedido.metodo !== 'POST' || partes[0] !== 'v1') return null;

    if (partes[1] === 'sinais-de-vida' && partes.length === 2) {
      const d = await identificar(banco, ctx.pedido);
      let sinal;
      try {
        sinal = lerSinalDeVida(ctx.corpo);
      } catch (erro) {
        throw new RecusaDaNuvem(400, (erro as Error).message);
      }
      if (sinal.dispositivoId !== d.id) throw new RecusaDaNuvem(403, 'O sinal é de outro dispositivo.');
      await banco.transacao('continuum_app', d.cliente_id, async (tx) => {
        // Histórico de conexão para o Central: guarda quando o estado muda e quando o caixa volta depois
        // de ficar sem sinal (com quanto tempo ficou fora). Sinal repetido no mesmo estado não grava nada.
        const antes = await tx.consultarUma<{ estado: string; segundos: number }>(
          'SELECT estado, floor(extract(epoch FROM now() - recebido_em))::int AS segundos FROM sinais_de_vida WHERE dispositivo_id = $1',
          d.id,
        );
        if (antes !== undefined && antes.segundos > SEGUNDOS_SEM_SINAL) {
          await tx.consultar(
            "INSERT INTO eventos_de_conexao (id, cliente_id, dispositivo_id, tipo, estado_anterior, estado, segundos_sem_sinal) VALUES ($1, $2, $3, 'retorno', $4, $5, $6)",
            gerarId(), d.cliente_id, d.id, antes.estado, sinal.estado, antes.segundos,
          );
        } else if (antes === undefined || antes.estado !== sinal.estado) {
          await tx.consultar(
            "INSERT INTO eventos_de_conexao (id, cliente_id, dispositivo_id, tipo, estado_anterior, estado) VALUES ($1, $2, $3, 'estado', $4, $5)",
            gerarId(), d.cliente_id, d.id, antes?.estado ?? null, sinal.estado,
          );
        }
        await tx.consultar(
          `INSERT INTO sinais_de_vida (dispositivo_id, cliente_id, estado, fila_pendente, caixa_aberto, ultima_venda_em, versao, recebido_em)
           VALUES ($1, $2, $3, $4, $5, $6, $7, now())
           ON CONFLICT (dispositivo_id) DO UPDATE SET estado = excluded.estado, fila_pendente = excluded.fila_pendente,
             caixa_aberto = excluded.caixa_aberto, ultima_venda_em = excluded.ultima_venda_em, versao = excluded.versao, recebido_em = now()`,
          d.id, d.cliente_id, sinal.estado, sinal.filaPendente, sinal.caixaAberto, sinal.ultimaVendaEm, sinal.versaoPrograma,
        );
      });
      return { status: 200, corpo: { ok: true } };
    }

    if (partes[1] !== 'origens' || partes[3] !== 'eventos' || partes.length !== 4) return null;
    const d = await identificar(banco, ctx.pedido);
    if (partes[2] !== d.id) throw new RecusaDaNuvem(403, 'A credencial é de outro dispositivo.');
    let eventos: Evento[];
    try {
      eventos = lerLote(ctx.corpo);
    } catch (erro) {
      if (erro instanceof ContratoInvalidoError) return { status: 400, corpo: { erro: erro.message } };
      throw erro;
    }
    try {
      return await banco.transacao('continuum_app', d.cliente_id, async (tx) => {
        await tx.consultar('INSERT INTO origens (dispositivo_id, cliente_id) VALUES ($1, $2) ON CONFLICT (dispositivo_id) DO NOTHING', d.id, d.cliente_id);
        const ultimaAntes = Number((await tx.consultarUma<{ ultima_seq: string }>('SELECT ultima_seq FROM origens WHERE dispositivo_id = $1 FOR UPDATE', d.id))?.ultima_seq ?? 0);
        let ultimaSeq = ultimaAntes;
        const resultados: { id: string; resultado: 'aplicado' | 'repetido' }[] = [];
        for (const e of eventos) {
          if (e.seq <= ultimaSeq) {
            const gravado = await tx.consultarUma<{ id: string }>('SELECT id FROM eventos_recebidos WHERE origem_id = $1 AND seq = $2', d.id, e.seq);
            if (gravado?.id !== e.id) throw new ForaDeOrdem(`a seq ${e.seq} já foi recebida com outro evento`, ultimaAntes);
            resultados.push({ id: e.id, resultado: 'repetido' });
            continue;
          }
          if (e.seq !== ultimaSeq + 1) throw new ForaDeOrdem(`buraco na sequência: esperada a seq ${ultimaSeq + 1}, recebida ${e.seq}`, ultimaAntes);
          await tx.consultar(
            'INSERT INTO eventos_recebidos (origem_id, seq, id, cliente_id, tipo, versao, dados, ocorrido_em) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
            d.id, e.seq, e.id, d.cliente_id, e.tipo, e.versao, JSON.stringify(e.dados), e.ocorridoEm,
          );
          await aplicar(tx, e, d);
          resultados.push({ id: e.id, resultado: 'aplicado' });
          ultimaSeq = e.seq;
        }
        if (ultimaSeq !== ultimaAntes) await tx.consultar('UPDATE origens SET ultima_seq = $2 WHERE dispositivo_id = $1', d.id, ultimaSeq);
        return { status: 200, corpo: { ultimaSeq, eventos: resultados } };
      });
    } catch (erro) {
      if (erro instanceof ForaDeOrdem) return { status: 409, corpo: { ultimaSeq: erro.ultimaSeq, erro: erro.message } };
      const codigo = (erro as { code?: string }).code;
      // Fato que o banco recusa (ex.: produto que a nuvem não conhece): lote recusado, para o caixa achar o evento.
      if (codigo === '23503' || codigo === '23514' || codigo === '23505' || codigo === '22P02') return { status: 400, corpo: { erro: `evento recusado pela nuvem: ${(erro as Error).message}` } };
      throw erro;
    }
  };
}
