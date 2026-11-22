// ERP · Caixas (Passo 2.5, UC17 e UC05): gerar o código de ativação de um caixa novo e desativar um caixa.
import { Botao, Cartao, Chip } from '@continuum/interface';
import type { TomChip } from '@continuum/interface';
import { KeyRound, MonitorSmartphone, Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { pedir } from '../api.ts';

interface Caixa {
  id: string;
  tipo: 'pdv' | 'agente';
  numeroCaixa: number | null;
  situacao: 'pendente' | 'ativo' | 'expirado' | 'desativado';
  codigoExpiraEm: string | null;
  loja: string;
  estado: string | null;
  ultimoSinalEm: string | null;
}

const TOM: Record<Caixa['situacao'], TomChip> = { pendente: 'atencao', ativo: 'sucesso', expirado: 'neutro', desativado: 'erro' };

export function ErpCaixas() {
  const [caixas, setCaixas] = useState<Caixa[]>([]);
  const [lojas, setLojas] = useState<{ id: string; nome_reduzido: string }[]>([]);
  const [codigo, setCodigo] = useState<{ texto: string; para: string; expiraEm: string } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const carregar = useCallback(() => {
    pedir<{ caixas: Caixa[] }>('GET', '/v1/erp/caixas')
      .then((r) => setCaixas(r.caixas))
      .catch((e: Error) => setAviso(e.message));
    pedir<{ lojas: { id: string; nome_reduzido: string }[] }>('GET', '/v1/erp/loja')
      .then((r) => setLojas(r.lojas))
      .catch(() => undefined);
  }, []);
  useEffect(carregar, [carregar]);

  const nome = (c: Caixa) => (c.tipo === 'pdv' ? `Caixa ${c.numeroCaixa ?? '?'}` : 'Agente da loja');

  function novo(tipo: 'pdv' | 'agente') {
    pedir<{ codigo: string; numeroCaixa: number | null; expiraEm: string }>('POST', '/v1/erp/caixas', { tipo, lojaId: lojas[0]?.id })
      .then((r) => {
        setCodigo({ texto: r.codigo, para: tipo === 'pdv' ? `Caixa ${r.numeroCaixa ?? ''}` : 'Agente da loja', expiraEm: r.expiraEm });
        setAviso(null);
        carregar();
      })
      .catch((e: Error) => setAviso(e.message));
  }

  function acao(c: Caixa, qual: 'novo-codigo' | 'desativar') {
    if (qual === 'desativar' && !window.confirm(`Desativar ${nome(c)}? Ele perde o acesso na hora (use em caso de perda, roubo ou troca).`)) return;
    pedir<{ codigo?: string; expiraEm?: string }>('POST', `/v1/erp/caixas/${c.id}/${qual}`)
      .then((r) => {
        if (r.codigo !== undefined && r.expiraEm !== undefined) setCodigo({ texto: r.codigo, para: nome(c), expiraEm: r.expiraEm });
        carregar();
      })
      .catch((e: Error) => setAviso(e.message));
  }

  return (
    <div className="duas-colunas">
      <Cartao titulo={`Caixas da loja (${caixas.length})`} icone={<MonitorSmartphone aria-hidden="true" />}>
        <div className="botoes">
          <Botao icone={<Plus aria-hidden="true" />} onClick={() => novo('pdv')}>
            Novo caixa
          </Botao>
          <Botao variante="secundario" icone={<Plus aria-hidden="true" />} onClick={() => novo('agente')}>
            Novo agente
          </Botao>
        </div>
        {aviso !== null && <p className="aviso">{aviso}</p>}
        <table className="tabela">
          <thead>
            <tr>
              <th>Dispositivo</th>
              <th>Situação</th>
              <th>Último sinal</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {caixas.map((c) => (
              <tr key={c.id}>
                <td>
                  {nome(c)} <small className="suave">{c.loja}</small>
                </td>
                <td>
                  <Chip tom={TOM[c.situacao]}>{c.situacao}</Chip>
                </td>
                <td>{c.ultimoSinalEm === null ? <span className="suave">—</span> : `${c.estado ?? ''} · ${new Date(c.ultimoSinalEm).toLocaleTimeString('pt-BR')}`}</td>
                <td>
                  {(c.situacao === 'pendente' || c.situacao === 'expirado') && (
                    <Botao variante="fantasma" onClick={() => acao(c, 'novo-codigo')}>
                      Código novo
                    </Botao>
                  )}
                  {c.situacao !== 'desativado' && (
                    <Botao variante="fantasma" onClick={() => acao(c, 'desativar')}>
                      Desativar
                    </Botao>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {caixas.length === 0 && <p className="suave">Nenhum caixa ainda. Crie um e use o código no PDV.</p>}
      </Cartao>
      <Cartao titulo="Código de ativação" icone={<KeyRound aria-hidden="true" />}>
        {codigo === null ? (
          <p className="suave">Ao criar um caixa, o código aparece aqui. Digite-o no PDV na primeira vez que ele abrir (Passo 3.1).</p>
        ) : (
          <div className="codigo-ativacao">
            <p className="suave">Para o {codigo.para}:</p>
            <p className="codigo-grande" data-testid="codigo-ativacao">
              {codigo.texto}
            </p>
            <p className="suave">Vale até {new Date(codigo.expiraEm).toLocaleString('pt-BR')}. Anote agora: por segurança, ele não aparece de novo.</p>
          </div>
        )}
      </Cartao>
    </div>
  );
}
