// A nuvem instalada para teste (nuvem-continuum.exe, Passo 3.5): o ERP e o Central rodando neste
// computador, com o PostgreSQL embutido. Liga o banco (dados em %APPDATA%\Continuum Nuvem), a API e as
// telas em http://localhost:5175 (o endereço que o PDV sugere na ativação) e abre uma janela no login.
// Na hospedagem de verdade (Passo 4.2) a nuvem roda num servidor; este programa é para testar a conexão.
import { app, BrowserWindow, dialog } from 'electron';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { prepararNuvem } from '../src/preparar.ts';
import type { NuvemPreparada } from '../src/preparar.ts';
import { middlewareDaNuvem } from '../src/servidor.ts';

const PASTA_TELAS = path.join(import.meta.dirname, 'web');
const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

let nuvem: NuvemPreparada | null = null;

async function iniciar(): Promise<void> {
  // Os programas do PostgreSQL vão dentro do executável, na pasta de recursos.
  process.env['CONTINUUM_POSTGRES_BIN'] ??= path.join(process.resourcesPath, 'postgres', 'bin');
  const pastaDeDados = process.env['CONTINUUM_NUVEM_DADOS'] ?? app.getPath('userData');
  mkdirSync(pastaDeDados, { recursive: true });
  nuvem = await prepararNuvem(pastaDeDados, Number(process.env['CONTINUUM_NUVEM_PORTA_BANCO'] ?? 5433));

  const api = middlewareDaNuvem(nuvem.api);
  const servidor = createServer((req, res) =>
    api(req, res, () => {
      const pedido = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
      let arquivo = path.join(PASTA_TELAS, pedido);
      if (!arquivo.startsWith(PASTA_TELAS) || !existsSync(arquivo) || statSync(arquivo).isDirectory()) arquivo = path.join(PASTA_TELAS, 'index.html');
      res.setHeader('Content-Type', TIPOS[path.extname(arquivo)] ?? 'application/octet-stream');
      createReadStream(arquivo).pipe(res);
    }),
  );
  const porta = Number(process.env['CONTINUUM_NUVEM_PORTA'] ?? 5175);
  await new Promise<void>((ok, falha) => {
    servidor.once('error', () => falha(new Error(`A porta ${porta} já está em uso: talvez a nuvem (ou o npm run erp) já esteja aberta.`)));
    // Ouve na rede local também, para PDVs e agentes de outros computadores alcançarem.
    servidor.listen(porta, '0.0.0.0', () => ok());
  });

  const janela = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Continuum Nuvem (ERP e Central)',
    backgroundColor: '#050a17',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  janela.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  await janela.loadURL(`http://localhost:${porta}`);
  app.on('before-quit', () => {
    servidor.close();
    void nuvem?.desligar();
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
      dialog.showErrorBox('Continuum Nuvem', `Não foi possível ligar a nuvem.\n\n${(erro as Error).message}`);
      void nuvem?.desligar();
      app.quit();
    });
}
