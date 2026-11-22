import { lerVariavel } from '../compartilhado/ambiente.js';
import { PARAMETROS_LAB, validarParametros } from '../estado/maquina-de-estados.js';
export class ConfiguracaoInvalidaError extends Error {
    name = 'ConfiguracaoInvalidaError';
}
function exigir(ler, nome) {
    const valor = ler(nome);
    if (valor === undefined) {
        throw new ConfiguracaoInvalidaError(`variável ${nome} não definida (veja o .env.example)`);
    }
    return valor;
}
function inteiro(ler, nome, padrao, minimo) {
    const texto = ler(nome);
    if (texto === undefined) {
        return padrao;
    }
    const valor = Number(texto);
    if (!/^\d+$/.test(texto.trim()) || !Number.isSafeInteger(valor) || valor < minimo) {
        throw new ConfiguracaoInvalidaError(`${nome} inválida: "${texto}" (use um inteiro a partir de ${minimo})`);
    }
    return valor;
}
/** Parâmetros da máquina de estados (docs/estados.md); sem variável, valem os do LAB. */
function lerParametros(ler) {
    const parametros = {
        falhasParaOffline: inteiro(ler, 'CONTINUUM_FALHAS_PARA_OFFLINE', PARAMETROS_LAB.falhasParaOffline, 1),
        sucessosParaVoltar: inteiro(ler, 'CONTINUUM_SUCESSOS_PARA_VOLTAR', PARAMETROS_LAB.sucessosParaVoltar, 1),
        limiteFila: inteiro(ler, 'CONTINUUM_LIMITE_FILA', PARAMETROS_LAB.limiteFila, 0),
    };
    validarParametros(parametros);
    return parametros;
}
export function lerConfiguracaoOperador(ler = lerVariavel) {
    return {
        bancoInterno: exigir(ler, 'CONTINUUM_BANCO_INTERNO'),
        bancoAplicacao: ler('CONTINUUM_BANCO_APLICACAO'),
        parametros: lerParametros(ler),
    };
}
/** Variáveis das portas do LAB: a mensagem de porta ocupada diz qual mudar (ADR 013). */
export const VARIAVEIS_PORTA = {
    lab: 'CONTINUUM_LAB_PORTA',
    nuvem: 'CONTINUUM_LAB_NUVEM_PORTA',
    kryptonita: 'CONTINUUM_LAB_KRYPTONITA_PORTA',
};
/** Configuração do executável do LAB (`npm run lab`, ADR 013). O sync filho lê a dele (lerConfiguracaoSync). */
export function lerConfiguracaoLab(ler = lerVariavel) {
    const postgresBanco = ler('CONTINUUM_LAB_POSTGRES_BANCO') ?? 'continuum_lab';
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(postgresBanco)) {
        throw new ConfiguracaoInvalidaError(`CONTINUUM_LAB_POSTGRES_BANCO inválida: "${postgresBanco}" (letras minúsculas, números e _, ex.: continuum_lab)`);
    }
    return {
        postgresUrl: exigir(ler, 'CONTINUUM_POSTGRES_URL'),
        postgresBanco,
        // Padrões do .env.example: o LAB sobe só com a URL do PostgreSQL.
        bancoAplicacao: ler('CONTINUUM_BANCO_APLICACAO') ?? 'lab/vendas.db',
        bancoInterno: ler('CONTINUUM_BANCO_INTERNO') ?? 'lab/continuum.db',
        parametros: lerParametros(ler),
        portas: {
            lab: porta(ler, VARIAVEIS_PORTA.lab, 3000),
            nuvem: porta(ler, VARIAVEIS_PORTA.nuvem, 0),
            kryptonita: porta(ler, VARIAVEIS_PORTA.kryptonita, 0),
        },
    };
}
function porta(ler, nome, padrao) {
    const valor = inteiro(ler, nome, padrao, 0);
    if (valor > 65_535) {
        throw new ConfiguracaoInvalidaError(`${nome} inválida: ${valor} (use de 0 a 65535; 0 escolhe uma porta livre)`);
    }
    return valor;
}
/** Configuração do executável do sync (ADR 012), validada antes de abrir qualquer banco. */
export function lerConfiguracaoSync(ler = lerVariavel) {
    const nuvemUrl = exigir(ler, 'CONTINUUM_NUVEM_URL').replace(/\/+$/, '');
    if (!/^https?:\/\/[^/]+/.test(nuvemUrl)) {
        throw new ConfiguracaoInvalidaError(`CONTINUUM_NUVEM_URL inválida: "${nuvemUrl}" (ex.: http://127.0.0.1:3000)`);
    }
    const configuracao = {
        ...lerConfiguracaoOperador(ler),
        bancoAplicacao: exigir(ler, 'CONTINUUM_BANCO_APLICACAO'),
        nuvemUrl,
        healthIntervaloMs: inteiro(ler, 'CONTINUUM_HEALTH_INTERVALO_MS', 5000, 1),
        healthTimeoutMs: inteiro(ler, 'CONTINUUM_HEALTH_TIMEOUT_MS', 2000, 1),
        tamanhoLote: inteiro(ler, 'CONTINUUM_SYNC_TAMANHO_LOTE', 100, 1),
        envioTimeoutMs: inteiro(ler, 'CONTINUUM_SYNC_TIMEOUT_MS', 10_000, 1),
        backoff: {
            inicialMs: inteiro(ler, 'CONTINUUM_SYNC_BACKOFF_INICIAL_MS', 1000, 1),
            maximoMs: inteiro(ler, 'CONTINUUM_SYNC_BACKOFF_MAXIMO_MS', 60_000, 1),
        },
    };
    if (configuracao.healthTimeoutMs >= configuracao.healthIntervaloMs) {
        throw new ConfiguracaoInvalidaError(`CONTINUUM_HEALTH_TIMEOUT_MS (${configuracao.healthTimeoutMs}) deve ser menor que CONTINUUM_HEALTH_INTERVALO_MS (${configuracao.healthIntervaloMs}) (docs/estados.md)`);
    }
    if (configuracao.backoff.maximoMs < configuracao.backoff.inicialMs) {
        throw new ConfiguracaoInvalidaError('CONTINUUM_SYNC_BACKOFF_MAXIMO_MS deve ser maior ou igual a CONTINUUM_SYNC_BACKOFF_INICIAL_MS');
    }
    if (configuracao.tamanhoLote > 1000) {
        throw new ConfiguracaoInvalidaError(`CONTINUUM_SYNC_TAMANHO_LOTE deve ser no máximo 1000 (ADR 010)`);
    }
    return configuracao;
}
//# sourceMappingURL=configuracao.js.map