// As últimas vendas do caixa, com o cancelamento (estorno) das vendas da sessão aberta.
import { Botao, Cartao, Chip } from '@continuum/interface';
import { Ban, Printer } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api.ts';
import type { EstadoDoCaixa } from '../api.ts';
import { abrirComprovante, Aviso, reais } from '../comum.tsx';

export function UltimasVendas({ estado, aoAtualizar }: { estado: EstadoDoCaixa; aoAtualizar: (e: EstadoDoCaixa) => void }) {
  const [cancelando, setCancelando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const [autorizadoPor, setAutorizadoPor] = useState('');
  const [pin, setPin] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);

  function confirmar(codigo: string) {
    api
      .cancelar(codigo, motivo, autorizadoPor, pin)
      .then((novo) => {
        aoAtualizar(novo);
        setCancelando(null);
        setMotivo('');
        setAutorizadoPor('');
        setPin('');
        setAviso(null);
      })
      .catch((erro: Error) => setAviso(erro.message));
  }

  return (
    <Cartao className="ultimas" titulo="Últimas vendas deste caixa">
      <ul>
        {estado.ultimasVendas.length === 0 && <li className="suave">Nenhuma venda ainda.</li>}
        {estado.ultimasVendas.map((v) => (
          <li key={v.codigo}>
            <div className="linha-venda">
              <span className="codigo">{v.codigo}</span>
              <span>{reais(v.liquidoCentavos)}</span>
              <Botao
                variante="fantasma"
                icone={<Printer aria-hidden="true" />}
                aria-label={`Reimprimir o comprovante ${v.codigo}`}
                onClick={() => abrirComprovante(v.codigo, { reimpressao: true })}
              />
              {v.cancelada ? (
                <Chip tom="erro">Cancelada</Chip>
              ) : v.sessaoId === estado.sessao?.id ? (
                <Botao variante="fantasma" icone={<Ban aria-hidden="true" />} onClick={() => setCancelando(v.codigo)}>
                  Cancelar
                </Botao>
              ) : (
                <Chip tom="neutro">Sessão anterior</Chip>
              )}
            </div>
            {cancelando === v.codigo && (
              <form
                className="cancelamento"
                onSubmit={(e) => {
                  e.preventDefault();
                  confirmar(v.codigo);
                }}
              >
                <label>
                  Motivo
                  <input value={motivo} onChange={(e) => setMotivo(e.target.value)} required />
                </label>
                <label>
                  Autorizado por (supervisor)
                  <input value={autorizadoPor} onChange={(e) => setAutorizadoPor(e.target.value)} required />
                </label>
                <label>
                  PIN do supervisor
                  <input type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} required />
                </label>
                <Aviso texto={aviso} />
                <div className="botoes">
                  <Botao type="submit" variante="perigo">
                    Confirmar cancelamento
                  </Botao>
                  <Botao variante="fantasma" onClick={() => setCancelando(null)}>
                    Voltar
                  </Botao>
                </div>
              </form>
            )}
          </li>
        ))}
      </ul>
    </Cartao>
  );
}
