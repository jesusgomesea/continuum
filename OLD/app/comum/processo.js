// Código comum aos aplicativos à parte (PDV, ERP): rodar com o Node do pacote sob
// outro nome de processo e acompanhar o LAB.
//
// Por que outro nome: ao subir, o iniciar-continuum encerra os "node.exe" do pacote
// que sobraram de uma execução anterior. Rodando como continuum-pdv.exe ou
// continuum-erp.exe (link para o mesmo node.exe, sem ocupar espaço), o aplicativo
// não é derrubado por isso.
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, linkSync } from 'node:fs';
import path from 'node:path';
import { nodeDoPacote } from '../dist/pacote/lancador.js';

/** Garante <pasta do node.exe>\<nome> (link para o node.exe; se não der, cópia). */
export function garantirNodeComNome(nodeExe, nome) {
  const destino = path.join(path.dirname(nodeExe), nome);
  if (!existsSync(destino)) {
    try { linkSync(nodeExe, destino); } catch { copyFileSync(nodeExe, destino); }
  }
  return destino;
}

/**
 * Se este processo é o node.exe do pacote, roda o mesmo script no Node com outro
 * nome e devolve a promessa do código de saída; senão, devolve null (seguir aqui).
 */
export function relancarComNome(raiz, script, nome) {
  if (process.platform !== 'win32' || !nodeDoPacote(raiz, process.execPath)) return null;
  if (path.basename(process.execPath).toLowerCase() !== 'node.exe') return null;
  const exe = garantirNodeComNome(process.execPath, nome);
  for (const sinal of ['SIGINT', 'SIGBREAK', 'SIGHUP', 'SIGTERM']) process.on(sinal, () => {});
  return new Promise((resolve) => {
    const filho = spawn(exe, [script, ...process.argv.slice(2)], { stdio: 'inherit' });
    filho.on('error', (erro) => { process.stdout.write(`não foi possível iniciar ${exe}: ${erro.message}\n`); resolve(1); });
    filho.on('exit', (codigo) => resolve(codigo ?? 1));
  });
}

/**
 * Acompanha o LAB pela /api/situacao (só leitura, para mostrar a conexão).
 * Os aplicativos funcionam com ou sem o LAB: é o Local First. Procura a porta a partir de 3000.
 */
export function acompanharLab({ portas = Array.from({ length: 10 }, (_, i) => 3000 + i), intervaloMs = 1000 } = {}) {
  let porta = null;
  let ultima = null;
  let ocupado = false;
  const consultar = async (p) => {
    const r = await fetch(`http://127.0.0.1:${p}/api/situacao`, { signal: AbortSignal.timeout(800) });
    if (!r.ok) throw new Error(String(r.status));
    const s = await r.json();
    if (typeof s?.estado !== 'string' || typeof s?.kryptonita !== 'object') throw new Error('não é o LAB');
    return s;
  };
  const passo = async () => {
    if (ocupado) return;
    ocupado = true;
    try {
      if (porta !== null) {
        try { ultima = await consultar(porta); return; } catch { porta = null; }
      }
      for (const p of portas) {
        try { ultima = await consultar(p); porta = p; return; } catch { /* próxima */ }
      }
      ultima = null;
    } finally {
      ocupado = false;
    }
  };
  void passo();
  const timer = setInterval(() => void passo(), intervaloMs);
  timer.unref();
  return {
    situacao: () => ultima,
    get url() { return porta === null ? null : `http://127.0.0.1:${porta}`; },
    parar: () => clearInterval(timer),
  };
}
