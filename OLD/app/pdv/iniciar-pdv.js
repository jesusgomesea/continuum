// Lançador do PDV: abre o banco local da loja, sobe a API do caixa em 127.0.0.1
// e abre a tela numa janela própria do Edge (perfil separado do Dashboard).
//
//   runtime\node\node.exe app\pdv\iniciar-pdv.js [--porta 3100] [--caixa "Caixa 01"] [--sem-janela]
//
// O PDV vende com ou sem o Continuum aberto (Local First): as vendas ficam na
// outbox e o Sync Engine do LAB envia quando estiver rodando.
import { copyFileSync, existsSync, linkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { abrirBanco } from '../dist/banco/sqlite.js';
import { abrirPainel, avisosDoCaminho, caminhosDoPacote, nodeDoPacote, portaLivre } from '../dist/pacote/lancador.js';
import { CaixaPdv } from './caixa.js';
import { acompanharLab, criarServidorPdv } from './servidor.js';

const USO = `uso: iniciar-pdv [--porta <n>] [--caixa <nome>] [--sem-janela] [--raiz <pasta do pacote>]
  --porta       primeira porta tentada (padrão: 3100)
  --caixa       nome do caixa no cupom (padrão: Caixa 01)
  --sem-janela  não abre o Edge (para testes)`;
/** Nome do processo do PDV: o iniciar-continuum encerra os "node.exe" do pacote ao subir. */
export const NOME_PROCESSO = 'continuum-pdv.exe';
const dizer = (linha) => process.stdout.write(`${linha}\n`);
const script = fileURLToPath(import.meta.url);

async function principal() {
  const { values } = parseArgs({
    options: {
      porta: { type: 'string', default: '3100' },
      caixa: { type: 'string', default: 'Caixa 01' },
      raiz: { type: 'string' },
      'sem-janela': { type: 'boolean', default: false },
      ajuda: { type: 'boolean', default: false },
    },
  });
  if (values.ajuda) { dizer(USO); return 0; }
  const raiz = path.resolve(values.raiz ?? path.join(path.dirname(script), '..', '..'));
  if (!existsSync(path.join(raiz, 'app', 'dist'))) {
    dizer(`pasta do pacote não encontrada em ${raiz}: use --raiz`);
    return 1;
  }

  // Rodando como node.exe do pacote: troca para o mesmo Node com outro nome, para o
  // iniciar-continuum (que encerra os node.exe órfãos do pacote ao subir) não derrubar o caixa.
  if (process.platform === 'win32' && nodeDoPacote(raiz, process.execPath)
      && path.basename(process.execPath).toLowerCase() === 'node.exe') {
    return relancar(process.execPath);
  }

  const portaInicial = Number(values.porta);
  if (!Number.isInteger(portaInicial) || portaInicial < 1 || portaInicial > 65_000) {
    dizer(`porta inválida: ${values.porta}\n${USO}`);
    return 1;
  }
  for (const aviso of avisosDoCaminho(raiz)) dizer(`aviso: ${aviso}; recomendado copiar o pacote para C:\\continuum`);

  const c = caminhosDoPacote(raiz);
  const banco = abrirBanco(c.bancoAplicacao);
  const caixa = new CaixaPdv(banco, { nome: values.caixa, arquivoCaixa: path.join(c.dados, 'pdv', 'vendas-do-caixa.jsonl') });
  const lab = acompanharLab();
  const servidor = criarServidorPdv({ caixa, lab });
  const porta = await portaLivre(portaInicial);
  await new Promise((resolve, reject) => servidor.listen(porta, '127.0.0.1', resolve).once('error', reject));
  const url = `http://127.0.0.1:${porta}`;

  let encerrado = false;
  const encerrar = async () => {
    if (encerrado) return;
    encerrado = true;
    lab.parar();
    await new Promise((resolve) => { servidor.close(() => resolve()); servidor.closeAllConnections(); });
    banco.fechar();
  };
  for (const sinal of ['SIGINT', 'SIGBREAK', 'SIGHUP', 'SIGTERM']) {
    process.on(sinal, () => void encerrar().then(() => process.exit(0)));
  }

  dizer(`Continuum PDV · ${caixa.nome}`);
  dizer(`banco da loja: ${c.bancoAplicacao}`);
  dizer(`PDV: ${url}`);
  if (values['sem-janela']) {
    dizer('Para encerrar: Ctrl+C.');
    await new Promise(() => undefined);
  }
  const janela = abrirPainel(url, path.join(c.dados, 'navegador-pdv'));
  dizer('Para encerrar, feche a janela do PDV ou este console (Ctrl+C).');
  await janela.fechada;
  dizer('janela do PDV fechada: encerrando…');
  await encerrar();
  return 0;
}

/** Garante runtime\node\continuum-pdv.exe (link para o node.exe, sem ocupar espaço) e roda o PDV nele. */
export function garantirNodeDoPdv(nodeExe) {
  const destino = path.join(path.dirname(nodeExe), NOME_PROCESSO);
  if (!existsSync(destino)) {
    try { linkSync(nodeExe, destino); } catch { copyFileSync(nodeExe, destino); }
  }
  return destino;
}

function relancar(nodeExe) {
  const exe = garantirNodeDoPdv(nodeExe);
  for (const sinal of ['SIGINT', 'SIGBREAK', 'SIGHUP', 'SIGTERM']) process.on(sinal, () => {});
  return new Promise((resolve) => {
    const filho = spawn(exe, [script, ...process.argv.slice(2)], { stdio: 'inherit' });
    filho.on('error', (erro) => { dizer(`não foi possível iniciar ${exe}: ${erro.message}`); resolve(1); });
    filho.on('exit', (codigo) => resolve(codigo ?? 1));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === script) {
  principal().then((codigo) => { process.exitCode = codigo; }, (erro) => {
    dizer(`erro: ${erro instanceof Error ? erro.message : String(erro)}`);
    process.exitCode = 1;
  });
}
