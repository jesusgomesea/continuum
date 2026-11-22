// Fila (outbox) e migrações: o que cada regra garante.
import { gerarId } from '@continuum/dominio';
import { ContratoInvalidoError } from '@continuum/contratos';
import { describe, expect, it } from 'vitest';
import { abrirBanco, aplicarMigracoes, Fila, MigracaoError, migracaoAtual, SQL_FILA } from '../src/index.ts';
import type { BancoSqlite, Migracao } from '../src/index.ts';

const SESSAO = '019a0b7c-0000-7000-8000-0000000000c1';

// Um banco de teste com a fila e uma tabela de "vendas" simplificada.
const MIGRACOES: Migracao[] = [
  { numero: 1, nome: 'fila', sql: SQL_FILA },
  { numero: 2, nome: 'vendas_teste', sql: 'CREATE TABLE vendas_teste (id TEXT PRIMARY KEY, total INTEGER NOT NULL) STRICT;' },
];

function preparar(relogio: () => Date = () => new Date('2026-11-21T12:00:00.000Z')): { banco: BancoSqlite; fila: Fila } {
  const banco = abrirBanco(':memory:');
  aplicarMigracoes(banco, MIGRACOES);
  return { banco, fila: new Fila(banco, { relogio }) };
}

const abertura = (operador = 'Ana') => ({ sessaoId: SESSAO, operador, fundoCentavos: 10000 });
const contarVendas = (banco: BancoSqlite) => Number(banco.consultarUma('SELECT count(*) AS n FROM vendas_teste')?.['n']);

describe('venda e evento juntos, ou nenhum (regra de ouro)', () => {
  it('transação confirmada: a venda e o evento estão lá', () => {
    const { banco, fila } = preparar();
    banco.transacao(() => {
      banco.rodar('INSERT INTO vendas_teste (id, total) VALUES (?, ?)', gerarId(), 1890);
      fila.adicionar('caixa.aberto', abertura());
    });
    expect(contarVendas(banco)).toBe(1);
    expect(fila.contarPendentes()).toBe(1);
  });

  it('falha depois de gravar os dois: nenhum dos dois fica', () => {
    const { banco, fila } = preparar();
    expect(() =>
      banco.transacao(() => {
        banco.rodar('INSERT INTO vendas_teste (id, total) VALUES (?, ?)', gerarId(), 1890);
        fila.adicionar('caixa.aberto', abertura());
        throw new Error('queda no meio da venda');
      }),
    ).toThrow('queda no meio da venda');
    expect(contarVendas(banco)).toBe(0);
    expect(fila.contarPendentes()).toBe(0);
  });

  it('evento fora do contrato: nem o evento nem a venda são gravados', () => {
    const { banco, fila } = preparar();
    expect(() =>
      banco.transacao(() => {
        banco.rodar('INSERT INTO vendas_teste (id, total) VALUES (?, ?)', gerarId(), 1890);
        fila.adicionar('caixa.aberto', { ...abertura(), fundoCentavos: -1 });
      }),
    ).toThrow(ContratoInvalidoError);
    expect(contarVendas(banco)).toBe(0);
    expect(fila.contarPendentes()).toBe(0);
  });
});

describe('fila', () => {
  it('guarda em ordem, com seq 1, 2, 3 e a versão atual do contrato', () => {
    const { fila } = preparar();
    for (const nome of ['Ana', 'Bia', 'Caio']) fila.adicionar('caixa.aberto', abertura(nome));
    const eventos = fila.pendentes(10);
    expect(eventos.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(eventos.map((e) => e.versao)).toEqual([1, 1, 1]);
    expect(eventos[2]?.tipo === 'caixa.aberto' && eventos[2].dados.operador).toBe('Caio');
    expect(fila.pendentes(2)).toHaveLength(2);
  });

  it('o evento gravado não pode ser editado nem apagado enquanto pendente', () => {
    const { banco, fila } = preparar();
    fila.adicionar('caixa.aberto', abertura());
    expect(() => banco.rodar("UPDATE outbox SET dados = '{}'")).toThrow(/não são editados/);
    expect(() => banco.rodar('DELETE FROM outbox')).toThrow(/não pode ser apagado/);
  });

  it('confirmação "recebido até a seq 2" marca só os dois primeiros, e só uma vez', () => {
    const { banco, fila } = preparar();
    for (let i = 0; i < 3; i++) fila.adicionar('caixa.aberto', abertura());
    expect(fila.marcarSincronizados(2)).toBe(2);
    expect(fila.contarPendentes()).toBe(1);
    expect(fila.marcarSincronizados(2)).toBe(0); // repetir não muda nada
    expect(() => banco.rodar("UPDATE outbox SET sincronizado_em = '2027-01-01T00:00:00.000Z' WHERE seq = 1")).toThrow(/já marcado/);
  });

  it('evento recusado de vez bloqueia a fila', () => {
    const { fila } = preparar();
    fila.adicionar('caixa.aberto', abertura());
    expect(fila.bloqueada()).toBe(false);
    fila.registrarFalha(1, 422, 'produto desconhecido');
    expect(fila.bloqueada()).toBe(true);
    expect(fila.falhas()).toEqual([{ seq: 1, status: 422, erro: 'produto desconhecido', falhouEm: '2026-11-21T12:00:00.000Z' }]);
    expect(() => fila.registrarFalha(99, 500, 'x')).toThrow(/seq 99/);
  });

  it('limpeza: apaga só os confirmados há mais de 90 dias, e a seq nunca se repete', () => {
    let agora = new Date('2026-01-01T00:00:00.000Z');
    const { fila } = preparar(() => agora);
    fila.adicionar('caixa.aberto', abertura());
    fila.adicionar('caixa.aberto', abertura());
    fila.marcarSincronizados(1);

    agora = new Date('2026-03-01T00:00:00.000Z'); // 59 dias depois: ainda não
    expect(fila.limparSincronizados()).toBe(0);

    agora = new Date('2026-04-15T00:00:00.000Z'); // 104 dias depois: o confirmado sai, o pendente fica
    expect(fila.limparSincronizados()).toBe(1);
    expect(fila.todos().map((e) => e.seq)).toEqual([2]);

    expect(fila.adicionar('caixa.aberto', abertura()).seq).toBe(3);
  });
});

describe('migrações', () => {
  it('aplica em ordem, uma vez só; abrir de novo não reaplica', () => {
    const banco = abrirBanco(':memory:');
    expect(aplicarMigracoes(banco, MIGRACOES)).toEqual([1, 2]);
    expect(aplicarMigracoes(banco, MIGRACOES)).toEqual([]);
    expect(migracaoAtual(banco)).toBe(2);
  });

  it('banco antigo recebe só a migração nova (PDV desatualizado se atualiza sozinho)', () => {
    const banco = abrirBanco(':memory:');
    aplicarMigracoes(banco, MIGRACOES.slice(0, 1));
    expect(aplicarMigracoes(banco, MIGRACOES)).toEqual([2]);
  });

  it('migração antiga editada (nome diferente) é recusada', () => {
    const banco = abrirBanco(':memory:');
    aplicarMigracoes(banco, MIGRACOES);
    const editada = [MIGRACOES[0], { numero: 2, nome: 'vendas_outro_nome', sql: '' }] as Migracao[];
    expect(() => aplicarMigracoes(banco, editada)).toThrow(MigracaoError);
  });

  it('banco mais novo que o programa é recusado', () => {
    const banco = abrirBanco(':memory:');
    aplicarMigracoes(banco, MIGRACOES);
    expect(() => aplicarMigracoes(banco, MIGRACOES.slice(0, 1))).toThrow(/mais nova que este programa/);
  });

  it('lista com número fora de ordem é recusada', () => {
    const banco = abrirBanco(':memory:');
    const errada = [{ numero: 2, nome: 'x', sql: '' }];
    expect(() => aplicarMigracoes(banco, errada)).toThrow(/esperado o número 1/);
  });

  it('migração com erro de SQL não deixa nada pela metade', () => {
    const banco = abrirBanco(':memory:');
    const quebrada: Migracao[] = [
      { numero: 1, nome: 'boa', sql: 'CREATE TABLE a (x INTEGER) STRICT;' },
      { numero: 2, nome: 'quebrada', sql: 'CREATE TABLE b (x INTEGER) STRICT; ISSO NAO E SQL;' },
    ];
    expect(() => aplicarMigracoes(banco, quebrada)).toThrow();
    expect(migracaoAtual(banco)).toBe(1);
    expect(banco.consultarUma("SELECT 1 FROM sqlite_master WHERE name = 'b'")).toBeUndefined();
  });
});
