// Rotas dos dispositivos (caixas e agentes), sem login de pessoa (Passo 3.1):
//
//   POST /v1/dispositivos/ativar   { codigo, versaoInstalada? }
//     O caixa novo informa o código gerado no ERP (UC17). Se o código confere e está no prazo, o caixa
//     vira "ativo", ganha a credencial dele (mostrada só agora; na nuvem fica o hash) e recebe o que
//     precisa para vender: loja, número do caixa, parâmetros do cliente, catálogo e o saldo da loja.
import { gerarId } from '@continuum/dominio';
import type { BancoNuvem } from './banco.ts';
import { RecusaDaNuvem } from './api.ts';
import type { Rota } from './api.ts';
import { ativarDispositivo, hashDoCodigo, normalizarCodigo } from './seguranca.ts';
import type { SituacaoDoDispositivo } from './seguranca.ts';

const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export function rotasDosDispositivos(banco: BancoNuvem, segredo: string): Rota {
  return async (ctx, partes) => {
    if (partes[0] !== 'v1' || partes[1] !== 'dispositivos' || partes[2] !== 'ativar' || ctx.pedido.metodo !== 'POST') return null;
    const codigo = normalizarCodigo(texto(ctx.corpo['codigo']));
    if (codigo === null) throw new RecusaDaNuvem(400, 'Código inválido. Ele tem 8 letras e números, como 4F7K-92QX.');

    // O código ainda não diz de qual cliente é: a busca usa o acesso da plataforma, pelo hash do código.
    const resposta = await banco.transacaoDaPlataforma(async (tx) => {
      const d = await tx.consultarUma<{
        id: string; cliente_id: string; loja_id: string; tipo: 'pdv' | 'agente'; numero_caixa: number | null;
        situacao: SituacaoDoDispositivo; codigo_ativacao_hash: string | null; codigo_expira_em: Date | null;
      }>('SELECT id, cliente_id, loja_id, tipo, numero_caixa, situacao, codigo_ativacao_hash, codigo_expira_em FROM dispositivos WHERE codigo_ativacao_hash = $1 FOR UPDATE', hashDoCodigo(codigo, segredo));
      if (d === undefined) throw new RecusaDaNuvem(404, 'Código não encontrado. Confira ou gere outro no ERP (Caixas).');
      const r = ativarDispositivo(
        { situacao: d.situacao, codigoAtivacaoHash: d.codigo_ativacao_hash, codigoExpiraEm: d.codigo_expira_em?.getTime() ?? null, credencialHash: null },
        codigo,
        segredo,
      );
      if (!r.ok) {
        if (d.situacao === 'pendente' && d.codigo_expira_em !== null && d.codigo_expira_em.getTime() <= Date.now()) {
          await tx.consultar("UPDATE dispositivos SET situacao = 'expirado' WHERE id = $1", d.id);
        }
        throw new RecusaDaNuvem(409, r.motivo);
      }
      await tx.consultar(
        "UPDATE dispositivos SET situacao = 'ativo', codigo_ativacao_hash = NULL, codigo_expira_em = NULL, credencial_hash = $2, versao_instalada = $3 WHERE id = $1",
        d.id, r.dispositivo.credencialHash, texto(ctx.corpo['versaoInstalada']) || null,
      );
      await tx.consultar("INSERT INTO auditoria (id, cliente_id, autor_id, acao, alvo) VALUES ($1, $2, $3, 'caixa.ativado', $4)", gerarId(), d.cliente_id, d.id, d.id);

      const loja = await tx.consultarUma<{ id: string; nome_reduzido: string; nome: string }>('SELECT id, nome_reduzido, nome FROM lojas WHERE id = $1', d.loja_id);
      const p = await tx.consultarUma<{ versao: number; regra_estoque: string; limite_desconto_pct: number; comprovante: unknown }>(
        'SELECT versao, regra_estoque, limite_desconto_pct, comprovante FROM parametros_cliente WHERE cliente_id = $1',
        d.cliente_id,
      );
      const catalogo = await tx.consultar(
        `SELECT p.id AS "produtoId", p.nome, p.preco_centavos::int AS "precoCentavos", p.unidade, p.ean, p.version,
                COALESCE((SELECT sum(m.quantidade) FROM movimentacoes m WHERE m.produto_id = p.id AND m.loja_id = $2), 0)::int AS "saldoNaLoja"
         FROM produtos p WHERE p.cliente_id = $1 ORDER BY p.nome`,
        d.cliente_id, d.loja_id,
      );
      // Até onde a fila de descida já está incluída neste pacote (o caixa pede "o que veio depois" no Passo 3.3).
      const cursor = await tx.consultarUma<{ seq: string }>('SELECT COALESCE(max(seq), 0) AS seq FROM alteracoes WHERE cliente_id = $1', d.cliente_id);
      return {
        dispositivoId: d.id,
        clienteId: d.cliente_id,
        tipo: d.tipo,
        numeroCaixa: d.numero_caixa,
        credencial: r.credencial,
        loja: { id: loja?.id, nomeReduzido: loja?.nome_reduzido, nome: loja?.nome },
        parametros: { versao: p?.versao ?? 1, regraEstoque: p?.regra_estoque ?? 'bloquear', limiteDescontoPct: p?.limite_desconto_pct ?? 10, comprovante: p?.comprovante ?? {} },
        catalogo,
        cursorDescida: Number(cursor?.seq ?? 0),
      };
    });
    return { status: 200, corpo: resposta };
  };
}
