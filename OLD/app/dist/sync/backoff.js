/**
 * Quanto esperar depois de `falhas` falhas seguidas (ADR 011): o teto dobra a
 * cada falha, a partir de `inicialMs`, até `maximoMs`. O jitter sorteia entre
 * metade do teto e o teto, para que várias origens não reenviem juntas.
 * `aleatorio` devolve um número em [0, 1); nos testes, um valor fixo.
 */
export function calcularEspera(falhas, opcoes, aleatorio = Math.random) {
    if (!Number.isSafeInteger(falhas) || falhas < 1) {
        throw new RangeError(`falhas inválidas: ${falhas} (use um inteiro a partir de 1)`);
    }
    // Limita o expoente: 2 ** 1000 seria Infinity.
    const teto = Math.min(opcoes.maximoMs, opcoes.inicialMs * 2 ** Math.min(falhas - 1, 30));
    return Math.round(teto / 2 + (aleatorio() * teto) / 2);
}
//# sourceMappingURL=backoff.js.map