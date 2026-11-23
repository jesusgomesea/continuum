// Continuum Central · Auditoria: quem mudou o quê e quando, em todos os clientes (ou num só).
// O registro é só de inclusão (ninguém edita nem apaga); aqui ele fica visível.
import { Cartao } from '@continuum/interface';
import { History } from 'lucide-react';
import { useEffect, useState } from 'react';
import { pedir } from '../api.ts';
import { BotoesDeExportar, TabelaDados } from '../componentes/Tabela.tsx';
import type { Coluna } from '../componentes/Tabela.tsx';

interface Registro {
  id: string;
  acao: string;
  alvo: string;
  dados: Record<string, unknown>;
  em: string;
  clienteId: string | null;
  cliente: string | null;
  autor: string;
}

/** Nomes das ações em português claro. O que não estiver aqui aparece com o código. */
const ACOES: Record<string, string> = {
  'cliente.cadastrado': 'Cliente cadastrado',
  'cliente.ativo': 'Cliente reativado',
  'cliente.suspenso': 'Cliente suspenso',
  'cliente.suspenso-por-atraso': 'Suspenso por atraso',
  'parametros.alterados': 'Parâmetros alterados',
  'plano.alterado': 'Plano alterado',
  'pagamento.registrado': 'Pagamento registrado',
  'caixa.criado': 'Caixa criado',
  'caixa.ativado': 'Caixa ativado',
  'caixa.novo-codigo': 'Novo código de ativação',
  'caixa.desativado': 'Caixa desativado',
  'loja.alterada': 'Loja alterada',
  'comprovante.alterado': 'Comprovante alterado',
  'produto.alterado': 'Produto alterado',
  'produtos.importados': 'Produtos importados',
  'usuario.criado': 'Usuário criado',
  'usuario.alterado': 'Usuário alterado',
  'pin.alterado': 'PIN do supervisor trocado',
};
export const nomeDaAcao = (a: string) => ACOES[a] ?? a;
const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const resumo = (d: Record<string, unknown>) =>
  Object.entries(d ?? {})
    .filter(([, v]) => v !== null && typeof v !== 'object')
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(' · ');

const COLUNAS: Coluna<Registro>[] = [
  { titulo: 'Quando', valor: (r) => r.em, mostrar: (r) => quando(r.em), exportar: (r) => quando(r.em) },
  { titulo: 'Cliente', valor: (r) => r.cliente ?? 'Plataforma' },
  { titulo: 'O quê', valor: (r) => nomeDaAcao(r.acao) },
  { titulo: 'Quem', valor: (r) => r.autor },
  { titulo: 'Detalhes', valor: (r) => resumo(r.dados), mostrar: (r) => <small className="suave">{resumo(r.dados)}</small> },
];

/** Lista compacta, para dentro da ficha do cliente. */
export function RegistrosDeAuditoria({ cliente, limite }: { cliente: string; limite: number }) {
  const [registros, setRegistros] = useState<Registro[] | null>(null);
  useEffect(() => {
    pedir<{ registros: Registro[] }>('GET', `/v1/central/auditoria?cliente=${cliente}&limite=${limite}`)
      .then((r) => setRegistros(r.registros))
      .catch(() => setRegistros([]));
  }, [cliente, limite]);
  if (registros === null) return <p className="suave">Carregando…</p>;
  if (registros.length === 0) return <p className="suave">Nada registrado ainda.</p>;
  return (
    <div>
      {registros.map((r) => (
        <div key={r.id} className="registro-auditoria">
          <span>
            <strong>{nomeDaAcao(r.acao)}</strong> <small>por {r.autor}</small>
          </span>
          <small>
            {quando(r.em)} {resumo(r.dados) !== '' && `· ${resumo(r.dados)}`}
          </small>
        </div>
      ))}
    </div>
  );
}

export function CentralAuditoria() {
  const [registros, setRegistros] = useState<Registro[]>([]);
  const [aviso, setAviso] = useState<string | null>(null);
  useEffect(() => {
    pedir<{ registros: Registro[] }>('GET', '/v1/central/auditoria?limite=500')
      .then((r) => setRegistros(r.registros))
      .catch((e: Error) => setAviso(e.message));
  }, []);
  return (
    <Cartao titulo="Auditoria (últimos 500 registros)" icone={<History aria-hidden="true" />} acao={<BotoesDeExportar nome="auditoria" colunas={COLUNAS} linhas={registros} />}>
      {aviso !== null && <p className="aviso">{aviso}</p>}
      <p className="suave">Tudo o que a Equipe, os donos e gerentes e os caixas mudaram. O registro não pode ser editado nem apagado.</p>
      <TabelaDados chave={(r) => r.id} linhas={registros} colunas={COLUNAS} vazio="Nada registrado ainda." />
    </Cartao>
  );
}
