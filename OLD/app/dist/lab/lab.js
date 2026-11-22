import { fork, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirBanco } from '../banco/sqlite.js';
import { abrirBancoPostgres } from '../cloud-api/banco-postgres.js';
import { abrirBancoInterno, EstadoSqlite } from '../estado/estado-sqlite.js';
import { alertaDoEstado } from '../estado/maquina-de-estados.js';
import { VARIAVEIS_PORTA } from '../executaveis/configuracao.js';
import { GeradorDeCarga } from '../gerador/gerador.js';
import { RegistroEventosSqlite } from '../registro/registro-sqlite.js';
import { LabVendas } from '../vendas/lab-vendas.js';
import { criarAppLab } from './api.js';
/** Quanto da saída dos processos filhos guardar, para mostrar se um deles cair. */
const SAIDA_DOS_FILHOS_MAXIMA = 20_000;
/** Espera pelo encerramento de um filho antes de forçar. */
const ENCERRAMENTO_DO_FILHO_MS = 3000;
/** Espera pela nuvem subir (cria o esquema no PostgreSQL) e por cada resposta dela. */
const ESPERA_DA_NUVEM_MS = 30_000;
/** Porta já em uso: diz qual porta e qual variável muda (ADR 013). */
export class PortaOcupadaError extends Error {
    name = 'PortaOcupadaError';
    porta;
    variavel;
    constructor(porta, variavel) {
        super(`porta ${porta} ocupada: feche o programa que a usa ou escolha outra porta em ${variavel} (no .env)`);
        this.porta = porta;
        this.variavel = variavel;
    }
}
/**
 * Sobe o LAB (ADR 013): a aplicação de vendas com o gerador de carga e a API
 * do painel neste processo; a nuvem (cloud-api e Kryptonita) e o sync como
 * processos filhos, para que a carga da loja não atrase a nuvem. Se uma parte
 * falhar ao subir, fecha as que já subiram e repassa o erro.
 */
export async function iniciarLab(opcoes) {
    const fechamentos = [];
    const fecharTudo = async () => {
        for (const fechar of fechamentos.reverse().splice(0)) {
            await fechar();
        }
    };
    let saida = '';
    const guardarSaida = (texto) => {
        saida = (saida + texto).slice(-SAIDA_DOS_FILHOS_MAXIMA);
        if (opcoes.ecoarFilhos !== false)
            process.stderr.write(texto);
    };
    try {
        // Bancos locais antes do sync: o esquema, a origem e a linha de estado ficam criados por um processo só.
        const bancoAplicacao = abrirSqlite(opcoes.bancoAplicacao, abrirBanco);
        fechamentos.push(() => bancoAplicacao.fechar());
        const lab = new LabVendas(bancoAplicacao);
        const gerador = new GeradorDeCarga(lab);
        fechamentos.push(() => gerador.atual?.parar());
        const bancoInterno = abrirSqlite(opcoes.bancoInterno, abrirBancoInterno);
        fechamentos.push(() => bancoInterno.fechar());
        const registro = new RegistroEventosSqlite(bancoInterno);
        const estado = new EstadoSqlite(bancoInterno, registro, { parametros: opcoes.parametros });
        // Só para os números do painel; a nuvem de verdade roda no processo filho.
        const nuvemBanco = abrirBancoPostgres(opcoes.postgresUrl, { maxConexoes: 2 });
        fechamentos.push(() => nuvemBanco.fechar());
        const { controle: nuvem, kryptonitaUrl, filho: filhoNuvem } = await iniciarNuvem(opcoes, guardarSaida);
        fechamentos.push(() => filhoNuvem.parar());
        const sync = iniciarFilho('sync', opcoes.scriptSync ?? emDist('sync.js'), opcoes, guardarSaida, {
            ...opcoes.ambienteSync,
            CONTINUUM_BANCO_APLICACAO: path.resolve(opcoes.bancoAplicacao),
            CONTINUUM_BANCO_INTERNO: path.resolve(opcoes.bancoInterno),
            CONTINUUM_NUVEM_URL: kryptonitaUrl,
        });
        fechamentos.push(() => sync.parar());
        const origemId = lab.outbox.origemId;
        const situacao = async () => {
            const atual = estado.ler();
            return {
                estado: atual.estado,
                modo: atual.modo,
                alerta: alertaDoEstado(atual.estado),
                falhasSeguidas: atual.falhasSeguidas,
                sucessosSeguidos: atual.sucessosSeguidos,
                proposta: atual.proposta,
                bloqueio: atual.bloqueio,
                alteradoEm: atual.alteradoEm,
                local: contarLocal(bancoAplicacao),
                nuvem: await contarNuvem(nuvemBanco, origemId),
                kryptonita: { queda: nuvem.queda, rodando: nuvem.rodando() },
                geracao: gerador.atual?.situacao() ?? null,
                sync: { rodando: sync.rodando() },
            };
        };
        const app = criarAppLab({ situacao, gerador, nuvem, estado });
        const servidor = await new Promise((resolve, reject) => {
            const s = app.listen(opcoes.portas.lab, '127.0.0.1', (erro) => {
                if (erro === undefined)
                    resolve(s);
                else
                    reject(erro.code === 'EADDRINUSE' ? new PortaOcupadaError(opcoes.portas.lab, VARIAVEIS_PORTA.lab) : erro);
            });
        });
        fechamentos.push(() => new Promise((resolve, reject) => {
            servidor.close((erro) => (erro ? reject(erro) : resolve()));
            servidor.closeAllConnections();
        }));
        return {
            url: `http://127.0.0.1:${servidor.address().port}`,
            kryptonitaUrl,
            nuvem,
            gerador,
            estado,
            registro,
            bancoAplicacao,
            bancoNuvem: nuvemBanco,
            origemId,
            situacao,
            saidaDosFilhos: () => saida,
            fechar: fecharTudo,
        };
    }
    catch (erro) {
        await fecharTudo();
        throw erro;
    }
}
const emDist = (arquivo) => fileURLToPath(new URL(`../executaveis/${arquivo}`, import.meta.url));
function abrirSqlite(caminho, abrir) {
    if (caminho !== ':memory:') {
        mkdirSync(path.dirname(path.resolve(caminho)), { recursive: true });
    }
    return abrir(caminho);
}
function contarLocal(banco) {
    // count(*) varreria as tabelas a cada consulta do painel. O número da venda e a
    // seq da outbox começam em 1 e não têm lacunas (ADR 004; nada é apagado), então
    // o maior valor é a contagem, lida direto do índice. Pendentes: índice parcial.
    const linha = banco.consultarUma(`SELECT (SELECT COALESCE(MAX(numero), 0) FROM vendas) AS vendas,
            (SELECT COALESCE(MAX(seq), 0) FROM outbox) AS eventos,
            (SELECT count(*) FROM outbox WHERE sincronizado_em IS NULL) AS pendentes`);
    return { vendas: Number(linha?.['vendas']), eventos: Number(linha?.['eventos']), pendentes: Number(linha?.['pendentes']) };
}
async function contarNuvem(banco, origemId) {
    try {
        const linha = await banco.consultarUma(`SELECT (SELECT ultima_seq FROM origens WHERE id = $1) AS eventos,
              (SELECT count(*)::int FROM vendas) AS vendas`, origemId);
        return { eventos: Number(linha?.['eventos'] ?? 0), vendas: Number(linha?.['vendas'] ?? 0) };
    }
    catch {
        return null; // PostgreSQL fora do ar: o painel mostra "sem resposta", e o LAB continua
    }
}
/**
 * Um executável do LAB como processo filho, com a saída guardada. Com IPC
 * (fork), o filho encerra sozinho quando o canal fecha; sem IPC (spawn), nada
 * o segura vivo depois do SIGTERM.
 */
function iniciarFilho(nome, script, opcoes, guardarSaida, ambiente, ipc = false) {
    const config = { env: { ...process.env, ...ambiente }, stdio: ['ignore', 'pipe', 'pipe'] };
    const execArgv = [...(opcoes.execArgvFilhos ?? [])];
    const processo = ipc
        ? fork(script, [], { ...config, execArgv, stdio: [...config.stdio, 'ipc'] })
        : spawn(process.execPath, [...execArgv, script], config);
    let vivo = true;
    let parando = false;
    processo.stdout?.on('data', (parte) => guardarSaida(parte.toString('utf8')));
    processo.stderr?.on('data', (parte) => guardarSaida(parte.toString('utf8')));
    const saiu = new Promise((resolve) => {
        processo.on('exit', (codigo, sinal) => {
            if (!parando)
                guardarSaida(`[lab] ${nome} terminou sozinho (${codigo ?? sinal}); o painel mostra "${nome} parado"\n`);
            vivo = false;
            resolve();
        });
    });
    return {
        processo,
        rodando: () => vivo,
        saiu,
        parar: async () => {
            if (!vivo || parando)
                return saiu;
            parando = true;
            // SIGTERM deixa o filho fechar o que abriu (no Windows, já encerra na hora).
            // Se não sair a tempo, SIGKILL: o estado gravado aguenta queda (ADR 012).
            processo.kill('SIGTERM');
            const prazo = setTimeout(() => processo.kill('SIGKILL'), ENCERRAMENTO_DO_FILHO_MS);
            await saiu;
            clearTimeout(prazo);
        },
    };
}
/** Sobe o processo da nuvem e espera a Kryptonita ficar pronta (ADR 013). */
async function iniciarNuvem(opcoes, guardarSaida) {
    const filho = iniciarFilho('nuvem', opcoes.scriptNuvem ?? emDist('nuvem.js'), opcoes, guardarSaida, {
        CONTINUUM_LAB_NUVEM_POSTGRES_URL: opcoes.postgresUrl,
        CONTINUUM_LAB_NUVEM_PORTA: String(opcoes.portas.nuvem),
        CONTINUUM_LAB_KRYPTONITA_PORTA: String(opcoes.portas.kryptonita),
    }, true);
    const ouvintes = new Set();
    filho.processo.on('message', (mensagem) => ouvintes.forEach((ouvir) => ouvir(mensagem)));
    const esperar = (escolher, oQue) => new Promise((resolve, reject) => {
        const terminar = (erro, valor) => {
            ouvintes.delete(ouvir);
            clearTimeout(prazo);
            if (erro === null)
                resolve(valor);
            else
                reject(erro);
        };
        const ouvir = (mensagem) => {
            try {
                const valor = escolher(mensagem);
                if (valor !== undefined)
                    terminar(null, valor);
            }
            catch (erro) {
                terminar(erro);
            }
        };
        const prazo = setTimeout(() => terminar(new Error(`a nuvem do LAB não respondeu (${oQue})`)), ESPERA_DA_NUVEM_MS);
        ouvintes.add(ouvir);
        void filho.saiu.then(() => terminar(new Error(`a nuvem do LAB terminou (${oQue}); veja a saída acima`)));
    });
    try {
        const kryptonitaUrl = await esperar((mensagem) => {
            if (mensagem.tipo === 'pronto')
                return mensagem.kryptonitaUrl;
            if (mensagem.tipo === 'porta-ocupada') {
                const variavel = mensagem.parte === 'nuvem' ? VARIAVEIS_PORTA.nuvem : VARIAVEIS_PORTA.kryptonita;
                throw new PortaOcupadaError(mensagem.porta, variavel);
            }
            if (mensagem.tipo === 'erro')
                throw new Error(`a nuvem do LAB não subiu: ${mensagem.erro}`);
            return undefined;
        }, 'subindo');
        let queda = null;
        let proximoId = 1;
        const pedir = async (pedido) => {
            const id = proximoId++;
            const resposta = esperar((m) => (m.tipo === 'queda' && m.id === id ? m : undefined), pedido.tipo);
            filho.processo.send({ ...pedido, id });
            const mensagem = await resposta;
            queda = mensagem.queda;
            return { queda, envios: mensagem.envios };
        };
        const controle = {
            get queda() {
                return queda;
            },
            rodando: filho.rodando,
            derrubar: async (tipo) => (await pedir({ tipo: 'derrubar', queda: tipo })).queda,
            restaurar: async () => (await pedir({ tipo: 'restaurar' })).queda,
            envios: async () => (await pedir({ tipo: 'contar' })).envios,
        };
        return { controle, kryptonitaUrl, filho };
    }
    catch (erro) {
        await filho.parar();
        throw erro;
    }
}
//# sourceMappingURL=lab.js.map