// Descida (Passo 3.3): o caixa pergunta à nuvem "o que mudou depois do nº N?" a cada poucos segundos e
// aplica: produto novo ou preço alterado (vale a versão mais nova) e parâmetros do cliente (regra de
// estoque, desconto, comprovante) e a entrada ou o ajuste de estoque feitos no ERP para a loja deste caixa. O nº N fica guardado no caixa (cursor_descida): nada se repete, nada se pula.
// Sem internet, o caixa segue com o que já tem; quando volta, recebe tudo o que mudou, em ordem.
import type { RegraEstoque } from '@continuum/dominio';
import type { Caixa } from './caixa.ts';
import type { ConfiguracaoComprovante } from './comprovante.ts';

export interface Alteracao {
  seq: number;
  entidade: 'produto' | 'parametros' | 'loja' | 'estoque';
  versao: number;
  dados: Record<string, unknown>;
}

/** Busca e aplica uma rodada de mudanças. Devolve quantas foram aplicadas (0 = nada novo ou sem conexão). */
export async function baixarAlteracoes(caixa: Caixa, urlNuvem: string, credencial: string): Promise<number> {
  const desde = caixa.cursorDescida();
  let resposta: Response;
  try {
    resposta = await fetch(`${urlNuvem}/v1/alteracoes?desde=${desde}`, { headers: { authorization: `Bearer ${credencial}` }, signal: AbortSignal.timeout(10_000) });
  } catch {
    return 0; // sem conexão: tenta na próxima rodada
  }
  if (!resposta.ok) return 0;
  const { alteracoes } = (await resposta.json()) as { alteracoes: Alteracao[] };
  for (const a of alteracoes) caixa.aplicarAlteracao(a);
  return alteracoes.length;
}

export interface Descida {
  /** Busca agora (além da busca automática). */
  agora(): Promise<number>;
  parar(): void;
}

export function ligarDescida(caixa: Caixa, urlNuvem: string, credencial: string, intervaloMs = 5000): Descida {
  let ocupado = false;
  const rodada = async () => {
    if (ocupado) return 0;
    ocupado = true;
    try {
      return await baixarAlteracoes(caixa, urlNuvem, credencial);
    } finally {
      ocupado = false;
    }
  };
  void rodada();
  const relogio = setInterval(() => void rodada(), intervaloMs);
  relogio.unref();
  return { agora: rodada, parar: () => clearInterval(relogio) };
}

/**
 * Converte os dados de uma alteração de parâmetros no formato do caixa.
 * O PIN do supervisor desce do ERP já como hash ("scrypt$sal$hash", ver pin.ts): só vem quando foi
 * definido ou trocado. Ausente = o caixa mantém o que já tem (aplicarAlteracao faz ...atual, ...p).
 */
export function parametrosDaAlteracao(a: Alteracao): {
  versao: number;
  regraEstoque: RegraEstoque;
  limiteDescontoPct: number;
  comprovante?: ConfiguracaoComprovante;
  pinSupervisorHash?: string;
} {
  const d = a.dados;
  return {
    versao: a.versao,
    regraEstoque: d['regraEstoque'] === 'permitir_alerta' ? 'permitir_alerta' : 'bloquear',
    limiteDescontoPct: Number(d['limiteDescontoPct'] ?? 10),
    ...(typeof d['comprovante'] === 'object' && d['comprovante'] !== null ? { comprovante: d['comprovante'] as ConfiguracaoComprovante } : {}),
    ...(typeof d['pinSupervisorHash'] === 'string' && d['pinSupervisorHash'] !== '' ? { pinSupervisorHash: d['pinSupervisorHash'] } : {}),
  };
}
