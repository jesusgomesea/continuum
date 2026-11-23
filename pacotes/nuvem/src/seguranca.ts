// Segurança da nuvem (ERP e Central), só as regras: senhas, sessão, perfis, ativação de caixa e credencial.
// Não depende de banco: quando o PostgreSQL entrar (Passo 2.1), estas peças são ligadas a ele.
// Regra do documento 04: senhas, códigos de ativação e credenciais só como hash, nunca em texto.
import { createHash, createHmac, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';

// ============================================================ senhas

/** Senha boa o bastante: 8 ou mais caracteres, com letras e números. */
export function senhaAceitavel(senha: string): string | null {
  if (senha.length < 8) return 'A senha precisa de pelo menos 8 caracteres.';
  if (!/[A-Za-zÀ-ÿ]/.test(senha) || !/\d/.test(senha)) return 'A senha precisa ter letras e números.';
  return null;
}

/** Hash da senha com scrypt e sal aleatório: "scrypt$sal$hash". */
export function hashDaSenha(senha: string): string {
  const sal = randomBytes(16);
  return `scrypt$${sal.toString('hex')}$${scryptSync(senha.normalize('NFC'), sal, 64).toString('hex')}`;
}

export function senhaConfere(senha: string, hash: string): boolean {
  const [tipo, salHex, hashHex] = hash.split('$');
  if (tipo !== 'scrypt' || salHex === undefined || hashHex === undefined) return false;
  const esperado = Buffer.from(hashHex, 'hex');
  return timingSafeEqual(esperado, scryptSync(senha.normalize('NFC'), Buffer.from(salHex, 'hex'), esperado.length));
}

/**
 * Hash do PIN do supervisor no MESMO formato que o caixa confere (pacotes/pdv/src/pin.ts):
 * "scrypt$sal$hash" com chave de 32 bytes. O PIN em texto nunca é guardado nem desce.
 */
export function hashDoPinDoSupervisor(pin: string): string {
  if (!/^\d{4,8}$/.test(pin)) throw new RangeError('O PIN deve ter de 4 a 8 números.');
  const sal = randomBytes(16);
  return `scrypt$${sal.toString('hex')}$${scryptSync(pin, sal, 32).toString('hex')}`;
}

// ============================================================ perfis e permissões

/** Perfis do ERP do cliente (docs/04, tabela usuarios) e da Equipe Continuum (Central). */
export type Perfil = 'equipe' | 'dono' | 'gerente' | 'supervisor' | 'operador';

/** O que cada um pode fazer (docs/03, casos de uso). */
const PERMISSOES = {
  'central.clientes': ['equipe'], // UC01, UC02
  'central.monitor': ['equipe'], // UC03
  'erp.loja.configurar': ['dono'], // UC10
  'erp.produtos.editar': ['dono', 'gerente'], // UC11, UC12
  'erp.estoque.movimentar': ['dono', 'gerente'], // UC13, UC14
  'erp.estoque.consultar': ['dono', 'gerente', 'supervisor'], // UC15
  'erp.usuarios.gerenciar': ['dono'], // UC16
  'erp.caixas.ativar': ['dono', 'gerente'], // UC17
  'erp.relatorios.ver': ['dono', 'gerente'], // UC18
  'erp.vendas.validar': ['dono', 'gerente', 'supervisor'], // UC19
  'pdv.vender': ['operador', 'supervisor', 'gerente', 'dono'],
  'pdv.autorizar': ['supervisor', 'gerente', 'dono'], // desconto alto, cancelamento
} as const satisfies Record<string, readonly Perfil[]>;

export type Acao = keyof typeof PERMISSOES;

export function pode(perfil: Perfil, acao: Acao): boolean {
  return (PERMISSOES[acao] as readonly Perfil[]).includes(perfil);
}

/** Tudo o que o perfil pode fazer (a tela usa para montar o menu). */
export function permissoesDe(perfil: Perfil): Acao[] {
  return (Object.keys(PERMISSOES) as Acao[]).filter((a) => pode(perfil, a));
}

// ============================================================ sessão (login)

export interface Sessao {
  /** Quem: id do usuário (ou da pessoa da Equipe Continuum). */
  usuarioId: string;
  /** De qual cliente; null para a Equipe Continuum (enxerga todos, no Central). */
  clienteId: string | null;
  perfil: Perfil;
  /** Até quando vale (milissegundos desde 1970). */
  expiraEm: number;
}

export const DURACAO_DA_SESSAO_MS = 12 * 60 * 60 * 1000; // um turno de trabalho

const base64url = (b: Buffer) => b.toString('base64url');

/** Emite o "crachá" da sessão: os dados + a assinatura do servidor. Quem não tem o segredo não falsifica. */
export function emitirSessao(sessao: Omit<Sessao, 'expiraEm'>, segredo: string, agora = Date.now()): string {
  const corpo = base64url(Buffer.from(JSON.stringify({ ...sessao, expiraEm: agora + DURACAO_DA_SESSAO_MS })));
  const assinatura = base64url(createHmac('sha256', segredo).update(corpo).digest());
  return `${corpo}.${assinatura}`;
}

/** Confere o crachá: assinatura certa e dentro da validade. Devolve null se falso, alterado ou vencido. */
export function lerSessao(token: string, segredo: string, agora = Date.now()): Sessao | null {
  const [corpo, assinatura] = token.split('.');
  if (corpo === undefined || assinatura === undefined) return null;
  const esperada = createHmac('sha256', segredo).update(corpo).digest();
  const recebida = Buffer.from(assinatura, 'base64url');
  if (recebida.length !== esperada.length || !timingSafeEqual(recebida, esperada)) return null;
  try {
    const sessao = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8')) as Sessao;
    return typeof sessao.expiraEm === 'number' && sessao.expiraEm > agora ? sessao : null;
  } catch {
    return null;
  }
}

// ============================================================ ativação do caixa (UC17) e credencial

/** Letras e números sem os que se confundem ao ler em voz alta ou na tela (0/O, 1/I/L). */
const ALFABETO = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const VALIDADE_DO_CODIGO_MS = 24 * 60 * 60 * 1000;

/** Gera o código de ativação que o dono passa ao caixa, ex.: 4F7K-92QX. */
export function gerarCodigoDeAtivacao(): string {
  let c = '';
  for (let i = 0; i < 8; i++) c += ALFABETO[randomInt(ALFABETO.length)];
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}

/** Normaliza o que o operador digitou: minúsculas, espaços e hífen são aceitos. */
export function normalizarCodigo(digitado: string): string | null {
  const limpo = digitado.toUpperCase().replace(/[\s-]/g, '');
  if (limpo.length !== 8 || [...limpo].some((c) => !ALFABETO.includes(c))) return null;
  return `${limpo.slice(0, 4)}-${limpo.slice(4)}`;
}

/** Hash do código, com o segredo do servidor (o código é curto: sem o segredo, não dá para adivinhar pelo hash). */
export function hashDoCodigo(codigo: string, segredo: string): string {
  return createHmac('sha256', segredo).update(codigo).digest('hex');
}

/** Credencial do dispositivo: longa e aleatória. O dispositivo guarda o texto; a nuvem, só o hash. */
export function gerarCredencial(): { credencial: string; hash: string } {
  const credencial = base64url(randomBytes(32));
  return { credencial, hash: hashDaCredencial(credencial) };
}

export function hashDaCredencial(credencial: string): string {
  return createHash('sha256').update(credencial).digest('hex');
}

export type SituacaoDoDispositivo = 'pendente' | 'ativo' | 'expirado' | 'desativado';

export interface Dispositivo {
  situacao: SituacaoDoDispositivo;
  codigoAtivacaoHash: string | null;
  codigoExpiraEm: number | null;
  credencialHash: string | null;
}

export type ResultadoDaAtivacao = { ok: true; dispositivo: Dispositivo; credencial: string } | { ok: false; motivo: string };

/**
 * O caixa informa o código (docs/03, diagrama 6.4): Pendente → Ativo. Código errado, vencido ou de um
 * dispositivo já ativo/desativado é recusado. Na ativação nasce a credencial; o código deixa de valer.
 */
export function ativarDispositivo(d: Dispositivo, digitado: string, segredo: string, agora = Date.now()): ResultadoDaAtivacao {
  if (d.situacao !== 'pendente') return { ok: false, motivo: `Este caixa está ${d.situacao}; gere um código novo no ERP.` };
  if (d.codigoExpiraEm === null || d.codigoExpiraEm <= agora) return { ok: false, motivo: 'Código vencido (vale 24 horas). Gere outro no ERP.' };
  const codigo = normalizarCodigo(digitado);
  if (codigo === null || d.codigoAtivacaoHash === null) return { ok: false, motivo: 'Código inválido. Confira e digite de novo.' };
  const esperado = Buffer.from(d.codigoAtivacaoHash, 'hex');
  const recebido = Buffer.from(hashDoCodigo(codigo, segredo), 'hex');
  if (!timingSafeEqual(esperado, recebido)) return { ok: false, motivo: 'Código inválido. Confira e digite de novo.' };
  const { credencial, hash } = gerarCredencial();
  return { ok: true, credencial, dispositivo: { situacao: 'ativo', codigoAtivacaoHash: null, codigoExpiraEm: null, credencialHash: hash } };
}

/** Confere a credencial que o dispositivo manda em cada envio (só dispositivos ativos). */
export function credencialConfere(d: Dispositivo, credencial: string): boolean {
  if (d.situacao !== 'ativo' || d.credencialHash === null) return false;
  return timingSafeEqual(Buffer.from(d.credencialHash, 'hex'), Buffer.from(hashDaCredencial(credencial), 'hex'));
}
