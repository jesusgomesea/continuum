import { parseArgs } from 'node:util';
import { executarCenario, TRANSICOES_ESPERADAS } from '../lab/cenario.js';
import { iniciarLab } from '../lab/lab.js';
import { prepararBancoDoLab } from '../lab/postgres-do-lab.js';
import { zerarLab } from '../lab/reset.js';
import { lerConfiguracaoLab } from './configuracao.js';
const USO = `uso: npm run cenario -- [--vendas N] [--ritmo R | --sem-pausa] [--sem-limite] [--json]
  --vendas N    vendas a gerar (padrão 1000)
  --ritmo R     vendas por segundo (padrão: sem pausa, o modo do cenário automatizado)
  --sem-limite  espera a fila escoar até o fim, sem o limite de 10 min (medição manual de filas grandes)
  --json        resultado em JSON (para registrar em docs)`;
/**
 * Cenário completo do Marco 1 (Fase 6, ADR 013): `npm run cenario`. Sobe um
 * LAB só dele, zerado, em porta livre e com dados próprios (lab/cenario/*.db e
 * o banco continuum_cenario): nunca encosta no LAB da demo. Gera as vendas,
 * derruba e restaura a nuvem, e confere que ela ficou igual ao local.
 */
async function principal() {
    const { values } = parseArgs({
        options: {
            vendas: { type: 'string', default: '1000' },
            ritmo: { type: 'string' },
            'sem-pausa': { type: 'boolean', default: false },
            'sem-limite': { type: 'boolean', default: false },
            json: { type: 'boolean', default: false },
            ajuda: { type: 'boolean', default: false },
        },
    });
    if (values.ajuda) {
        process.stderr.write(`${USO}\n`);
        return 0;
    }
    const vendas = Number(values.vendas);
    const ritmo = values.ritmo === undefined || values['sem-pausa'] ? null : Number(values.ritmo);
    if (!Number.isSafeInteger(vendas) || vendas < 10 || (ritmo !== null && !(ritmo > 0))) {
        process.stderr.write(`argumentos inválidos\n${USO}\n`);
        return 1;
    }
    const daMaquina = lerConfiguracaoLab();
    const configuracao = {
        ...daMaquina,
        postgresBanco: 'continuum_cenario',
        bancoAplicacao: 'lab/cenario/vendas.db',
        bancoInterno: 'lab/cenario/continuum.db',
        portas: { lab: 0, nuvem: 0, kryptonita: 0 },
    };
    await zerarLab(configuracao);
    const postgresUrl = await prepararBancoDoLab(configuracao.postgresUrl, configuracao.postgresBanco);
    const lab = await iniciarLab({ ...configuracao, postgresUrl });
    const log = (linha) => {
        process.stderr.write(`[cenario] ${linha}\n`);
    };
    try {
        const resultado = await executarCenario(lab, {
            vendas,
            ritmo,
            log,
            ...(values['sem-limite'] ? { limiteEscoamentoMs: Number.POSITIVE_INFINITY } : {}),
        });
        if (values.json) {
            process.stdout.write(`${JSON.stringify(resultado, null, 2)}\n`);
        }
        else {
            const s = (ms) => `${(ms / 1000).toFixed(1)} s`;
            process.stdout.write([
                `resultado: ${resultado.aprovado ? 'APROVADO' : 'REPROVADO'}`,
                `vendas: ${resultado.vendasFeitas} de ${resultado.vendasPedidas}, ${resultado.falhasDoGerador} recusadas${resultado.ultimoErroDoGerador === null ? '' : ` (${resultado.ultimoErroDoGerador})`}`,
                `vendas por trecho: ${resultado.vendas.antes} antes da queda, ${resultado.vendas.emOffline} em OFFLINE, ${resultado.vendas.depois} depois da volta`,
                `duração: ${s(resultado.duracaoMs)}; até OFFLINE: ${s(resultado.ateOfflineMs)}; da volta até SAUDÁVEL com a fila vazia: ${s(resultado.ateRecuperarMs)}`,
                `maior fila: ${resultado.maiorFila} eventos`,
                `escoamento: ${resultado.escoamento.filaNaVolta} na fila ao restaurar; ${resultado.escoamento.eventos} eventos entregues em ${s(resultado.escoamento.ms)} (${resultado.escoamento.eventosPorSegundo} eventos/s)`,
                `em OFFLINE: ${resultado.emOffline.envios} envios tentados; nuvem com ${resultado.emOffline.nuvemNaEntrada} eventos ao entrar e ${resultado.emOffline.nuvemNaSaida} ao restaurar`,
                `transições: ${resultado.transicoes.join(', ')}`,
                `  esperadas: ${TRANSICOES_ESPERADAS.join(', ')}`,
                `loja: ${resultado.local.vendas} vendas, ${resultado.local.eventos} eventos; nuvem: ${resultado.nuvem?.vendas ?? '?'} vendas, ${resultado.nuvem?.eventos ?? '?'} eventos`,
                `divergências: ${resultado.divergencias.length === 0 ? 'nenhuma' : `\n  ${resultado.divergencias.join('\n  ')}`}`,
            ].join('\n') + '\n');
        }
        return resultado.aprovado ? 0 : 1;
    }
    finally {
        await lab.fechar();
    }
}
principal()
    .then((codigo) => {
    process.exitCode = codigo;
})
    .catch((erro) => {
    process.stderr.write(`[cenario] falhou: ${erro instanceof Error ? erro.message : String(erro)}\n`);
    process.exitCode = 1;
});
//# sourceMappingURL=cenario.js.map