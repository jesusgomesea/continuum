// Cliente da API da nuvem, usado pelas telas do Central e do ERP. A sessão vai no cookie (o navegador cuida).
export class RecusaDaNuvem extends Error {
  readonly status: number;
  constructor(status: number, mensagem: string) {
    super(mensagem);
    this.status = status;
  }
}

export async function pedir<T>(metodo: 'GET' | 'POST' | 'PUT', caminho: string, corpo?: unknown): Promise<T> {
  const r = await fetch(caminho, {
    method: metodo,
    credentials: 'same-origin',
    headers: corpo === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
  });
  const dados = (await r.json()) as { mensagem?: string };
  if (!r.ok) throw new RecusaDaNuvem(r.status, dados.mensagem ?? 'Algo deu errado.');
  return dados as T;
}

export interface Eu {
  perfil: 'equipe' | 'dono' | 'gerente' | 'supervisor' | 'operador';
  nome: string;
  email: string;
  cliente: { id: string; nome: string; nome_fantasia: string | null; dominio: string } | null;
  permissoes: string[];
}

export interface ClienteResumo {
  id: string;
  nome: string;
  nome_fantasia: string | null;
  tipo_documento: 'CNPJ' | 'CPF';
  documento: string;
  segmento: string;
  dominio: string;
  situacao: 'ativo' | 'suspenso';
  lojas: number;
  caixas_ativos: number;
}

export interface DetalheDoCliente {
  cliente: ClienteResumo;
  parametros: { regra_estoque: 'bloquear' | 'permitir_alerta'; limite_desconto_pct: number; comprovante: { cabecalho?: string[]; rodape?: string; largura?: number }; versao: number };
  lojas: { id: string; nome_reduzido: string; nome: string }[];
  usuarios: { id: string; nome: string; email: string; perfil: string; ativo: boolean }[];
}

export const api = {
  eu: () => pedir<Eu>('GET', '/v1/eu'),
  entrarCentral: (email: string, senha: string) => pedir('POST', '/v1/central/entrar', { email, senha }),
  entrarErp: (email: string, senha: string, dominio: string) => pedir('POST', '/v1/erp/entrar', { email, senha, dominio }),
  sair: () => pedir('POST', '/v1/sair'),
  clientes: () => pedir<{ clientes: ClienteResumo[] }>('GET', '/v1/central/clientes'),
  cliente: (id: string) => pedir<DetalheDoCliente>('GET', `/v1/central/clientes/${id}`),
  cadastrarCliente: (dados: unknown) => pedir<{ id: string }>('POST', '/v1/central/clientes', dados),
  parametrizar: (id: string, dados: unknown) => pedir<{ versao: number }>('PUT', `/v1/central/clientes/${id}/parametros`, dados),
  mudarSituacao: (id: string, situacao: 'ativo' | 'suspenso') => pedir('PUT', `/v1/central/clientes/${id}/situacao`, { situacao }),
};
