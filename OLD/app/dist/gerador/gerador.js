import { DadosInvalidosError } from '../vendas/erros.js';
/** Ritmo padrão do botão Gerar vendas do painel (ADR 013). */
export const RITMO_PADRAO = 20;
/** Limites do pedido, para um clique errado não travar a demo. */
export const QUANTIDADE_MAXIMA = 1_000_000;
export const RITMO_MAXIMO = 1_000;
const CATALOGO = [
    { nome: 'Café', precoCentavos: 1_890 },
    { nome: 'Açúcar', precoCentavos: 549 },
    { nome: 'Leite', precoCentavos: 499 },
];
/** Maior quantidade de um produto numa venda gerada (ver itensDaVenda). */
const QUANTIDADE_MAXIMA_POR_ITEM = 3;
/** Intervalo entre rodadas no ritmo visível; cada rodada faz as vendas que faltam para o ritmo. */
const PASSO_MS = 50;
/** Vendas por rodada no modo sem pausa, antes de devolver o laço de eventos (painel e API seguem respondendo). */
const LOTE_SEM_PAUSA = 50;
/**
 * Gerador de carga do LAB (Fase 6): faz vendas reais pelo LabVendas, cada uma
 * com o seu evento na outbox (ADR 001), num ritmo visível ou sem pausa. Uma
 * venda que falha é contada e a geração continua: o número de falhas é o que
 * o cenário de 100.000 mede (docs/pendencias.md).
 */
export class GeradorDeCarga {
    #lab;
    #atual = null;
    constructor(lab) {
        this.#lab = lab;
    }
    /** A geração em andamento ou a última concluída; null se nunca houve. */
    get atual() {
        return this.#atual;
    }
    iniciar(pedido) {
        const quantidade = validarQuantidade(pedido.quantidade);
        const ritmo = pedido.ritmo === null ? null : validarRitmo(pedido.ritmo);
        if (this.#atual?.situacao().ativa === true) {
            throw new GeracaoEmAndamentoError();
        }
        const produtos = this.#prepararCatalogo(quantidade);
        this.#atual = executar(this.#lab, produtos, quantidade, ritmo);
        return this.#atual;
    }
    /**
     * Garante o catálogo da demo e estoque para a geração inteira: sem isso,
     * uma venda poderia ser recusada por estoque (ADR 009), o que não é a falha
     * que a demo quer mostrar. Reaproveita os produtos que já existem.
     */
    #prepararCatalogo(quantidade) {
        let produtos = this.#lab.produtos();
        if (produtos.length === 0) {
            produtos = CATALOGO.map((novo) => this.#lab.criarProduto(novo));
        }
        const necessario = quantidade * QUANTIDADE_MAXIMA_POR_ITEM;
        for (const produto of produtos) {
            const falta = necessario - this.#lab.saldo(produto.id);
            if (falta > 0) {
                this.#lab.registrarEntrada(produto.id, falta, 'reposição do gerador de carga');
            }
        }
        return produtos;
    }
}
export class GeracaoEmAndamentoError extends Error {
    name = 'GeracaoEmAndamentoError';
    constructor() {
        super('já existe uma geração de vendas em andamento');
    }
}
function validarQuantidade(valor) {
    if (!Number.isSafeInteger(valor) || valor < 1 || valor > QUANTIDADE_MAXIMA) {
        throw new DadosInvalidosError(`quantidade: informe um inteiro de 1 a ${QUANTIDADE_MAXIMA}`);
    }
    return valor;
}
function validarRitmo(valor) {
    if (!Number.isFinite(valor) || valor <= 0 || valor > RITMO_MAXIMO) {
        throw new DadosInvalidosError(`ritmo: informe vendas por segundo, maior que 0 e até ${RITMO_MAXIMO}`);
    }
    return valor;
}
/** Alterna vendas de 1 a 3 itens e quantidades de 1 a 3, como o movimento dos testes. */
function itensDaVenda(produtos, n) {
    return produtos
        .slice(0, 1 + (n % produtos.length))
        .map((produto, posicao) => ({ produtoId: produto.id, quantidade: 1 + ((n + posicao) % QUANTIDADE_MAXIMA_POR_ITEM) }));
}
function executar(lab, produtos, quantidade, ritmo) {
    let feitas = 0;
    let falhas = 0;
    let ultimoErro = null;
    let ativa = true;
    let temporizador;
    const recentes = []; // instantes das últimas vendas, para o ritmo medido
    const inicio = Date.now();
    let concluir = () => undefined;
    const concluida = new Promise((resolve) => (concluir = resolve));
    const situacao = () => {
        const umSegundoAtras = Date.now() - 1000;
        while (recentes.length > 0 && (recentes[0] ?? 0) < umSegundoAtras)
            recentes.shift();
        return { quantidade, ritmo, feitas, falhas, ritmoMedido: recentes.length, ativa, ultimoErro };
    };
    const terminar = () => {
        if (!ativa)
            return;
        ativa = false;
        if (temporizador !== undefined) {
            clearTimeout(temporizador);
            clearImmediate(temporizador);
        }
        concluir(situacao());
    };
    const vender = () => {
        const n = feitas + falhas;
        try {
            lab.registrarVenda(itensDaVenda(produtos, n));
            feitas += 1;
            recentes.push(Date.now());
        }
        catch (erro) {
            falhas += 1;
            ultimoErro = erro instanceof Error ? erro.message : String(erro);
        }
    };
    const rodada = () => {
        // No ritmo, faz as vendas que faltam para o tempo decorrido: o atraso de um
        // temporizador não diminui o ritmo, só junta vendas na rodada seguinte.
        const alvo = ritmo === null ? feitas + falhas + LOTE_SEM_PAUSA : Math.floor(((Date.now() - inicio) / 1000) * ritmo) + 1;
        while (ativa && feitas + falhas < Math.min(alvo, quantidade)) {
            vender();
        }
        if (feitas + falhas >= quantidade) {
            terminar();
        }
        else if (ativa) {
            temporizador = ritmo === null ? setImmediate(rodada) : setTimeout(rodada, PASSO_MS);
        }
    };
    rodada();
    return { situacao, parar: terminar, concluida };
}
//# sourceMappingURL=gerador.js.map