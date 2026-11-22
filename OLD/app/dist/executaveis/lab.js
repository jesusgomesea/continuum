import { iniciarLab } from '../lab/lab.js';
import { prepararBancoDoLab } from '../lab/postgres-do-lab.js';
import { lerConfiguracaoLab } from './configuracao.js';
/**
 * Executável do LAB (ADR 013): `npm run lab` (ou `npm run lab:demo`, com o
 * .env.demo). Sobe vendas, gerador de carga, cloud-api, Kryptonita, painel e
 * o sync como processo filho, até receber SIGINT (Ctrl+C) ou SIGTERM.
 */
async function principal() {
    const configuracao = lerConfiguracaoLab();
    const postgresUrl = await prepararBancoDoLab(configuracao.postgresUrl, configuracao.postgresBanco);
    const lab = await iniciarLab({ ...configuracao, postgresUrl });
    process.stderr.write(`[lab] LAB no ar: abra ${lab.url} no navegador (Ctrl+C encerra)\n`);
    let encerrando = false;
    const encerrar = async (sinal) => {
        if (encerrando)
            return;
        encerrando = true;
        process.stderr.write(`[lab] ${sinal} recebido: encerrando\n`);
        await lab.fechar();
        process.stderr.write('[lab] LAB encerrado\n');
    };
    for (const sinal of ['SIGINT', 'SIGTERM']) {
        process.on(sinal, () => void encerrar(sinal));
    }
}
principal().catch((erro) => {
    // Sem pilha: a mensagem já diz o que fazer (ex.: porta ocupada e qual variável muda).
    process.stderr.write(`[lab] não foi possível subir o LAB: ${erro instanceof Error ? erro.message : String(erro)}\n`);
    process.exitCode = 1;
});
//# sourceMappingURL=lab.js.map