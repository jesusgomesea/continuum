// Tela de entrada: o ERP do cliente (dono, gerente, operador) ou o Continuum Central (Equipe).
// Em produção o ERP é acessado pelo domínio do cliente; aqui, em desenvolvimento, o domínio vai no formulário.
import { Botao } from '@continuum/interface';
import { LogIn } from 'lucide-react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api.ts';

export function Entrar({ aoEntrar }: { aoEntrar: () => void }) {
  const [onde, setOnde] = useState<'erp' | 'central'>('erp');
  const [dominio, setDominio] = useState('mercbairro.continuum.app');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  function enviar(e: FormEvent) {
    e.preventDefault();
    setEnviando(true);
    (onde === 'central' ? api.entrarCentral(email, senha) : api.entrarErp(email, senha, dominio))
      .then(aoEntrar)
      .catch((erro: Error) => setAviso(erro.message))
      .finally(() => setEnviando(false));
  }

  return (
    <main className="centro">
      <form className="painel" onSubmit={enviar}>
        <div className="marca">
          <strong>
            CONTINUUM <span>{onde === 'central' ? 'CENTRAL' : 'ERP'}</span>
          </strong>
        </div>
        <div className="abas" role="tablist" aria-label="Onde entrar">
          <button type="button" role="tab" aria-selected={onde === 'erp'} onClick={() => setOnde('erp')}>
            ERP do meu negócio
          </button>
          <button type="button" role="tab" aria-selected={onde === 'central'} onClick={() => setOnde('central')}>
            Equipe Continuum
          </button>
        </div>
        {onde === 'erp' && (
          <label>
            Endereço do ERP
            <input value={dominio} onChange={(e) => setDominio(e.target.value)} required />
          </label>
        )}
        <label>
          E-mail
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
        </label>
        <label>
          Senha
          <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="current-password" required />
        </label>
        {aviso !== null && (
          <p className="aviso" role="alert">
            {aviso}
          </p>
        )}
        <Botao type="submit" largo icone={<LogIn aria-hidden="true" />} disabled={enviando}>
          Entrar
        </Botao>
      </form>
    </main>
  );
}
