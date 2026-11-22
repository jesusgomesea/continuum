import { zerarLab } from '../lab/reset.js';
import { lerConfiguracaoLab } from './configuracao.js';
/** `npm run lab:reset` (ADR 013): zera o SQLite e o PostgreSQL do LAB, com o LAB parado. */
zerarLab(lerConfiguracaoLab())
    .then((apagados) => {
    process.stderr.write(`[lab] zerado: ${apagados.join(', ')}\n[lab] o próximo npm run lab começa do zero\n`);
})
    .catch((erro) => {
    process.stderr.write(`[lab] não foi possível zerar: ${erro instanceof Error ? erro.message : String(erro)}\n`);
    process.exitCode = 1;
});
//# sourceMappingURL=lab-reset.js.map