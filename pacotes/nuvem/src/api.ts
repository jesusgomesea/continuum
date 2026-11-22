// A API da nuvem (ERP do cliente e Continuum Central). Cada pedido vira uma chamada ao banco, sempre
// dentro do isolamento por cliente (banco.ts). A sessão viaja num cookie protegido (HttpOnly).
//
// Rotas deste passo (2.2 · login e perfis):
//   GET  /v1/saude            o servidor e o banco estão no ar
//   POST /v1/central/entrar   login da Equipe Continuum            { email, senha }
//   POST /v1/erp/entrar       login no ERP de um cliente           { email, senha, dominio? }
//   POST /v1/sair             encerra a sessão
//   GET  /v1/eu               quem está logado e o que pode fazer
// O ERP descobre o cliente pelo domínio acessado (Host). Em desenvolvimento (localhost) o domínio vai no pedido.
import type { BancoNuvem } from './banco.ts';
import { emitirSessao, lerSessao, permissoesDe, pode, senhaConfere } from './seguranca.ts';
import type { Acao, Perfil, Sessao } from './seguranca.ts';

export interface PedidoHttp {
  metodo: string;
  caminho: string;
  corpo?: unknown;
  cabecalhos?: Record<string, string | string[] | undefined>;
}

export interface Resposta {
  status: number;
  corpo: unknown;
  cabecalhos?: Record<string, string>;
}

/** Recusa com status e mensagem para a tela. */
export class RecusaDaNuvem extends Error {
  readonly status: number;
  constructor(status: number, mensagem: string) {
    super(mensagem);
    this.status = status;
  }
}

export const COOKIE_DA_SESSAO = 'continuum_sessao';

type Objeto = Record<string, unknown>;
const objeto = (c: unknown): Objeto => (typeof c === 'object' && c !== null && !Array.isArray(c) ? (c as Objeto) : {});
const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const cabecalho = (p: PedidoHttp, nome: string): string => {
  const v = p.cabecalhos?.[nome];
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
};

function lerCookie(p: PedidoHttp, nome: string): string | null {
  for (const parte of cabecalho(p, 'cookie').split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nome) return decodeURIComponent(v.join('='));
  }
  return null;
}

/** Contexto que as rotas recebem: a sessão (se houver) e a exigência de permissão. */
export interface Contexto {
  pedido: PedidoHttp;
  corpo: Objeto;
  sessao: Sessao | null;
  /** Exige estar logado com permissão para a ação; devolve a sessão. */
  exigir(acao: Acao): Sessao;
}

export type Rota = (ctx: Contexto, partes: string[]) => Promise<Resposta | null>;

export interface OpcoesDaApi {
  segredo: string;
  /** Domínio usado quando o pedido vem de localhost e não informa outro (desenvolvimento). */
  dominioPadrao?: string;
  /** Rotas dos próximos passos (Central, ERP), testadas em ordem. */
  rotasExtras?: Rota[];
}

export function criarApiDaNuvem(banco: BancoNuvem, opcoes: OpcoesDaApi) {
  const cookieDaSessao = (token: string, segundos: number) =>
    `${COOKIE_DA_SESSAO}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${segundos}`;

  async function entrarNoCentral(c: Objeto): Promise<Resposta> {
    const email = texto(c['email']).toLowerCase();
    const pessoa = await banco.transacao('continuum_central', null, (tx) =>
      tx.consultarUma<{ id: string; nome: string; senha_hash: string }>('SELECT id, nome, senha_hash FROM equipe_continuum WHERE lower(email) = $1', email),
    );
    if (pessoa === undefined || !senhaConfere(texto(c['senha']), pessoa.senha_hash)) throw new RecusaDaNuvem(401, 'E-mail ou senha não conferem.');
    const token = emitirSessao({ usuarioId: pessoa.id, clienteId: null, perfil: 'equipe' }, opcoes.segredo);
    return { status: 200, corpo: { ok: true }, cabecalhos: { 'set-cookie': cookieDaSessao(token, 12 * 3600) } };
  }

  async function clientePeloDominio(p: PedidoHttp, c: Objeto): Promise<{ id: string; nome: string; situacao: string } | undefined> {
    const host = cabecalho(p, 'host').split(':')[0]?.toLowerCase() ?? '';
    const local = host === '' || host === 'localhost' || host === '127.0.0.1';
    const dominio = local ? texto(c['dominio']).toLowerCase() || (opcoes.dominioPadrao ?? '') : host;
    // O domínio ainda não diz quem é o cliente: a busca usa o acesso de leitura geral (Central).
    return banco.transacao('continuum_central', null, (tx) =>
      tx.consultarUma<{ id: string; nome: string; situacao: string }>('SELECT id, nome, situacao FROM clientes WHERE dominio = $1', dominio),
    );
  }

  async function entrarNoErp(p: PedidoHttp, c: Objeto): Promise<Resposta> {
    const cliente = await clientePeloDominio(p, c);
    if (cliente === undefined) throw new RecusaDaNuvem(404, 'Endereço do ERP não encontrado. Confira o domínio.');
    if (cliente.situacao !== 'ativo') throw new RecusaDaNuvem(403, 'Este ERP está suspenso. Fale com a Continuum.');
    const email = texto(c['email']).toLowerCase();
    // A partir daqui, o banco já só mostra os dados deste cliente.
    const usuario = await banco.transacao('continuum_app', cliente.id, (tx) =>
      tx.consultarUma<{ id: string; senha_hash: string; perfil: Perfil; ativo: boolean }>(
        'SELECT id, senha_hash, perfil, ativo FROM usuarios WHERE lower(email) = $1',
        email,
      ),
    );
    if (usuario === undefined || !senhaConfere(texto(c['senha']), usuario.senha_hash)) throw new RecusaDaNuvem(401, 'E-mail ou senha não conferem.');
    if (!usuario.ativo) throw new RecusaDaNuvem(403, 'Usuário desativado. Fale com o dono do negócio.');
    const token = emitirSessao({ usuarioId: usuario.id, clienteId: cliente.id, perfil: usuario.perfil }, opcoes.segredo);
    return { status: 200, corpo: { ok: true }, cabecalhos: { 'set-cookie': cookieDaSessao(token, 12 * 3600) } };
  }

  async function quemSou(sessao: Sessao): Promise<Resposta> {
    if (sessao.clienteId === null) {
      const pessoa = await banco.transacao('continuum_central', null, (tx) =>
        tx.consultarUma<{ nome: string; email: string }>('SELECT nome, email FROM equipe_continuum WHERE id = $1', sessao.usuarioId),
      );
      return { status: 200, corpo: { perfil: sessao.perfil, nome: pessoa?.nome, email: pessoa?.email, cliente: null, permissoes: permissoesDe(sessao.perfil) } };
    }
    const dados = await banco.transacao('continuum_app', sessao.clienteId, async (tx) => ({
      usuario: await tx.consultarUma<{ nome: string; email: string }>('SELECT nome, email FROM usuarios WHERE id = $1', sessao.usuarioId),
      cliente: await tx.consultarUma<{ id: string; nome: string; nome_fantasia: string | null; dominio: string }>('SELECT id, nome, nome_fantasia, dominio FROM clientes'),
    }));
    return {
      status: 200,
      corpo: { perfil: sessao.perfil, nome: dados.usuario?.nome, email: dados.usuario?.email, cliente: dados.cliente ?? null, permissoes: permissoesDe(sessao.perfil) },
    };
  }

  async function rotear(p: PedidoHttp): Promise<Resposta> {
    const metodo = p.metodo.toUpperCase();
    const [caminho = '/'] = p.caminho.split('?');
    const corpo = objeto(p.corpo);
    const token = lerCookie(p, COOKIE_DA_SESSAO) ?? (cabecalho(p, 'authorization').replace(/^Bearer\s+/i, '') || null);
    const sessao = token === null ? null : lerSessao(token, opcoes.segredo);
    const ctx: Contexto = {
      pedido: p,
      corpo,
      sessao,
      exigir(acao) {
        if (sessao === null) throw new RecusaDaNuvem(401, 'Entre com seu e-mail e senha.');
        if (!pode(sessao.perfil, acao)) throw new RecusaDaNuvem(403, 'Seu perfil não tem acesso a esta parte.');
        return sessao;
      },
    };

    if (metodo === 'GET' && caminho === '/v1/saude') {
      await banco.transacao('continuum_central', null, (tx) => tx.consultarUma('SELECT 1'));
      return { status: 200, corpo: { ok: true, banco: 'ok' } };
    }
    if (metodo === 'POST' && caminho === '/v1/central/entrar') return entrarNoCentral(corpo);
    if (metodo === 'POST' && caminho === '/v1/erp/entrar') return entrarNoErp(p, corpo);
    if (metodo === 'POST' && caminho === '/v1/sair') return { status: 200, corpo: { ok: true }, cabecalhos: { 'set-cookie': cookieDaSessao('', 0) } };
    if (metodo === 'GET' && caminho === '/v1/eu') {
      if (sessao === null) throw new RecusaDaNuvem(401, 'Entre com seu e-mail e senha.');
      return quemSou(sessao);
    }
    const partes = caminho.split('/').filter(Boolean).map(decodeURIComponent);
    for (const rota of opcoes.rotasExtras ?? []) {
      const r = await rota({ ...ctx, pedido: { ...p, metodo } }, partes);
      if (r !== null) return r;
    }
    return { status: 404, corpo: { erro: 'RotaDesconhecida', mensagem: `${metodo} ${caminho} não existe` } };
  }

  return {
    async tratar(p: PedidoHttp): Promise<Resposta> {
      try {
        return await rotear(p);
      } catch (erro) {
        if (erro instanceof RecusaDaNuvem) return { status: erro.status, corpo: { erro: 'Recusado', mensagem: erro.message } };
        const e = erro as { code?: string; message?: string };
        // Regras do banco (documento duplicado, campo fora do formato) viram mensagem para a tela.
        if (e.code === '23505') return { status: 409, corpo: { erro: 'Duplicado', mensagem: 'Já existe um cadastro com esses dados (documento, domínio ou e-mail).' } };
        if (e.code === '23514' || e.code === '22P02') return { status: 400, corpo: { erro: 'DadosInvalidos', mensagem: `Dados fora do formato: ${e.message ?? ''}` } };
        throw erro;
      }
    },
  };
}

export type ApiDaNuvem = ReturnType<typeof criarApiDaNuvem>;
