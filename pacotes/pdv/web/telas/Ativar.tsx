// Tela "Ativar este caixa" (Passo 3.1): aparece só na primeira vez que o PDV abre.
// Com o código gerado no ERP (Caixas → Novo caixa), o caixa baixa a loja, os parâmetros e os produtos.
import { Botao } from '@continuum/interface';
import { FlaskConical, KeyRound } from 'lucide-react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { RecusaDoCaixa } from '../api.ts';

async function postar(caminho: string, corpo: unknown): Promise<void> {
  const r = await fetch(caminho, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
  if (!r.ok) {
    const d = (await r.json().catch(() => ({}))) as { erro?: string; mensagem?: string };
    throw new RecusaDoCaixa(d.erro ?? 'Erro', d.mensagem ?? 'Não foi possível ativar.', r.status);
  }
}

export function Ativar({ aoAtivar }: { aoAtivar: () => void }) {
  const [urlNuvem, setUrlNuvem] = useState('http://localhost:5175');
  const [codigo, setCodigo] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const executar = (promessa: Promise<void>) => {
    setEnviando(true);
    promessa
      .then(aoAtivar)
      .catch((e: Error) => setAviso(e.message))
      .finally(() => setEnviando(false));
  };

  function ativar(e: FormEvent) {
    e.preventDefault();
    executar(postar('/api/ativar', { urlNuvem, codigo }));
  }

  return (
    <main className="centro">
      <form className="painel" onSubmit={ativar}>
        <h1>Ativar este caixa</h1>
        <p className="suave">No ERP, vá em Caixas → Novo caixa e digite aqui o código que aparecer. Só a ativação precisa de internet.</p>
        <label>
          Endereço do ERP
          <input value={urlNuvem} onChange={(e) => setUrlNuvem(e.target.value)} required />
        </label>
        <label>
          Código de ativação
          <input value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase())} placeholder="4F7K-92QX" autoFocus required />
        </label>
        {aviso !== null && (
          <p className="aviso" role="alert">
            {aviso}
          </p>
        )}
        <Botao type="submit" largo icone={<KeyRound aria-hidden="true" />} disabled={enviando}>
          Ativar
        </Botao>
        <Botao variante="fantasma" largo icone={<FlaskConical aria-hidden="true" />} disabled={enviando} onClick={() => executar(postar('/api/demonstracao', {}))}>
          Usar o modo demonstração (sem ERP)
        </Botao>
      </form>
    </main>
  );
}
