// O PDV: decide qual tela mostrar conforme o estado do caixa.
//   caixa fechado → Abrir caixa
//   caixa aberto  → Venda (com "Venda finalizada" por cima ao terminar cada venda) ou Fechamento
//   acabou de fechar → o relatório do fechamento
import { useCallback, useEffect, useState } from 'react';
import { api, RecusaDoCaixa } from './api.ts';
import type { EstadoDoCaixa, Relatorio } from './api.ts';
import { AbrirCaixa } from './telas/AbrirCaixa.tsx';
import { Fechamento, RelatorioDoCaixa } from './telas/Fechamento.tsx';
import { TelaDeVenda } from './telas/Venda.tsx';
import { Botao } from '@continuum/interface';

export function App() {
  const [estado, setEstado] = useState<EstadoDoCaixa | null>(null);
  const [falha, setFalha] = useState<string | null>(null);
  const [tela, setTela] = useState<'venda' | 'fechamento'>('venda');
  const [relatorioFinal, setRelatorioFinal] = useState<Relatorio | null>(null);

  const recarregar = useCallback(() => {
    api
      .estado()
      .then((e) => {
        setEstado(e);
        setFalha(null);
      })
      .catch((erro: unknown) => setFalha(erro instanceof RecusaDoCaixa ? erro.message : 'Não foi possível falar com o caixa.'));
  }, []);

  useEffect(recarregar, [recarregar]);

  if (falha !== null && estado === null) {
    return (
      <main className="centro">
        <p role="alert">{falha}</p>
        <Botao onClick={recarregar}>Tentar de novo</Botao>
      </main>
    );
  }
  if (estado === null) return <main className="centro">Carregando o caixa…</main>;

  if (relatorioFinal !== null) {
    return (
      <main className="centro">
        <section className="painel largo">
          <h1>Caixa fechado</h1>
          <RelatorioDoCaixa relatorio={relatorioFinal} />
          <Botao largo onClick={() => setRelatorioFinal(null)}>
            Abrir um novo caixa
          </Botao>
        </section>
      </main>
    );
  }

  if (estado.sessao === null) return <AbrirCaixa estado={estado} aoAbrir={setEstado} />;

  if (tela === 'fechamento') {
    return (
      <Fechamento
        estado={estado}
        aoAtualizar={setEstado}
        aoVoltar={() => setTela('venda')}
        aoFechar={(relatorio, novo) => {
          setEstado(novo);
          setRelatorioFinal(relatorio);
          setTela('venda');
        }}
      />
    );
  }
  return <TelaDeVenda estado={estado} aoAtualizar={setEstado} aoIrParaFechamento={() => setTela('fechamento')} />;
}
