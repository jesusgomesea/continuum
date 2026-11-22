// Dados de demonstração da nuvem (só em desenvolvimento): uma pessoa da Equipe Continuum e o cliente
// "Mercadinho do Bairro" com a loja MERCBAIRRO, um dono e um operador. Só cria se o banco estiver vazio.
// As senhas abaixo são de DEMONSTRAÇÃO e ficam guardadas no banco só como hash.
import { gerarId } from '@continuum/dominio';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { BancoNuvem } from './banco.ts';
import { hashDaSenha } from './seguranca.ts';

export const ACESSOS_DE_DEMONSTRACAO = {
  central: { email: 'equipe@continuum.app', senha: 'continuum2026' },
  dono: { email: 'dono@mercbairro.com.br', senha: 'mercado2026', dominio: 'mercbairro.continuum.app' },
  operador: { email: 'caixa@mercbairro.com.br', senha: 'caixa2026', dominio: 'mercbairro.continuum.app' },
} as const;

/** Cria os dados de demonstração, se o banco ainda não tem ninguém da Equipe. Devolve true se criou agora. */
export async function semearDemonstracao(banco: BancoNuvem): Promise<boolean> {
  return banco.transacaoDaPlataforma(async (tx) => {
    const ja = await tx.consultarUma('SELECT 1 FROM equipe_continuum LIMIT 1');
    if (ja !== undefined) return false;
    const a = ACESSOS_DE_DEMONSTRACAO;
    await tx.consultar("INSERT INTO equipe_continuum (id, nome, email, senha_hash, papel) VALUES ($1, 'Equipe Continuum', $2, $3, 'admin')", gerarId(), a.central.email, hashDaSenha(a.central.senha));
    const cliente = gerarId();
    await tx.consultar(
      "INSERT INTO clientes (id, tipo_documento, documento, nome, nome_fantasia, segmento, dominio) VALUES ($1, 'CNPJ', '11222333000181', 'Mercadinho do Bairro Ltda', 'Mercadinho do Bairro', 'mercearia', $2)",
      cliente, a.dono.dominio,
    );
    await tx.consultar(
      `INSERT INTO parametros_cliente (cliente_id, modelo, comprovante) VALUES ($1, 'mercearia', $2)`,
      cliente, JSON.stringify({ cabecalho: ['Mercadinho do Bairro', 'Rua Exemplo, 123 · Centro'], rodape: 'Obrigado pela preferência!', largura: 80 }),
    );
    await tx.consultar("INSERT INTO lojas (id, cliente_id, nome_reduzido, nome) VALUES ($1, $2, 'MERCBAIRRO', 'Mercadinho do Bairro')", gerarId(), cliente);
    await tx.consultar("INSERT INTO usuarios (id, cliente_id, nome, email, senha_hash, perfil) VALUES ($1, $2, 'Dona Maria', $3, $4, 'dono')", gerarId(), cliente, a.dono.email, hashDaSenha(a.dono.senha));
    await tx.consultar("INSERT INTO usuarios (id, cliente_id, nome, email, senha_hash, perfil) VALUES ($1, $2, 'João do Caixa', $3, $4, 'operador')", gerarId(), cliente, a.operador.email, hashDaSenha(a.operador.senha));
    return true;
  });
}

/** O segredo que assina as sessões: CONTINUUM_SEGREDO, ou um aleatório guardado na pasta de dados (desenvolvimento). */
export function segredoDasSessoes(pasta: string): string {
  const doAmbiente = process.env['CONTINUUM_SEGREDO'];
  if (doAmbiente !== undefined && doAmbiente.length >= 32) return doAmbiente;
  const arquivo = path.join(pasta, 'segredo.txt');
  if (existsSync(arquivo)) return readFileSync(arquivo, 'utf8').trim();
  mkdirSync(pasta, { recursive: true });
  const segredo = randomBytes(32).toString('base64url');
  writeFileSync(arquivo, segredo);
  return segredo;
}
