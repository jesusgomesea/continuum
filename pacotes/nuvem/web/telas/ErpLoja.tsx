// ERP · Loja e comprovante (Passo 2.4, UC10): dados da loja e o que sai impresso no comprovante dos caixas.
import { Botao, Cartao } from '@continuum/interface';
import { Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { pedir } from '../api.ts';

interface Loja {
  id: string;
  nome_reduzido: string;
  nome: string;
  telefone: string | null;
  endereco: { logradouro?: string; cidade?: string };
}

export function ErpLoja() {
  const [lojas, setLojas] = useState<Loja[]>([]);
  const [cabecalho, setCabecalho] = useState('');
  const [rodape, setRodape] = useState('');
  const [largura, setLargura] = useState<number>(80);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const carregar = () =>
    pedir<{ lojas: Loja[]; comprovante: { cabecalho?: string[]; rodape?: string; largura?: number } }>('GET', '/v1/erp/loja')
      .then((r) => {
        setLojas(r.lojas);
        setCabecalho((r.comprovante.cabecalho ?? []).join('\n'));
        setRodape(r.comprovante.rodape ?? '');
        setLargura(r.comprovante.largura ?? 80);
      })
      .catch((e: Error) => setAviso(e.message));
  useEffect(() => void carregar(), []);

  function salvarComprovante(e: FormEvent) {
    e.preventDefault();
    pedir<{ versao: number }>('PUT', '/v1/erp/comprovante', { cabecalho: cabecalho.split('\n'), rodape })
      .then((r) => {
        setOk(`Comprovante salvo (parâmetros versão ${r.versao}). Os caixas recebem na próxima sincronização.`);
        setAviso(null);
      })
      .catch((erro: Error) => setAviso(erro.message));
  }

  return (
    <div className="duas-colunas">
      <Cartao titulo="Comprovante">
        <form className="formulario" onSubmit={salvarComprovante}>
          <label>
            Cabeçalho (uma linha por linha impressa, até 5)
            <textarea value={cabecalho} onChange={(e) => setCabecalho(e.target.value)} rows={4} />
          </label>
          <label>
            Rodapé
            <input value={rodape} onChange={(e) => setRodape(e.target.value)} />
          </label>
          <p className="suave">Bobina: {largura} mm (definida pela Continuum no Central).</p>
          {aviso !== null && <p className="aviso">{aviso}</p>}
          {ok !== null && <p className="ok">{ok}</p>}
          <Botao type="submit" icone={<Save aria-hidden="true" />}>
            Salvar comprovante
          </Botao>
        </form>
      </Cartao>
      <div className="coluna">
        {lojas.map((l) => (
          <FormLoja key={l.id} loja={l} />
        ))}
      </div>
    </div>
  );
}

function FormLoja({ loja }: { loja: Loja }) {
  const [nome, setNome] = useState(loja.nome);
  const [telefone, setTelefone] = useState(loja.telefone ?? '');
  const [logradouro, setLogradouro] = useState(loja.endereco.logradouro ?? '');
  const [cidade, setCidade] = useState(loja.endereco.cidade ?? '');
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  function salvar(e: FormEvent) {
    e.preventDefault();
    pedir('PUT', `/v1/erp/lojas/${loja.id}`, { nome, telefone, endereco: { logradouro, cidade } })
      .then(() => setMsg({ ok: true, texto: 'Loja salva.' }))
      .catch((erro: Error) => setMsg({ ok: false, texto: erro.message }));
  }

  return (
    <Cartao titulo={`Loja ${loja.nome_reduzido}`}>
      <form className="formulario" onSubmit={salvar}>
        <label>
          Nome
          <input value={nome} onChange={(e) => setNome(e.target.value)} required />
        </label>
        <label>
          Endereço
          <input value={logradouro} onChange={(e) => setLogradouro(e.target.value)} />
        </label>
        <label>
          Cidade
          <input value={cidade} onChange={(e) => setCidade(e.target.value)} />
        </label>
        <label>
          Telefone
          <input value={telefone} onChange={(e) => setTelefone(e.target.value)} />
        </label>
        <p className="suave">O nome reduzido ({loja.nome_reduzido}) vai no código das vendas e não muda.</p>
        {msg !== null && <p className={msg.ok ? 'ok' : 'aviso'}>{msg.texto}</p>}
        <Botao type="submit" variante="secundario" icone={<Save aria-hidden="true" />}>
          Salvar loja
        </Botao>
      </form>
    </Cartao>
  );
}
