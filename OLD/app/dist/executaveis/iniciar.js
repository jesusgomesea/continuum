import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { executarCenario } from '../lab/cenario.js';
import { iniciarLab } from '../lab/lab.js';
import { prepararBancoDoLab } from '../lab/postgres-do-lab.js';
import { portaEmUso, zerarLab } from '../lab/reset.js';
import { abrirPainel, avisosDoCaminho, caminhosDoPacote, encerrarOrfaos, portaLivre, raizPeloScript, } from '../pacote/lancador.js';
import * as postgres from '../pacote/postgres-portatil.js';
import { lerConfiguracaoLab } from './configuracao.js';
/**
 * Lançador do pacote portátil (ADR 014). O iniciar-continuum.exe chama este
 * script com o node.exe do pacote; sem o .exe, o mesmo comando é o plano B:
 *   runtime\node\node.exe app\dist\executaveis\iniciar.js
 * Sobe o PostgreSQL portátil (criando o banco na primeira execução), o LAB com
 * o perfil da demo e abre o painel. Fechar a janela do painel, o console ou
 * Ctrl+C encerra tudo. Com --verificar, roda um cenário curto sem navegador e
 * grava dados/logs/verificacao.json.
 */
const USO = `uso: iniciar-continuum [--verificar] [--raiz <pasta do pacote>] [--porta <n>]
  --verificar   sobe tudo sem navegador, roda um cenário curto, encerra e confere
  --raiz        pasta do pacote (padrão: a pasta onde este programa está)
  --porta       primeira porta tentada para o painel (padrão: 3000)`;
const PORTA_LAB = 3000;
const PORTA_POSTGRES = 55432;
/** Cenário do --verificar: curto, mas com vendas antes, durante e depois da queda. */
const VENDAS_VERIFICACAO = 300;
const RITMO_VERIFICACAO = 50;
const LIMITE_VERIFICACAO_MS = 180_000;
const dizer = (linha) => {
    process.stdout.write(`${linha}\n`);
};
async function principal() {
    const { values } = parseArgs({
        options: {
            verificar: { type: 'boolean', default: false },
            raiz: { type: 'string' },
            porta: { type: 'string', default: String(PORTA_LAB) },
            ajuda: { type: 'boolean', default: false },
        },
    });
    if (values.ajuda) {
        dizer(USO);
        return 0;
    }
    const portaInicial = Number(values.porta);
    if (!Number.isInteger(portaInicial) || portaInicial < 1 || portaInicial > 65_000) {
        dizer(`porta inválida: ${values.porta}\n${USO}`);
        return 1;
    }
    const raiz = values.raiz !== undefined ? path.resolve(values.raiz) : raizPeloScript(path.dirname(fileURLToPath(import.meta.url)));
    if (raiz === null) {
        dizer(`não achei a pasta do pacote (runtime e app) ao redor deste script\n${USO}`);
        return 1;
    }
    const c = caminhosDoPacote(raiz);
    for (const aviso of avisosDoCaminho(raiz)) {
        dizer(`atenção: ${aviso}. Se algo falhar, copie a pasta para C:\\continuum e rode de lá.`);
    }
    mkdirSync(c.logs, { recursive: true });
    // Nenhum .env de fora do pacote entra: o LAB lê o .env da pasta atual.
    process.chdir(c.dados);
    if (existsSync(c.envDemo))
        process.loadEnvFile(c.envDemo);
    dizer('Continuum LAB: preparando…');
    const orfaos = await encerrarOrfaos(raiz);
    if (orfaos > 0)
        dizer(`${orfaos} processo(s) de uma execução anterior foram encerrados`);
    if (await postgres.pararSeVivo(c.postgres))
        dizer('um PostgreSQL da execução anterior estava no ar e foi parado');
    if (await postgres.inicializarSeNecessario(c.postgres))
        dizer('banco criado (primeira execução)');
    const portaPostgres = await portaLivre(PORTA_POSTGRES);
    await postgres.subir(c.postgres, portaPostgres);
    let lab = null;
    let janela = null;
    let encerrando = null;
    const encerrar = () => {
        encerrando ??= (async () => {
            janela?.fechar();
            if (lab !== null) {
                await lab.fechar().catch((erro) => dizer(`aviso ao encerrar o LAB: ${mensagem(erro)}`));
            }
            await postgres.parar(c.postgres).catch((erro) => dizer(`aviso ao parar o PostgreSQL: ${mensagem(erro)}`));
        })();
        return encerrando;
    };
    // SIGHUP: console fechado no Windows (há ~5 s para encerrar); SIGBREAK: Ctrl+Break.
    for (const sinal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
        process.on(sinal, () => {
            dizer('encerrando…');
            void encerrar().then(() => process.exit(process.exitCode ?? 0));
        });
    }
    try {
        process.env.CONTINUUM_POSTGRES_URL = postgres.urlPortatil(portaPostgres);
        const base = lerConfiguracaoLab();
        if (values.verificar) {
            return await verificar(c, base, portaPostgres, (l) => (lab = l), encerrar);
        }
        const configuracao = {
            ...base,
            bancoAplicacao: c.bancoAplicacao,
            bancoInterno: c.bancoInterno,
            portas: { lab: await portaLivre(portaInicial), nuvem: 0, kryptonita: 0 },
        };
        const postgresUrl = await prepararBancoDoLab(configuracao.postgresUrl, configuracao.postgresBanco);
        lab = await iniciarLab({ ...configuracao, postgresUrl });
        dizer(`painel: ${lab.url}`);
        janela = abrirPainel(lab.url, c.perfilNavegador);
        dizer('Para encerrar, feche a janela do painel ou este console (Ctrl+C).');
        await janela.fechada;
        dizer('janela do painel fechada: encerrando…');
        await encerrar();
        return 0;
    }
    catch (erro) {
        await encerrar();
        throw erro;
    }
}
/**
 * Cenário curto com bancos próprios (não mexe nos dados da demo): vendas, queda,
 * OFFLINE, volta, SAUDÁVEL e nuvem igual à loja. Depois encerra e confere que o
 * LAB, a Kryptonita e o PostgreSQL não ficaram escutando.
 */
async function verificar(c, base, portaPostgres, registrarLab, encerrar) {
    const inicio = Date.now();
    const configuracao = {
        ...base,
        postgresBanco: 'continuum_verificacao',
        bancoAplicacao: path.join(c.dados, 'verificacao', 'vendas.db'),
        bancoInterno: path.join(c.dados, 'verificacao', 'continuum.db'),
        portas: { lab: 0, nuvem: 0, kryptonita: 0 },
    };
    await zerarLab(configuracao);
    const postgresUrl = await prepararBancoDoLab(configuracao.postgresUrl, configuracao.postgresBanco);
    const lab = await iniciarLab({ ...configuracao, postgresUrl });
    registrarLab(lab);
    const portas = [Number(new URL(lab.url).port), Number(new URL(lab.kryptonitaUrl).port), portaPostgres];
    let cenario = null;
    let erro = null;
    try {
        cenario = await executarCenario(lab, {
            vendas: VENDAS_VERIFICACAO,
            ritmo: RITMO_VERIFICACAO,
            limiteMs: LIMITE_VERIFICACAO_MS,
            log: (linha) => dizer(`[verificar] ${linha}`),
        });
    }
    catch (falha) {
        erro = `${mensagem(falha)}\n${lab.saidaDosFilhos()}`;
    }
    await encerrar();
    const portasAbertas = [];
    for (const porta of portas) {
        if (await portaEmUso(porta))
            portasAbertas.push(porta);
    }
    const postgresFicou = existsSync(path.join(c.postgres.dados, 'postmaster.pid'));
    const aprovado = cenario?.aprovado === true && portasAbertas.length === 0 && !postgresFicou;
    const relatorio = {
        aprovado,
        quando: new Date().toISOString(),
        duracaoMs: Date.now() - inicio,
        raiz: c.raiz,
        node: process.version,
        erro,
        encerramento: { portasAbertas, postgresFicou },
        cenario,
    };
    writeFileSync(path.join(c.logs, 'verificacao.json'), `${JSON.stringify(relatorio, null, 2)}\n`);
    dizer(`verificação: ${aprovado ? 'APROVADA' : 'REPROVADA'}` +
        (cenario === null ? '' : ` (cenário ${cenario.aprovado ? 'aprovado' : 'reprovado'}, ${cenario.vendasFeitas} vendas, ${cenario.vendas.emOffline} em OFFLINE)`) +
        (portasAbertas.length > 0 ? `; portas ainda abertas: ${portasAbertas.join(', ')}` : '') +
        (postgresFicou ? '; o PostgreSQL não parou' : '') +
        (erro === null ? '' : `; erro: ${erro.split('\n')[0]}`));
    dizer(`relatório: ${path.join(c.logs, 'verificacao.json')}`);
    return aprovado ? 0 : 1;
}
const mensagem = (erro) => (erro instanceof Error ? erro.message : String(erro));
principal().then((codigo) => {
    process.exitCode = codigo;
    // Handles de rede do pg podem segurar o processo alguns segundos; o trabalho acabou.
    setTimeout(() => process.exit(codigo), 2000).unref();
}, (erro) => {
    process.stderr.write(`[iniciar] não foi possível subir o Continuum: ${mensagem(erro)}\n`);
    process.exit(1);
});
//# sourceMappingURL=iniciar.js.map