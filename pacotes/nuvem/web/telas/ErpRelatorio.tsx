// ERP · Relatório de vendas (UC18): qualquer período (hoje, 7 dias, o mês, ou de/até), por loja.
// Por dia, forma de pagamento, produto, caixa, hora e operador. Exporta para o Excel (CSV) e imprime/PDF.
import { formatarReais } from '@continuum/dominio';
import { Cartao } from '@continuum/interface';
import { BarChart3, Clock, CreditCard, Package, User } from 'lucide-react';
import { useEffect, useState } from 'react';
import { pedir } from '../api.ts';
import { GraficoDeBarras, GraficoDeRosca } from '../componentes/Graficos.tsx';
import { BotoesDeExportar, centavosParaPlanilha, TabelaDados } from '../componentes/Tabela.tsx';
import type { Coluna } from '../componentes/Tabela.tsx';
import { NOMES_DAS_FORMAS } from './ErpPainel.tsx';

interface Relatorio {
  de: string;
  ate: string;
  totais: { vendas: number; liquidoCentavos: number; descontosCentavos: number; trocoCentavos: number; ticketMedioCentavos: number };
  canceladas: { quantidade: number; liquidoCentavos: number };
  porDia: { dia: string; vendas: number; liquidoCentavos: number }[];
  porForma: { forma: string; vendas: number; valorCentavos: number }[];
  porProduto: { nome: string; unidade: string; quantidade: number; vendas: number; valorCentavos: number }[];
  porCaixa: { loja: string; numeroCaixa: number; vendas: number; liquidoCentavos: number }[];
  porHora: { hora: number; vendas: number; liquidoCentavos: number }[];
  porOperador: { operador: string; vendas: number; liquidoCentavos: number }[];
  lojas: { id: string; nomeReduzido: string }[];
}
type Produto = Relatorio['porProduto'][number];

const fmt = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
const menosDias = (iso: string, n: number) => fmt(new Date(Date.parse(`${iso}T12:00:00Z`) - n * 86_400_000));
const brasil = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

const PERIODOS = [
  { id: 'hoje', nome: 'Hoje', de: (h: string) => h },
  { id: 'ontem', nome: 'Ontem', de: (h: string) => menosDias(h, 1), ate: (h: string) => menosDias(h, 1) },
  { id: '7', nome: '7 dias', de: (h: string) => menosDias(h, 6) },
  { id: '30', nome: '30 dias', de: (h: string) => menosDias(h, 29) },
  { id: 'mes', nome: 'Este mês', de: (h: string) => `${h.slice(0, 8)}01` },
] as const;

const COLUNAS_PRODUTO: Coluna<Produto>[] = [
  { titulo: 'Produto', valor: (p) => p.nome },
  { titulo: 'Quantidade', valor: (p) => p.quantidade, mostrar: (p) => `${p.quantidade} ${p.unidade}`, numerica: true },
  { titulo: 'Vendas', valor: (p) => p.vendas, numerica: true },
  { titulo: 'Total', valor: (p) => p.valorCentavos, mostrar: (p) => formatarReais(p.valorCentavos), exportar: (p) => centavosParaPlanilha(p.valorCentavos), numerica: true },
];

export function ErpRelatorio() {
  const hoje = fmt(new Date());
  const [periodo, setPeriodo] = useState<string>('hoje');
  const [de, setDe] = useState(hoje);
  const [ate, setAte] = useState(hoje);
  const [loja, setLoja] = useState('');
  const [r, setR] = useState<Relatorio | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  function escolher(id: string) {
    const p = PERIODOS.find((x) => x.id === id);
    setPeriodo(id);
    if (p === undefined) return;
    setDe(p.de(hoje));
    setAte('ate' in p ? p.ate(hoje) : hoje);
  }

  useEffect(() => {
    if (de > ate) return;
    pedir<Relatorio>('GET', `/v1/erp/relatorios/periodo?de=${de}&ate=${ate}${loja === '' ? '' : `&loja=${loja}`}`)
      .then((x) => {
        setR(x);
        setAviso(null);
      })
      .catch((e: Error) => setAviso(e.message));
  }, [de, ate, loja]);

  const umDia = de === ate;
  return (
    <div className="coluna">
      <div className="filtros nao-imprimir">
        <div className="segmentado" role="group" aria-label="Período">
          {PERIODOS.map((p) => (
            <button key={p.id} type="button" aria-pressed={periodo === p.id} onClick={() => escolher(p.id)}>
              {p.nome}
            </button>
          ))}
        </div>
        <label>
          De
          <input type="date" value={de} max={ate} onChange={(e) => (setPeriodo('livre'), setDe(e.target.value))} />
        </label>
        <label>
          Até
          <input type="date" value={ate} min={de} onChange={(e) => (setPeriodo('livre'), setAte(e.target.value))} />
        </label>
        {r !== null && r.lojas.length > 1 && (
          <label>
            Loja
            <select value={loja} onChange={(e) => setLoja(e.target.value)}>
              <option value="">Todas</option>
              {r.lojas.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nomeReduzido}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <p className="so-imprimir">
        Relatório de vendas · {brasil(de)} a {brasil(ate)}
      </p>
      {aviso !== null && <p className="aviso">{aviso}</p>}
      {r !== null && (
        <>
          <div className="grade-kpi">
            <Cartao titulo="Vendido" icone={<BarChart3 aria-hidden="true" />} className="kpi kpi-principal">
              <p className="numero-grande">{formatarReais(r.totais.liquidoCentavos)}</p>
              <small className="suave">descontos {formatarReais(r.totais.descontosCentavos)}</small>
            </Cartao>
            <Cartao titulo="Vendas" className="kpi">
              <p className="numero-grande">{r.totais.vendas}</p>
            </Cartao>
            <Cartao titulo="Ticket médio" className="kpi">
              <p className="numero-grande">{formatarReais(r.totais.ticketMedioCentavos)}</p>
            </Cartao>
            <Cartao titulo="Canceladas (estorno)" className="kpi">
              <p className="numero-grande">{r.canceladas.quantidade}</p>
              <small className="suave">{formatarReais(r.canceladas.liquidoCentavos)}</small>
            </Cartao>
          </div>

          {r.totais.vendas === 0 ? (
            <Cartao titulo="Nenhuma venda neste período">
              <p className="suave">As vendas dos caixas aparecem aqui quando sobem para a nuvem, mesmo as feitas sem internet.</p>
            </Cartao>
          ) : (
            <>
              <div className="grade-painel">
                <Cartao titulo={umDia ? 'Por hora' : 'Por dia'} icone={umDia ? <Clock aria-hidden="true" /> : <BarChart3 aria-hidden="true" />} className="largo-2">
                  {umDia ? (
                    <GraficoDeBarras
                      titulo="Vendas por hora"
                      barras={r.porHora.map((h) => ({ rotulo: `${h.hora}h`, valor: h.liquidoCentavos, dica: `${h.hora}h: ${formatarReais(h.liquidoCentavos)} em ${h.vendas} venda(s)` }))}
                      formatar={formatarReais}
                    />
                  ) : (
                    <GraficoDeBarras
                      titulo="Vendas por dia"
                      barras={r.porDia.map((d) => ({ rotulo: d.dia.slice(8, 10), valor: d.liquidoCentavos, dica: `${brasil(d.dia)}: ${formatarReais(d.liquidoCentavos)} em ${d.vendas} venda(s)` }))}
                      formatar={formatarReais}
                      passoDoRotulo={r.porDia.length > 40 ? 7 : r.porDia.length > 14 ? 3 : 1}
                    />
                  )}
                </Cartao>
                <Cartao titulo="Formas de pagamento" icone={<CreditCard aria-hidden="true" />}>
                  <GraficoDeRosca titulo="Formas de pagamento" fatias={r.porForma.map((f) => ({ rotulo: NOMES_DAS_FORMAS[f.forma] ?? f.forma, valor: f.valorCentavos }))} formatar={formatarReais} />
                  <p className="suave">Troco devolvido: {formatarReais(r.totais.trocoCentavos)}</p>
                </Cartao>
              </div>

              <Cartao titulo={`Por produto (${r.porProduto.length})`} icone={<Package aria-hidden="true" />} acao={<BotoesDeExportar nome={`vendas-por-produto-${de}-a-${ate}`} colunas={COLUNAS_PRODUTO} linhas={r.porProduto} />}>
                <TabelaDados colunas={COLUNAS_PRODUTO} linhas={r.porProduto} chave={(p) => `${p.nome}-${p.unidade}`} />
              </Cartao>

              <div className="grade-cartoes">
                <Cartao titulo="Por caixa">
                  <TabelaDados
                    busca={false}
                    chave={(c) => `${c.loja}-${c.numeroCaixa}`}
                    linhas={r.porCaixa}
                    colunas={[
                      { titulo: 'Caixa', valor: (c) => `${c.loja} · Caixa ${c.numeroCaixa}` },
                      { titulo: 'Vendas', valor: (c) => c.vendas, numerica: true },
                      { titulo: 'Total', valor: (c) => c.liquidoCentavos, mostrar: (c) => formatarReais(c.liquidoCentavos), numerica: true },
                    ]}
                  />
                </Cartao>
                <Cartao titulo="Por operador" icone={<User aria-hidden="true" />}>
                  <TabelaDados
                    busca={false}
                    chave={(o) => o.operador}
                    linhas={r.porOperador}
                    colunas={[
                      { titulo: 'Operador', valor: (o) => o.operador },
                      { titulo: 'Vendas', valor: (o) => o.vendas, numerica: true },
                      { titulo: 'Total', valor: (o) => o.liquidoCentavos, mostrar: (o) => formatarReais(o.liquidoCentavos), numerica: true },
                    ]}
                  />
                </Cartao>
                <Cartao titulo="Por forma de pagamento">
                  <TabelaDados
                    busca={false}
                    chave={(f) => f.forma}
                    linhas={r.porForma}
                    colunas={[
                      { titulo: 'Forma', valor: (f) => NOMES_DAS_FORMAS[f.forma] ?? f.forma },
                      { titulo: 'Vendas', valor: (f) => f.vendas, numerica: true },
                      { titulo: 'Recebido', valor: (f) => f.valorCentavos, mostrar: (f) => formatarReais(f.valorCentavos), numerica: true },
                    ]}
                  />
                </Cartao>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
