// Migrações: as mudanças na estrutura do banco, numeradas e aplicadas em ordem, uma única vez
// (docs/04-banco-de-dados.md, seção 6).
//
// - Cada migração tem número (1, 2, 3...) e nome. O banco guarda quais já recebeu, na tabela `migracoes`.
// - Uma migração já aplicada NUNCA é editada: corrigir é criar a próxima. Se o nome gravado no banco não
//   bater com o do programa, alguém editou uma migração antiga, e o programa se recusa a seguir.
// - Um PDV desatualizado se atualiza sozinho: ao abrir, aplica as migrações que faltam.
import type { BancoSqlite } from './banco.ts';

export interface Migracao {
  readonly numero: number;
  readonly nome: string;
  readonly sql: string;
}

export class MigracaoError extends Error {
  override name = 'MigracaoError';
}

const TABELA = `
  CREATE TABLE IF NOT EXISTS migracoes (
    numero     INTEGER PRIMARY KEY CHECK (numero >= 1),
    nome       TEXT    NOT NULL,
    aplicada_em TEXT   NOT NULL
  ) STRICT;
`;

/** Confere a lista e aplica, cada uma na sua transação, as que o banco ainda não tem. Devolve os números aplicados. */
export function aplicarMigracoes(
  banco: BancoSqlite,
  lista: readonly Migracao[],
  relogio: () => Date = () => new Date(),
): number[] {
  lista.forEach((m, i) => {
    if (m.numero !== i + 1) {
      throw new MigracaoError(`migração "${m.nome}": esperado o número ${i + 1}, recebido ${m.numero} (sem buracos nem repetidas)`);
    }
  });
  banco.executar(TABELA);

  const gravadas = banco.consultar('SELECT numero, nome FROM migracoes ORDER BY numero');
  for (const linha of gravadas) {
    const numero = Number(linha['numero']);
    const doPrograma = lista[numero - 1];
    if (doPrograma === undefined) {
      throw new MigracaoError(`o banco está na migração ${numero}, mais nova que este programa (${lista.length}): atualize o programa`);
    }
    if (doPrograma.nome !== String(linha['nome'])) {
      throw new MigracaoError(`a migração ${numero} foi aplicada como "${String(linha['nome'])}" e o programa tem "${doPrograma.nome}": migração antiga não se edita`);
    }
  }

  const aplicadas: number[] = [];
  for (const m of lista.slice(gravadas.length)) {
    banco.transacao(() => {
      banco.executar(m.sql);
      banco.rodar('INSERT INTO migracoes (numero, nome, aplicada_em) VALUES (?, ?, ?)', m.numero, m.nome, relogio().toISOString());
    });
    aplicadas.push(m.numero);
  }
  return aplicadas;
}

/** Em qual migração o banco está (0 = nenhuma). */
export function migracaoAtual(banco: BancoSqlite): number {
  banco.executar(TABELA);
  return Number(banco.consultarUma('SELECT COALESCE(MAX(numero), 0) AS n FROM migracoes')?.['n']);
}
