// Vitrine da interface (.\dev vitrine): mostra os tokens e os componentes do
// Continuum nos temas escuro e claro, para aprovar o visual antes das telas reais.
import { Activity, ListOrdered, Moon, Play, RefreshCw, ShieldCheck, Sun, Trash2 } from 'lucide-react';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/estilos.css';
import { Botao, Cartao, Chip, FaixaDeEstado, NOMES_ESTADO, type EstadoSistema } from '../src/index.ts';
import './vitrine.css';

type Tema = 'escuro' | 'claro';

function lerTema(): Tema {
  try {
    return localStorage.getItem('continuum.vitrine.tema') === 'claro' ? 'claro' : 'escuro';
  } catch {
    return 'escuro';
  }
}

const CORES = [
  ['--cor-fundo', 'Fundo'],
  ['--cor-superficie', 'Superfície (cartão)'],
  ['--cor-superficie-2', 'Superfície 2 (campos)'],
  ['--cor-borda', 'Borda'],
  ['--cor-texto', 'Texto'],
  ['--cor-texto-fraco', 'Texto fraco'],
  ['--cor-primaria', 'Primária'],
  ['--cor-primaria-2', 'Primária 2 (destaque)'],
  ['--cor-sucesso', 'Sucesso · SAUDÁVEL'],
  ['--cor-atencao', 'Atenção · DEGRADADO'],
  ['--cor-erro', 'Erro · OFFLINE'],
  ['--cor-info', 'Informação'],
] as const;

const TEXTOS = [
  ['--texto-3xl', 'KPI', '1.850'],
  ['--texto-2xl', 'Título de página', 'Relatório da sessão'],
  ['--texto-xl', 'Título de seção', 'Lojas da rede'],
  ['--texto-lg', 'Destaque', 'Contingência ativa'],
  ['--texto-base', 'Texto', 'A loja continua vendendo; a fila cresce e nada se perde.'],
  ['--texto-sm', 'Apoio', 'vendas na nuvem · 5.561 eventos recebidos'],
  ['--texto-xs', 'Rótulo', 'DETECÇÃO DA QUEDA'],
] as const;

const ESTADOS = Object.keys(NOMES_ESTADO) as EstadoSistema[];

/** Lê o valor atual de um token (muda quando o tema muda). */
function valorDoToken(nome: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(nome).trim();
}

function Vitrine() {
  const [tema, setTema] = useState<Tema>(lerTema);
  const [, redesenhar] = useState(0);

  useEffect(() => {
    document.documentElement.dataset['tema'] = tema;
    try {
      localStorage.setItem('continuum.vitrine.tema', tema);
    } catch {
      /* sem armazenamento: segue só nesta visita */
    }
    redesenhar((n) => n + 1); // atualiza os códigos das cores mostrados na paleta
  }, [tema]);

  return (
    <div className="vitrine">
      <header className="topo">
        <div className="marca">
          <img src="./logo.png" alt="" />
          <div>
            <strong>CONTINUUM</strong>
            <small>Vitrine da interface · Passo 0.2</small>
          </div>
        </div>
        <Botao
          variante="secundario"
          icone={tema === 'escuro' ? <Sun /> : <Moon />}
          onClick={() => setTema(tema === 'escuro' ? 'claro' : 'escuro')}
          aria-label={`Trocar para o tema ${tema === 'escuro' ? 'claro' : 'escuro'}`}
        >
          Tema {tema === 'escuro' ? 'claro' : 'escuro'}
        </Botao>
      </header>

      <p className="intro">
        Tema <b>{tema}</b> · {tema === 'escuro' ? 'Central e PDV (a cara do Dashboard)' : 'ERP do cliente (a cara do material de apresentação)'}
      </p>

      <section className="secao">
        <h2>Faixa de estado</h2>
        <p className="nota">Os 5 estados da máquina de estados, como no topo do Dashboard.</p>
        <div className="pilha">
          <FaixaDeEstado estado="offline" extra="Contingência ativa">
            <div className="metrica"><small>Detecção da queda</small><b>1,0 s</b></div>
            <div className="metrica"><small>Vendas na queda</small><b>98</b></div>
          </FaixaDeEstado>
          {ESTADOS.filter((e) => e !== 'offline').map((estado) => (
            <FaixaDeEstado key={estado} estado={estado} />
          ))}
        </div>
      </section>

      <section className="secao">
        <h2>Cartões e chips</h2>
        <div className="grade3">
          <Cartao titulo="Status do sistema" icone={<Activity />} acao={<Chip tom="sucesso">Online</Chip>}>
            <div className="kpi">1.850</div>
            <p className="nota">vendas na loja · 5.561 eventos gravados</p>
          </Cartao>
          <Cartao titulo="Sincronização" icone={<RefreshCw />} acao={<Chip tom="atencao">Pausada</Chip>}>
            <div className="kpi">1.851</div>
            <div className="barra"><div style={{ width: '95%' }} /></div>
            <p className="nota">95% dos eventos da loja na nuvem</p>
          </Cartao>
          <Cartao titulo="Fila de operações" icone={<ListOrdered />} acao={<Chip tom="erro">Acumulando</Chip>}>
            <div className="kpi atencao">4.230</div>
            <p className="nota">eventos pendentes · nada se perde sem a nuvem</p>
          </Cartao>
        </div>
        <div className="linha">
          <Chip tom="sucesso">Em dia</Chip>
          <Chip tom="atencao">Aguardando</Chip>
          <Chip tom="erro">Contingência</Chip>
          <Chip tom="info">Em andamento</Chip>
          <Chip tom="neutro">Desconhecido</Chip>
          <Chip tom="sucesso" ponto={false}>sem ponto</Chip>
        </div>
      </section>

      <section className="secao">
        <h2>Botões</h2>
        <div className="linha">
          <Botao icone={<Play />}>Gerar vendas</Botao>
          <Botao variante="secundario">Parar</Botao>
          <Botao variante="perigo" icone={<Trash2 />}>Derrubar nuvem</Botao>
          <Botao variante="fantasma">Ação discreta</Botao>
          <Botao disabled>Desabilitado</Botao>
        </div>
        <div className="largo-demo">
          <Botao largo icone={<ShieldCheck />}>Finalizar venda (F9) · botão largo do PDV</Botao>
        </div>
      </section>

      <section className="secao">
        <h2>Paleta (tokens de cor)</h2>
        <p className="nota">As telas usam o nome do token; o tema troca o valor.</p>
        <div className="paleta">
          {CORES.map(([token, nome]) => (
            <div key={token} className="cor">
              <span className="amostra" style={{ background: `var(${token})` }} />
              <div>
                <b>{nome}</b>
                <code>{token}</code>
                <code>{valorDoToken(token)}</code>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="secao">
        <h2>Tipografia</h2>
        <div className="pilha">
          {TEXTOS.map(([token, nome, exemplo]) => (
            <div key={token} className="texto-amostra">
              <code>{token} · {nome}</code>
              <span style={{ fontSize: `var(${token})`, fontWeight: token === '--texto-3xl' ? 800 : undefined }}>{exemplo}</span>
            </div>
          ))}
        </div>
      </section>

      <footer className="rodape">CONTINUUM · Sempre em operação.</footer>
    </div>
  );
}

const raiz = document.getElementById('raiz');
if (raiz) {
  createRoot(raiz).render(
    <StrictMode>
      <Vitrine />
    </StrictMode>,
  );
}
