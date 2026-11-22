import { existsSync } from 'node:fs';
import { abrirBanco } from '../banco/sqlite.js';
import { abrirBancoInterno, EstadoSqlite } from '../estado/estado-sqlite.js';
import { alertaDoEstado, MODOS } from '../estado/maquina-de-estados.js';
import { RegistroEventosSqlite } from '../registro/registro-sqlite.js';
import { lerConfiguracaoOperador } from './configuracao.js';
const USO = `uso: continuum <comando>
  status           estado, modo, alerta, contadores, proposta, bloqueio e fila
  status --json    o mesmo em JSON (painel da Fase 6)
  modo <modo>      ${MODOS.join(' | ')}
  confirmar        em MANUAL, aplica a transição proposta`;
/**
 * Comando do operador (ADR 012): `npm run continuum -- <comando>`. Grava no
 * banco interno, o mesmo que o executável do sync usa; funciona com o sync
 * parado ou rodando. Para JSON limpo, use `npm run -s continuum -- status --json`.
 */
export function executarOperador(argumentos, ler) {
    const [comando, ...resto] = argumentos;
    const falha = (erro) => ({ codigo: 1, saida: '', erro: `${erro}\n` });
    const ok = (saida) => ({ codigo: 0, saida: `${saida}\n`, erro: '' });
    if (comando === undefined || !['status', 'modo', 'confirmar'].includes(comando)) {
        return falha(comando === undefined ? USO : `comando desconhecido: ${comando}\n${USO}`);
    }
    let configuracao;
    try {
        configuracao = lerConfiguracaoOperador(ler);
    }
    catch (erro) {
        return falha(String(erro instanceof Error ? erro.message : erro));
    }
    const banco = abrirBancoInterno(configuracao.bancoInterno);
    try {
        const estado = new EstadoSqlite(banco, new RegistroEventosSqlite(banco), { parametros: configuracao.parametros });
        if (comando === 'modo') {
            const modo = resto[0];
            if (modo === undefined || !MODOS.includes(modo)) {
                return falha(`modo inválido: ${modo ?? '(vazio)'} (use ${MODOS.join(', ')})`);
            }
            return ok(estado.alterarModo(modo) ? `modo alterado para ${modo}` : `modo já era ${modo}`);
        }
        if (comando === 'confirmar') {
            try {
                const { transicao } = estado.confirmar();
                return ok(`transição confirmada: ${transicao?.de} -> ${transicao?.para}`);
            }
            catch (erro) {
                return falha(String(erro instanceof Error ? erro.message : erro));
            }
        }
        const atual = estado.ler();
        const status = {
            estado: atual.estado,
            modo: atual.modo,
            alerta: alertaDoEstado(atual.estado),
            falhasSeguidas: atual.falhasSeguidas,
            sucessosSeguidos: atual.sucessosSeguidos,
            proposta: atual.proposta,
            bloqueio: atual.bloqueio,
            pendentes: contarPendentes(configuracao.bancoAplicacao),
            alteradoEm: atual.alteradoEm,
            parametros: configuracao.parametros,
        };
        if (resto.includes('--json')) {
            return ok(JSON.stringify(status));
        }
        const linhas = [
            `estado:    ${status.estado}${status.alerta === 'nenhum' ? '' : ` (alerta ${status.alerta})`}`,
            `modo:      ${status.modo}`,
            `contagem:  ${status.falhasSeguidas} falhas seguidas, ${status.sucessosSeguidos} sucessos seguidos`,
            `proposta:  ${status.proposta === null ? 'nenhuma' : `${status.proposta.de} -> ${status.proposta.para} (${status.proposta.motivo})`}`,
            `bloqueio:  ${status.bloqueio === null ? 'nenhum' : JSON.stringify(status.bloqueio)}`,
            `pendentes: ${status.pendentes ?? 'desconhecido (CONTINUUM_BANCO_APLICACAO não definido ou inexistente)'}`,
            `alterado:  ${status.alteradoEm}`,
        ];
        return ok(linhas.join('\n'));
    }
    finally {
        banco.fechar();
    }
}
/**
 * Eventos pendentes na outbox; null se o banco da aplicação não foi informado,
 * não existe ou ainda não tem outbox. Só lê: não abre pela OutboxSqlite, que
 * criaria o esquema e a origem no banco da aplicação.
 */
function contarPendentes(caminho) {
    if (caminho === undefined || !existsSync(caminho)) {
        return null;
    }
    const banco = abrirBanco(caminho);
    try {
        const tabela = banco.consultarUma("SELECT 1 AS existe FROM sqlite_master WHERE type = 'table' AND name = 'outbox'");
        if (tabela === undefined) {
            return null;
        }
        return Number(banco.consultarUma('SELECT count(*) AS n FROM outbox WHERE sincronizado_em IS NULL')?.['n']);
    }
    finally {
        banco.fechar();
    }
}
if (import.meta.main) {
    const { codigo, saida, erro } = executarOperador(process.argv.slice(2));
    process.stdout.write(saida);
    process.stderr.write(erro);
    process.exitCode = codigo;
}
//# sourceMappingURL=operador.js.map