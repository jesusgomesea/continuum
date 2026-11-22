// Os horários ficam de fora: o do dado local e o do evento na outbox vêm de
// leituras diferentes do relógio e podem diferir em ms.
const COMPARACOES = [
    {
        tabela: 'produtos',
        local: 'SELECT id, nome, preco_centavos, version FROM produtos ORDER BY id',
        nuvem: 'SELECT id::text, nome, preco_centavos, version FROM produtos ORDER BY id::text COLLATE "C"',
    },
    {
        tabela: 'movimentacoes',
        local: 'SELECT id, produto_id, tipo, quantidade, venda_id, motivo FROM movimentacoes ORDER BY id',
        nuvem: 'SELECT id::text, produto_id::text, tipo, quantidade, venda_id::text, motivo FROM movimentacoes ORDER BY id::text COLLATE "C"',
    },
    {
        tabela: 'vendas',
        local: 'SELECT id, numero, total_centavos FROM vendas ORDER BY id',
        nuvem: 'SELECT id::text, numero, total_centavos FROM vendas ORDER BY id::text COLLATE "C"',
    },
    {
        tabela: 'itens_venda',
        local: `SELECT id, venda_id, posicao, produto_id, quantidade, preco_unitario_centavos, movimentacao_id
            FROM itens_venda ORDER BY id`,
        nuvem: `SELECT id::text, venda_id::text, posicao, produto_id::text, quantidade, preco_unitario_centavos,
                   movimentacao_id::text
            FROM itens_venda ORDER BY id::text COLLATE "C"`,
    },
];
const linha = (valor) => JSON.stringify({ ...valor });
/**
 * Confere, linha a linha, que os dados consolidados na nuvem são iguais aos
 * do banco local, e que a nuvem recebeu todo evento da outbox desta origem,
 * uma vez só. Devolve as divergências; lista vazia é nuvem igual ao local.
 */
export async function compararNuvemComLocal(nuvem, local, origemId) {
    const divergencias = [];
    for (const { tabela, local: sqlLocal, nuvem: sqlNuvem } of COMPARACOES) {
        const daNuvem = (await nuvem.consultar(sqlNuvem)).map(linha);
        const doLocal = local.consultar(sqlLocal).map(linha);
        if (daNuvem.length !== doLocal.length) {
            divergencias.push(`${tabela}: ${doLocal.length} linhas no local, ${daNuvem.length} na nuvem`);
        }
        const primeira = doLocal.findIndex((valor, i) => valor !== daNuvem[i]);
        if (primeira !== -1) {
            divergencias.push(`${tabela}: primeira diferença na linha ${primeira + 1}: local ${doLocal[primeira]}, nuvem ${daNuvem[primeira] ?? '(nenhuma)'}`);
        }
    }
    const outbox = local.consultarUma('SELECT count(*) AS n, coalesce(max(seq), 0) AS ultima FROM outbox');
    const recebidos = await nuvem.consultarUma(`SELECT count(*)::int AS n, count(DISTINCT seq)::int AS distintos,
            (SELECT ultima_seq FROM origens WHERE id = $1) AS ultima
     FROM eventos_recebidos WHERE origem_id = $1`, origemId);
    const naOutbox = Number(outbox?.['n']);
    const naNuvem = Number(recebidos?.['n']);
    if (naNuvem !== naOutbox || Number(recebidos?.['distintos']) !== naNuvem) {
        divergencias.push(`eventos: ${naOutbox} na outbox, ${naNuvem} recebidos pela nuvem (${Number(recebidos?.['distintos'])} seqs distintas)`);
    }
    if (Number(recebidos?.['ultima'] ?? 0) !== Number(outbox?.['ultima'])) {
        divergencias.push(`última seq: ${Number(outbox?.['ultima'])} na outbox, ${Number(recebidos?.['ultima'] ?? 0)} na nuvem`);
    }
    return divergencias;
}
//# sourceMappingURL=conferencia.js.map