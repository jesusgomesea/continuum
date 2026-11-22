// Teste de queda (Passo 4.1, aplicado ao trecho caixa → agente): vários caixas vendendo enquanto o
// Kryptonita derruba a rede, perde respostas e deixa o agente indisponível, incluindo um período de
// queda total. Depois a rede volta, a fila esvazia e a conferência prova: nada se perdeu, nada duplicou.
import { setTimeout as aguardar } from 'node:timers/promises';
import { abrirBancoDoCaixa, Caixa, ligarSincronizacao } from '@continuum/pdv';
import type { Sincronizacao } from '@continuum/pdv';
import { falhasAleatorias, iniciarKryptonita } from '@continuum/sync';
import type { FalhaDeRede } from '@continuum/sync';
import { prepararDemonstracao } from '../../pdv/src/servidor/demonstracao.ts';
import { abrirBancoDaLoja, Agente } from './agente.ts';
import { conferirCaixaComAgente } from './conferencia.ts';
import type { ResultadoDaConferencia } from './conferencia.ts';
import { criarServidorDoAgente, ligar } from './servidor.ts';

export interface OpcoesDoTeste {
  caixas: number;
  vendasPorCaixa: number;
  /** Chance (0 a 1) de cada pedido de rede falhar durante as vendas. */
  chanceDeFalha: number;
  /** Quantas vendas de cada caixa acontecem com a rede totalmente fora. */
  vendasNaQuedaTotal: number;
  /** Limite para a fila esvaziar depois que a rede volta. */
  tempoMaximoMs?: number;
  aoProgredir?: (mensagem: string) => void;
}

export interface RelatorioDoTeste {
  aprovado: boolean;
  vendas: number;
  canceladas: number;
  eventos: number;
  falhasProvocadas: Record<FalhaDeRede, number>;
  segundosAteEsvaziar: number;
  caixas: ResultadoDaConferencia[];
}

export async function rodarTesteDeQueda(o: OpcoesDoTeste): Promise<RelatorioDoTeste> {
  const dizer = o.aoProgredir ?? (() => undefined);
  const bancoDaLoja = abrirBancoDaLoja(':memory:');
  const servidor = criarServidorDoAgente(new Agente(bancoDaLoja), { estilos: '' });
  const enderecoDoAgente = await ligar(servidor, 0, '127.0.0.1');
  const kryptonita = await iniciarKryptonita(enderecoDoAgente);

  const caixas: { caixa: Caixa; sync: Sincronizacao }[] = [];
  for (let i = 1; i <= o.caixas; i++) {
    const caixa = new Caixa(abrirBancoDoCaixa(':memory:'));
    prepararDemonstracao(caixa);
    caixa.abrirCaixa(`Operador ${i}`, 10000);
    const sync = ligarSincronizacao(caixa, kryptonita.url, {
      esperaOciosaMs: 5,
      intervaloSinalMs: 60_000,
      backoff: { inicialMs: 20, maximoMs: 300 },
    });
    caixas.push({ caixa, sync });
  }

  let vendas = 0;
  let canceladas = 0;
  const vender = (caixa: Caixa, n: number) => {
    const catalogo = caixa.catalogo();
    const p = catalogo[n % catalogo.length];
    if (p === undefined) return;
    const { venda } = caixa.registrarVenda({ itens: [{ produtoId: p.id, quantidade: 1 + (n % 3) }], pagamentos: [{ forma: 'pix', valorCentavos: p.precoCentavos * (1 + (n % 3)) }] });
    vendas += 1;
    if (n % 7 === 3) {
      caixa.cancelarVenda(venda.codigo, 'Teste de queda', 'Supervisor', '1234');
      canceladas += 1;
    }
  };

  try {
    dizer(`Vendendo com ${Math.round(o.chanceDeFalha * 100)}% dos pedidos de rede falhando…`);
    kryptonita.decidir = falhasAleatorias(o.chanceDeFalha);
    const comFalhas = o.vendasPorCaixa - o.vendasNaQuedaTotal;
    for (let n = 0; n < comFalhas; n++) {
      for (const { caixa } of caixas) vender(caixa, n);
      await aguardar(5);
    }

    dizer('Queda total da rede: os caixas continuam vendendo…');
    kryptonita.decidir = () => 'derrubar';
    for (let n = comFalhas; n < o.vendasPorCaixa; n++) {
      for (const { caixa } of caixas) vender(caixa, n);
      await aguardar(5);
    }

    dizer('A rede voltou. Esperando as filas esvaziarem…');
    kryptonita.decidir = () => 'normal';
    const inicio = Date.now();
    const limite = inicio + (o.tempoMaximoMs ?? 60_000);
    while (caixas.some(({ caixa }) => caixa.fila.contarPendentes() > 0) && Date.now() < limite) await aguardar(20);
    const segundosAteEsvaziar = Math.round((Date.now() - inicio) / 100) / 10;

    for (const { sync } of caixas) await sync.parar();
    const resultados = caixas.map(({ caixa }) => conferirCaixaComAgente(caixa.identidade().dispositivoId, caixa.fila, bancoDaLoja));
    return {
      aprovado: resultados.every((r) => r.divergencias.length === 0),
      vendas,
      canceladas,
      eventos: resultados.reduce((t, r) => t + r.eventosNoCaixa, 0),
      falhasProvocadas: { ...kryptonita.contagem },
      segundosAteEsvaziar,
      caixas: resultados,
    };
  } finally {
    for (const { sync } of caixas) await sync.parar();
    await kryptonita.fechar();
    await new Promise<void>((ok) => {
      servidor.closeAllConnections();
      servidor.close(() => ok());
    });
  }
}
