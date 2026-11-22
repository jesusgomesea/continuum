// Ponto de partida das telas do PDV (Passo 1.4). Tema escuro, como definido para o caixa.
import '@continuum/interface/estilos';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './pdv.css';

const raiz = document.getElementById('raiz');
if (raiz === null) throw new Error('elemento #raiz não encontrado');
createRoot(raiz).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
