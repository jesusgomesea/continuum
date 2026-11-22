// Tela de fechamento: o relatório parcial da sessão, sangria e suprimento, e o fechamento com a
// contagem da gaveta. Depois de fechado, a sessão não muda mais (o banco impede).
import { Botao, Cartao } from '@continuum/interface';
import { ArrowLeft, Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api.ts';
import type { EstadoDoCaixa, Relatorio } from '../api.ts';
import { Aviso, Cabecalho, lerCampoReais, NOMES_FORMA, reais } from '../comum.tsx';

interface Props {
  estado: EstadoDoCaixa;
  aoAtualizar: (e: EstadoDoCaixa) => void;
  aoVoltar: () => void;
  aoFechar: (relatorio: Relatorio, estado: EstadoDoCaixa) => void;
}

export function Fechamento({ estado, aoAtualizar, aoVoltar, aoFechar }: Props) {
  const [relatorio, setRelatorio] = useState<Relatorio | null>(null);
  const [tipo, setTipo] = useState<'SANGRIA' | 'SUPRIMENTO'>('SANGRIA');
  const [valor, setValor] = useState('');
  const [motivo, setMotivo] = useState('');
  const [contado, setContado] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    api.relatorio().then(setRelatorio).catch((erro: Error) => setAviso(erro.message));
  }, [estado]);

  function movimentar(evento: FormEvent) {
    evento.preventDefault();
    const centavos = lerCampoReais(valor);
    if (centavos === null || centavos <= 0) {
      setAviso('Valor inválido.');
      return;
    }
    api
      .movimentar(tipo, centavos, motivo)
      .then((novo) => {
        aoAtualizar(novo);
        setValor('');
        setMotivo('');
        setAviso(null);
      })
      .catch((erro: Error) => setAviso(erro.message));
  }

  function fechar(evento: FormEvent) {
    evento.preventDefault();
    const centavos = lerCampoReais(contado);
    if (centavos === null || contado.trim() === '') {
      setAviso('Informe o dinheiro contado na gaveta.');
      return;
    }
    api
      .fechar(centavos)
      .then(({ relatorio: final, estado: novo }) => aoFechar(final, novo))
      .catch((erro: Error) => setAviso(erro.message));
  }

  return (
    <>
      <Cabecalho estado={estado}>
        <Botao variante="secundario" icone={<ArrowLeft aria-hidden="true" />} onClick={aoVoltar}>
          Voltar às vendas
        </Botao>
      </Cabecalho>
      <main className="fechamento">
        <Cartao titulo="Resumo da sessão">{relatorio === null ? <p className="suave">Carregando…</p> : <RelatorioDoCaixa relatorio={relatorio} />}</Cartao>

        <div className="coluna">
          <Cartao titulo="Sangria e suprimento">
            <form onSubmit={movimentar} className="formulario">
              <div className="escolha" role="radiogroup" aria-label="Tipo">
                <label>
                  <input type="radio" checked={tipo === 'SANGRIA'} onChange={() => setTipo('SANGRIA')} /> Sangria (tirar da gaveta)
                </label>
                <label>
                  <input type="radio" checked={tipo === 'SUPRIMENTO'} onChange={() => setTipo('SUPRIMENTO')} /> Suprimento (pôr na gaveta)
                </label>
              </div>
              <label>
                Valor (R$)
                <input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" required />
              </label>
              <label>
                Motivo
                <input value={motivo} onChange={(e) => setMotivo(e.target.value)} required />
              </label>
              <Botao type="submit" variante="secundario">
                Registrar
              </Botao>
            </form>
          </Cartao>

          <Cartao titulo="Fechar o caixa">
            <form onSubmit={fechar} className="formulario">
              <label>
                Dinheiro contado na gaveta (R$)
                <input value={contado} onChange={(e) => setContado(e.target.value)} inputMode="decimal" required />
              </label>
              <Botao type="submit" variante="perigo" icone={<Lock aria-hidden="true" />}>
                Fechar caixa
              </Botao>
            </form>
          </Cartao>
          <Aviso texto={aviso} />
        </div>
      </main>
    </>
  );
}

/** O relatório do caixa, usado no fechamento parcial e no final. */
export function RelatorioDoCaixa({ relatorio: r }: { relatorio: Relatorio }) {
  return (
    <dl className="totais relatorio">
      <div>
        <dt>Vendas</dt>
        <dd>
          {r.vendas.quantidade} · {reais(r.vendas.liquidoCentavos)}
        </dd>
      </div>
      {(Object.keys(r.porForma) as (keyof typeof r.porForma)[]).map((f) => (
        <div key={f}>
          <dt>{NOMES_FORMA[f]}</dt>
          <dd>{reais(r.porForma[f])}</dd>
        </div>
      ))}
      <div>
        <dt>Descontos</dt>
        <dd>{reais(r.descontosCentavos)}</dd>
      </div>
      <div>
        <dt>Canceladas</dt>
        <dd>
          {r.canceladas.quantidade} · {reais(r.canceladas.liquidoCentavos)}
        </dd>
      </div>
      <div>
        <dt>Fundo de troco</dt>
        <dd>{reais(r.fundoCentavos)}</dd>
      </div>
      <div>
        <dt>Suprimentos</dt>
        <dd>{reais(r.suprimentosCentavos)}</dd>
      </div>
      <div>
        <dt>Sangrias</dt>
        <dd>{reais(r.sangriasCentavos)}</dd>
      </div>
      <div className="total">
        <dt>Esperado na gaveta</dt>
        <dd data-testid="esperado">{reais(r.esperadoCentavos)}</dd>
      </div>
      {r.contadoCentavos !== null && (
        <>
          <div>
            <dt>Contado</dt>
            <dd>{reais(r.contadoCentavos)}</dd>
          </div>
          <div className={r.diferencaCentavos === 0 ? 'diferenca ok' : 'diferenca'}>
            <dt>Diferença</dt>
            <dd data-testid="diferenca">{reais(r.diferencaCentavos ?? 0)}</dd>
          </div>
        </>
      )}
    </dl>
  );
}
