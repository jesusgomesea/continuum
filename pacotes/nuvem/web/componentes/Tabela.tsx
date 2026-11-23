// Tabela com busca, ordenação por coluna e exportação para planilha (CSV que o Excel abre) e impressão/PDF.
import { Download, Printer, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export interface Coluna<T> {
  titulo: string;
  /** O valor usado para ordenar e exportar. */
  valor: (linha: T) => string | number | null;
  /** Como aparece na tela (se não vier, mostra o valor). */
  mostrar?: (linha: T) => ReactNode;
  /** Como vai para a planilha (ex.: centavos viram "12,90"). */
  exportar?: (linha: T) => string | number;
  numerica?: boolean;
}

/** Tira acentos e maiúsculas, para a busca achar "açúcar" digitando "acucar". */
export const normalizar = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Monta o CSV no padrão brasileiro (separador ";", que o Excel em português abre direto). */
export function montarCsv<T>(colunas: Coluna<T>[], linhas: T[]): string {
  const celula = (v: string | number | null) => {
    const t = v === null ? '' : String(v);
    return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return [colunas.map((c) => celula(c.titulo)).join(';'), ...linhas.map((l) => colunas.map((c) => celula(c.exportar ? c.exportar(l) : c.valor(l))).join(';'))].join('\r\n');
}

/** Baixa o CSV no computador (com BOM, para o Excel ler os acentos certo). */
export function baixarCsv(nomeDoArquivo: string, conteudo: string): void {
  const url = URL.createObjectURL(new Blob(['﻿', conteudo], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeDoArquivo;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Centavos no formato da planilha brasileira: 1290 → "12,90". */
export const centavosParaPlanilha = (c: number) => (c / 100).toFixed(2).replace('.', ',');

export function BotoesDeExportar<T>({ nome, colunas, linhas }: { nome: string; colunas: Coluna<T>[]; linhas: T[] }) {
  return (
    <span className="botoes nao-imprimir">
      <button type="button" className="botao-pequeno" onClick={() => baixarCsv(`${nome}.csv`, montarCsv(colunas, linhas))} disabled={linhas.length === 0}>
        <Download aria-hidden="true" /> Excel (CSV)
      </button>
      <button type="button" className="botao-pequeno" onClick={() => window.print()}>
        <Printer aria-hidden="true" /> Imprimir / PDF
      </button>
    </span>
  );
}

export function TabelaDados<T>({
  colunas,
  linhas,
  chave,
  busca = true,
  vazio = 'Nada para mostrar.',
  aoEscolher,
  selecionada,
  rodape,
}: {
  colunas: Coluna<T>[];
  linhas: T[];
  chave: (l: T) => string;
  busca?: boolean;
  vazio?: string;
  aoEscolher?: (l: T) => void;
  selecionada?: string | null;
  rodape?: ReactNode;
}) {
  const [termo, setTermo] = useState('');
  const [ordem, setOrdem] = useState<{ coluna: number; sobe: boolean } | null>(null);
  const visiveis = useMemo(() => {
    const t = normalizar(termo.trim());
    let r = t === '' ? linhas : linhas.filter((l) => colunas.some((c) => normalizar(String(c.valor(l) ?? '')).includes(t)));
    if (ordem !== null) {
      const c = colunas[ordem.coluna];
      if (c !== undefined) {
        r = [...r].sort((a, b) => {
          const va = c.valor(a);
          const vb = c.valor(b);
          const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va ?? '').localeCompare(String(vb ?? ''), 'pt-BR', { numeric: true });
          return ordem.sobe ? cmp : -cmp;
        });
      }
    }
    return r;
  }, [linhas, colunas, termo, ordem]);

  return (
    <div className="tabela-dados">
      {busca && linhas.length > 5 && (
        <label className="busca nao-imprimir">
          <Search aria-hidden="true" />
          <input type="search" placeholder="Buscar…" value={termo} onChange={(e) => setTermo(e.target.value)} aria-label="Buscar na tabela" />
        </label>
      )}
      <div className="rolagem-tabela">
        <table className="tabela">
          <thead>
            <tr>
              {colunas.map((c, i) => (
                <th key={c.titulo} className={c.numerica === true ? 'numerica' : ''} aria-sort={ordem?.coluna === i ? (ordem.sobe ? 'ascending' : 'descending') : 'none'}>
                  <button type="button" className="ordenar" onClick={() => setOrdem((o) => ({ coluna: i, sobe: o?.coluna === i ? !o.sobe : c.numerica !== true }))}>
                    {c.titulo}
                    <span aria-hidden="true">{ordem?.coluna === i ? (ordem.sobe ? ' ▲' : ' ▼') : ''}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visiveis.length === 0 ? (
              <tr>
                <td colSpan={colunas.length} className="suave">
                  {termo === '' ? vazio : `Nada encontrado para "${termo}".`}
                </td>
              </tr>
            ) : (
              visiveis.map((l) => (
                <tr key={chave(l)} className={[aoEscolher ? 'clicavel' : '', selecionada === chave(l) ? 'selecionada' : ''].join(' ')} onClick={aoEscolher ? () => aoEscolher(l) : undefined}>
                  {colunas.map((c) => (
                    <td key={c.titulo} className={c.numerica === true ? 'numerica' : ''}>
                      {c.mostrar ? c.mostrar(l) : (c.valor(l) ?? '—')}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
          {rodape !== undefined && <tfoot>{rodape}</tfoot>}
        </table>
      </div>
    </div>
  );
}
