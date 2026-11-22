// Sync Engine e recebimento: a fila do caixa chega ao destino em ordem, sem duplicar e sem perder,
// mesmo com a rede caindo, resposta perdida, evento torto ou destino que perdeu dados.
import { gerarId } from '@continuum/dominio';
import { describe, expect, it } from 'vitest';
import {
  abrirBanco,
  aplicarEvidencia,
  aplicarMigracoes,
  calcularEspera,
  classificarResposta,
  Fila,
  MotorDeSync,
  receberLote,
  SITUACAO_INICIAL,
  SQL_FILA,
  SQL_RECEBIMENTO,
} from '../src/index.ts';
import type { BancoSqlite, Transporte } from '../src/index.ts';

const CAIXA = gerarId();
const abertura = (n: number) => ({ sessaoId: gerarId(), operador: `Operador ${n}`, fundoCentavos: n * 100 });

function caixa() {
  const banco = abrirBanco(':memory:');
  aplicarMigracoes(banco, [{ numero: 1, nome: 'fila', sql: SQL_FILA }]);
  const fila = new Fila(banco);
  return { fila, adicionar: (n: number) => fila.adicionar('caixa.aberto', abertura(n)) };
}

function destino(): BancoSqlite {
  const banco = abrirBanco(':memory:');
  aplicarMigracoes(banco, [{ numero: 1, nome: 'recebimento', sql: SQL_RECEBIMENTO }]);
  return banco;
}

const recebidos = (banco: BancoSqlite) => banco.consultar('SELECT seq FROM eventos_recebidos ORDER BY seq').map((l) => Number(l['seq']));

/** Uma "rede" entre o caixa e o destino, que o teste pode derrubar, ou fazer perder a resposta. */
interface Rede {
  noAr: boolean;
  perderProximaResposta: boolean;
  recusarId: string | null;
  transporte: Transporte;
}

function rede(alvo: { banco: BancoSqlite }): Rede {
  const r: Rede = {
    noAr: true,
    perderProximaResposta: false,
    recusarId: null as string | null,
    transporte: {
      async enviarLote(origemId, eventos) {
        if (!r.noAr) return { classe: 'temporario', erro: 'sem rede' };
        if (r.recusarId !== null && eventos.some((e) => e.id === r.recusarId)) return { classe: 'lote-recusado', status: 400, erro: 'evento torto' };
        const resposta = receberLote(alvo.banco, origemId, { eventos });
        if (r.perderProximaResposta) {
          r.perderProximaResposta = false;
          return { classe: 'temporario', erro: 'resposta perdida' };
        }
        return classificarResposta(resposta.status, resposta.corpo);
      },
      async verificarSaude() {
        return r.noAr;
      },
    },
  };
  return r;
}

function motor(fila: Fila, transporte: Transporte, estados: string[] = []) {
  return new MotorDeSync({
    fila,
    transporte,
    origemId: CAIXA,
    tamanhoLote: 4,
    aleatorio: () => 0,
    aoMudarEstado: (s) => estados.push(s.estado),
  });
}

describe('Sync Engine', () => {
  it('envia a fila em lotes e só marca o que o destino confirmou', async () => {
    const c = caixa();
    for (let i = 1; i <= 6; i++) c.adicionar(i);
    const alvo = { banco: destino() };
    const m = motor(c.fila, rede(alvo).transporte);

    expect(await m.sincronizarUmaVez()).toMatchObject({ tipo: 'confirmado', ultimaSeq: 4, marcados: 4 });
    expect(await m.sincronizarUmaVez()).toMatchObject({ tipo: 'confirmado', ultimaSeq: 6, marcados: 2 });
    expect(await m.sincronizarUmaVez()).toEqual({ tipo: 'vazio' });
    expect(c.fila.contarPendentes()).toBe(0);
    expect(recebidos(alvo.banco)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('queda de rede: DEGRADADO, OFFLINE, a fila cresce; na volta, RECUPERANDO, SINCRONIZANDO e SAUDÁVEL sem perder nada', async () => {
    const c = caixa();
    const alvo = { banco: destino() };
    const r = rede(alvo);
    const estados: string[] = [];
    const m = motor(c.fila, r.transporte, estados);

    r.noAr = false;
    for (let i = 1; i <= 20; i++) {
      c.adicionar(i); // a loja continua vendendo
      if (i <= 4) await m.sincronizarUmaVez();
    }
    expect(m.situacao().estado).toBe('offline');
    expect(c.fila.contarPendentes()).toBe(20);

    r.noAr = true;
    for (let i = 0; i < 20 && (m.situacao().estado !== 'saudavel' || c.fila.contarPendentes() > 0); i++) await m.sincronizarUmaVez();

    expect(estados).toEqual(['degradado', 'offline', 'recuperando', 'sincronizando', 'saudavel']);
    expect(c.fila.contarPendentes()).toBe(0);
    expect(recebidos(alvo.banco)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('resposta perdida: reenviar não duplica (o destino reconhece o repetido)', async () => {
    const c = caixa();
    for (let i = 1; i <= 3; i++) c.adicionar(i);
    const alvo = { banco: destino() };
    const r = rede(alvo);
    const m = motor(c.fila, r.transporte);

    r.perderProximaResposta = true;
    expect((await m.sincronizarUmaVez()).tipo).toBe('temporario');
    expect(c.fila.contarPendentes()).toBe(3); // o caixa não sabe que chegou: continua pendente
    expect(await m.sincronizarUmaVez()).toMatchObject({ tipo: 'confirmado', ultimaSeq: 3 });
    expect(recebidos(alvo.banco)).toEqual([1, 2, 3]);
  });

  it('evento recusado: divide o lote até achar o culpado, que bloqueia a fila; os anteriores chegam', async () => {
    const c = caixa();
    const eventos = [1, 2, 3, 4].map((i) => c.adicionar(i));
    const alvo = { banco: destino() };
    const r = rede(alvo);
    r.recusarId = eventos[2]?.id ?? null; // o 3º é torto
    const m = motor(c.fila, r.transporte);

    let resultado = await m.sincronizarUmaVez();
    for (let i = 0; i < 10 && resultado.tipo !== 'bloqueado'; i++) resultado = await m.sincronizarUmaVez();

    expect(resultado).toMatchObject({ tipo: 'bloqueado', bloqueio: { motivo: 'evento', seq: 3, status: 400 } });
    expect(recebidos(alvo.banco)).toEqual([1, 2]);
    expect(c.fila.bloqueada()).toBe(true);
    expect((await m.sincronizarUmaVez()).tipo).toBe('bloqueado'); // parado até alguém analisar
  });

  it('destino que perdeu dados ("fora de ordem"): reenvia a partir do que ele tem', async () => {
    const c = caixa();
    for (let i = 1; i <= 3; i++) c.adicionar(i);
    const alvo = { banco: destino() };
    const r = rede(alvo);
    const m = motor(c.fila, r.transporte);
    await m.sincronizarUmaVez(); // 1 a 3 entregues

    alvo.banco = destino(); // o destino foi restaurado de um backup antigo: não tem nada
    c.adicionar(4);
    expect((await m.sincronizarUmaVez()).tipo).toBe('reenviar');
    expect(await m.sincronizarUmaVez()).toMatchObject({ tipo: 'confirmado', ultimaSeq: 4 });
    expect(recebidos(alvo.banco)).toEqual([1, 2, 3, 4]);
  });

  it('origem recusada (ex.: caixa não autorizado) para tudo', async () => {
    const c = caixa();
    c.adicionar(1);
    const m = motor(c.fila, {
      enviarLote: async () => ({ classe: 'origem-recusada', status: 403, erro: 'caixa desativado' }),
      verificarSaude: async () => true,
    });
    expect(await m.sincronizarUmaVez()).toMatchObject({ tipo: 'bloqueado', bloqueio: { motivo: 'origem', status: 403 } });
  });

  it('iniciar e parar: o laço envia sozinho', async () => {
    const c = caixa();
    for (let i = 1; i <= 5; i++) c.adicionar(i);
    const alvo = { banco: destino() };
    const m = new MotorDeSync({ fila: c.fila, transporte: rede(alvo).transporte, origemId: CAIXA, esperaOciosaMs: 5 });
    m.iniciar();
    for (let i = 0; i < 50 && c.fila.contarPendentes() > 0; i++) await new Promise((ok) => setTimeout(ok, 5));
    await m.parar();
    expect(recebidos(alvo.banco)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('recebimento', () => {
  const lote = (eventos: unknown[]) => ({ eventos });
  function evento(seq: number, id = gerarId()) {
    return { id, seq, tipo: 'caixa.aberto', versao: 1, ocorridoEm: new Date().toISOString(), dados: abertura(seq) };
  }

  it('aplica em ordem e reconhece o repetido', () => {
    const banco = destino();
    const e1 = evento(1);
    expect(receberLote(banco, CAIXA, lote([e1, evento(2)])).corpo.ultimaSeq).toBe(2);
    expect(receberLote(banco, CAIXA, lote([e1])).corpo.eventos).toEqual([{ id: e1.id, resultado: 'repetido' }]);
  });

  it('buraco na sequência: 409 com a última seq que o destino tem, e nada do lote fica', () => {
    const banco = destino();
    receberLote(banco, CAIXA, lote([evento(1)]));
    expect(receberLote(banco, CAIXA, lote([evento(3)]))).toMatchObject({ status: 409, corpo: { ultimaSeq: 1 } });
    expect(recebidos(banco)).toEqual([1]);
  });

  it('evento fora do contrato ou lote mal formado: 400', () => {
    const banco = destino();
    expect(receberLote(banco, CAIXA, lote([{ ...evento(1), tipo: 'venda.apagada' }])).status).toBe(400);
    expect(receberLote(banco, CAIXA, lote([])).status).toBe(400);
    expect(receberLote(banco, 'nao-e-uuid', lote([evento(1)])).status).toBe(400);
    expect(receberLote(banco, CAIXA, lote([evento(1), evento(3)])).status).toBe(400);
  });

  it('cada caixa tem a sua sequência: o 1 do Caixa 1 não se confunde com o 1 do Caixa 2', () => {
    const banco = destino();
    expect(receberLote(banco, gerarId(), lote([evento(1)])).status).toBe(200);
    expect(receberLote(banco, gerarId(), lote([evento(1)])).status).toBe(200);
  });
});

describe('máquina de estados e espera', () => {
  it('transições pelas regras', () => {
    let s = SITUACAO_INICIAL;
    s = aplicarEvidencia(s, { tipo: 'falha' }).situacao;
    expect(s.estado).toBe('degradado');
    s = aplicarEvidencia(s, { tipo: 'sucesso', pendentes: 3 }).situacao;
    expect(s.estado).toBe('saudavel');
    s = aplicarEvidencia(s, { tipo: 'falha' }).situacao;
    s = aplicarEvidencia(s, { tipo: 'sucesso', pendentes: 500 }).situacao;
    expect(s.estado).toBe('sincronizando'); // fila grande: ainda não é "em dia"
  });

  it('a espera dobra a cada falha, até o máximo', () => {
    const o = { inicialMs: 1000, maximoMs: 8000 };
    expect([1, 2, 3, 4, 5].map((f) => calcularEspera(f, o, () => 0.999999))).toEqual([1000, 2000, 4000, 8000, 8000]);
    expect(calcularEspera(1, o, () => 0)).toBe(500);
  });
});
