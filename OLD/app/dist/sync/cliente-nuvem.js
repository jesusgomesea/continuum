/**
 * Envia um lote para `POST /v1/origens/:origemId/eventos` (ADR 010) e
 * classifica a resposta. Nunca lança: todo resultado vira uma RespostaNuvem.
 */
export async function enviarLote(opcoes, origemId, eventos) {
    const corpo = JSON.stringify({
        eventos: eventos.map(({ id, seq, tipo, ocorridoEm, dados }) => ({ id, seq, tipo, ocorridoEm, dados })),
    });
    let status;
    let texto;
    try {
        const resposta = await fetch(`${opcoes.urlBase}/v1/origens/${origemId}/eventos`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: corpo,
            signal: AbortSignal.timeout(opcoes.timeoutMs),
        });
        status = resposta.status;
        texto = await resposta.text();
    }
    catch (erro) {
        return { classe: 'temporario', erro: `falha de rede ou timeout: ${String(erro)}` };
    }
    return classificar(status, texto);
}
function classificar(status, texto) {
    const corpo = lerJson(texto);
    const erro = typeof corpo?.['erro'] === 'string' ? corpo['erro'] : `HTTP ${status}: ${texto.slice(0, 200)}`;
    const ultimaSeq = corpo?.['ultimaSeq'];
    const temUltimaSeq = typeof ultimaSeq === 'number' && Number.isSafeInteger(ultimaSeq) && ultimaSeq >= 0;
    if (status === 200) {
        // Sem ultimaSeq válida não dá para saber o que foi guardado; reenviar é seguro (ADR 010).
        return temUltimaSeq ? { classe: 'confirmado', ultimaSeq } : { classe: 'temporario', erro };
    }
    if (status === 409) {
        return temUltimaSeq ? { classe: 'fora-de-ordem', ultimaSeq, erro } : { classe: 'temporario', erro };
    }
    if (status === 400 || status === 413) {
        return { classe: 'lote-recusado', status, erro };
    }
    if (status >= 400 && status < 500) {
        return { classe: 'origem-recusada', status, erro };
    }
    return { classe: 'temporario', erro };
}
function lerJson(texto) {
    try {
        const valor = JSON.parse(texto);
        return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
            ? valor
            : undefined;
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=cliente-nuvem.js.map