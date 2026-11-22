import { abrirBancoPostgres } from '../cloud-api/banco-postgres.js';
import { iniciarCloudApi } from '../cloud-api/servidor.js';
import { exigirVariavel } from '../compartilhado/ambiente.js';
import { iniciarKryptonita } from '../kryptonita/kryptonita.js';
const enviar = (mensagem) => {
    process.send?.(mensagem);
};
const porta = (nome) => Number(exigirVariavel(nome));
async function principal() {
    if (process.send === undefined) {
        throw new Error('a nuvem do LAB roda como processo filho do npm run lab (precisa do canal IPC)');
    }
    const banco = abrirBancoPostgres(exigirVariavel('CONTINUUM_LAB_NUVEM_POSTGRES_URL'));
    let nuvem;
    let kryptonita;
    let encerrando = false;
    const encerrar = async () => {
        if (encerrando)
            return;
        encerrando = true;
        await kryptonita?.fechar();
        await nuvem?.fechar();
        await banco.fechar();
        process.disconnect?.();
    };
    process.on('disconnect', () => void encerrar());
    for (const sinal of ['SIGINT', 'SIGTERM']) {
        process.on(sinal, () => void encerrar());
    }
    const subir = async (parte, numero, iniciar) => {
        try {
            return await iniciar();
        }
        catch (erro) {
            if (erro?.code === 'EADDRINUSE') {
                enviar({ tipo: 'porta-ocupada', parte, porta: numero });
                await encerrar();
                return undefined;
            }
            throw erro;
        }
    };
    const portaNuvem = porta('CONTINUUM_LAB_NUVEM_PORTA');
    nuvem = await subir('nuvem', portaNuvem, () => iniciarCloudApi(banco, { porta: portaNuvem }));
    if (nuvem === undefined)
        return;
    const portaKryptonita = porta('CONTINUUM_LAB_KRYPTONITA_PORTA');
    const alvo = `http://127.0.0.1:${nuvem.porta}`;
    kryptonita = await subir('kryptonita', portaKryptonita, () => iniciarKryptonita(alvo, { porta: portaKryptonita }));
    if (kryptonita === undefined)
        return;
    const k = kryptonita;
    process.on('message', (pedido) => {
        if (pedido.tipo === 'derrubar')
            k.derrubar(pedido.queda);
        else if (pedido.tipo === 'restaurar')
            k.restaurar();
        // envios: lotes (POST) que o sync tentou mandar, com ou sem queda.
        enviar({ tipo: 'queda', id: pedido.id, queda: k.queda, envios: k.envios });
    });
    enviar({ tipo: 'pronto', kryptonitaUrl: k.url });
}
principal().catch((erro) => {
    // Sai de vez: o pool do PostgreSQL ainda aberto seguraria o processo vivo.
    const mensagem = { tipo: 'erro', erro: erro instanceof Error ? erro.message : String(erro) };
    if (process.send === undefined) {
        process.stderr.write(`[nuvem] ${mensagem.erro}\n`);
        process.exit(1);
    }
    process.send(mensagem, () => process.exit(1));
});
//# sourceMappingURL=nuvem.js.map