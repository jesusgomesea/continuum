// ERP · Importar produtos de uma planilha: escolher o arquivo (ou colar do Excel), conferir a prévia e
// importar. Tudo ou nada: com qualquer linha errada, nada entra e a tela mostra cada linha a corrigir.
import { formatarReais } from '@continuum/dominio';
import { Botao, Cartao } from '@continuum/interface';
import { FileSpreadsheet, Upload } from 'lucide-react';
import { useState } from 'react';
import { pedir, RecusaDaNuvem } from '../api.ts';
import { baixarCsv } from '../componentes/Tabela.tsx';
import { lerPlanilhaDeProdutos, MODELO_DA_PLANILHA } from '../planilha.ts';
import type { LinhaDeProduto } from '../planilha.ts';

export function ImportarProdutos({ lojas, aoImportar }: { lojas: { id: string; nome_reduzido: string }[]; aoImportar: () => void }) {
  const [aberto, setAberto] = useState(false);
  const [linhas, setLinhas] = useState<LinhaDeProduto[]>([]);
  const [colunas, setColunas] = useState<string[]>([]);
  const [loja, setLoja] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [erros, setErros] = useState<{ linha: number; mensagem: string }[]>([]);
  const [enviando, setEnviando] = useState(false);

  function ler(texto: string) {
    const r = lerPlanilhaDeProdutos(texto);
    setLinhas(r.linhas);
    setColunas(r.colunasReconhecidas);
    setErros([]);
    setMsg(r.erro === null ? null : { ok: false, texto: r.erro });
  }

  function importar() {
    setEnviando(true);
    pedir<{ importados: number }>('POST', '/v1/erp/produtos/importar', { linhas, lojaId: loja || lojas[0]?.id })
      .then((r) => {
        setMsg({ ok: true, texto: `${r.importados} produto(s) importado(s). Os caixas recebem em segundos.` });
        setLinhas([]);
        setErros([]);
        aoImportar();
      })
      .catch((e: Error) => {
        setMsg({ ok: false, texto: e.message });
        // A nuvem devolve a lista de linhas com problema: a prévia marca cada uma.
        setErros(e instanceof RecusaDaNuvem && Array.isArray(e.dados['erros']) ? (e.dados['erros'] as { linha: number; mensagem: string }[]) : []);
      })
      .finally(() => setEnviando(false));
  }

  if (!aberto) {
    return (
      <button type="button" className="botao-pequeno faixa-acao" onClick={() => setAberto(true)}>
        <FileSpreadsheet aria-hidden="true" /> Importar vários produtos de uma planilha (Excel)
      </button>
    );
  }
  const comEstoque = linhas.some((l) => Number(l.estoqueInicial) > 0);
  return (
    <Cartao titulo="Importar planilha" icone={<FileSpreadsheet aria-hidden="true" />} acao={<button type="button" className="link" onClick={() => setAberto(false)}>Fechar</button>}>
      <div className="formulario">
        <p className="suave">
          Salve a planilha como <strong>CSV</strong> no Excel (ou copie as células e cole abaixo). A primeira linha tem os nomes das colunas: nome, preço, unidade, código de barras, estoque mínimo, estoque inicial.{' '}
          <button type="button" className="link" onClick={() => baixarCsv('modelo-produtos.csv', MODELO_DA_PLANILHA)}>
            Baixar modelo
          </button>
        </p>
        <label>
          Arquivo CSV
          <input type="file" accept=".csv,.txt,text/csv" onChange={(e) => void e.target.files?.[0]?.text().then(ler)} />
        </label>
        <label>
          Ou cole aqui
          <textarea rows={3} placeholder="nome;preço;unidade…" onChange={(e) => ler(e.target.value)} />
        </label>
        {linhas.length > 0 && (
          <>
            <p className="suave">
              {linhas.length} produto(s) · colunas reconhecidas: {colunas.join(', ')}
            </p>
            <div className="rolagem-tabela previa">
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Linha</th>
                    <th>Nome</th>
                    <th className="numerica">Preço</th>
                    <th>Un.</th>
                    <th>Código</th>
                    <th className="numerica">Mín.</th>
                    <th className="numerica">Inicial</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.slice(0, 50).map((l) => {
                    const erro = erros.find((x) => x.linha === l.linha);
                    return (
                      <tr key={l.linha} className={erro === undefined ? '' : 'linha-erro'} title={erro?.mensagem}>
                        <td>{l.linha}</td>
                        <td>
                          {l.nome || '—'}
                          {erro !== undefined && <small className="texto-erro"> {erro.mensagem}</small>}
                        </td>
                        <td className="numerica">{typeof l.precoCentavos === 'number' ? formatarReais(l.precoCentavos) : `"${l.precoCentavos}"`}</td>
                        <td>{l.unidade}</td>
                        <td>{l.ean}</td>
                        <td className="numerica">{l.estoqueMinimo}</td>
                        <td className="numerica">{l.estoqueInicial}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {linhas.length > 50 && <small className="suave">Mostrando as 50 primeiras.</small>}
            {erros.length > 50 && <small className="texto-erro">E mais {erros.length - 50} linha(s) com problema.</small>}
            {comEstoque && lojas.length > 1 && (
              <label>
                Loja que recebe o estoque inicial
                <select value={loja} onChange={(e) => setLoja(e.target.value)}>
                  {lojas.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.nome_reduzido}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        )}
        {msg !== null && <p className={msg.ok ? 'ok' : 'aviso'}>{msg.texto}</p>}
        {erros.length > 0 && (
          <ul className="lista-erros">
            {erros.slice(0, 50).map((e) => (
              <li key={`${e.linha}-${e.mensagem}`}>
                Linha {e.linha}: {e.mensagem}
              </li>
            ))}
          </ul>
        )}
        <Botao icone={<Upload aria-hidden="true" />} onClick={importar} disabled={linhas.length === 0 || enviando}>
          {enviando ? 'Importando…' : `Importar ${linhas.length} produto(s)`}
        </Botao>
      </div>
    </Cartao>
  );
}
