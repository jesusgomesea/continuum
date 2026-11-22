/**
 * Consulta `GET /v1/saude` (ADR 012). Só `200` é sucesso; timeout, rede fora
 * ou qualquer outro status contam como falha. Nunca lança.
 */
export async function verificarSaude(opcoes) {
    try {
        const resposta = await fetch(`${opcoes.urlBase}/v1/saude`, { signal: AbortSignal.timeout(opcoes.timeoutMs) });
        await resposta.arrayBuffer(); // consome o corpo para liberar a conexão
        return resposta.status === 200 ? { ok: true } : { ok: false, erro: `HTTP ${resposta.status}` };
    }
    catch (erro) {
        return { ok: false, erro: `falha de rede ou timeout: ${String(erro)}` };
    }
}
//# sourceMappingURL=health-check.js.map