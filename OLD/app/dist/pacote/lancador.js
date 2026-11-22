import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
export function caminhosDoPacote(raiz) {
    const dados = path.join(raiz, 'dados');
    const logs = path.join(dados, 'logs');
    return {
        raiz,
        app: path.join(raiz, 'app'),
        envDemo: path.join(raiz, 'app', '.env.demo'),
        dados,
        logs,
        postgres: { bin: path.join(raiz, 'runtime', 'postgres', 'bin'), dados: path.join(dados, 'postgres'), log: path.join(logs, 'postgres.log') },
        bancoAplicacao: path.join(dados, 'lab', 'vendas.db'),
        bancoInterno: path.join(dados, 'lab', 'continuum.db'),
        perfilNavegador: path.join(dados, 'navegador'),
    };
}
/**
 * Raiz do pacote a partir da pasta do script: três níveis acima
 * fica a pasta com runtime/ e app/ (o script fica em app/dist/executaveis/). Fora do pacote (no repositório), não há
 * runtime/ ao lado, e a raiz precisa vir de --raiz.
 */
export function raizPeloScript(pastaDoScript) {
    const raiz = path.resolve(pastaDoScript, '..', '..', '..');
    return existsSync(path.join(raiz, 'runtime')) && existsSync(path.join(raiz, 'app')) ? raiz : null;
}
/**
 * Avisos sobre a pasta do pacote: OneDrive sincroniza e trava os arquivos do
 * banco; acentos e outros caracteres fora do ASCII já quebraram o initdb no
 * Windows. Não impede de rodar: só recomenda copiar para C:\continuum.
 */
export function avisosDoCaminho(raiz) {
    const avisos = [];
    if (/onedrive/i.test(raiz)) {
        avisos.push('a pasta está dentro do OneDrive, que pode travar os arquivos do banco');
    }
    if (/[^\x20-\x7e]/.test(raiz)) {
        avisos.push('o caminho da pasta tem acento ou caractere especial, que pode impedir o PostgreSQL de subir');
    }
    return avisos;
}
/**
 * O node.exe que roda este lançador é o do pacote? Só nesse caso dá para
 * reconhecer os processos do Continuum pelo executável sem atingir outros
 * programas Node da máquina. Os dois caminhos são resolvidos antes de comparar;
 * maiúsculas só são ignoradas no Windows (no Linux elas diferenciam, ADR 006).
 */
export function nodeDoPacote(raiz, execPath) {
    const normalizar = (caminho) => process.platform === 'win32' ? path.resolve(caminho).toLowerCase() : path.resolve(caminho);
    return normalizar(execPath).startsWith(normalizar(path.join(raiz, 'runtime')) + path.sep);
}
/**
 * Encerra processos que ficaram de uma execução anterior derrubada sem aviso
 * (lançador morto pelo Gerenciador de Tarefas): o sync é filho sem canal (ADR 012)
 * e continuaria rodando sozinho sobre o mesmo banco. Só no Windows e só com o
 * node.exe do pacote; devolve quantos encerrou. Falha aqui não impede de subir.
 */
export function encerrarOrfaos(raiz) {
    if (process.platform !== 'win32' || !nodeDoPacote(raiz, process.execPath))
        return Promise.resolve(0);
    const exe = path.resolve(process.execPath).replace(/'/g, "''");
    const comando = `$p = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ` +
        `Where-Object { $_.ExecutablePath -eq '${exe}' -and $_.ProcessId -ne ${process.pid} -and $_.ProcessId -ne ${process.ppid} }; ` +
        `$p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; @($p).Count`;
    return new Promise((resolve) => {
        execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', comando], { windowsHide: true, timeout: 30_000 }, (erro, saida) => {
            resolve(erro === null ? Number(saida.trim()) || 0 : 0);
        });
    });
}
/** Primeira porta livre em 127.0.0.1 a partir de `inicial`. */
export async function portaLivre(inicial, tentativas = 50) {
    for (let porta = inicial; porta < inicial + tentativas; porta++) {
        if (await consegueEscutar(porta))
            return porta;
    }
    throw new Error(`nenhuma porta livre entre ${inicial} e ${inicial + tentativas - 1}`);
}
function consegueEscutar(porta) {
    return new Promise((resolve) => {
        const servidor = net.createServer();
        servidor.once('error', () => resolve(false));
        servidor.listen({ host: '127.0.0.1', port: porta, exclusive: true }, () => servidor.close(() => resolve(true)));
    });
}
/** Lugares onde o Edge fica no Windows 10 e 11 (instalação de máquina ou de usuário). */
export function candidatosEdge(ambiente) {
    const bases = [ambiente['ProgramFiles(x86)'], ambiente.ProgramFiles, ambiente.LOCALAPPDATA].filter((base) => base !== undefined && base !== '');
    return bases.map((base) => path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
}
/** Argumentos do Edge: janela de aplicativo com perfil próprio, dentro da pasta do pacote. */
export function argumentosEdge(url, perfil) {
    return [`--app=${url}`, `--user-data-dir=${perfil}`, '--no-first-run', '--no-default-browser-check', '--start-maximized'];
}
/** Menos que isso e o Edge só repassou a URL para outra instância: não dá para esperar a janela. */
const VIDA_MINIMA_MS = 4000;
/** Abre o painel: no Edge em modo aplicativo, se houver; senão, no navegador padrão. */
export function abrirPainel(url, perfil) {
    const edge = candidatosEdge(process.env).find((caminho) => existsSync(caminho));
    if (edge === undefined) {
        abrirNoPadrao(url);
        return { controlada: false, fechada: new Promise(() => undefined), fechar: () => undefined };
    }
    const inicio = Date.now();
    const processo = spawn(edge, argumentosEdge(url, perfil), { stdio: 'ignore' });
    let controlada = true;
    const fechada = new Promise((resolve) => {
        processo.once('error', () => {
            controlada = false;
            abrirNoPadrao(url);
        });
        processo.once('exit', () => {
            if (Date.now() - inicio < VIDA_MINIMA_MS) {
                controlada = false;
                return; // repassou para outra instância: o console continua sendo o jeito de encerrar
            }
            resolve();
        });
    });
    return {
        get controlada() {
            return controlada;
        },
        fechada,
        fechar: () => {
            if (processo.exitCode === null)
                processo.kill();
        },
    };
}
function abrirNoPadrao(url) {
    if (process.platform === 'win32') {
        spawn('explorer.exe', [url], { stdio: 'ignore', detached: true }).unref();
    }
}
//# sourceMappingURL=lancador.js.map