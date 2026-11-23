// Tela de venda: produtos à esquerda, a venda atual à direita, as últimas vendas embaixo.
// As contas mostradas aqui são só para o operador acompanhar: quem confere de verdade é o caixa
// (as regras do pacote dominio). Se algo não fechar, a venda é recusada com a explicação.
//
// Feita para o leitor de código de barras e o teclado (o foco volta sempre para a busca) e para o
// toque (botões grandes). Atalhos: F2 quantidade · F4 pagamento · F6 venda em espera ·
// Esc tira o item selecionado ou fecha a janela · Delete tira o último item.
import { cnpjValido, cpfValido, formatarDocumento, soDigitos } from '@continuum/dominio';
import type { FormaPagamento, Venda } from '@continuum/dominio';
import { Botao, Cartao } from '@continuum/interface';
import { Calculator, Check, CirclePause, Minus, Plus, ShoppingCart, Trash2, Volume2, VolumeX, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { formatarPeso, lerEtiquetaDeBalanca, produtoDaEtiqueta, quantidadeDaEtiqueta } from '../../src/balanca.ts';
import { filtrarProdutos, nivelDeEstoque, produtoPeloCodigo } from '../../src/busca.ts';
import { api } from '../api.ts';
import type { CarrinhoEmEspera, EstadoDoCaixa } from '../api.ts';
import { Aviso, Cabecalho, lerCampoReais, NOMES_FORMA, reais } from '../comum.tsx';
import { bip, guardarSom, somLigado } from '../som.ts';
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
/** Notas para o pagamento rápido em dinheiro (em centavos). */
const NOTAS = [1000, 2000, 5000, 10000] as const;
const NOMES_NIVEL = { normal: '', baixo: 'Estoque baixo', sem: 'Sem estoque' } as const;

/** O CPF/CNPJ digitado: vazio (ok), válido (com a pontuação) ou inválido (com o motivo). */
function conferirDocumento(texto: string): { valido: boolean; mensagem: string | null } {
  const d = soDigitos(texto);
  if (d === '') return { valido: true, mensagem: null };
  if (d.length === 11 && cpfValido(d)) return { valido: true, mensagem: `CPF ${formatarDocumento(d) ?? ''}` };
  if (d.length === 14 && cnpjValido(d)) return { valido: true, mensagem: `CNPJ ${formatarDocumento(d) ?? ''}` };
  if (d.length < 11) return { valido: false, mensagem: 'CPF incompleto (11 números).' };
  return { valido: false, mensagem: d.length === 14 ? 'CNPJ inválido.' : 'CPF inválido (confira os números).' };
}

export function TelaDeVenda({ estado, aoAtualizar, aoIrParaFechamento }: Props) {
  const [busca, setBusca] = useState('');
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [desconto, setDesconto] = useState('');
  const [documento, setDocumento] = useState('');
  const [pagamentos, setPagamentos] = useState<{ forma: FormaPagamento; valorCentavos: number }[]>([]);
  const [valorPagamento, setValorPagamento] = useState('');
  const [pin, setPin] = useState('');
  // Chave desta tentativa de venda: se o clique for duplo ou a resposta se perder, o caixa não grava duas vezes.
  const chave = useRef<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [finalizada, setFinalizada] = useState<Venda | null>(null);
  // F2: a quantidade do próximo item lançado (1 = normal).
  const [proximaQuantidade, setProximaQuantidade] = useState(1);
  const [dialogo, setDialogo] = useState<'quantidade' | 'espera' | null>(null);
  const [textoQuantidade, setTextoQuantidade] = useState('');
  // O item que acabou de entrar (para a animação); `n` muda a cada lançamento para a animação repetir.
  const [destaque, setDestaque] = useState<{ produtoId: string; n: number } | null>(null);
  const [comSom, setComSom] = useState(somLigado);

  const campoBusca = useRef<HTMLInputElement>(null);
  const campoPagamento = useRef<HTMLInputElement>(null);
  const focarBusca = useCallback(() => {
    // Depois do React redesenhar, para não perder o foco para um botão que sumiu.
    requestAnimationFrame(() => campoBusca.current?.focus());
  }, []);

  const produtos = useMemo(() => new Map(estado.catalogo.map((p) => [p.id, p])), [estado.catalogo]);
  // "3*cafe" ou "3*789..." lança 3 de uma vez (como no caixa de supermercado).
  const multiplicador = /^\s*(\d{1,4})\s*[*xX]\s*(.*)$/.exec(busca);
  const termo = multiplicador === null ? busca : (multiplicador[2] ?? '');
  const visiveis = useMemo(() => filtrarProdutos(estado.catalogo, termo), [estado.catalogo, termo]);

  // Contas para o operador acompanhar.
  const bruto = linhas.reduce((s, l) => s + l.quantidade * (produtos.get(l.produtoId)?.precoCentavos ?? 0), 0);
  const descontoCentavos = lerCampoReais(desconto);
  const liquido = bruto - (descontoCentavos ?? 0);
  const pago = pagamentos.reduce((s, p) => s + p.valorCentavos, 0);
  const falta = Math.max(liquido - pago, 0);
  const troco = Math.max(pago - liquido, 0);
  const passaDoLimite = (descontoCentavos ?? 0) * 100 > bruto * estado.parametros.limiteDescontoPct;
  const doc = conferirDocumento(documento);
  const itensNoCarrinho = linhas.reduce((s, l) => s + l.quantidade, 0);

  function recusar(mensagem: string) {
    setAviso(mensagem);
    bip('erro');
  }

  /** Lança o produto na venda (soma se já estiver lá). Confere o estoque quando a regra é bloquear. */
  function adicionar(produtoId: string, quantidade = proximaQuantidade) {
    const p = produtos.get(produtoId);
    if (p === undefined) return;
    const jaNoCarrinho = linhas.find((l) => l.produtoId === produtoId)?.quantidade ?? 0;
    if (estado.parametros.regraEstoque === 'bloquear' && jaNoCarrinho + quantidade > p.saldo) {
      recusar(p.saldo <= 0 ? `${p.nome}: sem estoque.` : `${p.nome}: só há ${p.saldo} em estoque.`);
      focarBusca();
      return;
    }
    setAviso(null);
    setLinhas((atual) =>
      atual.some((l) => l.produtoId === produtoId)
        ? atual.map((l) => (l.produtoId === produtoId ? { ...l, quantidade: l.quantidade + quantidade } : l))
        : [...atual, { produtoId, quantidade }],
    );
    setSelecionado(produtoId);
    setDestaque((d) => ({ produtoId, n: (d?.n ?? 0) + 1 }));
    setProximaQuantidade(1);
    bip('ok');
    focarBusca();
  }

  function mudarQuantidade(produtoId: string, delta: number) {
    const p = produtos.get(produtoId);
    const atual = linhas.find((l) => l.produtoId === produtoId)?.quantidade ?? 0;
    if (delta > 0 && p !== undefined && estado.parametros.regraEstoque === 'bloquear' && atual + delta > p.saldo) {
      recusar(`${p.nome}: só há ${p.saldo} em estoque.`);
      return;
    }
    setLinhas((ls) => ls.map((l) => (l.produtoId === produtoId ? { ...l, quantidade: l.quantidade + delta } : l)).filter((l) => l.quantidade > 0));
  }

  function definirQuantidade(produtoId: string, quantidade: number) {
    const p = produtos.get(produtoId);
    if (p !== undefined && estado.parametros.regraEstoque === 'bloquear' && quantidade > p.saldo) {
      recusar(`${p.nome}: só há ${p.saldo} em estoque.`);
      return;
    }
    setLinhas((ls) => ls.map((l) => (l.produtoId === produtoId ? { ...l, quantidade } : l)));
    setAviso(null);
  }

  function remover(produtoId: string) {
    setLinhas((ls) => ls.filter((l) => l.produtoId !== produtoId));
    setSelecionado((s) => (s === produtoId ? null : s));
    focarBusca();
  }

  /** Enter na busca: etiqueta de balança, código de barras exato ou um único produto encontrado. */
  function aoTeclarNaBusca(evento: KeyboardEvent<HTMLInputElement>) {
    if (evento.key !== 'Enter') return;
    evento.preventDefault();
    const texto = termo.trim();
    if (texto === '') return;
    const vezes = multiplicador === null ? proximaQuantidade : Math.max(Number(multiplicador[1]), 1);

    const etiqueta = lerEtiquetaDeBalanca(texto);
    if (etiqueta !== undefined && produtoPeloCodigo(estado.catalogo, texto) === undefined) {
      setBusca('');
      const p = produtoDaEtiqueta(estado.catalogo, etiqueta);
      if (p === undefined) {
        recusar(`Etiqueta de balança (código ${etiqueta.codigoProduto}, ${formatarPeso(etiqueta.pesoGramas)}): nenhum produto por kg com esse código.`);
        return;
      }
      const quilos = quantidadeDaEtiqueta(etiqueta);
      if (quilos === null) {
        recusar(`${p.nome}: ${formatarPeso(etiqueta.pesoGramas)}. Venda de peso quebrado ainda não é aceita pelo caixa (só quilos inteiros).`);
        return;
      }
      adicionar(p.id, quilos);
      return;
    }

    const escolhido = produtoPeloCodigo(estado.catalogo, texto) ?? (visiveis.length === 1 ? visiveis[0] : undefined);
    if (escolhido !== undefined) {
      setBusca('');
      adicionar(escolhido.id, vezes);
    } else if (/^\d{8,14}$/.test(texto)) {
      setBusca('');
      recusar(`Código ${texto} não cadastrado neste caixa.`);
    }
  }

  function adicionarPagamento(forma: FormaPagamento, valorFixo?: number) {
    const valor = valorFixo ?? (valorPagamento.trim() === '' ? falta : lerCampoReais(valorPagamento));
    if (valor === null || valor <= 0) {
      setAviso('Valor do pagamento inválido.');
      return;
    }
    setPagamentos((atual) => [...atual, { forma, valorCentavos: valor }]);
    setValorPagamento('');
    setAviso(null);
  }

  function carrinhoAtual(): CarrinhoEmEspera {
    return { itens: linhas, documentoCliente: documento, desconto };
  }

  function limpar() {
    setLinhas([]);
    setSelecionado(null);
    setDesconto('');
    setDocumento('');
    setPagamentos([]);
    setValorPagamento('');
    setPin('');
    setProximaQuantidade(1);
    chave.current = null;
    setAviso(null);
  }

  /** F6: pausa a venda atual para atender outro cliente (os pagamentos lançados não vão junto). */
  function colocarEmEspera() {
    if (linhas.length === 0) {
      setDialogo('espera');
      return;
    }
    api
      .guardarEspera(carrinhoAtual())
      .then((novo) => {
        aoAtualizar(novo);
        limpar();
        focarBusca();
      })
      .catch((erro: Error) => recusar(erro.message));
  }

  /** Retoma uma venda em espera. Se houver uma venda em andamento, ela vai para a espera no lugar. */
  async function retomar(id: string) {
    try {
      if (linhas.length > 0) await api.guardarEspera(carrinhoAtual());
      const { carrinho, estado: novo } = await api.retomarEspera(id);
      aoAtualizar(novo);
      limpar();
      setLinhas(carrinho.itens.filter((i) => produtos.has(i.produtoId)));
      setDocumento(carrinho.documentoCliente);
      setDesconto(carrinho.desconto);
      setDialogo(null);
      focarBusca();
    } catch (erro) {
      recusar((erro as Error).message);
    }
  }

  function confirmarQuantidade(destino: 'proximo' | 'ultimo') {
    const n = Number(textoQuantidade);
    if (!Number.isSafeInteger(n) || n < 1 || n > 9999) {
      setAviso('Quantidade: um número inteiro de 1 a 9999.');
      return;
    }
    const alvo = selecionado ?? linhas.at(-1)?.produtoId ?? null;
    if (destino === 'ultimo' && alvo !== null) definirQuantidade(alvo, n);
    else setProximaQuantidade(n);
    setDialogo(null);
    setTextoQuantidade('');
    focarBusca();
  }

  function finalizar() {
    if (descontoCentavos === null) {
      setAviso('Desconto inválido. Use, por exemplo, 2,50.');
      return;
    }
    if (!doc.valido) {
      setAviso(doc.mensagem);
      return;
    }
    setEnviando(true);
    chave.current ??= crypto.randomUUID();
    api
      .vender({
        itens: linhas,
        pagamentos,
        descontoCentavos,
        // Só os dígitos: o caixa valida de novo e guarda no documentoCliente da venda (sai no comprovante).
        documentoCliente: soDigitos(documento),
        chave: chave.current,
        ...(pin === '' ? {} : { pinSupervisor: pin }),
      })
      .then(({ venda, estado: novo }) => {
        aoAtualizar(novo);
        setFinalizada(venda);
        limpar();
      })
      .catch((erro: Error) => recusar(erro.message))
      .finally(() => setEnviando(false));
  }

  // Atalhos de teclado (valem na tela toda, menos quando a janela de "venda finalizada" está aberta).
  const atalhos = useRef<(e: globalThis.KeyboardEvent) => void>(() => undefined);
  atalhos.current = (e) => {
    if (finalizada !== null) return;
    const alvo = e.target as HTMLElement | null;
    const campoComTexto = alvo instanceof HTMLInputElement && alvo.value !== '';
    if (e.key === 'F2') {
      e.preventDefault();
      setTextoQuantidade('');
      setDialogo('quantidade');
    } else if (e.key === 'F4') {
      e.preventDefault();
      setDialogo(null);
      campoPagamento.current?.focus();
    } else if (e.key === 'F6') {
      e.preventDefault();
      colocarEmEspera();
    } else if (e.key === 'Escape') {
      if (dialogo !== null) {
        setDialogo(null);
        focarBusca();
      } else if (busca !== '') {
        setBusca('');
      } else if (selecionado !== null) {
        remover(selecionado);
      } else {
        focarBusca();
      }
    } else if (e.key === 'Delete' && !campoComTexto && dialogo === null) {
      const ultimo = linhas.at(-1);
      if (ultimo !== undefined) {
        e.preventDefault();
        remover(ultimo.produtoId);
      }
    }
  };
  useEffect(() => {
    const ouvir = (e: globalThis.KeyboardEvent) => atalhos.current(e);
    window.addEventListener('keydown', ouvir);
    return () => window.removeEventListener('keydown', ouvir);
  }, []);

  function alternarSom() {
    guardarSom(!comSom);
    setComSom(!comSom);
    focarBusca();
  }

  return (
    <>
      <Cabecalho estado={estado}>
        <Botao
          variante="fantasma"
          icone={comSom ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}
          onClick={alternarSom}
          aria-pressed={comSom}
          title="Som de confirmação ao lançar item"
        >
          {comSom ? 'Som ligado' : 'Som desligado'}
        </Botao>
        <Botao variante="secundario" icone={<CirclePause aria-hidden="true" />} onClick={() => setDialogo('espera')}>
          Espera (F6){estado.emEspera.length > 0 && ` · ${estado.emEspera.length}`}
        </Botao>
        <Botao variante="secundario" icone={<Calculator aria-hidden="true" />} onClick={aoIrParaFechamento}>
          Fechamento
        </Botao>
      </Cabecalho>

      <main className="venda">
        <section className="catalogo" aria-label="Produtos">
          <div className="linha-busca">
            <input
              ref={campoBusca}
              type="search"
              className="busca"
              placeholder="Nome, parte do nome ou código de barras (Enter lança)"
              aria-label="Buscar produto"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              onKeyDown={aoTeclarNaBusca}
              autoFocus
            />
            {proximaQuantidade > 1 && (
              <button type="button" className="multiplicador" onClick={() => setProximaQuantidade(1)} title="Tirar a quantidade">
                × {proximaQuantidade}
              </button>
            )}
          </div>
          <p className="atalhos" aria-label="Atalhos de teclado">
            <span><kbd>F2</kbd> quantidade</span>
            <span><kbd>F4</kbd> pagamento</span>
            <span><kbd>F6</kbd> espera</span>
            <span><kbd>Esc</kbd> tira o item selecionado</span>
            <span><kbd>Delete</kbd> tira o último</span>
            <span><kbd>3*</kbd> lança 3</span>
          </p>
          <div className="grade">
            {visiveis.map((p) => {
              const nivel = nivelDeEstoque(p.saldo);
              return (
                <button key={p.id} type="button" className={`produto ${nivel}`} onClick={() => adicionar(p.id)}>
                  <span className="nome">{p.nome}</span>
                  <span className="preco">
                    {reais(p.precoCentavos)}
                    {p.unidade !== 'un' && <small> /{p.unidade}</small>}
                  </span>
                  <span className={`saldo ${nivel}`}>
                    {nivel === 'normal' ? `Estoque: ${p.saldo}` : `${NOMES_NIVEL[nivel]}: ${p.saldo}`}
                  </span>
                </button>
              );
            })}
            {visiveis.length === 0 && <p className="suave">Nenhum produto encontrado.</p>}
          </div>
        </section>

        <Cartao className="carrinho" titulo={`Venda atual${itensNoCarrinho > 0 ? ` · ${itensNoCarrinho} ${itensNoCarrinho === 1 ? 'item' : 'itens'}` : ''}`} icone={<ShoppingCart aria-hidden="true" />}>
          <div className="total-destaque" aria-live="polite">
            <span>Total</span>
            <strong data-testid="total">{reais(liquido)}</strong>
          </div>

          <ul className="itens" aria-label="Itens da venda">
            {linhas.length === 0 && <li className="suave">Bipe ou toque num produto para começar a venda.</li>}
            {linhas.map((l) => {
              const p = produtos.get(l.produtoId);
              const novo = destaque?.produtoId === l.produtoId;
              return (
                <li
                  key={novo ? `${l.produtoId}-${destaque.n}` : l.produtoId}
                  className={[novo ? 'entrou' : '', selecionado === l.produtoId ? 'selecionado' : ''].join(' ')}
                  onClick={() => setSelecionado(l.produtoId)}
                >
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
            <label className={doc.valido ? '' : 'invalido'}>
              CPF do cliente (opcional)
              <input
                value={documento}
                onChange={(e) => setDocumento(e.target.value)}
                inputMode="numeric"
                placeholder="000.000.000-00"
                aria-invalid={!doc.valido}
                maxLength={18}
              />
              {doc.mensagem !== null && <small className={doc.valido ? 'ok' : 'erro'}>{doc.mensagem}</small>}
            </label>
          </div>
          {passaDoLimite && (
            <label className="supervisor">
              Desconto acima de {estado.parametros.limiteDescontoPct}%: PIN do supervisor
              <input type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} />
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
          </dl>

          <div className="pagamento">
            <label>
              Valor recebido (F4 · vazio = o que falta)
              <input
                ref={campoPagamento}
                value={valorPagamento}
                onChange={(e) => setValorPagamento(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && linhas.length > 0) adicionarPagamento('dinheiro');
                }}
                inputMode="decimal"
                placeholder={reais(falta)}
              />
            </label>
            <div className="formas">
              {FORMAS.map((f) => (
                <Botao key={f} variante="secundario" onClick={() => adicionarPagamento(f)} disabled={linhas.length === 0}>
                  {NOMES_FORMA[f]}
                </Botao>
              ))}
            </div>
            <div className="notas" aria-label="Dinheiro: notas rápidas">
              {NOTAS.map((n) => (
                <button key={n} type="button" className="nota" onClick={() => adicionarPagamento('dinheiro', n)} disabled={linhas.length === 0}>
                  {reais(n)}
                </button>
              ))}
              <button type="button" className="nota exato" onClick={() => adicionarPagamento('dinheiro', falta)} disabled={linhas.length === 0 || falta === 0}>
                Valor exato
              </button>
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
            {linhas.length > 0 && (
              <p className={falta > 0 ? 'resumo-pagamento falta' : 'resumo-pagamento troco'} data-testid="resumo-pagamento">
                <span>{falta > 0 ? 'Falta:' : 'Troco:'}</span>{' '}
                <strong>{reais(falta > 0 ? falta : troco)}</strong>
              </p>
            )}
          </div>

          <Aviso texto={aviso} />
          <div className="botoes">
            <Botao largo icone={<Check aria-hidden="true" />} onClick={finalizar} disabled={enviando || linhas.length === 0 || falta > 0 || !doc.valido}>
              Finalizar venda
            </Botao>
            <Botao variante="fantasma" onClick={limpar} disabled={linhas.length === 0 && pagamentos.length === 0}>
              Limpar
            </Botao>
          </div>
        </Cartao>

        <UltimasVendas estado={estado} aoAtualizar={aoAtualizar} />
      </main>

      {dialogo === 'quantidade' && (
        <div className="fundo-modal">
          <section className="painel" role="dialog" aria-modal="true" aria-labelledby="titulo-quantidade">
            <h2 id="titulo-quantidade">Quantidade (F2)</h2>
            <label>
              Quantas unidades?
              <input
                autoFocus
                inputMode="numeric"
                value={textoQuantidade}
                onChange={(e) => setTextoQuantidade(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') confirmarQuantidade('proximo');
                }}
              />
            </label>
            <div className="botoes">
              <Botao onClick={() => confirmarQuantidade('proximo')}>Para o próximo item (Enter)</Botao>
              {linhas.length > 0 && (
                <Botao variante="secundario" onClick={() => confirmarQuantidade('ultimo')}>
                  Trocar no {selecionado !== null ? 'item selecionado' : 'último item'}
                </Botao>
              )}
              <Botao variante="fantasma" icone={<X aria-hidden="true" />} onClick={() => { setDialogo(null); focarBusca(); }}>
                Fechar (Esc)
              </Botao>
            </div>
          </section>
        </div>
      )}

      {dialogo === 'espera' && (
        <div className="fundo-modal">
          <section className="painel largo" role="dialog" aria-modal="true" aria-labelledby="titulo-espera">
            <h2 id="titulo-espera">Vendas em espera</h2>
            {estado.emEspera.length === 0 ? (
              <p className="suave">Nenhuma venda em espera. Com itens na venda, F6 pausa a venda para atender outro cliente.</p>
            ) : (
              <ul className="lista-espera">
                {estado.emEspera.map((e) => (
                  <li key={e.id}>
                    <span>
                      <strong>{e.rotulo}</strong>
                      <small>
                        {e.itens} itens · {new Date(e.criadaEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      </small>
                    </span>
                    <span className="valor">{reais(e.totalCentavos)}</span>
                    <Botao variante="secundario" onClick={() => void retomar(e.id)}>
                      Retomar
                    </Botao>
                  </li>
                ))}
              </ul>
            )}
            <div className="botoes">
              {linhas.length > 0 && (
                <Botao
                  icone={<CirclePause aria-hidden="true" />}
                  onClick={() => {
                    setDialogo(null);
                    colocarEmEspera();
                  }}
                >
                  Pôr a venda atual em espera
                </Botao>
              )}
              <Botao variante="fantasma" icone={<X aria-hidden="true" />} onClick={() => { setDialogo(null); focarBusca(); }}>
                Fechar (Esc)
              </Botao>
            </div>
          </section>
        </div>
      )}

      {finalizada !== null && (
        <VendaFinalizada
          venda={finalizada}
          aoFechar={() => {
            setFinalizada(null);
            focarBusca();
          }}
        />
      )}
    </>
  );
}
