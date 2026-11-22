export const ESTADOS = ['saudavel', 'degradado', 'offline', 'recuperando', 'sincronizando'];
export const MODOS = ['automatico', 'manual', 'local-forcado'];
/** Parâmetros do LAB (docs/estados.md). */
export const PARAMETROS_LAB = { falhasParaOffline: 3, sucessosParaVoltar: 5, limiteFila: 10 };
export const SITUACAO_INICIAL = Object.freeze({
    estado: 'saudavel',
    modo: 'automatico',
    falhasSeguidas: 0,
    sucessosSeguidos: 0,
    proposta: null,
});
/** As transições permitidas (docs/estados.md); qualquer outra é proibida. */
const PERMITIDAS = new Set([
    'saudavel>degradado',
    'degradado>saudavel',
    'degradado>sincronizando',
    'degradado>offline',
    'offline>recuperando',
    'recuperando>offline',
    'recuperando>sincronizando',
    'sincronizando>saudavel',
    'sincronizando>degradado',
]);
export class TransicaoProibidaError extends Error {
    name = 'TransicaoProibidaError';
}
export function transicaoPermitida(de, para) {
    return PERMITIDAS.has(`${de}>${para}`);
}
export function exigirTransicaoPermitida(de, para) {
    if (!transicaoPermitida(de, para)) {
        throw new TransicaoProibidaError(`transição proibida: ${de} -> ${para} (docs/estados.md)`);
    }
}
/** O sync só envia nestes estados, e nunca em LOCAL FORÇADO (ADR 012). */
export function syncEnvia(estado, modo) {
    return modo !== 'local-forcado' && (estado === 'saudavel' || estado === 'degradado' || estado === 'sincronizando');
}
/**
 * Uma fonte de evidência por vez (ADR 012): o sync conta quando está de fato
 * enviando; nos outros casos (fila vazia ou bloqueada, sync parado), conta o
 * health check.
 */
export function fonteDeEvidencia(situacao, fila) {
    return syncEnvia(situacao.estado, situacao.modo) && fila.pendentes > 0 && !fila.bloqueada ? 'sync' : 'health-check';
}
/** Alerta do estado (docs/estados.md): amarelo em DEGRADADO, vermelho em OFFLINE. */
export function alertaDoEstado(estado) {
    return estado === 'degradado' ? 'amarelo' : estado === 'offline' ? 'vermelho' : 'nenhum';
}
export function validarParametros(parametros) {
    for (const [nome, valor] of Object.entries(parametros)) {
        const minimo = nome === 'limiteFila' ? 0 : 1;
        if (!Number.isSafeInteger(valor) || valor < minimo) {
            throw new RangeError(`${nome} inválido: ${String(valor)} (use um inteiro a partir de ${minimo})`);
        }
    }
}
/** A transição que as regras pedem para esta situação, se houver. */
function transicaoDevida(estado, falhas, sucessos, evidencia, parametros) {
    const t = (para, causa, motivo) => ({ de: estado, para, causa, motivo });
    switch (evidencia.tipo) {
        case 'falha':
            if (estado === 'saudavel')
                return t('degradado', 'falha', '1ª falha');
            if (estado === 'sincronizando')
                return t('degradado', 'falha', 'falha durante o envio');
            if (estado === 'recuperando')
                return t('offline', 'falha', 'falha durante a recuperação');
            if (estado === 'degradado' && falhas >= parametros.falhasParaOffline) {
                return t('offline', 'falha', `${falhas} falhas seguidas`);
            }
            return null;
        case 'sucesso':
            if (estado === 'degradado') {
                // Com fila acumulada, não é SAUDÁVEL: volta a esvaziá-la em SINCRONIZANDO
                // (cenário de 100.000: SINCRONIZANDO > DEGRADADO > SAUDÁVEL com 200.000 na fila).
                return evidencia.pendentes > parametros.limiteFila
                    ? t('sincronizando', 'sucesso', `1 sucesso com fila de ${evidencia.pendentes} eventos pendentes`)
                    : t('saudavel', 'sucesso', '1 sucesso');
            }
            if (estado === 'offline')
                return t('recuperando', 'sucesso', '1º sucesso do health check');
            if (estado === 'recuperando' && sucessos >= parametros.sucessosParaVoltar) {
                return t('sincronizando', 'sucesso', `${sucessos} sucessos seguidos`);
            }
            return null;
        case 'fila':
            if (estado === 'sincronizando' && evidencia.pendentes <= parametros.limiteFila) {
                return t('saudavel', 'fila', `fila com ${evidencia.pendentes} eventos pendentes`);
            }
            return null;
    }
}
/**
 * Aplica uma evidência (docs/estados.md, ADR 012). Um sucesso zera as falhas
 * seguidas e uma falha zera os sucessos. Em MANUAL a transição vira proposta;
 * uma proposta que a evidência nova contradiz (sucesso depois de proposta por
 * falha, ou o contrário) é descartada.
 */
export function aplicarEvidencia(situacao, evidencia, parametros) {
    let { falhasSeguidas, sucessosSeguidos, proposta } = situacao;
    if (evidencia.tipo === 'falha') {
        falhasSeguidas += 1;
        sucessosSeguidos = 0;
        if (proposta !== null && proposta.causa !== 'falha')
            proposta = null;
    }
    else if (evidencia.tipo === 'sucesso') {
        sucessosSeguidos += 1;
        falhasSeguidas = 0;
        if (proposta?.causa === 'falha')
            proposta = null;
    }
    const devida = transicaoDevida(situacao.estado, falhasSeguidas, sucessosSeguidos, evidencia, parametros);
    const base = { ...situacao, falhasSeguidas, sucessosSeguidos };
    if (devida === null) {
        return { situacao: Object.freeze({ ...base, proposta }), transicao: null, propostaNova: null };
    }
    exigirTransicaoPermitida(devida.de, devida.para);
    if (situacao.modo === 'manual') {
        const nova = proposta?.para === devida.para ? null : devida;
        return {
            situacao: Object.freeze({ ...base, proposta: nova ?? proposta }),
            transicao: null,
            propostaNova: nova,
        };
    }
    return {
        situacao: Object.freeze({ ...base, estado: devida.para, proposta: null }),
        transicao: devida,
        propostaNova: null,
    };
}
/** Em MANUAL, aplica a proposta, se ainda for permitida a partir do estado atual. */
export function confirmarProposta(situacao) {
    const proposta = situacao.proposta;
    if (situacao.modo !== 'manual' || proposta === null) {
        throw new Error('não há transição proposta para confirmar');
    }
    exigirTransicaoPermitida(situacao.estado, proposta.para);
    const transicao = { ...proposta, de: situacao.estado };
    return {
        situacao: Object.freeze({ ...situacao, estado: proposta.para, proposta: null }),
        transicao,
        propostaNova: null,
    };
}
/** Troca o modo. Sair de MANUAL descarta a proposta: as regras voltam a valer na próxima evidência. */
export function alterarModo(situacao, modo) {
    return Object.freeze({ ...situacao, modo, proposta: modo === 'manual' ? situacao.proposta : null });
}
//# sourceMappingURL=maquina-de-estados.js.map