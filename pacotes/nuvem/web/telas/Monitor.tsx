// Continuum Central · Monitor ao vivo (UC03): todos os caixas de todos os clientes, atualizando a cada 3 s.
// A essência do Continuum: mostrar abertamente em que situação cada ponto de venda está.
//   - faixa de estado no topo (veredito + contadores)
//   - caixas agrupados por cliente e loja, com filtro ("só os com problema") e busca
//   - alertas: sem sinal, fila acumulando, versão desatualizada, quedas frequentes, cliente suspenso
//   - linha do tempo das quedas e mudanças de estado (24 h)
//   - modo telão: tela cheia com letras grandes, para deixar numa TV
import { formatarReais } from '@continuum/dominio';
import { Botao, Cartao, Chip, NOMES_ESTADO } from '@continuum/interface';
import type { TomChip } from '@continuum/interface';
import { AlertTriangle, Clock, Maximize2, Minimize2, PackageOpen, Radio, Search, WifiOff } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { pedir } from '../api.ts';
import { normalizar } from '../componentes/Tabela.tsx';

interface CaixaNoMonitor {
  id: string;
  tipo: 'pdv' | 'agente';
  numeroCaixa: number | null;
  clienteId: string;
  cliente: string;
  situacaoCliente: string;
  loja: string;
  situacao: string;
  filaPendente: number | null;
  caixaAberto: boolean | null;
  segundosSemSinal: number | null;
  vendasHoje: number;
  vendidoHojeCentavos: number;
  versao: string | null;
  quedas24h: number;
}
interface Monitor {
  resumo: { caixas: number; saudaveis: number; comProblema: number; semSinal: number; clientes: number; filaTotal: number; vendidoHojeCentavos: number; versaoMaisNova: string | null };
  caixas: CaixaNoMonitor[];
  agora: string;
}
interface EventoDeConexao {
  id: string;
  tipo: 'estado' | 'retorno';
  estadoAnterior: string | null;
  estado: string;
  segundosSemSinal: number | null;
  em: string;
  numeroCaixa: number | null;
  tipoDispositivo: string;
  loja: string;
  cliente: string;
}

/** Acima disso a fila de um caixa "acumulando" vira alerta. */
export const FILA_PREOCUPANTE = 50;
/** Quedas em 24 h a partir das quais a conexão do caixa é "instável". */
export const QUEDAS_PREOCUPANTES = 3;

const TOM: Record<string, TomChip> = { saudavel: 'sucesso', degradado: 'atencao', offline: 'erro', recuperando: 'atencao', sincronizando: 'info', 'sem-sinal': 'erro' };
const nomeDaSituacao = (s: string) => (s === 'sem-sinal' ? 'SEM SINAL' : ((NOMES_ESTADO as Record<string, string>)[s] ?? s.toUpperCase()));
const nomeDoCaixa = (c: { tipo?: string; tipoDispositivo?: string; numeroCaixa: number | null }) => ((c.tipo ?? c.tipoDispositivo) === 'agente' ? 'Agente' : `Caixa ${c.numeroCaixa ?? '?'}`);

export function tempo(segundos: number | null): string {
  if (segundos === null) return 'nunca';
  if (segundos < 60) return `há ${segundos} s`;
  if (segundos < 3600) return `há ${Math.floor(segundos / 60)} min`;
  if (segundos < 86_400) return `há ${Math.floor(segundos / 3600)} h`;
  return `há ${Math.floor(segundos / 86_400)} dia(s)`;
}

const duracao = (s: number) => (s < 120 ? `${s} s` : s < 7200 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`);

export interface AlertaDoMonitor {
  nivel: 'erro' | 'atencao' | 'info';
  titulo: string;
  detalhe: string;
  caixaId: string;
}

/** Os alertas que o monitor mostra, do mais grave para o mais leve. */
export function alertasDoMonitor(m: Monitor): AlertaDoMonitor[] {
  const a: AlertaDoMonitor[] = [];
  for (const c of m.caixas) {
    const onde = `${c.cliente} · ${c.loja} · ${nomeDoCaixa(c)}`;
    if (c.situacao === 'sem-sinal') a.push({ nivel: 'erro', titulo: `${nomeDoCaixa(c)} sem sinal`, detalhe: `${onde} · último sinal ${tempo(c.segundosSemSinal)}`, caixaId: c.id });
    else if (c.situacao === 'offline') a.push({ nivel: 'erro', titulo: `${nomeDoCaixa(c)} sem internet`, detalhe: `${onde} · vende normalmente e guarda as vendas`, caixaId: c.id });
    if ((c.filaPendente ?? 0) >= FILA_PREOCUPANTE) a.push({ nivel: 'atencao', titulo: 'Fila acumulando', detalhe: `${onde} · ${c.filaPendente} eventos esperando subir`, caixaId: c.id });
    if (c.quedas24h >= QUEDAS_PREOCUPANTES) a.push({ nivel: 'atencao', titulo: 'Conexão instável', detalhe: `${onde} · ${c.quedas24h} quedas em 24 h`, caixaId: c.id });
    if (m.resumo.versaoMaisNova !== null && c.versao !== null && c.versao !== m.resumo.versaoMaisNova)
      a.push({ nivel: 'info', titulo: 'Versão desatualizada', detalhe: `${onde} · ${c.versao} (a mais nova é ${m.resumo.versaoMaisNova})`, caixaId: c.id });
    if (c.situacaoCliente === 'suspenso') a.push({ nivel: 'info', titulo: 'Cliente suspenso com caixa ativo', detalhe: onde, caixaId: c.id });
  }
  const peso = { erro: 0, atencao: 1, info: 2 };
  return a.sort((x, y) => peso[x.nivel] - peso[y.nivel]);
}

function Contador({ valor, rotulo, tom }: { valor: ReactNode; rotulo: string; tom?: 'erro' | 'atencao' | 'sucesso' | undefined }) {
  return (
    <div className={`contador ${tom ?? ''}`}>
      <strong>{valor}</strong>
      <small>{rotulo}</small>
    </div>
  );
}

export function MonitorAoVivo() {
  const [m, setM] = useState<Monitor | null>(null);
  const [historico, setHistorico] = useState<EventoDeConexao[]>([]);
  const [aviso, setAviso] = useState<string | null>(null);
  const [soProblemas, setSoProblemas] = useState(false);
  const [busca, setBusca] = useState('');
  const [telao, setTelao] = useState(false);

  useEffect(() => {
    let rodada = 0;
    const atualizar = () => {
      pedir<Monitor>('GET', '/v1/central/monitor')
        .then((x) => {
          setM(x);
          setAviso(null);
        })
        .catch((e: Error) => setAviso(`Sem resposta do servidor: ${e.message}`));
      // O histórico muda devagar: a cada 15 s basta.
      if (rodada++ % 5 === 0) {
        pedir<{ eventos: EventoDeConexao[] }>('GET', '/v1/central/monitor/historico?horas=24')
          .then((h) => setHistorico(h.eventos))
          .catch(() => undefined);
      }
    };
    atualizar();
    const relogio = setInterval(atualizar, 3000);
    return () => clearInterval(relogio);
  }, []);

  // Esc sai do telão.
  useEffect(() => {
    if (!telao) return;
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && setTelao(false);
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [telao]);

  const alertas = useMemo(() => (m === null ? [] : alertasDoMonitor(m)), [m]);
  const grupos = useMemo(() => {
    if (m === null) return [];
    const t = normalizar(busca.trim());
    const comAlerta = new Set(alertas.filter((a) => a.nivel !== 'info').map((a) => a.caixaId));
    const filtrados = m.caixas.filter((c) => (!soProblemas || c.situacao !== 'saudavel' || comAlerta.has(c.id)) && (t === '' || normalizar(`${c.cliente} ${c.loja}`).includes(t)));
    const porCliente = new Map<string, { cliente: string; situacaoCliente: string; caixas: CaixaNoMonitor[] }>();
    for (const c of filtrados) {
      const g = porCliente.get(c.clienteId) ?? { cliente: c.cliente, situacaoCliente: c.situacaoCliente, caixas: [] };
      g.caixas.push(c);
      porCliente.set(c.clienteId, g);
    }
    // Quem tem problema aparece primeiro.
    return [...porCliente.entries()].sort(([, a], [, b]) => b.caixas.filter((c) => c.situacao !== 'saudavel').length - a.caixas.filter((c) => c.situacao !== 'saudavel').length || a.cliente.localeCompare(b.cliente, 'pt-BR'));
  }, [m, busca, soProblemas, alertas]);

  if (m === null) return <p className="suave">{aviso ?? 'Carregando o monitor…'}</p>;
  const r = m.resumo;
  const gravidade = r.semSinal > 0 || m.caixas.some((c) => c.situacao === 'offline') ? 'critico' : r.comProblema > 0 || alertas.some((a) => a.nivel === 'atencao') ? 'atencao' : '';
  const veredito = r.caixas === 0 ? 'Nenhum caixa ativo ainda' : gravidade === 'critico' ? `${r.semSinal + m.caixas.filter((c) => c.situacao === 'offline').length} caixa(s) fora do ar` : gravidade === 'atencao' ? 'Tudo vendendo, com pontos de atenção' : 'Tudo funcionando';

  const conteudo = (
    <div className="coluna">
      {aviso !== null && <p className="aviso">{aviso}</p>}
      <section className={`faixa-monitor ${gravidade}`} aria-label="Situação geral" aria-live="polite">
        <div className="veredito">
          <strong>{veredito}</strong>
          <small className="suave">
            {r.clientes} cliente(s) · atualizado {new Date(m.agora).toLocaleTimeString('pt-BR')}
          </small>
        </div>
        <Contador valor={r.caixas} rotulo="caixas ativos" />
        <Contador valor={r.saudaveis} rotulo="saudáveis" tom="sucesso" />
        <Contador valor={r.comProblema - r.semSinal} rotulo="com atenção" tom={r.comProblema - r.semSinal > 0 ? 'atencao' : undefined} />
        <Contador valor={r.semSinal} rotulo="sem sinal" tom={r.semSinal > 0 ? 'erro' : undefined} />
        <Contador valor={r.filaTotal} rotulo="eventos nas filas" tom={r.filaTotal >= FILA_PREOCUPANTE ? 'atencao' : undefined} />
        <Contador valor={formatarReais(r.vendidoHojeCentavos)} rotulo="vendido hoje" />
      </section>

      <div className="filtros nao-imprimir">
        <label className="busca">
          <Search aria-hidden="true" />
          <input type="search" placeholder="Buscar cliente ou loja…" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar cliente ou loja" />
        </label>
        <div className="segmentado" role="group" aria-label="Filtro">
          <button type="button" aria-pressed={!soProblemas} onClick={() => setSoProblemas(false)}>
            Todos
          </button>
          <button type="button" aria-pressed={soProblemas} onClick={() => setSoProblemas(true)}>
            Só com problema
          </button>
        </div>
        <Botao variante="secundario" icone={telao ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />} onClick={() => setTelao(!telao)}>
          {telao ? 'Sair do telão (Esc)' : 'Modo telão'}
        </Botao>
        {telao && <span className="telao-relogio">{new Date(m.agora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>}
      </div>

      <div className="monitor-corpo">
        <div className="coluna">
          {m.caixas.length === 0 ? (
            <Cartao titulo="Nenhum caixa ativo ainda">
              <p className="suave">Os caixas aparecem aqui quando são ativados pelo código do ERP e mandam o primeiro sinal de vida.</p>
            </Cartao>
          ) : grupos.length === 0 ? (
            <Cartao titulo={soProblemas ? 'Nenhum caixa com problema' : 'Nada encontrado'}>
              <p className="suave">{soProblemas ? 'Todos os caixas estão saudáveis agora.' : `Nenhum cliente ou loja com "${busca}".`}</p>
            </Cartao>
          ) : (
            grupos.map(([clienteId, g]) => (
              <section key={clienteId} className="grupo-cliente" aria-label={g.cliente}>
                <header>
                  <h2>{g.cliente}</h2>
                  {g.situacaoCliente === 'suspenso' && <Chip tom="erro">suspenso</Chip>}
                  <small className="suave">
                    {g.caixas.length} ponto(s) · {formatarReais(g.caixas.reduce((t, c) => t + c.vendidoHojeCentavos, 0))} hoje
                  </small>
                </header>
                <div className="ladrilhos">
                  {g.caixas.map((c) => (
                    <article key={c.id} className="ladrilho" data-situacao={c.situacao}>
                      <header>
                        <strong>
                          {c.loja} · {nomeDoCaixa(c)}
                        </strong>
                        <Chip tom={TOM[c.situacao] ?? 'neutro'}>{nomeDaSituacao(c.situacao)}</Chip>
                      </header>
                      <div className="linha">
                        <span>Último sinal</span>
                        <strong>{tempo(c.segundosSemSinal)}</strong>
                      </div>
                      <div className="linha">
                        <span>Caixa</span>
                        <strong>{c.caixaAberto === null ? '—' : c.caixaAberto ? 'aberto' : 'fechado'}</strong>
                      </div>
                      <div className="linha">
                        <span>Fila</span>
                        <strong className={(c.filaPendente ?? 0) >= FILA_PREOCUPANTE ? 'texto-atencao' : ''}>{c.filaPendente ?? '—'}</strong>
                      </div>
                      <div className="linha">
                        <span>Hoje</span>
                        <strong>
                          {c.vendasHoje} · {formatarReais(c.vendidoHojeCentavos)}
                        </strong>
                      </div>
                      <div className="linha">
                        <span>Quedas 24 h · versão</span>
                        <strong className={c.quedas24h >= QUEDAS_PREOCUPANTES ? 'texto-atencao' : ''}>
                          {c.quedas24h} · {c.versao ?? '—'}
                        </strong>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>

        <aside className="lado-monitor" aria-label="Alertas e histórico">
          <Cartao titulo={`Alertas (${alertas.length})`} icone={<AlertTriangle aria-hidden="true" />}>
            {alertas.length === 0 ? (
              <p className="suave">Nenhum alerta. 👍</p>
            ) : (
              <ul className="alertas-monitor">
                {alertas.slice(0, 30).map((a, i) => (
                  <li key={`${a.caixaId}-${a.titulo}-${i}`} className={a.nivel}>
                    {a.nivel === 'erro' ? <WifiOff aria-hidden="true" /> : a.nivel === 'atencao' ? <AlertTriangle aria-hidden="true" /> : <PackageOpen aria-hidden="true" />}
                    <strong>{a.titulo}</strong>
                    <small>{a.detalhe}</small>
                  </li>
                ))}
              </ul>
            )}
          </Cartao>
          <Cartao titulo="Linha do tempo (24 h)" icone={<Clock aria-hidden="true" />}>
            {historico.length === 0 ? (
              <p className="suave">Sem quedas nem mudanças de estado nas últimas 24 horas.</p>
            ) : (
              <ol className="linha-do-tempo">
                {historico.slice(0, 40).map((e) => (
                  <li key={e.id} className={e.tipo === 'retorno' ? 'retorno' : e.estado === 'saudavel' ? '' : 'atencao'}>
                    <time dateTime={e.em}>{new Date(e.em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</time>
                    <span>
                      <strong>
                        {e.cliente} · {e.loja} · {nomeDoCaixa(e)}
                      </strong>{' '}
                      {e.tipo === 'retorno'
                        ? `voltou depois de ${duracao(e.segundosSemSinal ?? 0)} sem sinal`
                        : e.estadoAnterior === null
                          ? `primeiro sinal (${nomeDaSituacao(e.estado)})`
                          : `${nomeDaSituacao(e.estadoAnterior)} → ${nomeDaSituacao(e.estado)}`}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Cartao>
          <p className="suave">
            <Radio aria-hidden="true" width={14} height={14} /> "SEM SINAL" depois de 45 s sem notícia do caixa. Fila acima de {FILA_PREOCUPANTE} e {QUEDAS_PREOCUPANTES}+ quedas por dia viram alerta.
          </p>
        </aside>
      </div>
    </div>
  );

  return telao ? <div className="telao">{conteudo}</div> : conteudo;
}
