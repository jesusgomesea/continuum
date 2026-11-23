// ERP · Produtos e estoque (Passo 2.4): cadastrar produto, alterar preço, dar entrada, ajustar e ver o kardex.
import { formatarReais, lerReais } from '@continuum/dominio';
import { Botao, Cartao, Chip } from '@continuum/interface';
import { History, PackagePlus, Save } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { pedir } from '../api.ts';
import { TabelaDados } from '../componentes/Tabela.tsx';
import { ImportarProdutos } from './ErpImportar.tsx';

interface Produto {
  id: string;
  nome: string;
  precoCentavos: number;
  unidade: string;
  ean: string | null;
  estoqueMinimo: number;
  version: number;
  saldo: number;
}
interface LinhaKardex {
  ocorridoEm: string;
  tipo: string;
  quantidade: number;
  motivo: string | null;
  loja: string;
  codigoVenda: string | null;
  saldo: number;
}

const lerPreco = (t: string): number | null => {
  try {
    return lerReais(t);
  } catch {
    return null;
  }
};

export function ErpProdutos({ podeEditar }: { podeEditar: boolean }) {
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [lojas, setLojas] = useState<{ id: string; nome_reduzido: string }[]>([]);
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const carregar = useCallback(() => {
    pedir<{ produtos: Produto[] }>('GET', '/v1/erp/produtos')
      .then((r) => setProdutos(r.produtos))
      .catch((e: Error) => setAviso(e.message));
    pedir<{ lojas: { id: string; nome_reduzido: string }[] }>('GET', '/v1/erp/loja')
      .then((r) => setLojas(r.lojas))
      .catch(() => undefined);
  }, []);
  useEffect(carregar, [carregar]);

  const produto = produtos.find((p) => p.id === escolhido) ?? null;
  return (
    <div className="duas-colunas">
      <div className="coluna">
        {podeEditar && <NovoProduto aoCriar={carregar} />}
        {podeEditar && <ImportarProdutos lojas={lojas} aoImportar={carregar} />}
        <Cartao titulo={`Produtos (${produtos.length})`}>
          {aviso !== null && <p className="aviso">{aviso}</p>}
          <TabelaDados
            chave={(p) => p.id}
            linhas={produtos}
            selecionada={escolhido}
            aoEscolher={(p) => setEscolhido(p.id)}
            vazio="Nenhum produto ainda. Cadastre o primeiro ou importe uma planilha."
            colunas={[
              { titulo: 'Produto', valor: (p) => `${p.nome} ${p.ean ?? ''}`, mostrar: (p) => <>{p.nome}{p.ean !== null && <small className="suave"> {p.ean}</small>}</> },
              { titulo: 'Preço', valor: (p) => p.precoCentavos, mostrar: (p) => formatarReais(p.precoCentavos), numerica: true },
              {
                titulo: 'Estoque',
                valor: (p) => p.saldo,
                mostrar: (p) => <Chip tom={p.saldo <= 0 ? 'erro' : p.saldo <= p.estoqueMinimo ? 'atencao' : 'sucesso'}>{`${p.saldo} ${p.unidade}`}</Chip>,
                numerica: true,
              },
            ]}
          />
        </Cartao>
      </div>
      {produto === null ? (
        <Cartao titulo="Escolha um produto">
          <p className="suave">Clique num produto para alterar o preço, dar entrada ou ajustar o estoque e ver o kardex.</p>
        </Cartao>
      ) : (
        <DetalheProduto key={`${produto.id}-${produto.version}-${produto.saldo}`} produto={produto} lojas={lojas} podeEditar={podeEditar} aoMudar={carregar} />
      )}
    </div>
  );
}

function NovoProduto({ aoCriar }: { aoCriar: () => void }) {
  const [f, setF] = useState({ nome: '', preco: '', unidade: 'un', ean: '', estoqueMinimo: '' });
  const [aviso, setAviso] = useState<string | null>(null);
  const campo = (k: keyof typeof f) => ({ value: f[k], onChange: (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value }) });

  function enviar(e: FormEvent) {
    e.preventDefault();
    const precoCentavos = lerPreco(f.preco);
    if (precoCentavos === null) {
      setAviso('Preço inválido. Use, por exemplo, 18,90.');
      return;
    }
    pedir('POST', '/v1/erp/produtos', { nome: f.nome, precoCentavos, unidade: f.unidade, ean: f.ean, estoqueMinimo: f.estoqueMinimo === '' ? 0 : Number(f.estoqueMinimo) })
      .then(() => {
        setF({ nome: '', preco: '', unidade: 'un', ean: '', estoqueMinimo: '' });
        setAviso(null);
        aoCriar();
      })
      .catch((erro: Error) => setAviso(erro.message));
  }

  return (
    <Cartao titulo="Novo produto" icone={<PackagePlus aria-hidden="true" />}>
      <form className="formulario grade-campos" onSubmit={enviar}>
        <label className="largo">
          Nome
          <input {...campo('nome')} required />
        </label>
        <label>
          Preço (R$)
          <input {...campo('preco')} inputMode="decimal" placeholder="18,90" required />
        </label>
        <label>
          Unidade
          <select {...campo('unidade')}>
            <option value="un">un</option>
            <option value="kg">kg</option>
            <option value="l">l</option>
          </select>
        </label>
        <label>
          Código de barras (EAN-13)
          <input {...campo('ean')} inputMode="numeric" placeholder="opcional" />
        </label>
        <label>
          Estoque mínimo
          <input {...campo('estoqueMinimo')} inputMode="numeric" placeholder="0" />
        </label>
        {aviso !== null && (
          <p className="aviso largo" role="alert">
            {aviso}
          </p>
        )}
        <Botao type="submit" icone={<PackagePlus aria-hidden="true" />}>
          Cadastrar
        </Botao>
      </form>
    </Cartao>
  );
}

function DetalheProduto({ produto, lojas, podeEditar, aoMudar }: { produto: Produto; lojas: { id: string; nome_reduzido: string }[]; podeEditar: boolean; aoMudar: () => void }) {
  const [preco, setPreco] = useState(formatarReais(produto.precoCentavos).replace('R$ ', ''));
  const [mov, setMov] = useState({ tipo: 'ENTRADA', quantidade: '', motivo: '', lojaId: lojas[0]?.id ?? '' });
  const [kardex, setKardex] = useState<LinhaKardex[]>([]);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    pedir<{ kardex: LinhaKardex[] }>('GET', `/v1/erp/produtos/${produto.id}/kardex`)
      .then((r) => setKardex(r.kardex))
      .catch((e: Error) => setAviso(e.message));
  }, [produto.id]);

  function salvarPreco(e: FormEvent) {
    e.preventDefault();
    const precoCentavos = lerPreco(preco);
    if (precoCentavos === null) {
      setAviso('Preço inválido.');
      return;
    }
    pedir('PUT', `/v1/erp/produtos/${produto.id}`, { ...produto, precoCentavos, version: produto.version })
      .then(aoMudar)
      .catch((erro: Error) => setAviso(erro.message));
  }

  function movimentar(e: FormEvent) {
    e.preventDefault();
    pedir('POST', '/v1/erp/estoque', { produtoId: produto.id, lojaId: mov.lojaId || lojas[0]?.id, tipo: mov.tipo, quantidade: Number(mov.quantidade), motivo: mov.motivo })
      .then(aoMudar)
      .catch((erro: Error) => setAviso(erro.message));
  }

  return (
    <Cartao titulo={produto.nome} acao={<Chip tom="neutro">versão {produto.version}</Chip>}>
      <div className="formulario">
        {podeEditar && (
          <form className="linha-form" onSubmit={salvarPreco}>
            <label>
              Preço (R$)
              <input value={preco} onChange={(e) => setPreco(e.target.value)} inputMode="decimal" />
            </label>
            <Botao type="submit" icone={<Save aria-hidden="true" />}>
              Salvar preço
            </Botao>
          </form>
        )}
        {podeEditar && (
          <form className="linha-form" onSubmit={movimentar}>
            <label>
              Movimento
              <select value={mov.tipo} onChange={(e) => setMov({ ...mov, tipo: e.target.value })}>
                <option value="ENTRADA">Entrada (compra, reposição)</option>
                <option value="AJUSTE">Ajuste (contagem, quebra)</option>
              </select>
            </label>
            <label>
              Quantidade
              <input value={mov.quantidade} onChange={(e) => setMov({ ...mov, quantidade: e.target.value })} inputMode="numeric" placeholder={mov.tipo === 'AJUSTE' ? '-2 ou 5' : '24'} required />
            </label>
            <label>
              Motivo
              <input value={mov.motivo} onChange={(e) => setMov({ ...mov, motivo: e.target.value })} placeholder={mov.tipo === 'AJUSTE' ? 'obrigatório' : 'nota, fornecedor…'} />
            </label>
            {lojas.length > 1 && (
              <label>
                Loja
                <select value={mov.lojaId} onChange={(e) => setMov({ ...mov, lojaId: e.target.value })}>
                  {lojas.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.nome_reduzido}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <Botao type="submit" variante="secundario">
              Registrar
            </Botao>
          </form>
        )}
        {aviso !== null && (
          <p className="aviso" role="alert">
            {aviso}
          </p>
        )}
        <h3 className="subtitulo">
          <History aria-hidden="true" /> Kardex (saldo atual: {produto.saldo} {produto.unidade})
        </h3>
        <table className="tabela">
          <thead>
            <tr>
              <th>Quando</th>
              <th>Movimento</th>
              <th>Qtd.</th>
              <th>Saldo</th>
            </tr>
          </thead>
          <tbody>
            {kardex.map((k, i) => (
              <tr key={i}>
                <td>{new Date(k.ocorridoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                <td>
                  {k.tipo} · {k.loja}
                  {k.codigoVenda !== null && <small className="suave"> {k.codigoVenda}</small>}
                  {k.motivo !== null && <small className="suave"> {k.motivo}</small>}
                </td>
                <td className={k.quantidade < 0 ? 'negativo' : ''}>{k.quantidade > 0 ? `+${k.quantidade}` : k.quantidade}</td>
                <td>{k.saldo}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {kardex.length === 0 && <p className="suave">Sem movimentações ainda.</p>}
      </div>
    </Cartao>
  );
}
