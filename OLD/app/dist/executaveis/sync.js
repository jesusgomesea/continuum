import { abrirBanco } from '../banco/sqlite.js';
import { abrirBancoInterno, EstadoSqlite } from '../estado/estado-sqlite.js';
import { verificarSaude } from '../estado/health-check.js';
import { Orquestrador } from '../estado/orquestrador.js';
import { OutboxSqlite } from '../outbox/outbox-sqlite.js';
import { RegistroEventosSqlite } from '../registro/registro-sqlite.js';
import { SyncEngine } from '../sync/sync-engine.js';
import { lerConfiguracaoSync } from './configuracao.js';
/**
 * Executável do Sync Engine (ADR 011 e ADR 012): `npm run sync`.
 * Lê a configuração do ambiente ou do .env, abre o banco da aplicação
 * (outbox) e o banco interno (estado e registro geral), e roda o health check
 * e o sync até receber SIGINT ou SIGTERM.
 */
const configuracao = lerConfiguracaoSync();
const bancoAplicacao = abrirBanco(configuracao.bancoAplicacao);
const bancoInterno = abrirBancoInterno(configuracao.bancoInterno);
const registro = new RegistroEventosSqlite(bancoInterno);
const estado = new EstadoSqlite(bancoInterno, registro, { parametros: configuracao.parametros });
const outbox = new OutboxSqlite(bancoAplicacao);
const engine = new SyncEngine({
    outbox,
    registro,
    urlBase: configuracao.nuvemUrl,
    tamanhoLote: configuracao.tamanhoLote,
    timeoutMs: configuracao.envioTimeoutMs,
    backoff: configuracao.backoff,
});
const orquestrador = new Orquestrador({
    estado,
    outbox,
    engine,
    verificarSaude: () => verificarSaude({ urlBase: configuracao.nuvemUrl, timeoutMs: configuracao.healthTimeoutMs }),
    intervaloHealthMs: configuracao.healthIntervaloMs,
});
const inicial = estado.ler();
process.stderr.write(`[continuum] sync iniciado: origem ${outbox.origemId}, estado ${inicial.estado}, modo ${inicial.modo}, nuvem ${configuracao.nuvemUrl}\n`);
orquestrador.iniciar();
let encerrando = false;
async function encerrar(sinal) {
    if (encerrando) {
        return;
    }
    encerrando = true;
    process.stderr.write(`[continuum] ${sinal} recebido: encerrando\n`);
    await orquestrador.parar();
    bancoAplicacao.fechar();
    bancoInterno.fechar();
    process.stderr.write('[continuum] sync encerrado\n');
}
for (const sinal of ['SIGINT', 'SIGTERM']) {
    process.on(sinal, () => void encerrar(sinal));
}
//# sourceMappingURL=sync.js.map