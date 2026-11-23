// Prepara a nuvem de desenvolvimento: PostgreSQL local, migrações, dados de demonstração e a API.
// Usado pelo terminal (npm run nuvem) e pelo servidor das telas (npm run erp).
import path from 'node:path';
import { criarApiDaNuvem } from './api.ts';
import type { ApiDaNuvem } from './api.ts';
import { BancoNuvem } from './banco.ts';
import { rotasDoCentral } from './central.ts';
import { aplicarInadimplencia, rotasDaGestaoDoCentral } from './central-gestao.ts';
import { rotasDaGestao } from './erp-gestao.ts';
import { rotasDoErp } from './erp.ts';
import { rotasDosCaixas } from './erp-caixas.ts';
import { rotasDosDispositivos } from './dispositivos.ts';
import { rotasDoRecebimento } from './recebimento.ts';
import { ACESSOS_DE_DEMONSTRACAO, segredoDasSessoes, semearDemonstracao } from './demonstracao.ts';
import { aplicarMigracoesNuvem } from './migracoes.ts';
import { ligarPostgresLocal } from './postgres-local.ts';

export interface NuvemPreparada {
  api: ApiDaNuvem;
  banco: BancoNuvem;
  mensagens: string[];
  desligar(): Promise<void>;
}

export async function prepararNuvem(pasta: string, portaBanco = Number(process.env['CONTINUUM_NUVEM_PORTA_BANCO'] ?? 5433)): Promise<NuvemPreparada> {
  const postgres = ligarPostgresLocal(path.join(pasta, 'postgres'), portaBanco);
  const banco = new BancoNuvem(postgres.url);
  const aplicadas = await banco.comoDono((c) => aplicarMigracoesNuvem(c));
  const semeou = await semearDemonstracao(banco);
  const segredo = segredoDasSessoes(pasta);
  const api = criarApiDaNuvem(banco, {
    segredo,
    dominioPadrao: ACESSOS_DE_DEMONSTRACAO.dono.dominio,
    rotasExtras: [rotasDaGestaoDoCentral(banco), rotasDaGestao(banco), rotasDoCentral(banco), rotasDoErp(banco), rotasDosCaixas(banco, segredo), rotasDosDispositivos(banco, segredo), rotasDoRecebimento(banco)],
  });
  // Uma vez por hora, suspende quem passou da tolerância de atraso (também roda ao abrir a lista de clientes).
  const cobranca = setInterval(() => void aplicarInadimplencia(banco).catch(() => undefined), 60 * 60 * 1000);
  cobranca.unref();
  const a = ACESSOS_DE_DEMONSTRACAO;
  const mensagens = [
    `PostgreSQL local na porta ${portaBanco} (dados em ${pasta})${aplicadas.length ? `; migrações aplicadas agora: ${aplicadas.join(', ')}` : ''}`,
    ...(semeou ? ['Dados de demonstração criados.'] : []),
    `Acessos de demonstração: Central ${a.central.email} / ${a.central.senha} · ERP (${a.dono.dominio}) ${a.dono.email} / ${a.dono.senha} e ${a.operador.email} / ${a.operador.senha}`,
  ];
  return {
    api,
    banco,
    mensagens,
    async desligar() {
      clearInterval(cobranca);
      await banco.fechar();
      postgres.parar();
    },
  };
}
