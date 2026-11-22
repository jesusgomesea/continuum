// O agente da loja instalado (Electron): liga o servidor do agente na rede da loja (porta 5180) e
// abre uma janela com o painel dos caixas. Fechar a janela desliga o agente.
// O banco fica em %APPDATA%\Continuum Agente\loja.db. Nada vem da internet.
import { app, BrowserWindow, dialog } from 'electron';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import base from '../../interface/src/tokens/base.css?raw';
import tokens from '../../interface/src/tokens/tokens.css?raw';
import { abrirBancoDaLoja, Agente } from '../src/agente.ts';
import { criarServidorDoAgente, ligar } from '../src/servidor.ts';

async function iniciar(): Promise<void> {
  // CONTINUUM_AGENTE_DADOS e CONTINUUM_AGENTE_PORTA existem para testes e casos especiais.
  const pastaDeDados = process.env['CONTINUUM_AGENTE_DADOS'] ?? app.getPath('userData');
  mkdirSync(pastaDeDados, { recursive: true });
  const banco = abrirBancoDaLoja(path.join(pastaDeDados, 'loja.db'));
  const servidor = criarServidorDoAgente(new Agente(banco), { estilos: `${tokens}\n${base}` });
  const porta = Number(process.env['CONTINUUM_AGENTE_PORTA'] ?? 5180);
  let endereco: string;
  try {
    endereco = await ligar(servidor, porta, '0.0.0.0');
  } catch (erro) {
    throw new Error(`A porta ${porta} já está em uso: talvez o agente já esteja aberto neste computador. (${(erro as Error).message})`);
  }

  const janela = new BrowserWindow({
    width: 1100,
    height: 720,
    title: 'Continuum Agente',
    backgroundColor: '#050a17',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  janela.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  await janela.loadURL(endereco);
  app.on('before-quit', () => {
    servidor.close();
    banco.fechar();
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => BrowserWindow.getAllWindows()[0]?.focus());
  app.on('window-all-closed', () => app.quit());
  app
    .whenReady()
    .then(iniciar)
    .catch((erro: unknown) => {
      dialog.showErrorBox('Continuum Agente', `Não foi possível ligar o agente.\n\n${(erro as Error).message}`);
      app.quit();
    });
}
