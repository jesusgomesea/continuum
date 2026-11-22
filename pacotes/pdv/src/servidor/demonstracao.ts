// Dados de demonstração: enquanto a ativação pelo ERP (Passo 3.1) não existe, o caixa novo
// se ativa sozinho como "Caixa 1 do MERCBAIRRO" e recebe um catálogo de exemplo com estoque.
// O catálogo é o mesmo do PDV do OLD (OLD/trabalho-em-andamento/caixa-v3-operacao-de-caixa.js).
import { gerarId } from '@continuum/dominio';
import type { Caixa } from '../caixa.ts';

export const CATALOGO_DEMO = [
  { nome: 'Café 500 g', precoCentavos: 1890, ean: '7890000000017' },
  { nome: 'Açúcar 1 kg', precoCentavos: 549, ean: '7890000000024' },
  { nome: 'Leite 1 L', precoCentavos: 499, ean: '7890000000031' },
  { nome: 'Pão de forma', precoCentavos: 899, ean: '7890000000048' },
  { nome: 'Arroz 5 kg', precoCentavos: 2790, ean: '7890000000055' },
  { nome: 'Feijão 1 kg', precoCentavos: 849, ean: '7890000000062' },
  { nome: 'Óleo de soja', precoCentavos: 799, ean: '7890000000079' },
  { nome: 'Macarrão', precoCentavos: 479, ean: '7890000000086' },
  { nome: 'Biscoito', precoCentavos: 399, ean: '7890000000093' },
  { nome: 'Refrigerante 2 L', precoCentavos: 999, ean: '7890000000109' },
  { nome: 'Água 1,5 L', precoCentavos: 349, ean: '7890000000116' },
  { nome: 'Sabão em pó', precoCentavos: 1590, ean: '7890000000123' },
] as const;

export const ESTOQUE_INICIAL_DEMO = 60;

/** Ativa e abastece o caixa, se ele ainda não foi ativado. Devolve true se preparou agora. */
export function prepararDemonstracao(caixa: Caixa): boolean {
  try {
    caixa.identidade();
    return false; // já ativado: não mexe em nada
  } catch {
    // ainda não ativado: segue
  }
  caixa.ativar({ dispositivoId: gerarId(), lojaId: gerarId(), nomeReduzido: 'MERCBAIRRO', numeroCaixa: 1 });
  caixa.aplicarParametros({
    versao: 1,
    regraEstoque: 'bloquear',
    limiteDescontoPct: 10,
    comprovante: {
      cabecalho: ['Mercadinho do Bairro', 'Loja de demonstração do Continuum', 'Rua Exemplo, 123 · Centro'],
      rodape: 'Obrigado pela preferência!',
      largura: 80,
    },
  });
  for (const p of CATALOGO_DEMO) {
    const produtoId = gerarId();
    caixa.receberProduto({ produtoId, nome: p.nome, precoCentavos: p.precoCentavos, unidade: 'un', ean: p.ean, version: 1 });
    caixa.registrarEntrada(produtoId, ESTOQUE_INICIAL_DEMO, 'estoque inicial de demonstração');
  }
  return true;
}
