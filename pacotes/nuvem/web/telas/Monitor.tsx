// Continuum Central · Monitor ao vivo (Passo 3.4, UC03): todos os caixas de todos os clientes, atualizando
// a cada 3 segundos. A essência do Continuum: mostrar abertamente em que situação cada ponto de venda está.
import { formatarReais } from '@continuum/dominio';
import { Cartao, Chip, NOMES_ESTADO } from '@continuum/interface';
import type { TomChip } from '@continuum/interface';
import { Activity } from 'lucide-react';
import { useEffect, useState } from 'react';
import { pedir } from '../api.ts';

interface CaixaNoMonitor {
  id: string;
  tipo: 'pdv' | 'agente';
  numeroCaixa: number | null;
  cliente: string;
  loja: string;
  situacao: string;
  filaPendente: number | null;
  caixaAberto: boolean | null;
  segundosSemSinal: number | null;
  vendasHoje: number;
  vendidoHojeCentavos: number;
  versao: string | null;
}
interface Monitor {
  resumo: { caixas: number; saudaveis: number; comProblema: number; filaTotal: number; vendidoHojeCentavos: number };
  caixas: CaixaNoMonitor[];
  agora: string;
}

const TOM: Record<string, TomChip> = { saudavel: 'sucesso', degradado: 'atencao', offline: 'erro', recuperando: 'atencao', sincronizando: 'info', 'sem-sinal': 'erro' };
const nomeDaSituacao = (s: string) => (s === 'sem-sinal' ? 'SEM SINAL' : (NOMES_ESTADO as Record<string, string>)[s] ?? s.toUpperCase());

function tempo(segundos: number | null): string {
  if (segundos === null) return 'nunca';
  if (segundos < 60) return `há ${segundos} s`;
  if (segundos < 3600) return `há ${Math.floor(segundos / 60)} min`;
  return `há ${Math.floor(segundos / 3600)} h`;
}

export function MonitorAoVivo() {
  const [m, setM] = useState<Monitor | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    const atualizar = () =>
      pedir<Monitor>('GET', '/v1/central/monitor')
        .then((x) => {
          setM(x);
          setAviso(null);
        })
        .catch((e: Error) => setAviso(`Sem resposta do servidor: ${e.message}`));
    void atualizar();
    const relogio = setInterval(() => void atualizar(), 3000);
    return () => clearInterval(relogio);
  }, []);

  if (m === null) return <p className="suave">{aviso ?? 'Carregando o monitor…'}</p>;
  return (
    <div className="coluna">
      {aviso !== null && <p className="aviso">{aviso}</p>}
      <div className="grade-cartoes resumo-monitor">
        <Cartao titulo="Caixas ativos" icone={<Activity aria-hidden="true" />}>
          <p className="numero-grande">{m.resumo.caixas}</p>
        </Cartao>
        <Cartao titulo="Saudáveis">
          <p className="numero-grande">{m.resumo.saudaveis}</p>
        </Cartao>
        <Cartao titulo="Pedem atenção">
          <p className="numero-grande">{m.resumo.comProblema}</p>
        </Cartao>
        <Cartao titulo="Vendido hoje">
          <p className="numero-grande">{formatarReais(m.resumo.vendidoHojeCentavos)}</p>
          <p className="suave">{m.resumo.filaTotal} eventos nas filas</p>
        </Cartao>
      </div>
      {m.caixas.length === 0 ? (
        <Cartao titulo="Nenhum caixa ativo ainda">
          <p className="suave">Os caixas aparecem aqui quando são ativados pelo código do ERP e mandam o primeiro sinal de vida.</p>
        </Cartao>
      ) : (
        <div className="grade-cartoes" aria-label="Caixas ao vivo">
          {m.caixas.map((c) => (
            <Cartao key={c.id} titulo={`${c.loja} · ${c.tipo === 'pdv' ? `Caixa ${c.numeroCaixa ?? ''}` : 'Agente'}`} acao={<Chip tom={TOM[c.situacao] ?? 'neutro'}>{nomeDaSituacao(c.situacao)}</Chip>}>
              <p className="suave">{c.cliente}</p>
              <dl className="dados">
                <dt>Último sinal</dt>
                <dd>{tempo(c.segundosSemSinal)}</dd>
                <dt>Caixa</dt>
                <dd>{c.caixaAberto === null ? '—' : c.caixaAberto ? 'aberto' : 'fechado'}</dd>
                <dt>Fila</dt>
                <dd>{c.filaPendente ?? '—'} eventos</dd>
                <dt>Hoje</dt>
                <dd>
                  {c.vendasHoje} vendas · {formatarReais(c.vendidoHojeCentavos)}
                </dd>
                <dt>Versão</dt>
                <dd>{c.versao ?? '—'}</dd>
              </dl>
            </Cartao>
          ))}
        </div>
      )}
      <p className="suave">Atualizado {new Date(m.agora).toLocaleTimeString('pt-BR')} · "SEM SINAL" depois de 45 s sem notícia do caixa.</p>
    </div>
  );
}
