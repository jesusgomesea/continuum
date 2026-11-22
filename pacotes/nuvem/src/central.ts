// Rotas do Continuum Central (Passo 2.3): a Equipe Continuum cadastra clientes (UC01) e parametriza o
// ERP de cada um (UC02). Tudo exige a sessão da Equipe e fica registrado na auditoria.
//
//   GET   /v1/central/clientes                       lista de clientes
//   POST  /v1/central/clientes                       cadastra cliente + parâmetros + 1ª loja + dono
//   GET   /v1/central/clientes/{id}                  detalhes (parâmetros, lojas, usuários)
//   PUT   /v1/central/clientes/{id}/parametros       muda a regra de estoque, o desconto, o comprovante
//   PUT   /v1/central/clientes/{id}/situacao         ativo ou suspenso
import { cnpjValido, cpfValido, gerarId, nomeReduzidoValido, soDigitos } from '@continuum/dominio';
import type { BancoNuvem, Transacao } from './banco.ts';
import { RecusaDaNuvem } from './api.ts';
import type { Rota } from './api.ts';
import { hashDaSenha, senhaAceitavel } from './seguranca.ts';

const SEGMENTOS = ['mercearia', 'padaria', 'conveniencia', 'hortifruti', 'farmacia', 'outro'] as const;
const PADRAO_DOMINIO = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
const PADRAO_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Objeto = Record<string, unknown>;
const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const objeto = (c: unknown): Objeto => (typeof c === 'object' && c !== null && !Array.isArray(c) ? (c as Objeto) : {});

function exigirTexto(v: unknown, campo: string): string {
  const t = texto(v);
  if (t === '') throw new RecusaDaNuvem(400, `Informe ${campo}.`);
  return t;
}

/** Os parâmetros que o Central controla no ERP do cliente. */
function lerParametros(c: Objeto) {
  const regra = texto(c['regraEstoque']) || 'bloquear';
  if (regra !== 'bloquear' && regra !== 'permitir_alerta') throw new RecusaDaNuvem(400, 'Regra de estoque: bloquear ou permitir_alerta.');
  const limite = c['limiteDescontoPct'] === undefined ? 10 : Number(c['limiteDescontoPct']);
  if (!Number.isInteger(limite) || limite < 0 || limite > 100) throw new RecusaDaNuvem(400, 'Limite de desconto: de 0 a 100 (%).');
  const comp = objeto(c['comprovante']);
  const largura = comp['largura'] === undefined ? 80 : Number(comp['largura']);
  if (largura !== 58 && largura !== 80) throw new RecusaDaNuvem(400, 'Largura da bobina: 58 ou 80 mm.');
  const cabecalho = Array.isArray(comp['cabecalho']) ? comp['cabecalho'].map(texto).filter(Boolean).slice(0, 5) : [];
  return { regraEstoque: regra, limiteDescontoPct: limite, comprovante: { cabecalho, rodape: texto(comp['rodape']) || 'Obrigado pela preferência!', largura } };
}

async function auditar(tx: Transacao, autorId: string, clienteId: string | null, acao: string, alvo: string, dados: unknown): Promise<void> {
  await tx.consultar('INSERT INTO auditoria (id, cliente_id, autor_id, acao, alvo, dados) VALUES ($1, $2, $3, $4, $5, $6)', gerarId(), clienteId, autorId, acao, alvo, JSON.stringify(dados));
}

/** Registra a mudança na "fila de descida" (Passo 3.3): os caixas do cliente vão receber os parâmetros novos. */
async function avisarDescida(tx: Transacao, clienteId: string, versao: number, dados: unknown): Promise<void> {
  await tx.consultar("INSERT INTO alteracoes (cliente_id, entidade, entidade_id, versao, dados) VALUES ($1, 'parametros', $1, $2, $3)", clienteId, versao, JSON.stringify(dados));
}

/** Depois de quanto tempo sem sinal o caixa aparece como "SEM SINAL" no monitor. */
export const SEGUNDOS_ATE_SEM_SINAL = 45;

export function rotasDoCentral(banco: BancoNuvem): Rota {
  return async (ctx, partes) => {
    // Monitor ao vivo (Passo 3.4, UC03): todos os caixas ativos de todos os clientes, com o último sinal.
    if (partes[0] === 'v1' && partes[1] === 'central' && partes[2] === 'monitor' && ctx.pedido.metodo === 'GET') {
      ctx.exigir('central.monitor');
      const caixas = await banco.transacao('continuum_central', null, (tx) =>
        tx.consultar(`
          SELECT d.id, d.tipo, d.numero_caixa AS "numeroCaixa", d.versao_instalada AS "versaoInstalada",
                 c.id AS "clienteId", COALESCE(c.nome_fantasia, c.nome) AS cliente, l.nome_reduzido AS loja,
                 sv.estado, sv.fila_pendente AS "filaPendente", sv.caixa_aberto AS "caixaAberto",
                 sv.ultima_venda_em AS "ultimaVendaEm", sv.versao,
                 sv.recebido_em AS "ultimoSinalEm",
                 floor(extract(epoch FROM now() - sv.recebido_em))::int AS "segundosSemSinal",
                 (SELECT count(*)::int FROM vendas v WHERE v.dispositivo_id = d.id
                    AND (v.ocorrido_em AT TIME ZONE 'America/Sao_Paulo')::date = (now() AT TIME ZONE 'America/Sao_Paulo')::date
                    AND NOT EXISTS (SELECT 1 FROM cancelamentos x WHERE x.venda_id = v.id)) AS "vendasHoje",
                 (SELECT COALESCE(sum(v.liquido_centavos), 0)::int FROM vendas v WHERE v.dispositivo_id = d.id
                    AND (v.ocorrido_em AT TIME ZONE 'America/Sao_Paulo')::date = (now() AT TIME ZONE 'America/Sao_Paulo')::date
                    AND NOT EXISTS (SELECT 1 FROM cancelamentos x WHERE x.venda_id = v.id)) AS "vendidoHojeCentavos"
          FROM dispositivos d JOIN clientes c ON c.id = d.cliente_id JOIN lojas l ON l.id = d.loja_id
          LEFT JOIN sinais_de_vida sv ON sv.dispositivo_id = d.id
          WHERE d.situacao = 'ativo'
          ORDER BY cliente, l.nome_reduzido, d.tipo DESC, d.numero_caixa`),
      );
      const comSituacao = caixas.map((cx): Record<string, unknown> & { situacao: string } => {
        const s = cx['segundosSemSinal'];
        const semSinal = s === null || s === undefined || Number(s) > SEGUNDOS_ATE_SEM_SINAL;
        return { ...cx, situacao: semSinal ? 'sem-sinal' : String(cx['estado']) };
      });
      const resumo = {
        caixas: comSituacao.length,
        saudaveis: comSituacao.filter((c) => c.situacao === 'saudavel').length,
        comProblema: comSituacao.filter((c) => c.situacao !== 'saudavel').length,
        filaTotal: comSituacao.reduce((t, c) => t + Number(c['filaPendente'] ?? 0), 0),
        vendidoHojeCentavos: comSituacao.reduce((t, c) => t + Number(c['vendidoHojeCentavos'] ?? 0), 0),
      };
      return { status: 200, corpo: { resumo, caixas: comSituacao, agora: new Date().toISOString() } };
    }

    if (partes[0] !== 'v1' || partes[1] !== 'central' || partes[2] !== 'clientes') return null;
    const sessao = ctx.exigir('central.clientes');
    const metodo = ctx.pedido.metodo;
    const id = partes[3];

    if (metodo === 'GET' && id === undefined) {
      const clientes = await banco.transacao('continuum_central', null, (tx) =>
        tx.consultar(`
          SELECT c.id, c.nome, c.nome_fantasia, c.tipo_documento, c.documento, c.segmento, c.dominio, c.situacao, c.criado_em,
                 (SELECT count(*)::int FROM lojas l WHERE l.cliente_id = c.id) AS lojas,
                 (SELECT count(*)::int FROM dispositivos d WHERE d.cliente_id = c.id AND d.situacao = 'ativo') AS caixas_ativos
          FROM clientes c ORDER BY c.nome`),
      );
      return { status: 200, corpo: { clientes } };
    }

    if (metodo === 'POST' && id === undefined) {
      const c = ctx.corpo;
      const documento = soDigitos(texto(c['documento']));
      const tipoDocumento = documento.length === 14 ? 'CNPJ' : 'CPF';
      if (!(documento.length === 14 ? cnpjValido(documento) : documento.length === 11 && cpfValido(documento))) {
        throw new RecusaDaNuvem(400, 'CNPJ ou CPF inválido (o dígito verificador não confere).');
      }
      const nome = exigirTexto(c['nome'], 'a razão social ou o nome');
      const segmento = texto(c['segmento']) || 'outro';
      if (!(SEGMENTOS as readonly string[]).includes(segmento)) throw new RecusaDaNuvem(400, `Segmento: ${SEGMENTOS.join(', ')}.`);
      const dominio = texto(c['dominio']).toLowerCase();
      if (!PADRAO_DOMINIO.test(dominio)) throw new RecusaDaNuvem(400, 'Domínio inválido. Exemplo: mercearia.continuum.app');
      const loja = objeto(c['loja']);
      const nomeReduzido = texto(loja['nomeReduzido']).toUpperCase();
      if (!nomeReduzidoValido(nomeReduzido)) throw new RecusaDaNuvem(400, 'Nome reduzido da loja: só letras e números, até 10 (ex.: MERCBAIRRO).');
      const dono = objeto(c['dono']);
      const email = texto(dono['email']).toLowerCase();
      if (!PADRAO_EMAIL.test(email)) throw new RecusaDaNuvem(400, 'E-mail do dono inválido.');
      const senha = texto(dono['senha']);
      const fraca = senhaAceitavel(senha);
      if (fraca !== null) throw new RecusaDaNuvem(400, fraca);
      const parametros = lerParametros(objeto(c['parametros']));

      const clienteId = gerarId();
      await banco.transacaoDaPlataforma(async (tx) => {
        await tx.consultar(
          'INSERT INTO clientes (id, tipo_documento, documento, nome, nome_fantasia, segmento, dominio) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          clienteId, tipoDocumento, documento, nome, texto(c['nomeFantasia']) || null, segmento, dominio,
        );
        await tx.consultar(
          'INSERT INTO parametros_cliente (cliente_id, modelo, regra_estoque, limite_desconto_pct, comprovante) VALUES ($1, $2, $3, $4, $5)',
          clienteId, segmento, parametros.regraEstoque, parametros.limiteDescontoPct, JSON.stringify(parametros.comprovante),
        );
        await tx.consultar('INSERT INTO lojas (id, cliente_id, nome_reduzido, nome) VALUES ($1, $2, $3, $4)', gerarId(), clienteId, nomeReduzido, texto(loja['nome']) || nome);
        await tx.consultar(
          "INSERT INTO usuarios (id, cliente_id, nome, email, senha_hash, perfil) VALUES ($1, $2, $3, $4, $5, 'dono')",
          gerarId(), clienteId, exigirTexto(dono['nome'], 'o nome do dono'), email, hashDaSenha(senha),
        );
        await avisarDescida(tx, clienteId, 1, parametros);
        await auditar(tx, sessao.usuarioId, clienteId, 'cliente.cadastrado', clienteId, { nome, documento, dominio });
      });
      return { status: 201, corpo: { id: clienteId } };
    }

    if (id === undefined) return null;

    if (metodo === 'GET' && partes.length === 4) {
      const detalhe = await banco.transacao('continuum_central', null, async (tx) => ({
        cliente: await tx.consultarUma('SELECT * FROM clientes WHERE id = $1', id),
        parametros: await tx.consultarUma('SELECT regra_estoque, limite_desconto_pct, comprovante, versao FROM parametros_cliente WHERE cliente_id = $1', id),
        lojas: await tx.consultar('SELECT id, nome_reduzido, nome FROM lojas WHERE cliente_id = $1 ORDER BY nome_reduzido', id),
        usuarios: await tx.consultar('SELECT id, nome, email, perfil, ativo FROM usuarios WHERE cliente_id = $1 ORDER BY nome', id),
      }));
      if (detalhe.cliente === undefined) throw new RecusaDaNuvem(404, 'Cliente não encontrado.');
      return { status: 200, corpo: detalhe };
    }

    if (metodo === 'PUT' && partes[4] === 'parametros') {
      const parametros = lerParametros(ctx.corpo);
      const versao = await banco.transacaoDaPlataforma(async (tx) => {
        const linha = await tx.consultarUma<{ versao: number }>(
          `UPDATE parametros_cliente SET regra_estoque = $2, limite_desconto_pct = $3, comprovante = $4, versao = versao + 1
           WHERE cliente_id = $1 RETURNING versao`,
          id, parametros.regraEstoque, parametros.limiteDescontoPct, JSON.stringify(parametros.comprovante),
        );
        if (linha === undefined) throw new RecusaDaNuvem(404, 'Cliente não encontrado.');
        await avisarDescida(tx, id, linha.versao, parametros);
        await auditar(tx, sessao.usuarioId, id, 'parametros.alterados', id, parametros);
        return linha.versao;
      });
      return { status: 200, corpo: { versao } };
    }

    if (metodo === 'PUT' && partes[4] === 'situacao') {
      const situacao = texto(ctx.corpo['situacao']);
      if (situacao !== 'ativo' && situacao !== 'suspenso') throw new RecusaDaNuvem(400, 'Situação: ativo ou suspenso.');
      await banco.transacaoDaPlataforma(async (tx) => {
        const r = await tx.consultar('UPDATE clientes SET situacao = $2 WHERE id = $1 RETURNING id', id, situacao);
        if (r.length === 0) throw new RecusaDaNuvem(404, 'Cliente não encontrado.');
        await auditar(tx, sessao.usuarioId, id, `cliente.${situacao}`, id, {});
      });
      return { status: 200, corpo: { situacao } };
    }
    return null;
  };
}
