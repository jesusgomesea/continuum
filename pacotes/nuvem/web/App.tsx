// A nuvem: decide a tela conforme quem está logado.
//   ninguém         → Entrar (Central ou ERP)
//   Equipe          → Continuum Central (tema escuro)
//   dono, gerente…  → ERP do cliente (tema claro), com o menu do que o perfil pode
import { useCallback, useEffect, useState } from 'react';
import { api, RecusaDaNuvem } from './api.ts';
import type { Eu } from './api.ts';
import { Central } from './telas/Central.tsx';
import { Entrar } from './telas/Entrar.tsx';
import { Erp } from './telas/Erp.tsx';

export function App() {
  const [eu, setEu] = useState<Eu | null | undefined>(undefined);

  const carregar = useCallback(() => {
    api
      .eu()
      .then(setEu)
      .catch((erro: unknown) => setEu(erro instanceof RecusaDaNuvem && erro.status === 401 ? null : null));
  }, []);
  useEffect(carregar, [carregar]);

  // Tema: escuro para o Central (e o login), claro para o ERP (docs/02).
  useEffect(() => {
    document.documentElement.dataset['tema'] = eu !== undefined && eu !== null && eu.perfil !== 'equipe' ? 'claro' : 'escuro';
  }, [eu]);

  const sair = () => void api.sair().finally(() => setEu(null));

  if (eu === undefined) return <main className="centro">Carregando…</main>;
  if (eu === null) return <Entrar aoEntrar={carregar} />;
  if (eu.perfil === 'equipe') return <Central eu={eu} aoSair={sair} />;
  return <Erp eu={eu} aoSair={sair} />;
}
