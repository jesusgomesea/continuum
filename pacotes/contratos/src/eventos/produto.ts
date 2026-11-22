// Eventos de produto: produto.criado e produto.alterado (versão 1).
// Herdados do OLD; agora com unidade e código de barras (docs/04-banco-de-dados.md, tabela produtos).
import { ean13Valido } from '@continuum/dominio';
import {
  ContratoInvalidoError,
  lerInteiro,
  lerObjeto,
  lerOpcao,
  lerTexto,
  lerUuid,
  ouNull,
  semChavesExtras,
} from '../leitura.ts';

export const UNIDADES = ['un', 'kg', 'l'] as const;
export type Unidade = (typeof UNIDADES)[number];

export interface ProdutoCriado {
  produtoId: string;
  nome: string;
  precoCentavos: number;
  unidade: Unidade;
  /** Código de barras EAN-13, ou null se o produto não tem. */
  ean: string | null;
  /** Sempre 1 na criação; sobe a cada alteração (controle de conflito, ADR 004 do OLD). */
  version: number;
}

export interface ProdutoAlterado extends Omit<ProdutoCriado, 'version'> {
  versionAnterior: number;
  version: number;
}

function lerEan(valor: unknown, caminho: string): string {
  if (typeof valor !== 'string' || !/^\d{13}$/.test(valor) || !ean13Valido(valor)) {
    throw new ContratoInvalidoError(caminho, 'código de barras EAN-13 inválido (13 dígitos, último dígito confere)');
  }
  return valor;
}

function lerCamposComuns(d: Record<string, unknown>, c: string): Omit<ProdutoCriado, 'version'> {
  return {
    produtoId: lerUuid(d['produtoId'], `${c}.produtoId`),
    nome: lerTexto(d['nome'], `${c}.nome`),
    precoCentavos: lerInteiro(d['precoCentavos'], `${c}.precoCentavos`, 0),
    unidade: lerOpcao(d['unidade'], `${c}.unidade`, UNIDADES),
    ean: ouNull(d['ean'], `${c}.ean`, lerEan),
  };
}

export function lerProdutoCriado(dados: unknown, c = 'dados'): ProdutoCriado {
  const d = lerObjeto(dados, c);
  semChavesExtras(d, c, ['produtoId', 'nome', 'precoCentavos', 'unidade', 'ean', 'version']);
  const version = lerInteiro(d['version'], `${c}.version`, 1);
  if (version !== 1) throw new ContratoInvalidoError(`${c}.version`, 'produto novo começa na versão 1');
  return { ...lerCamposComuns(d, c), version };
}

export function lerProdutoAlterado(dados: unknown, c = 'dados'): ProdutoAlterado {
  const d = lerObjeto(dados, c);
  semChavesExtras(d, c, ['produtoId', 'nome', 'precoCentavos', 'unidade', 'ean', 'versionAnterior', 'version']);
  const versionAnterior = lerInteiro(d['versionAnterior'], `${c}.versionAnterior`, 1);
  const version = lerInteiro(d['version'], `${c}.version`, 2);
  if (version !== versionAnterior + 1) {
    throw new ContratoInvalidoError(`${c}.version`, 'deve ser versionAnterior + 1 (uma alteração por vez)');
  }
  return { ...lerCamposComuns(d, c), versionAnterior, version };
}
