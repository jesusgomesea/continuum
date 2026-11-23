// Continuum Central · Ficha do cliente: caixas com versão e quedas, vendas dos últimos 30 dias, plano e
// cobrança (mensalidade, vencimento, pagamentos) e o que mudou no cliente (auditoria).
import { formatarReais, lerReais } from '@continuum/dominio';
import { Botao, Cartao, Chip } from '@continuum/interface';
import type { TomChip } from '@continuum/interface';
import { BarChart3, CreditCard, History, MonitorSmartphone, Save } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { pedir } from '../api.ts';
import { GraficoDeBarras } from '../componentes/Graficos.tsx';
import { RegistrosDeAuditoria } from './CentralAuditoria.tsx';
import { tempo } from './Monitor.tsx';

interface Ficha {
  cliente: { id: string; plano: string; mensalidade_centavos: string; dia_vencimento: number; pago_ate: string | null; hoje: string; situacao: string; suspenso_por: string | null };
  plano: { situacao: 'isento' | 'sem-registro' | 'em-dia' | 'vence-logo' | 'atrasado'; dias: number };
  caixas: { id: string; tipo: string; numeroCaixa: number | null; situacao: string; loja: string; versao: string | null; versaoInstalada: string | null; estado: string | null; filaPendente: number | null; segundosSemSinal: number | null; quedas7d: number }[];
  vendas30: { dia: string; vendas: number; liquidoCentavos: number }[];
  produtos: number;
  usuarios: number;
  pagamentos: { referencia: string; valorCentavos: number; pagoEm: string; registradoPor: string | null }[];
}

export const SITUACAO_DO_PAGAMENTO: Record<string, { nome: string; tom: TomChip }> = {
  isento: { nome: 'isento', tom: 'neutro' },
  'sem-registro': { nome: 'sem pagamento registrado', tom: 'neutro' },
  'em-dia': { nome: 'em dia', tom: 'sucesso' },
  'vence-logo': { nome: 'vence logo', tom: 'atencao' },
  atrasado: { nome: 'atrasado', tom: 'erro' },
};

export function textoDoPagamento(p: { situacao: string; dias: number }): string {
  const nome = SITUACAO_DO_PAGAMENTO[p.situacao]?.nome ?? p.situacao;
  if (p.situacao === 'atrasado') return `${nome} ${p.dias} dia(s)`;
  if (p.situacao === 'vence-logo') return `vence em ${p.dias} dia(s)`;
  return nome;
}

const ultimos30 = (hoje: string, linhas: Ficha['vendas30']) => {
  const mapa = new Map(linhas.map((l) => [l.dia, l]));
  return Array.from({ length: 30 }, (_, i) => {
    const dia = new Date(Date.parse(`${hoje}T12:00:00Z`) - (29 - i) * 86_400_000).toISOString().slice(0, 10);
    return { dia, vendas: mapa.get(dia)?.vendas ?? 0, liquidoCentavos: mapa.get(dia)?.liquidoCentavos ?? 0 };
  });
};
const lerValor = (t: string) => {
  try {
    return lerReais(t);
  } catch {
    return null;
  }
};

export function FichaCliente({ id, aoMudar }: { id: string; aoMudar: () => void }) {
  const [f, setF] = useState<Ficha | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const carregar = useCallback(() => {
    pedir<Ficha>('GET', `/v1/central/clientes/${id}/ficha`)
      .then(setF)
      .catch((e: Error) => setAviso(e.message));
  }, [id]);
  useEffect(carregar, [carregar]);
  if (f === null) return aviso === null ? null : <p className="aviso">{aviso}</p>;

  const dias = ultimos30(f.cliente.hoje, f.vendas30);
  const total = dias.reduce((t, d) => t + d.liquidoCentavos, 0);
  return (
    <>
      <Cartao titulo="Caixas e conexão" icone={<MonitorSmartphone aria-hidden="true" />}>
        <p className="suave">
          {f.produtos} produto(s) · {f.usuarios} usuário(s) ativo(s)
        </p>
        {f.caixas.length === 0 ? (
          <p className="suave">Nenhum caixa criado ainda.</p>
        ) : (
          <table className="tabela">
            <thead>
              <tr>
                <th>Caixa</th>
                <th>Situação</th>
                <th>Último sinal</th>
                <th className="numerica">Quedas 7 d</th>
                <th>Versão</th>
              </tr>
            </thead>
            <tbody>
              {f.caixas.map((c) => (
                <tr key={c.id}>
                  <td>
                    {c.loja} · {c.tipo === 'pdv' ? `Caixa ${c.numeroCaixa ?? '?'}` : 'Agente'}
                  </td>
                  <td>
                    <Chip tom={c.situacao === 'ativo' ? 'sucesso' : c.situacao === 'pendente' ? 'info' : 'neutro'}>{c.situacao}</Chip>
                  </td>
                  <td>{tempo(c.segundosSemSinal)}</td>
                  <td className="numerica">{c.quedas7d}</td>
                  <td>{c.versao ?? c.versaoInstalada ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Cartao>

      <Cartao titulo={`Vendas em 30 dias: ${formatarReais(total)}`} icone={<BarChart3 aria-hidden="true" />}>
        <GraficoDeBarras
          titulo="Vendas do cliente nos últimos 30 dias"
          barras={dias.map((d) => ({ rotulo: d.dia.slice(8, 10), valor: d.liquidoCentavos, dica: `${d.dia.slice(8, 10)}/${d.dia.slice(5, 7)}: ${formatarReais(d.liquidoCentavos)} em ${d.vendas} venda(s)` }))}
          formatar={formatarReais}
          passoDoRotulo={5}
          altura={140}
        />
      </Cartao>

      <PlanoECobranca
        key={`${f.cliente.plano}-${f.cliente.mensalidade_centavos}-${f.cliente.pago_ate ?? ''}`}
        f={f}
        aoMudar={() => {
          carregar();
          aoMudar();
        }}
      />

      <Cartao titulo="O que mudou (auditoria)" icone={<History aria-hidden="true" />}>
        <RegistrosDeAuditoria cliente={id} limite={20} />
      </Cartao>
    </>
  );
}

function PlanoECobranca({ f, aoMudar }: { f: Ficha; aoMudar: () => void }) {
  const [plano, setPlano] = useState(f.cliente.plano);
  const [mensalidade, setMensalidade] = useState(formatarReais(Number(f.cliente.mensalidade_centavos)).replace(/^R\$\s*/, ''));
  const [dia, setDia] = useState(String(f.cliente.dia_vencimento));
  const [referencia, setReferencia] = useState(f.cliente.hoje.slice(0, 7));
  const [valorPago, setValorPago] = useState(formatarReais(Number(f.cliente.mensalidade_centavos)).replace(/^R\$\s*/, ''));
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const s = SITUACAO_DO_PAGAMENTO[f.plano.situacao];

  function salvarPlano(e: FormEvent) {
    e.preventDefault();
    const centavos = lerValor(mensalidade);
    if (centavos === null) return setMsg({ ok: false, texto: 'Mensalidade inválida. Exemplo: 149,90' });
    pedir('PUT', `/v1/central/clientes/${f.cliente.id}/plano`, { plano, mensalidadeCentavos: centavos, diaVencimento: Number(dia) })
      .then(() => {
        setMsg({ ok: true, texto: 'Plano salvo.' });
        aoMudar();
      })
      .catch((erro: Error) => setMsg({ ok: false, texto: erro.message }));
  }

  function registrarPagamento(e: FormEvent) {
    e.preventDefault();
    const centavos = lerValor(valorPago);
    if (centavos === null || centavos <= 0) return setMsg({ ok: false, texto: 'Valor pago inválido.' });
    pedir<{ pagoAte: string; reativado: boolean }>('POST', `/v1/central/clientes/${f.cliente.id}/pagamentos`, { referencia, valorCentavos: centavos })
      .then((r) => {
        setMsg({ ok: true, texto: `Pagamento registrado: coberto até ${r.pagoAte.split('-').reverse().join('/')}.${r.reativado ? ' O ERP do cliente foi reativado.' : ''}` });
        aoMudar();
      })
      .catch((erro: Error) => setMsg({ ok: false, texto: erro.message }));
  }

  return (
    <Cartao titulo="Plano e cobrança" icone={<CreditCard aria-hidden="true" />} acao={<Chip tom={s?.tom ?? 'neutro'}>{textoDoPagamento(f.plano)}</Chip>}>
      <div className="formulario">
        {f.cliente.situacao === 'suspenso' && (
          <p className="aviso">Suspenso {f.cliente.suspenso_por === 'inadimplencia' ? 'automaticamente por atraso (registrar o pagamento reativa na hora)' : 'pela Equipe'}.</p>
        )}
        <p className="suave">
          Pago até: <strong>{f.cliente.pago_ate === null ? '—' : f.cliente.pago_ate.split('-').reverse().join('/')}</strong>. Com mensalidade e mais de 10 dias de atraso, o ERP é suspenso sozinho (os caixas continuam vendendo).
        </p>
        <form className="linha-form" onSubmit={salvarPlano}>
          <label>
            Plano
            <select value={plano} onChange={(e) => setPlano(e.target.value)}>
              <option value="mvp">MVP (piloto)</option>
              <option value="essencial">Essencial</option>
              <option value="loja">Loja</option>
              <option value="rede">Rede</option>
            </select>
          </label>
          <label>
            Mensalidade (R$)
            <input value={mensalidade} onChange={(e) => setMensalidade(e.target.value)} inputMode="decimal" placeholder="0 = isento" />
          </label>
          <label>
            Vence todo dia
            <input type="number" min={1} max={28} value={dia} onChange={(e) => setDia(e.target.value)} />
          </label>
          <Botao type="submit" variante="secundario" icone={<Save aria-hidden="true" />}>
            Salvar plano
          </Botao>
        </form>
        {Number(f.cliente.mensalidade_centavos) > 0 && (
          <form className="linha-form" onSubmit={registrarPagamento}>
            <label>
              Mês pago
              <input type="month" value={referencia} onChange={(e) => setReferencia(e.target.value)} required />
            </label>
            <label>
              Valor (R$)
              <input value={valorPago} onChange={(e) => setValorPago(e.target.value)} inputMode="decimal" required />
            </label>
            <Botao type="submit" icone={<CreditCard aria-hidden="true" />}>
              Registrar pagamento
            </Botao>
          </form>
        )}
        {msg !== null && <p className={msg.ok ? 'ok' : 'aviso'}>{msg.texto}</p>}
        {f.pagamentos.length > 0 && (
          <table className="tabela">
            <thead>
              <tr>
                <th>Mês</th>
                <th className="numerica">Valor</th>
                <th>Registrado</th>
              </tr>
            </thead>
            <tbody>
              {f.pagamentos.map((p) => (
                <tr key={p.referencia}>
                  <td>{p.referencia.split('-').reverse().join('/')}</td>
                  <td className="numerica">{formatarReais(p.valorCentavos)}</td>
                  <td>
                    {new Date(p.pagoEm).toLocaleDateString('pt-BR')} {p.registradoPor !== null && <small className="suave">por {p.registradoPor}</small>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Cartao>
  );
}
