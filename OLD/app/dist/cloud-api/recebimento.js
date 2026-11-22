import { EventoInvalidoError, serializarDados, validarTipo } from '../registro/validacao.js';
import { aplicarFato, lerFato } from './aplicacao.js';
import { RestricaoVioladaError } from './banco-postgres.js';
import { ForaDeOrdemError, LoteInvalidoError } from './erros.js';
import { lerInstante, lerInteiro, lerLista, lerObjeto, lerUuid } from './leitura.js';
/** Limite de eventos por lote: um lote é uma transação só, e ela não deve crescer sem fim. */
export const MAXIMO_EVENTOS_POR_LOTE = 1000;
/**
 * Recebe um lote de eventos de uma origem (ADR 010), numa única transação:
 * - seq já aplicada com o mesmo id: 'repetido', ignorado;
 * - seq seguinte à última aplicada: gravado e aplicado ('aplicado' ou 'conflito');
 * - lacuna, id divergente na mesma seq, ou id já recebido em outro lugar:
 *   ForaDeOrdemError, e nada do lote é gravado.
 * A linha da origem fica travada até o fim, para que envios simultâneos da
 * mesma origem sejam processados um depois do outro.
 */
export async function receberLote(banco, origemId, corpo) {
    const origem = lerUuid(origemId, 'origemId');
    const eventos = lerLote(corpo);
    const primeira = eventos[0]?.seq ?? 1;
    const ultimaDoLote = primeira + eventos.length - 1;
    return banco.transacao(async (tx) => {
        await tx.rodar('INSERT INTO origens (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', origem);
        const linhaOrigem = await tx.consultarUma('SELECT ultima_seq FROM origens WHERE id = $1 FOR UPDATE', origem);
        const ultimaAntes = Number(linhaOrigem?.['ultima_seq']);
        const idsJson = JSON.stringify(eventos.map((e) => e.id));
        const recebidos = new Map((await tx.consultar(`SELECT id, origem_id, seq FROM eventos_recebidos
           WHERE id IN (SELECT jsonb_array_elements_text($1::jsonb)::uuid)
              OR (origem_id = $2 AND seq BETWEEN $3 AND $4)`, idsJson, origem, primeira, ultimaDoLote)).map((linha) => [String(linha['id']), { origemId: String(linha['origem_id']), seq: Number(linha['seq']) }]));
        const idNaSeq = new Map([...recebidos].filter(([, r]) => r.origemId === origem).map(([id, r]) => [r.seq, id]));
        let ultimaSeq = ultimaAntes;
        const resultados = [];
        for (const evento of eventos) {
            if (evento.seq <= ultimaSeq) {
                const gravado = idNaSeq.get(evento.seq);
                if (gravado !== evento.id) {
                    throw new ForaDeOrdemError(`seq ${evento.seq} já foi aplicada com o evento ${gravado ?? '(desconhecido)'}, e não ${evento.id}`, ultimaAntes);
                }
                resultados.push({ id: evento.id, resultado: 'repetido' });
                continue;
            }
            if (evento.seq !== ultimaSeq + 1) {
                throw new ForaDeOrdemError(`lacuna: esperada a seq ${ultimaSeq + 1}, recebida ${evento.seq}`, ultimaAntes);
            }
            const outro = recebidos.get(evento.id);
            if (outro !== undefined) {
                throw new ForaDeOrdemError(`o evento ${evento.id} já foi recebido na origem ${outro.origemId}, seq ${outro.seq}`, ultimaAntes);
            }
            await tx.rodar(`INSERT INTO eventos_recebidos (id, origem_id, seq, tipo, ocorrido_em, dados)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`, evento.id, origem, evento.seq, evento.tipo, evento.ocorridoEm, evento.dadosJson);
            let resultado;
            try {
                resultado = await aplicarFato(tx, evento.fato, { origemId: origem, eventoId: evento.id, ocorridoEm: evento.ocorridoEm });
            }
            catch (erro) {
                if (erro instanceof RestricaoVioladaError) {
                    // Ex.: movimentação de um produto que a nuvem não conhece.
                    throw new LoteInvalidoError(`evento ${evento.id} (seq ${evento.seq}) não pôde ser aplicado: ${erro.message}`, {
                        cause: erro,
                    });
                }
                throw erro;
            }
            resultados.push({ id: evento.id, resultado });
            ultimaSeq = evento.seq;
        }
        if (ultimaSeq !== ultimaAntes) {
            await tx.rodar('UPDATE origens SET ultima_seq = $1 WHERE id = $2', ultimaSeq, origem);
        }
        return { ultimaSeq, eventos: resultados };
    });
}
/** Confere a forma do lote inteiro antes de tocar no banco. */
function lerLote(corpo) {
    const lista = lerLista(lerObjeto(corpo, 'corpo')['eventos'], 'eventos');
    if (lista.length === 0 || lista.length > MAXIMO_EVENTOS_POR_LOTE) {
        throw new LoteInvalidoError(`eventos: informe de 1 a ${MAXIMO_EVENTOS_POR_LOTE} eventos`);
    }
    const eventos = lista.map((valor, i) => lerEvento(valor, `eventos[${i}]`));
    const ids = new Set();
    eventos.forEach((evento, i) => {
        const primeiro = eventos[0];
        if (primeiro !== undefined && evento.seq !== primeiro.seq + i) {
            throw new LoteInvalidoError(`eventos[${i}].seq: o lote deve ter seqs consecutivas e crescentes`);
        }
        if (ids.has(evento.id)) {
            throw new LoteInvalidoError(`eventos[${i}].id: id repetido dentro do lote`);
        }
        ids.add(evento.id);
    });
    return eventos;
}
function lerEvento(valor, caminho) {
    const evento = lerObjeto(valor, caminho);
    const tipo = evento['tipo'];
    let dadosJson;
    try {
        validarTipo(tipo);
        // Mesmas regras de JSON puro do registro geral (ADR 007).
        dadosJson = serializarDados(evento['dados']);
    }
    catch (erro) {
        if (erro instanceof EventoInvalidoError) {
            throw new LoteInvalidoError(`${caminho}: ${erro.message}`, { cause: erro });
        }
        throw erro;
    }
    return {
        id: lerUuid(evento['id'], `${caminho}.id`),
        seq: lerInteiro(evento['seq'], `${caminho}.seq`, 1),
        tipo: tipo,
        ocorridoEm: lerInstante(evento['ocorridoEm'], `${caminho}.ocorridoEm`),
        dadosJson,
        fato: lerFato(tipo, evento['dados'], `${caminho}.dados`),
    };
}
//# sourceMappingURL=recebimento.js.map