// Tela de venda: produtos à esquerda, a venda atual à direita, as últimas vendas embaixo.
// As contas mostradas aqui são só para o operador acompanhar: quem confere de verdade é o caixa
// (as regras do pacote dominio). Se algo não fechar, a venda é recusada com a explicação.
import type { FormaPagamento, Venda } from '@continuum/dominio';
import { Botao, Cartao } from '@continuum/interface';
import { Calculator, Check, Minus, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { api } from '../api.ts';
import type { EstadoDoCaixa } from '../api.ts';
import { Aviso, Cabecalho, lerCampoReais, NOMES_FORMA, reais } from '../comum.tsx';
import { UltimasVendas } from './UltimasVendas.tsx';
import { VendaFinalizada } from './VendaFinalizada.tsx';

interface Linha {
  produtoId: string;
  quantidade: number;
}

interface Props {
  estado: EstadoDoCaixa;
  aoAtualizar: (e: EstadoDoCaixa) => void;
  aoIrParaFechamento: () => void;
}

const FORMAS = Object.keys(NOMES_FORMA) as FormaPagamento[];

export function TelaDeVenda({ estado, aoAtualizar, aoIrParaFechamento }: Props) {
  const [busca, setBusca] = useState('');
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [desconto, setDesconto] = useState('');
  const [documento, setDocumento] = useState('');
  const [pagamentos, setPagamentos] = useState<{ forma: FormaPagamento; valorCentavos: number }[]>([]);
  const [valorPagamento, setValorPagamento] = useState('');
  const [supervisor, setSupervisor] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [finalizada, setFinalizada] = useState<Venda | null>(null);

  const produtos = useMemo(() => new Map(estado.catalogo.map((p) => [p.id, p])), [estado.catalogo]);
  const termo = busca.trim().toLowerCase();
  const visiveis = estado.catalogo.filter((p) => termo === '' || p.nome.toLowerCase().includes(termo) || p.ean === termo);

  // Contas para o operador acompanhar.
  const bruto = linhas.reduce((s, l) => s + l.quantidade * (produtos.get(l.produtoId)?.precoCentavos ?? 0), 0);
  const descontoCentavos = lerCampoReais(desconto);
  const liquido = bruto - (descontoCentavos ?? 0);
  const pago = pagamentos.reduce((s, p) => s + p.valorCentavos, 0);
  const falta = Math.max(liquido - pago, 0);
  const troco = Math.max(pago - liquido, 0);
  const passaDoLimite = (descontoCentavos ?? 0) * 100 > bruto * estado.parametros.limiteDescontoPct;

  function adicionar(produtoId: string) {
    setAviso(null);
    setLinhas((atual) => {
      const existente = atual.find((l) => l.produtoId === produtoId);
      if (existente === undefined) return [...atual, { produtoId, quantidade: 1 }];
      return atual.map((l) => (l.produtoId === produtoId ? { ...l, quantidade: l.quantidade + 1 } : l));
    });
  }

  function mudarQuantidade(produtoId: string, delta: number) {
    setLinhas((atual) =>
      atual.map((l) => (l.produtoId === produtoId ? { ...l, quantidade: l.quantidade + delta } : l)).filter((l) => l.quantidade > 0),
    );
  }

  /** Enter na busca: código de barras exato ou um único produto encontrado entra na venda. */
  function aoTeclarNaBusca(evento: KeyboardEvent<HTMLInputElement>) {
    if (evento.key !== 'Enter') return;
    const exato = estado.catalogo.find((p) => p.ean === termo);
    const escolhido = exato ?? (visiveis.length === 1 ? visiveis[0] : undefined);
    if (escolhido !== undefined) {
      adicionar(escolhido.id);
      setBusca('');
    }
  }

  function adicionarPagamento(forma: FormaPagamento) {
    const valor = valorPagamento.trim() === '' ? falta : lerCampoReais(valorPagamento);
    if (valor === null || valor <= 0) {
      setAviso('Valor do pagamento inválido.');
      return;
    }
    setPagamentos((atual) => [...atual, { forma, valorCentavos: valor }]);
    setValorPagamento('');
    setAviso(null);
  }

  function limpar() {
    setLinhas([]);
    setDesconto('');
    setDocumento('');
    setPagamentos([]);
    setValorPagamento('');
    setSupervisor(false);
    setAviso(null);
  }

  function finalizar() {
    if (descontoCentavos === null) {
      setAviso('Desconto inválido. Use, por exemplo, 2,50.');
      return;
    }
    setEnviando(true);
    api
      .vender({ itens: linhas, pagamentos, descontoCentavos, documentoCliente: documento, autorizadoPorSupervisor: supervisor })
      .then(({ venda, estado: novo }) => {
        aoAtualizar(novo);
        setFinalizada(venda);
        limpar();
      })
      .catch((erro: Error) => setAviso(erro.message))
      .finally(() => setEnviando(false));
  }

  return (
    <>
      <Cabecalho estado={estado}>
        <Botao variante="secundario" icone={<Calculator aria-hidden="true" />} onClick={aoIrParaFechamento}>
          Fechamento
        </Botao>
      </Cabecalho>

      <main className="venda">
        <section className="catalogo" aria-label="Produtos">
          <input
            type="search"
            placeholder="Buscar produto ou código de barras (Enter adiciona)"
            aria-label="Buscar produto"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            onKeyDown={aoTeclarNaBusca}
            autoFocus
          />
          <div className="grade">
            {visiveis.map((p) => (
              <button key={p.id} type="button" className="produto" onClick={() => adicionar(p.id)}>
                <span className="nome">{p.nome}</span>
                <span className="preco">{reais(p.precoCentavos)}</span>
                <span className={p.saldo > 0 ? 'saldo' : 'saldo zerado'}>Estoque: {p.saldo}</span>
              </button>
            ))}
            {visiveis.length === 0 && <p className="suave">Nenhum produto encontrado.</p>}
          </div>
        </section>

        <Cartao className="carrinho" titulo="Venda atual" icone={<ShoppingCart aria-hidden="true" />}>
          <ul className="itens" aria-label="Itens da venda">
            {linhas.length === 0 && <li className="suave">Clique num produto para começar a venda.</li>}
            {linhas.map((l) => {
              const p = produtos.get(l.produtoId);
              return (
                <li key={l.produtoId}>
                  <span className="nome">{p?.nome}</span>
                  <span className="quantidade">
                    <button type="button" aria-label={`Tirar um ${p?.nome ?? ''}`} onClick={() => mudarQuantidade(l.produtoId, -1)}>
                      <Minus aria-hidden="true" />
                    </button>
                    {l.quantidade}
                    <button type="button" aria-label={`Pôr mais um ${p?.nome ?? ''}`} onClick={() => mudarQuantidade(l.produtoId, 1)}>
                      <Plus aria-hidden="true" />
                    </button>
                  </span>
                  <span className="valor">{reais(l.quantidade * (p?.precoCentavos ?? 0))}</span>
                </li>
              );
            })}
          </ul>

          <div className="campos">
            <label>
              Desconto no total (R$)
              <input value={desconto} onChange={(e) => setDesconto(e.target.value)} inputMode="decimal" placeholder="0,00" />
            </label>
            <label>
              CPF/CNPJ na nota
              <input value={documento} onChange={(e) => setDocumento(e.target.value)} inputMode="numeric" placeholder="opcional" />
            </label>
          </div>
          {passaDoLimite && (
            <label className="supervisor">
              <input type="checkbox" checked={supervisor} onChange={(e) => setSupervisor(e.target.checked)} />
              Desconto acima de {estado.parametros.limiteDescontoPct}%: autorizado pelo supervisor
            </label>
          )}

          <dl className="totais">
            <div>
              <dt>Subtotal</dt>
              <dd>{reais(bruto)}</dd>
            </div>
            <div>
              <dt>Desconto</dt>
              <dd>{reais(descontoCentavos ?? 0)}</dd>
            </div>
            <div className="total">
              <dt>Total</dt>
              <dd data-testid="total">{reais(liquido)}</dd>
            </div>
          </dl>

          <div className="pagamento">
            <label>
              Valor recebido (vazio = o que falta)
              <input value={valorPagamento} onChange={(e) => setValorPagamento(e.target.value)} inputMode="decimal" placeholder={reais(falta)} />
            </label>
            <div className="formas">
              {FORMAS.map((f) => (
                <Botao key={f} variante="secundario" onClick={() => adicionarPagamento(f)} disabled={linhas.length === 0}>
                  {NOMES_FORMA[f]}
                </Botao>
              ))}
            </div>
            <ul className="pagos" aria-label="Pagamentos">
              {pagamentos.map((p, i) => (
                <li key={i}>
                  {NOMES_FORMA[p.forma]} <b>{reais(p.valorCentavos)}</b>
                  <button type="button" aria-label="Remover pagamento" onClick={() => setPagamentos((a) => a.filter((_, j) => j !== i))}>
                    <Trash2 aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
            <p className="resumo-pagamento" data-testid="resumo-pagamento">
              {falta > 0 ? `Falta: ${reais(falta)}` : `Troco: ${reais(troco)}`}
            </p>
          </div>

          <Aviso texto={aviso} />
          <div className="botoes">
            <Botao largo icone={<Check aria-hidden="true" />} onClick={finalizar} disabled={enviando || linhas.length === 0 || falta > 0}>
              Finalizar venda
            </Botao>
            <Botao variante="fantasma" onClick={limpar} disabled={linhas.length === 0 && pagamentos.length === 0}>
              Limpar
            </Botao>
          </div>
        </Cartao>

        <UltimasVendas estado={estado} aoAtualizar={aoAtualizar} />
      </main>

      {finalizada !== null && <VendaFinalizada venda={finalizada} aoFechar={() => setFinalizada(null)} />}
    </>
  );
}
