import { createServer } from 'node:http';
/**
 * Kryptonita v1: proxy HTTP entre o Sync Engine e a cloud-api, para provocar
 * falhas de rede nos testes e na demonstração (ADR 013).
 */
export async function iniciarKryptonita(alvo, opcoes = {}) {
    let n = 0;
    let emAndamento = 0;
    let clientesCaidos = 0;
    let queda = null;
    let aoFicarOcioso = [];
    const proxy = {
        url: '',
        porta: 0,
        alvo,
        decidir: () => 'normal',
        atrasoMs: 0,
        contagem: { normal: 0, derrubar: 0, 'perder-resposta': 0, indisponivel: 0 },
        envios: 0,
        get emAndamento() {
            return emAndamento;
        },
        get clientesCaidos() {
            return clientesCaidos;
        },
        get queda() {
            return queda;
        },
        derrubar: () => undefined,
        restaurar: () => undefined,
        ocioso: () => (emAndamento === 0 ? Promise.resolve() : new Promise((resolve) => aoFicarOcioso.push(resolve))),
        fechar: async () => undefined,
    };
    const terminar = () => {
        emAndamento -= 1;
        if (emAndamento === 0) {
            const esperando = aoFicarOcioso;
            aoFicarOcioso = [];
            esperando.forEach((resolver) => resolver());
        }
    };
    const servidor = createServer((req, res) => {
        let corpo = '';
        req.setEncoding('utf8');
        req.on('data', (parte) => (corpo += parte));
        req.on('end', () => {
            emAndamento += 1;
            if (req.method === 'POST')
                proxy.envios += 1;
            const falha = proxy.decidir(n++);
            proxy.contagem[falha] += 1;
            if (falha === 'normal') {
                // No `res`, não no socket: o socket keep-alive é o mesmo para vários pedidos.
                res.once('close', () => {
                    if (!res.writableFinished) {
                        clientesCaidos += 1;
                    }
                });
            }
            if (falha === 'derrubar') {
                req.socket.destroy();
                terminar();
                return;
            }
            if (falha === 'indisponivel') {
                res.writeHead(503, { 'content-type': 'application/json' }).end(JSON.stringify({ erro: 'indisponível' }));
                terminar();
                return;
            }
            setTimeout(() => {
                if (req.socket.destroyed) {
                    terminar(); // o cliente caiu durante a latência: o pedido se perde com ele
                    return;
                }
                fetch(`${proxy.alvo}${req.url ?? ''}`, {
                    method: req.method ?? 'POST',
                    headers: { 'content-type': req.headers['content-type'] ?? 'application/json' },
                    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : corpo, // fetch recusa corpo em GET
                })
                    .then(async (resposta) => {
                    const texto = await resposta.text();
                    if (falha === 'perder-resposta') {
                        req.socket.destroy();
                    }
                    else {
                        res.writeHead(resposta.status, { 'content-type': 'application/json' }).end(texto);
                    }
                })
                    .catch(() => req.socket.destroy()) // cloud-api fora do ar: o cliente vê erro de rede
                    .finally(terminar);
            }, proxy.atrasoMs);
        });
    });
    await new Promise((resolve, reject) => {
        servidor.once('error', reject);
        servidor.listen(opcoes.porta ?? 0, '127.0.0.1', () => {
            servidor.off('error', reject);
            resolve();
        });
    });
    const porta = servidor.address().port;
    return Object.assign(proxy, {
        url: `http://127.0.0.1:${porta}`,
        porta,
        derrubar: (tipo = 'corte') => {
            queda = tipo;
            proxy.decidir = () => (tipo === 'corte' ? 'derrubar' : 'indisponivel');
            if (tipo === 'corte') {
                servidor.closeAllConnections();
            }
        },
        restaurar: () => {
            queda = null;
            proxy.decidir = () => 'normal';
        },
        fechar: () => new Promise((resolve, reject) => {
            servidor.close((erro) => (erro ? reject(erro) : resolve()));
            servidor.closeAllConnections();
        }),
    });
}
//# sourceMappingURL=kryptonita.js.map