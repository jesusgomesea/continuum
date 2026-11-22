import { fileURLToPath } from 'node:url';
import express, {} from 'express';
import { MODOS } from '../estado/maquina-de-estados.js';
import { GeracaoEmAndamentoError, RITMO_PADRAO } from '../gerador/gerador.js';
import { DadosInvalidosError } from '../vendas/erros.js';
/** Cabeçalho exigido em todo POST da API do LAB (ADR 013). */
export const CABECALHO_LAB = 'x-continuum';
export const VALOR_CABECALHO_LAB = 'lab';
/**
 * Arquivos do painel (HTML, CSS e JS puro). O build não copia arquivos que não
 * são TypeScript: tanto de src/lab quanto de dist/lab, ../../src/painel é a
 * mesma pasta do código-fonte.
 */
export const PASTA_PAINEL = fileURLToPath(new URL('../../src/painel/', import.meta.url));
/**
 * Sem `X-Continuum: lab`, todo POST recebe 403. Uma página aberta no navegador
 * não consegue mandar esse cabeçalho para o localhost sem um preflight de CORS,
 * que o LAB não autoriza: assim ela não aciona o LAB (ADR 013).
 */
const exigirCabecalho = (req, res, next) => {
    if (req.method === 'POST' && req.get(CABECALHO_LAB) !== VALOR_CABECALHO_LAB) {
        res.status(403).json({ erro: `cabeçalho ${CABECALHO_LAB}: ${VALOR_CABECALHO_LAB} obrigatório` });
        return;
    }
    next();
};
/** A API do painel do LAB (ADR 013). Respostas de erro trazem `{ erro }`. */
export function criarAppLab(dependencias) {
    const { gerador, nuvem, estado } = dependencias;
    const app = express();
    app.use(exigirCabecalho);
    app.use(express.json({ limit: '10kb' }));
    app.get('/api/situacao', async (_req, res) => {
        res.json(await dependencias.situacao());
    });
    // Corpo: { quantidade, ritmo? } (ritmo em vendas/s; null é sem pausa, só para o cenário automatizado).
    app.post('/api/vendas', (req, res) => {
        const corpo = (req.body ?? {});
        const ritmo = corpo.ritmo === undefined ? RITMO_PADRAO : corpo.ritmo;
        if (typeof corpo.quantidade !== 'number' || (ritmo !== null && typeof ritmo !== 'number')) {
            throw new DadosInvalidosError('informe { quantidade: número, ritmo?: número | null }');
        }
        res.status(202).json(gerador.iniciar({ quantidade: corpo.quantidade, ritmo }).situacao());
    });
    app.post('/api/vendas/parar', (_req, res) => {
        gerador.atual?.parar();
        res.json(gerador.atual?.situacao() ?? null);
    });
    // Corpo: { tipo?: 'corte' | '503' }; sem tipo, corte de conexão (ADR 013).
    app.post('/api/nuvem/derrubar', async (req, res) => {
        const tipo = req.body?.tipo ?? 'corte';
        if (tipo !== 'corte' && tipo !== '503') {
            throw new DadosInvalidosError("tipo: use 'corte' ou '503'");
        }
        res.json({ queda: await nuvem.derrubar(tipo) });
    });
    app.post('/api/nuvem/restaurar', async (_req, res) => {
        res.json({ queda: await nuvem.restaurar() });
    });
    // Corpo: { modo }, como `npm run continuum -- modo <modo>` (ADR 012).
    app.post('/api/modo', (req, res) => {
        const modo = req.body?.modo;
        if (typeof modo !== 'string' || !MODOS.includes(modo)) {
            throw new DadosInvalidosError(`modo: use ${MODOS.join(', ')}`);
        }
        res.json({ alterado: estado.alterarModo(modo), modo });
    });
    // Em MANUAL, aplica a transição proposta, como `npm run continuum -- confirmar`.
    app.post('/api/confirmar', (_req, res) => {
        try {
            const { transicao } = estado.confirmar();
            res.json({ transicao });
        }
        catch (erro) {
            res.status(409).json({ erro: erro instanceof Error ? erro.message : String(erro) });
        }
    });
    app.use(express.static(PASTA_PAINEL));
    app.use((_req, res) => {
        res.status(404).json({ erro: 'rota não encontrada' });
    });
    app.use(tratarErros);
    return app;
}
const tratarErros = (erro, _req, res, _next) => {
    if (erro instanceof DadosInvalidosError) {
        res.status(400).json({ erro: erro.message });
    }
    else if (erro instanceof GeracaoEmAndamentoError) {
        res.status(409).json({ erro: erro.message });
    }
    else if (erroDoCliente(erro)) {
        res.status(erro.status).json({ erro: erro.message }); // JSON malformado ou grande demais
    }
    else {
        console.error(erro);
        res.status(500).json({ erro: 'erro interno do LAB' });
    }
};
function erroDoCliente(erro) {
    const status = erro?.status;
    return erro instanceof Error && typeof status === 'number' && status >= 400 && status < 500;
}
//# sourceMappingURL=api.js.map