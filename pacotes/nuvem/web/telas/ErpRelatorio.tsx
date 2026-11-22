// ERP · Relatório de vendas (Passo 2.5, UC18): o dia, por forma de pagamento, os mais vendidos e cada caixa.
import { formatarReais } from '@continuum/dominio';
import { Cartao } from '@continuum/interface';
import { BarChart3 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { pedir } from '../api.ts';

interface Relatorio {
  totais: { vendas: number; liquidoCentavos: number; descontosCentavos: number };
  canceladas: { quantidade: number; liquidoCentavos: number };
  porForma: { forma: string; valorCentavos: number }[];
  trocoCentavos: number;
  maisVendidos: { nome: string; quantidade: number; valorCentavos: number }[];
  porCaixa: { loja: string; numeroCaixa: number; vendas: number; liquidoCentavos: number }[];
}

const FORMAS: Record<string, string> = { dinheiro: 'Dinheiro', debito: 'Débito', credito: 'Crédito', pix: 'Pix' };
const hojeEmBrasilia = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

export function ErpRelatorio() {
  const [dia, setDia] = useState(hojeEmBrasilia());
  const [r, setR] = useState<Relatorio | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    pedir<Relatorio>('GET', `/v1/erp/relatorios/vendas?dia=${dia}`)
      .then((x) => {
        setR(x);
        setAviso(null);
      })
      .catch((e: Error) => setAviso(e.message));
  }, [dia]);

  return (
    <div className="coluna">
      <label className="campo-dia">
        Dia
        <input type="date" value={dia} onChange={(e) => setDia(e.target.value)} />
      </label>
      {aviso !== null && <p className="aviso">{aviso}</p>}
      {r !== null && (
        <>
          <div className="grade-cartoes">
            <Cartao titulo="Vendido no dia" icone={<BarChart3 aria-hidden="true" />}>
              <p className="numero-grande">{formatarReais(r.totais.liquidoCentavos)}</p>
              <p className="suave">
                {r.totais.vendas} vendas · descontos {formatarReais(r.totais.descontosCentavos)}
              </p>
            </Cartao>
            <Cartao titulo="Canceladas (estorno)">
              <p className="numero-grande">{r.canceladas.quantidade}</p>
              <p className="suave">{formatarReais(r.canceladas.liquidoCentavos)}</p>
            </Cartao>
          </div>
          {r.totais.vendas === 0 ? (
            <Cartao titulo="Nenhuma venda neste dia">
              <p className="suave">As vendas dos caixas aparecem aqui quando sobem para a nuvem (Passo 3.2), mesmo as feitas sem internet.</p>
            </Cartao>
          ) : (
            <div className="grade-cartoes">
              <Cartao titulo="Por forma de pagamento">
                <dl className="dados">
                  {r.porForma.map((f) => (
                    <div key={f.forma} className="linha-dado">
                      <dt>{FORMAS[f.forma] ?? f.forma}</dt>
                      <dd>{formatarReais(f.valorCentavos)}</dd>
                    </div>
                  ))}
                  <div className="linha-dado">
                    <dt>Troco devolvido</dt>
                    <dd>-{formatarReais(r.trocoCentavos)}</dd>
                  </div>
                </dl>
              </Cartao>
              <Cartao titulo="Mais vendidos">
                <table className="tabela">
                  <tbody>
                    {r.maisVendidos.map((m) => (
                      <tr key={m.nome}>
                        <td>{m.nome}</td>
                        <td>{m.quantidade}</td>
                        <td>{formatarReais(m.valorCentavos)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Cartao>
              <Cartao titulo="Por caixa">
                <table className="tabela">
                  <tbody>
                    {r.porCaixa.map((c) => (
                      <tr key={`${c.loja}-${c.numeroCaixa}`}>
                        <td>
                          {c.loja} · Caixa {c.numeroCaixa}
                        </td>
                        <td>{c.vendas} vendas</td>
                        <td>{formatarReais(c.liquidoCentavos)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Cartao>
            </div>
          )}
        </>
      )}
    </div>
  );
}
