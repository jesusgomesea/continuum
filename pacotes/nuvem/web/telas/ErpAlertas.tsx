// ERP · Alertas de estoque (UC20) e lista de compras: produtos com estoque negativo (vendeu mais do que
// tinha: conferir e ajustar), abaixo do mínimo, e quanto comprar para repor até o dobro do mínimo.
import { Cartao, Chip } from '@continuum/interface';
import { AlertTriangle, ShoppingCart, TrendingDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { pedir } from '../api.ts';
import { BotoesDeExportar, TabelaDados } from '../componentes/Tabela.tsx';
import type { Coluna } from '../componentes/Tabela.tsx';

interface Linha {
  produtoId: string;
  nome: string;
  unidade: string;
  ean: string | null;
  estoqueMinimo: number;
  lojaId: string;
  loja: string;
  saldo: number;
  ultimaMovimentacaoEm: string | null;
  comprar?: number;
}
interface Alertas {
  negativos: Linha[];
  abaixoDoMinimo: Linha[];
  compras: (Linha & { comprar: number })[];
  semMinimo: number;
  fatorDeReposicao: number;
}

const quando = (iso: string | null) => (iso === null ? '—' : new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }));

const COLUNAS_COMPRAS: Coluna<Linha & { comprar: number }>[] = [
  { titulo: 'Produto', valor: (l) => l.nome },
  { titulo: 'Código de barras', valor: (l) => l.ean ?? '' },
  { titulo: 'Loja', valor: (l) => l.loja },
  { titulo: 'Saldo', valor: (l) => l.saldo, mostrar: (l) => <Chip tom={l.saldo < 0 ? 'erro' : 'atencao'} ponto={false}>{`${l.saldo} ${l.unidade}`}</Chip>, numerica: true },
  { titulo: 'Mínimo', valor: (l) => l.estoqueMinimo, numerica: true },
  { titulo: 'Comprar', valor: (l) => l.comprar, mostrar: (l) => <strong>{`${l.comprar} ${l.unidade}`}</strong>, numerica: true },
];

export function ErpAlertas({ abrirProduto }: { abrirProduto: () => void }) {
  const [a, setA] = useState<Alertas | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  useEffect(() => {
    pedir<Alertas>('GET', '/v1/erp/estoque/alertas')
      .then(setA)
      .catch((e: Error) => setAviso(e.message));
  }, []);
  if (a === null) return <p className="suave">{aviso ?? 'Carregando…'}</p>;
  return (
    <div className="coluna">
      <div className="grade-kpi">
        <Cartao titulo="Estoque negativo" icone={<AlertTriangle aria-hidden="true" />} className="kpi">
          <p className="numero-grande">{a.negativos.length}</p>
          <small className="suave">vendeu mais do que havia</small>
        </Cartao>
        <Cartao titulo="Abaixo do mínimo" icone={<TrendingDown aria-hidden="true" />} className="kpi">
          <p className="numero-grande">{a.abaixoDoMinimo.length}</p>
        </Cartao>
        <Cartao titulo="Itens para comprar" icone={<ShoppingCart aria-hidden="true" />} className="kpi">
          <p className="numero-grande">{a.compras.length}</p>
        </Cartao>
      </div>
      {a.semMinimo > 0 && (
        <p className="info">
          {a.semMinimo} produto(s) sem estoque mínimo definido não entram na lista de compras.{' '}
          <button type="button" className="link" onClick={abrirProduto}>
            Definir em Produtos
          </button>
        </p>
      )}

      <Cartao titulo="Estoque negativo: conferir" icone={<AlertTriangle aria-hidden="true" />}>
        <p className="suave">
          Acontece quando a loja vende algo que não deu entrada (ou contou errado). Confira a prateleira e faça um <strong>ajuste</strong> ou a <strong>entrada</strong> que faltou em Produtos e estoque.
        </p>
        <TabelaDados
          chave={(l) => `${l.produtoId}-${l.lojaId}`}
          linhas={a.negativos}
          vazio="Nenhum produto com estoque negativo."
          aoEscolher={abrirProduto}
          colunas={[
            { titulo: 'Produto', valor: (l) => l.nome },
            { titulo: 'Loja', valor: (l) => l.loja },
            { titulo: 'Saldo', valor: (l) => l.saldo, mostrar: (l) => <Chip tom="erro" ponto={false}>{`${l.saldo} ${l.unidade}`}</Chip>, numerica: true },
            { titulo: 'Último movimento', valor: (l) => l.ultimaMovimentacaoEm ?? '', mostrar: (l) => quando(l.ultimaMovimentacaoEm) },
          ]}
        />
      </Cartao>

      <Cartao
        titulo="Lista de compras"
        icone={<ShoppingCart aria-hidden="true" />}
        acao={<BotoesDeExportar nome="lista-de-compras" colunas={COLUNAS_COMPRAS} linhas={a.compras} />}
      >
        <p className="suave">Sugestão para repor até {a.fatorDeReposicao}× o estoque mínimo. Exporte para mandar ao fornecedor.</p>
        <TabelaDados chave={(l) => `${l.produtoId}-${l.lojaId}`} linhas={a.compras} colunas={COLUNAS_COMPRAS} vazio="Nada para comprar agora." />
      </Cartao>
    </div>
  );
}
