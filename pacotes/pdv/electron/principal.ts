// O PDV instalado (Electron). Ao abrir o programa:
// 1. abre o banco do caixa (caixa.db) na pasta de dados do Windows deste usuário;
// 2. liga um servidor só para este computador (127.0.0.1): as telas e a API do caixa;
// 3. abre a janela do PDV apontando para esse servidor.
// As telas e as regras são exatamente as mesmas do navegador (Passo 1.4). Nada vem da internet.
import { app, BrowserWindow, dialog } from 'electron';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { abrirBancoDoCaixa, Caixa } from '../src/caixa.ts';
import { criarApi } from '../src/servidor/api.ts';
import { caixaAtivado, middlewareDeAtivacao } from '../src/ativacao.ts';
import { middlewareDaApi } from '../src/servidor/http.ts';
import { destinoDaFila, ligarSincronizacao } from '../src/sincronizacao.ts';
import type { Sincronizacao } from '../src/sincronizacao.ts';

const PASTA_TELAS = path.join(import.meta.dirname, 'web');

const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

/** Liga o servidor do caixa e devolve o endereço. */
function ligarServidor(caixa: Caixa, sincronizacao: () => Sincronizacao | null, aoAtivar: () => void): Promise<string> {
  const ativacao = middlewareDeAtivacao(caixa, aoAtivar);
  const api = middlewareDaApi(criarApi(caixa, sincronizacao));
  const servidor = createServer((req, res) => {
    ativacao(req, res, () => api(req, res, () => {
      // Arquivos das telas. Qualquer caminho desconhecido volta para a tela principal.
      const pedido = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
      let arquivo = path.join(PASTA_TELAS, pedido);
      if (!arquivo.startsWith(PASTA_TELAS) || !existsSync(arquivo) || statSync(arquivo).isDirectory()) {
        arquivo = path.join(PASTA_TELAS, 'index.html');
      }
      res.setHeader('Content-Type', TIPOS[path.extname(arquivo)] ?? 'application/octet-stream');
      createReadStream(arquivo).pipe(res);
    }));
  });
  return new Promise((resolver) => {
    servidor.listen(Number(process.env['CONTINUUM_PDV_PORTA'] ?? 0), '127.0.0.1', () => resolver(`http://127.0.0.1:${(servidor.address() as AddressInfo).port}`));
  });
}

function lerEnderecoDoAgente(pasta: string): string | null {
  const arquivo = path.join(pasta, 'agente.txt');
  if (!existsSync(arquivo)) return null;
  const linha = readFileSync(arquivo, 'utf8').trim();
  return linha === '' ? null : linha.replace(/\/+$/, '');
}

async function iniciar(): Promise<void> {
  // CONTINUUM_PDV_DADOS e CONTINUUM_PDV_PORTA existem só para testes; no uso normal ficam vazios.
  const pastaDeDados = process.env['CONTINUUM_PDV_DADOS'] ?? app.getPath('userData');
  mkdirSync(pastaDeDados, { recursive: true });
  const arquivoDoBanco = path.join(pastaDeDados, 'caixa.db');
  const banco = abrirBancoDoCaixa(arquivoDoBanco);
  const caixa = new Caixa(banco);
  // A fila vai para o agente da loja, depois que o caixa for ativado (código do ERP ou modo demonstração).
  // O endereço vem de agente.txt na pasta de dados (uma linha, ex.: http://192.168.0.10:5180) ou de
  // CONTINUUM_AGENTE_URL; sem nada, o agente deste computador.
  // Sem agente informado, um caixa ativado pelo ERP envia direto para a nuvem (formato MEI).
  let sincronizacao: Sincronizacao | null = null;
  const ligar = () => {
    const { destino, credencial } = destinoDaFila(caixa, process.env['CONTINUUM_AGENTE_URL'] ?? lerEnderecoDoAgente(pastaDeDados));
    sincronizacao ??= ligarSincronizacao(caixa, destino, credencial === undefined ? {} : { credencial });
  };
  if (caixaAtivado(caixa)) ligar();
  const endereco = await ligarServidor(caixa, () => sincronizacao, ligar);

  const janela = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 1024,
    minHeight: 640,
    title: 'Continuum PDV',
    backgroundColor: '#050a17', // o mesmo fundo do tema escuro, para não piscar branco ao abrir
    autoHideMenuBar: true,
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  // O comprovante abre numa janela própria; qualquer outro endereço é bloqueado.
  janela.webContents.setWindowOpenHandler(({ url }) =>
    url.startsWith(`${endereco}/comprovante/`)
      ? { action: 'allow', overrideBrowserWindowOptions: { width: 420, height: 720, autoHideMenuBar: true, title: 'Comprovante' } }
      : { action: 'deny' },
  );
  janela.once('ready-to-show', () => {
    janela.maximize();
    janela.show();
  });
  await janela.loadURL(endereco);
  app.on('before-quit', () => {
    void sincronizacao?.parar();
    banco.fechar();
  });
}

// Um caixa só por computador: abrir de novo traz a janela que já está aberta.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const janela = BrowserWindow.getAllWindows()[0];
    if (janela !== undefined) {
      if (janela.isMinimized()) janela.restore();
      janela.focus();
    }
  });
  app.on('window-all-closed', () => app.quit());
  app
    .whenReady()
    .then(iniciar)
    .catch((erro: unknown) => {
      dialog.showErrorBox('Continuum PDV', `Não foi possível abrir o caixa.\n\n${(erro as Error).message}`);
      app.quit();
    });
}
