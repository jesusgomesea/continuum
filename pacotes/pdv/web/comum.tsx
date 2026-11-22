// Pedaços usados por várias telas do PDV.
import { formatarReais, lerReais } from '@continuum/dominio';
import { Chip, FaixaDeEstado, NOMES_ESTADO } from '@continuum/interface';
import type { TomChip } from '@continuum/interface';
import type { EstadoDoCaixa } from './api.ts';

export const reais = formatarReais;

/** Lê um campo em reais; vazio vale zero; texto inválido devolve null. */
export function lerCampoReais(texto: string): number | null {
  if (texto.trim() === '') return 0;
  try {
    return lerReais(texto);
  } catch {
    return null;
  }
}

export const NOMES_FORMA = { dinheiro: 'Dinheiro', debito: 'Débito', credito: 'Crédito', pix: 'Pix' } as const;

const TOM_DO_ESTADO: Record<keyof typeof NOMES_ESTADO, TomChip> = {
  saudavel: 'sucesso',
  degradado: 'atencao',
  offline: 'erro',
  recuperando: 'atencao',
  sincronizando: 'info',
};

const DETALHE_DO_ESTADO: Record<keyof typeof NOMES_ESTADO, string> = {
  saudavel: 'Agente da loja respondendo; a fila segue normalmente.',
  degradado: 'Falhas ao falar com o agente da loja. O caixa continua vendendo; tentando de novo.',
  offline: 'Sem conexão com o agente da loja. O caixa continua vendendo; a fila cresce e nada se perde.',
  recuperando: 'O agente voltou a responder. Confirmando a estabilidade antes de enviar a fila.',
  sincronizando: 'Conexão confirmada. Enviando a fila acumulada ao agente.',
};

/** A barra do topo: loja, caixa, operador, a fila e a conexão com o agente. */
export function Cabecalho({ estado, children }: { estado: EstadoDoCaixa; children?: React.ReactNode }) {
  const { identidade, sessao, filaPendente, sincronizacao } = estado;
  return (
    <>
    <header className="cabecalho">
      <div className="marca">
        <strong>
          CONTINUUM <span>PDV</span>
        </strong>
        <small>
          {identidade.nomeReduzido} · Caixa {identidade.numeroCaixa}
          {sessao !== null && ` · ${sessao.operador}`}
        </small>
      </div>
      <div className="fila" title="Eventos gravados no caixa que ainda não seguiram para a loja e a nuvem">
        <small>Fila para enviar</small>
        <Chip tom={filaPendente === 0 ? 'sucesso' : 'info'}>{filaPendente} eventos</Chip>
      </div>
      {sincronizacao !== null && (
        <div className="fila" title={`Agente da loja: ${sincronizacao.destino}`}>
          <small>Conexão</small>
          <Chip tom={sincronizacao.bloqueio !== null ? 'erro' : TOM_DO_ESTADO[sincronizacao.estado]}>
            {sincronizacao.bloqueio !== null ? 'FILA PARADA' : NOMES_ESTADO[sincronizacao.estado]}
          </Chip>
        </div>
      )}
      <div className="acoes">{children}</div>
    </header>
    {sincronizacao !== null && sincronizacao.bloqueio !== null && (
      <div className="faixa">
        <FaixaDeEstado estado="offline" extra="Fila parada" detalhe={`O agente recusou um envio: ${sincronizacao.bloqueio.erro}. As vendas continuam; chame o suporte.`} />
      </div>
    )}
    {sincronizacao !== null && sincronizacao.bloqueio === null && sincronizacao.estado !== 'saudavel' && (
      <div className="faixa">
        <FaixaDeEstado estado={sincronizacao.estado} detalhe={DETALHE_DO_ESTADO[sincronizacao.estado]}>
          <span>{filaPendente} na fila</span>
        </FaixaDeEstado>
      </div>
    )}
    </>
  );
}

/** Mensagem de recusa para o operador. */
export function Aviso({ texto }: { texto: string | null }) {
  if (texto === null) return null;
  return (
    <p className="aviso" role="alert">
      {texto}
    </p>
  );
}

/** Abre o comprovante numa janela própria (no PDV instalado, uma janela do programa). */
export function abrirComprovante(codigo: string, opcoes: { reimpressao?: boolean; imprimir?: boolean } = {}) {
  const busca = new URLSearchParams();
  if (opcoes.reimpressao === true) busca.set('reimpressao', '1');
  if (opcoes.imprimir === true) busca.set('imprimir', '1');
  window.open(`/comprovante/${encodeURIComponent(codigo)}?${busca.toString()}`, '_blank', 'width=420,height=720');
}
