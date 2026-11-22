// Ponto de partida das telas da nuvem: Continuum Central (escuro) e ERP do cliente (claro).
import '@continuum/interface/estilos';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './nuvem.css';

const raiz = document.getElementById('raiz');
if (raiz === null) throw new Error('elemento #raiz não encontrado');
createRoot(raiz).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
