import { compararNuvemComLocal } from './conferencia.js';
/**
 * Intervalo entre consultas à situação. Ela roda no processo do gerador: a
 * cada 100 ms, com o banco grande, disputava o processo com as vendas.
 */
const CONSULTA_MS = 500;
/** Uma linha de progresso a cada este intervalo, enquanto a fila escoa. */
const PROGRESSO_MS = 30_000;
/** A sequência de uma queda e volta sem tropeço (docs/estados.md). */
export const TRANSICOES_ESPERADAS = [
    'saudavel>degradado',
    'degradado>offline',
    'offline>recuperando',
    'recuperando>sincronizando',
    'sincronizando>saudavel',
];
/**
 * O cenário completo do Marco 1 (Fase 6), em trechos que garantem vendas
 * durante a queda por construção: vende com a nuvem no ar; derruba (corte de
 * conexão, ADR 013) e espera o OFFLINE confirmado; vende em OFFLINE; restaura;
 * vende o resto; espera a fila zerar e confere que a nuvem ficou igual ao
 * local, sem perda nem duplicação. Roda num LAB já no ar, de preferência zerado.
 */
export async function executarCenario(lab, opcoes) {
    const log = opcoes.log ?? (() => undefined);
    const limiteMs = opcoes.limiteMs ?? 600_000;
    const qtdAntes = Math.floor(opcoes.vendas * (opcoes.antes ?? 0.3));
    const qtdDurante = Math.floor(opcoes.vendas * (opcoes.durante ?? 0.4));
    const qtdDepois = opcoes.vendas - qtdAntes - qtdDurante;
    if (qtdAntes < 1 || qtdDurante < 1 || qtdDepois < 1) {
        throw new RangeError('cada trecho do cenário (antes, durante e depois da queda) precisa de ao menos uma venda');
    }
    let maiorFila = 0;
    const geracoes = [];
    const esperar = async (oQue, condicao, limite = limiteMs, progresso) => {
        const fim = Date.now() + limite;
        let ultimoProgresso = Date.now();
        for (;;) {
            const s = await lab.situacao();
            maiorFila = Math.max(maiorFila, s.local.pendentes);
            if (condicao(s))
                return s;
            if (Date.now() > fim) {
                throw new Error(`cenário parado esperando ${oQue} (${limite} ms); última situação: ${JSON.stringify(s)}`);
            }
            if (progresso !== undefined && Date.now() - ultimoProgresso >= PROGRESSO_MS) {
                progresso(s);
                ultimoProgresso = Date.now();
            }
            await new Promise((resolve) => setTimeout(resolve, CONSULTA_MS));
        }
    };
    /** Gera e espera terminar; devolve a situação logo depois. */
    const vender = async (quantidade, trecho) => {
        log(`${trecho}: gerando ${quantidade} vendas (${opcoes.ritmo === null ? 'sem pausa' : `${opcoes.ritmo}/s`})`);
        const geracao = lab.gerador.iniciar({ quantidade, ritmo: opcoes.ritmo });
        await esperar(`o fim das vendas ${trecho}`, (atual) => atual.geracao?.ativa === false);
        geracoes.push(await geracao.concluida);
        // Uma situação nova, com a geração já parada: a que viu o fim pode ter contado
        // as vendas da loja antes das últimas (a situação lê o PostgreSQL no meio).
        return lab.situacao();
    };
    const inicial = await esperar('o estado SAUDÁVEL inicial', (s) => s.estado === 'saudavel' && s.kryptonita.queda === null);
    const seqInicial = lab.registro.listar().at(-1)?.seq ?? 0;
    const inicio = Date.now();
    // 1. Nuvem no ar.
    const aposAntes = await vender(qtdAntes, 'antes da queda');
    // 2. Queda, e só segue com o OFFLINE confirmado.
    const pedidoDeQueda = Date.now();
    await lab.nuvem.derrubar('corte');
    log('nuvem derrubada (corte de conexão)');
    const entradaOffline = await esperar('OFFLINE', (s) => s.estado === 'offline');
    const ateOfflineMs = Date.now() - pedidoDeQueda;
    const enviosNaEntrada = await lab.nuvem.envios();
    log(`OFFLINE em ${ateOfflineMs} ms`);
    // 3. Vendas em OFFLINE. A Kryptonita segue cortando: o estado não tem como sair de OFFLINE.
    const saidaOffline = await vender(qtdDurante, 'em OFFLINE');
    if (saidaOffline.estado !== 'offline') {
        throw new Error(`o estado saiu de OFFLINE durante as vendas em OFFLINE: ${saidaOffline.estado}`);
    }
    const enviosEmOffline = (await lab.nuvem.envios()) - enviosNaEntrada;
    const nuvemNaEntrada = entradaOffline.nuvem?.eventos ?? 0;
    const nuvemNaSaida = saidaOffline.nuvem?.eventos ?? 0;
    // 4. Volta da nuvem, e o resto das vendas com ela recuperando.
    const pedidoDeVolta = Date.now();
    await lab.nuvem.restaurar();
    log(`nuvem restaurada com ${saidaOffline.local.pendentes} eventos na fila`);
    await vender(qtdDepois, 'depois da volta');
    const fim = await esperar('SAUDÁVEL e a fila vazia', (s) => s.estado === 'saudavel' && s.local.pendentes === 0, opcoes.limiteEscoamentoMs ?? limiteMs, (s) => {
        const decorrido = Date.now() - pedidoDeVolta;
        const recebidos = (s.nuvem?.eventos ?? nuvemNaSaida) - nuvemNaSaida;
        log(`escoando: ${s.local.pendentes} na fila, ${recebidos} eventos entregues em ${(decorrido / 1000).toFixed(0)} s (${Math.round(recebidos / (decorrido / 1000))}/s), estado ${s.estado}`);
    });
    const ateRecuperarMs = Date.now() - pedidoDeVolta;
    log(`SAUDÁVEL com a fila vazia ${ateRecuperarMs} ms depois da volta; conferindo a nuvem`);
    const vendas = {
        antes: aposAntes.local.vendas - inicial.local.vendas,
        emOffline: saidaOffline.local.vendas - entradaOffline.local.vendas,
        depois: fim.local.vendas - saidaOffline.local.vendas,
    };
    const transicoes = lab.registro
        .listar()
        .filter((e) => e.seq > seqInicial && e.tipo === 'estado.transicao')
        .map((e) => `${String(e.dados['de'])}>${String(e.dados['para'])}`);
    const divergencias = await compararNuvemComLocal(lab.bancoNuvem, lab.bancoAplicacao, lab.origemId);
    const falhasDoGerador = geracoes.reduce((soma, g) => soma + g.falhas, 0);
    const eventosEscoados = (fim.nuvem?.eventos ?? nuvemNaSaida) - nuvemNaSaida;
    return {
        vendasPedidas: opcoes.vendas,
        vendasFeitas: geracoes.reduce((soma, g) => soma + g.feitas, 0),
        vendas,
        falhasDoGerador,
        ultimoErroDoGerador: geracoes.map((g) => g.ultimoErro).findLast((e) => e !== null) ?? null,
        duracaoMs: Date.now() - inicio,
        ateOfflineMs,
        ateRecuperarMs,
        maiorFila,
        escoamento: {
            filaNaVolta: saidaOffline.local.pendentes,
            eventos: eventosEscoados,
            ms: ateRecuperarMs,
            eventosPorSegundo: Math.round(eventosEscoados / (ateRecuperarMs / 1000)),
        },
        emOffline: { envios: enviosEmOffline, nuvemNaEntrada, nuvemNaSaida },
        transicoes,
        local: fim.local,
        nuvem: fim.nuvem,
        divergencias,
        aprovado: vendas.emOffline > 0 &&
            falhasDoGerador === 0 &&
            enviosEmOffline === 0 &&
            nuvemNaEntrada === nuvemNaSaida &&
            divergencias.length === 0 &&
            JSON.stringify(transicoes) === JSON.stringify(TRANSICOES_ESPERADAS),
    };
}
//# sourceMappingURL=cenario.js.map