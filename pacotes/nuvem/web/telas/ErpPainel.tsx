// ERP · Painel do dono: a primeira tela. Vendas de hoje comparadas com ontem e com o mesmo dia da semana
// passada, ticket médio, os últimos 30 dias, as horas de movimento, formas de pagamento, mais vendidos,
// estoque baixo e os caixas. Atualiza sozinho a cada 30 segundos.
import { formatarReais } from '@continuum/dominio';
import { Cartao, Chip } from '@continuum/interface';
import { AlertTriangle, BarChart3, Boxes, Clock, CreditCard, MonitorSmartphone, Receipt, Trophy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { pedir } from '../api.ts';
import { GraficoDeBarras, GraficoDeRosca, MiniLinha, Tendencia } from '../componentes/Graficos.tsx';

interface Dia {
  dia: string;
  vendas: number;
  liquidoCentavos: number;
}
interface Painel {
  hoje: Dia;
  ontem: Dia;
  semanaPassada: Dia;
  ultimos7: { vendas: number; liquidoCentavos: number };
  ultimos30Totais: { vendas: number; liquidoCentavos: number };
  ultimos30: Dia[];
  porHora: { hora: number; vendas: number; liquidoCentavos: number }[];
  porForma: { forma: string; valorCentavos: number }[];
  maisVendidos: { nome: string; quantidade: number; valorCentavos: number }[];
  estoque: { negativos: number; abaixo: number; produtos: number };
  estoqueBaixo: { id: string; nome: string; unidade: string; estoqueMinimo: number; saldo: number }[];
  caixas: { ativos: number; semSinal: number; abertos: number; filaPendente: number };
}

export const NOMES_DAS_FORMAS: Record<string, string> = { dinheiro: 'Dinheiro', debito: 'Débito', credito: 'Crédito', pix: 'Pix' };
const ticket = (d: { vendas: number; liquidoCentavos: number }) => (d.vendas === 0 ? 0 : Math.round(d.liquidoCentavos / d.vendas));
const diaCurto = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

export function ErpPainel({ irPara }: { irPara: (tela: 'relatorio' | 'alertas' | 'caixas') => void }) {
  const [p, setP] = useState<Painel | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    const carregar = () =>
      pedir<Painel>('GET', '/v1/erp/painel')
        .then((x) => {
          setP(x);
          setAviso(null);
        })
        .catch((e: Error) => setAviso(e.message));
    void carregar();
    const relogio = setInterval(() => void carregar(), 30_000);
    return () => clearInterval(relogio);
  }, []);

  if (p === null) return <p className="suave">{aviso ?? 'Carregando o painel…'}</p>;
  const horas = Array.from({ length: 24 }, (_, h) => p.porHora.find((x) => x.hora === h) ?? { hora: h, vendas: 0, liquidoCentavos: 0 });
  const primeiraHora = Math.min(...horas.filter((h) => h.vendas > 0).map((h) => h.hora), 7);
  const ultimaHora = Math.max(...horas.filter((h) => h.vendas > 0).map((h) => h.hora), 20);
  const diaDaSemana = SEMANA[new Date(`${p.hoje.dia}T12:00:00Z`).getUTCDay()] ?? '';

  return (
    <div className="coluna painel-erp">
      {aviso !== null && <p className="aviso">{aviso}</p>}

      <div className="grade-kpi">
        <Cartao titulo="Vendido hoje" icone={<BarChart3 aria-hidden="true" />} className="kpi kpi-principal">
          <p className="numero-grande">{formatarReais(p.hoje.liquidoCentavos)}</p>
          <div className="tendencias">
            <Tendencia atual={p.hoje.liquidoCentavos} anterior={p.ontem.liquidoCentavos} rotulo="vs. ontem" />
            <Tendencia atual={p.hoje.liquidoCentavos} anterior={p.semanaPassada.liquidoCentavos} rotulo={`vs. ${diaDaSemana} passada`} />
          </div>
        </Cartao>
        <Cartao titulo="Vendas hoje" icone={<Receipt aria-hidden="true" />} className="kpi">
          <p className="numero-grande">{p.hoje.vendas}</p>
          <Tendencia atual={p.hoje.vendas} anterior={p.ontem.vendas} rotulo="vs. ontem" />
        </Cartao>
        <Cartao titulo="Ticket médio" icone={<CreditCard aria-hidden="true" />} className="kpi">
          <p className="numero-grande">{formatarReais(ticket(p.hoje))}</p>
          <small className="suave">7 dias: {formatarReais(ticket(p.ultimos7))}</small>
        </Cartao>
        <Cartao titulo="Últimos 30 dias" icone={<Clock aria-hidden="true" />} className="kpi">
          <p className="numero-medio">{formatarReais(p.ultimos30Totais.liquidoCentavos)}</p>
          <MiniLinha valores={p.ultimos30.map((d) => d.liquidoCentavos)} titulo="Vendas dos últimos 30 dias" />
          <small className="suave">{p.ultimos30Totais.vendas} vendas</small>
        </Cartao>
      </div>

      <div className="grade-painel">
        <Cartao titulo="Vendas por dia (30 dias)" icone={<BarChart3 aria-hidden="true" />} className="largo-2" acao={<button type="button" className="link" onClick={() => irPara('relatorio')}>Ver relatório</button>}>
          <GraficoDeBarras
            titulo="Vendas por dia nos últimos 30 dias"
            barras={p.ultimos30.map((d, i) => ({ rotulo: diaCurto(d.dia), valor: d.liquidoCentavos, destaque: i === p.ultimos30.length - 1, dica: `${diaCurto(d.dia)}: ${formatarReais(d.liquidoCentavos)} em ${d.vendas} venda(s)` }))}
            formatar={formatarReais}
            passoDoRotulo={5}
          />
        </Cartao>
        <Cartao titulo="Formas de pagamento (7 dias)" icone={<CreditCard aria-hidden="true" />}>
          <GraficoDeRosca titulo="Formas de pagamento" fatias={p.porForma.map((f) => ({ rotulo: NOMES_DAS_FORMAS[f.forma] ?? f.forma, valor: f.valorCentavos }))} formatar={formatarReais} />
        </Cartao>
        <Cartao titulo="Movimento por hora (hoje)" icone={<Clock aria-hidden="true" />} className="largo-2">
          <GraficoDeBarras
            titulo="Vendas por hora hoje"
            barras={horas.slice(primeiraHora, ultimaHora + 1).map((h) => ({ rotulo: `${h.hora}h`, valor: h.liquidoCentavos, dica: `${h.hora}h: ${formatarReais(h.liquidoCentavos)} em ${h.vendas} venda(s)` }))}
            formatar={formatarReais}
            altura={150}
          />
        </Cartao>
        <Cartao titulo="Mais vendidos (7 dias)" icone={<Trophy aria-hidden="true" />}>
          {p.maisVendidos.length === 0 ? (
            <p className="suave">As vendas dos caixas aparecem aqui.</p>
          ) : (
            <ol className="ranking">
              {p.maisVendidos.map((m) => (
                <li key={m.nome}>
                  <span>{m.nome}</span>
                  <small className="suave">{m.quantidade} un.</small>
                  <strong>{formatarReais(m.valorCentavos)}</strong>
                </li>
              ))}
            </ol>
          )}
        </Cartao>
        <Cartao
          titulo="Estoque"
          icone={<Boxes aria-hidden="true" />}
          acao={
            p.estoque.negativos + p.estoque.abaixo > 0 ? (
              <button type="button" className="link" onClick={() => irPara('alertas')}>
                Lista de compras
              </button>
            ) : undefined
          }
        >
          <div className="etiquetas">
            <Chip tom={p.estoque.negativos > 0 ? 'erro' : 'sucesso'}>{p.estoque.negativos} negativo(s)</Chip>
            <Chip tom={p.estoque.abaixo > 0 ? 'atencao' : 'sucesso'}>{p.estoque.abaixo} abaixo do mínimo</Chip>
          </div>
          {p.estoqueBaixo.length === 0 ? (
            <p className="suave">Nenhum produto pedindo reposição.</p>
          ) : (
            <ul className="lista-compacta">
              {p.estoqueBaixo.map((e) => (
                <li key={e.id}>
                  <span>{e.nome}</span>
                  <Chip tom={e.saldo < 0 ? 'erro' : 'atencao'} ponto={false}>
                    {e.saldo} {e.unidade} {e.estoqueMinimo > 0 ? `/ mín. ${e.estoqueMinimo}` : ''}
                  </Chip>
                </li>
              ))}
            </ul>
          )}
        </Cartao>
        <Cartao
          titulo="Caixas"
          icone={<MonitorSmartphone aria-hidden="true" />}
          acao={
            <button type="button" className="link" onClick={() => irPara('caixas')}>
              Gerenciar
            </button>
          }
        >
          <dl className="dados">
            <dt>Ativos</dt>
            <dd>{p.caixas.ativos}</dd>
            <dt>Abertos agora</dt>
            <dd>{p.caixas.abertos}</dd>
            <dt>Sem sinal</dt>
            <dd>{p.caixas.semSinal > 0 ? <Chip tom="erro">{p.caixas.semSinal}</Chip> : '0'}</dd>
            <dt>Vendas a subir</dt>
            <dd>{p.caixas.filaPendente}</dd>
          </dl>
          {p.caixas.semSinal > 0 && (
            <p className="alerta-pequeno">
              <AlertTriangle aria-hidden="true" /> Caixa sem sinal continua vendendo; as vendas sobem quando a conexão voltar.
            </p>
          )}
        </Cartao>
      </div>
    </div>
  );
}
