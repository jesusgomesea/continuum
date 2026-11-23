// ERP · Fechamentos de caixa: cada abertura e fechamento, com fundo, vendas, sangrias, suprimentos e a
// diferença entre o que foi contado na gaveta e o que o caixa esperava (sobra ou falta).
import { formatarReais } from '@continuum/dominio';
import { Cartao, Chip } from '@continuum/interface';
import { Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { pedir } from '../api.ts';
import { BotoesDeExportar, centavosParaPlanilha, TabelaDados } from '../componentes/Tabela.tsx';
import type { Coluna } from '../componentes/Tabela.tsx';

interface Fechamento {
  id: string;
  loja: string;
  numeroCaixa: number;
  operador: string;
  fundoCentavos: number;
  abertaEm: string;
  fechadaEm: string | null;
  contadoCentavos: number | null;
  esperadoCentavos: number | null;
  diferencaCentavos: number | null;
  sangriasCentavos: number;
  suprimentosCentavos: number;
  vendas: number;
  vendidoCentavos: number;
  dinheiroCentavos: number;
}

const fmt = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
const quando = (iso: string | null) => (iso === null ? '—' : new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }));
const reais = (c: number | null) => (c === null ? '—' : formatarReais(c));

function Diferenca({ f }: { f: Fechamento }) {
  if (f.fechadaEm === null) return <Chip tom="info">aberto</Chip>;
  const d = f.diferencaCentavos ?? 0;
  if (d === 0) return <Chip tom="sucesso">confere</Chip>;
  return <Chip tom={d < 0 ? 'erro' : 'atencao'}>{`${d < 0 ? 'falta' : 'sobra'} ${formatarReais(Math.abs(d))}`}</Chip>;
}

const COLUNAS: Coluna<Fechamento>[] = [
  { titulo: 'Caixa', valor: (f) => `${f.loja} · Caixa ${f.numeroCaixa}` },
  { titulo: 'Operador', valor: (f) => f.operador },
  { titulo: 'Abertura', valor: (f) => f.abertaEm, mostrar: (f) => quando(f.abertaEm) },
  { titulo: 'Fechamento', valor: (f) => f.fechadaEm ?? '', mostrar: (f) => quando(f.fechadaEm) },
  { titulo: 'Vendas', valor: (f) => f.vendas, numerica: true },
  { titulo: 'Vendido', valor: (f) => f.vendidoCentavos, mostrar: (f) => formatarReais(f.vendidoCentavos), exportar: (f) => centavosParaPlanilha(f.vendidoCentavos), numerica: true },
  { titulo: 'Fundo', valor: (f) => f.fundoCentavos, mostrar: (f) => formatarReais(f.fundoCentavos), exportar: (f) => centavosParaPlanilha(f.fundoCentavos), numerica: true },
  { titulo: 'Sangrias', valor: (f) => f.sangriasCentavos, mostrar: (f) => formatarReais(f.sangriasCentavos), exportar: (f) => centavosParaPlanilha(f.sangriasCentavos), numerica: true },
  { titulo: 'Suprimentos', valor: (f) => f.suprimentosCentavos, mostrar: (f) => formatarReais(f.suprimentosCentavos), exportar: (f) => centavosParaPlanilha(f.suprimentosCentavos), numerica: true },
  { titulo: 'Esperado', valor: (f) => f.esperadoCentavos, mostrar: (f) => reais(f.esperadoCentavos), exportar: (f) => (f.esperadoCentavos === null ? '' : centavosParaPlanilha(f.esperadoCentavos)), numerica: true },
  { titulo: 'Contado', valor: (f) => f.contadoCentavos, mostrar: (f) => reais(f.contadoCentavos), exportar: (f) => (f.contadoCentavos === null ? '' : centavosParaPlanilha(f.contadoCentavos)), numerica: true },
  { titulo: 'Diferença', valor: (f) => f.diferencaCentavos, mostrar: (f) => <Diferenca f={f} />, exportar: (f) => (f.diferencaCentavos === null ? '' : centavosParaPlanilha(f.diferencaCentavos)), numerica: true },
];

export function ErpFechamentos() {
  const hoje = fmt(new Date());
  const [de, setDe] = useState(fmt(new Date(Date.now() - 6 * 86_400_000)));
  const [ate, setAte] = useState(hoje);
  const [lista, setLista] = useState<Fechamento[] | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  useEffect(() => {
    pedir<{ fechamentos: Fechamento[] }>('GET', `/v1/erp/fechamentos?de=${de}&ate=${ate}`)
      .then((r) => {
        setLista(r.fechamentos);
        setAviso(null);
      })
      .catch((e: Error) => setAviso(e.message));
  }, [de, ate]);
  const fechados = (lista ?? []).filter((f) => f.fechadaEm !== null);
  const saldoDasDiferencas = fechados.reduce((t, f) => t + (f.diferencaCentavos ?? 0), 0);
  const comDiferenca = fechados.filter((f) => (f.diferencaCentavos ?? 0) !== 0).length;

  return (
    <div className="coluna">
      <div className="filtros nao-imprimir">
        <label>
          De
          <input type="date" value={de} max={ate} onChange={(e) => setDe(e.target.value)} />
        </label>
        <label>
          Até
          <input type="date" value={ate} min={de} max={hoje} onChange={(e) => setAte(e.target.value)} />
        </label>
      </div>
      {aviso !== null && <p className="aviso">{aviso}</p>}
      {lista !== null && (
        <>
          <div className="grade-kpi">
            <Cartao titulo="Turnos" icone={<Wallet aria-hidden="true" />} className="kpi">
              <p className="numero-grande">{lista.length}</p>
              <small className="suave">{lista.length - fechados.length} ainda aberto(s)</small>
            </Cartao>
            <Cartao titulo="Com diferença" className="kpi">
              <p className="numero-grande">{comDiferenca}</p>
            </Cartao>
            <Cartao titulo="Saldo das diferenças" className="kpi">
              <p className={`numero-grande ${saldoDasDiferencas < 0 ? 'texto-erro' : ''}`}>{formatarReais(saldoDasDiferencas)}</p>
              <small className="suave">negativo = faltou dinheiro na gaveta</small>
            </Cartao>
          </div>
          <Cartao titulo="Aberturas e fechamentos" acao={<BotoesDeExportar nome={`fechamentos-${de}-a-${ate}`} colunas={COLUNAS} linhas={lista} />}>
            <TabelaDados chave={(f) => f.id} linhas={lista} colunas={COLUNAS} vazio="Nenhum caixa aberto neste período." />
          </Cartao>
        </>
      )}
    </div>
  );
}
