// Tela "Abrir caixa": quem vai operar e quanto dinheiro fica na gaveta para troco.
import { Botao } from '@continuum/interface';
import { LockOpen } from 'lucide-react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api.ts';
import type { EstadoDoCaixa } from '../api.ts';
import { Aviso, Cabecalho, lerCampoReais } from '../comum.tsx';

export function AbrirCaixa({ estado, aoAbrir }: { estado: EstadoDoCaixa; aoAbrir: (e: EstadoDoCaixa) => void }) {
  const [operador, setOperador] = useState('');
  const [fundo, setFundo] = useState('100,00');
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  function enviar(evento: FormEvent) {
    evento.preventDefault();
    const fundoCentavos = lerCampoReais(fundo);
    if (fundoCentavos === null || fundoCentavos < 0) {
      setAviso('Fundo de troco inválido. Use, por exemplo, 100,00.');
      return;
    }
    setEnviando(true);
    api
      .abrirCaixa(operador, fundoCentavos)
      .then(aoAbrir)
      .catch((erro: Error) => setAviso(erro.message))
      .finally(() => setEnviando(false));
  }

  return (
    <>
      <Cabecalho estado={estado} />
      <main className="centro">
        <form className="painel" onSubmit={enviar}>
          <h1>Abrir caixa</h1>
          <p className="suave">Informe quem vai operar e o dinheiro deixado na gaveta para troco.</p>
          <label>
            Operador
            <input value={operador} onChange={(e) => setOperador(e.target.value)} autoFocus required />
          </label>
          <label>
            Fundo de troco (R$)
            <input value={fundo} onChange={(e) => setFundo(e.target.value)} inputMode="decimal" />
          </label>
          <Aviso texto={aviso} />
          <Botao type="submit" largo icone={<LockOpen aria-hidden="true" />} disabled={enviando}>
            Abrir caixa
          </Botao>
        </form>
      </main>
    </>
  );
}
