// Pedaços usados por várias telas do PDV.
import { formatarReais, lerReais } from '@continuum/dominio';
import { Chip } from '@continuum/interface';
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

/** A barra do topo: loja, caixa, operador e a fila de eventos ainda não enviados. */
export function Cabecalho({ estado, children }: { estado: EstadoDoCaixa; children?: React.ReactNode }) {
  const { identidade, sessao, filaPendente } = estado;
  return (
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
      <div className="acoes">{children}</div>
    </header>
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
