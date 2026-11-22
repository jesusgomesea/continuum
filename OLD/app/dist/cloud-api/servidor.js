import express, {} from 'express';
import { BancoIndisponivelError } from './banco-postgres.js';
import { ForaDeOrdemError, LoteInvalidoError } from './erros.js';
import { criarEsquemaNuvem } from './esquema.js';
import { receberLote } from './recebimento.js';
/** Corpo máximo de um lote: folga para 1000 vendas de vários itens. */
const TAMANHO_MAXIMO_CORPO = '5mb';
/**
 * A API HTTP da nuvem simulada (ADR 010). Cada resposta de erro traz
 * `{ erro }`; a 409 traz também `ultimaSeq`, de onde o envio deve continuar.
 */
export function criarAppCloud(banco) {
    const app = express();
    app.use(express.json({ limit: TAMANHO_MAXIMO_CORPO }));
    app.post('/v1/origens/:origemId/eventos', async (req, res) => {
        res.status(200).json(await receberLote(banco, req.params.origemId, req.body));
    });
    // Health check (ADR 012): saudável só se o PostgreSQL responde, porque sem
    // ele nenhum lote seria aceito. Sem banco, o tratarErros responde 503.
    app.get('/v1/saude', async (_req, res) => {
        await banco.consultarUma('SELECT 1');
        res.status(200).json({ status: 'ok' });
    });
    app.use((_req, res) => {
        res.status(404).json({ erro: 'rota não encontrada' });
    });
    app.use(tratarErros);
    return app;
}
const tratarErros = (erro, _req, res, _next) => {
    if (erro instanceof LoteInvalidoError) {
        res.status(400).json({ erro: erro.message });
    }
    else if (erro instanceof ForaDeOrdemError) {
        res.status(409).json({ erro: erro.message, ultimaSeq: erro.ultimaSeq });
    }
    else if (erro instanceof BancoIndisponivelError) {
        res.status(503).json({ erro: 'banco da nuvem indisponível; reenvie o lote mais tarde' });
    }
    else if (erroDoCliente(erro)) {
        // Erros do leitor de JSON do Express: corpo malformado (400) ou grande demais (413).
        res.status(erro.status).json({ erro: erro.message });
    }
    else {
        console.error(erro);
        res.status(500).json({ erro: 'erro interno da nuvem' });
    }
};
function erroDoCliente(erro) {
    const status = erro?.status;
    return erro instanceof Error && typeof status === 'number' && status >= 400 && status < 500;
}
/**
 * Cria o esquema, se preciso, e começa a escutar. Só em 127.0.0.1: a
 * cloud-api ainda não tem autenticação (docs/pendencias.md).
 */
export async function iniciarCloudApi(banco, opcoes = {}) {
    await criarEsquemaNuvem(banco);
    const app = criarAppCloud(banco);
    const servidor = await new Promise((resolve, reject) => {
        const s = app.listen(opcoes.porta ?? 0, '127.0.0.1', (erro) => (erro ? reject(erro) : resolve(s)));
    });
    return {
        porta: servidor.address().port,
        fechar: () => new Promise((resolve, reject) => {
            servidor.close((erro) => (erro ? reject(erro) : resolve()));
            servidor.closeAllConnections(); // keep-alive não segura o fechamento
        }),
    };
}
//# sourceMappingURL=servidor.js.map