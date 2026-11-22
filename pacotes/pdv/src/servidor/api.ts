// A API do caixa: o "balcão" entre as telas (navegador ou Electron) e o Caixa (banco + regras).
//
// As telas não falam com o banco: pedem por aqui, em JSON. Cada pedido vira uma chamada ao Caixa
// e cada recusa das regras vira uma resposta com o nome do erro e a mensagem em português,
// que a tela mostra ao operador.
//
// `tratar` não depende de servidor nenhum: recebe método, caminho e corpo e devolve status e corpo.
// Assim a mesma API roda no servidor de desenvolvimento (Vite), no Electron (Passo 1.5) e nos testes.
import {
  AutorizacaoNecessariaError,
  CancelamentoRecusadoError,
  DadosInvalidosError,
  EstoqueInsuficienteError,
  ProdutoNaoEncontradoError,
} from '@continuum/dominio';
import type { PedidoDeVenda } from '@continuum/dominio';
import type { Caixa } from '../caixa.ts';
import { OperacaoDeCaixaError } from '../caixa.ts';

export interface Resposta {
  status: number;
  corpo: unknown;
}

/** O retrato do caixa que a tela precisa para se desenhar. */
export function estadoDoCaixa(caixa: Caixa) {
  return {
    identidade: caixa.identidade(),
    sessao: caixa.sessaoAberta() ?? null,
    parametros: caixa.parametros(),
    filaPendente: caixa.fila.contarPendentes(),
    catalogo: caixa.catalogo(),
    ultimasVendas: caixa.ultimasVendas(10),
  };
}

export type EstadoDoCaixa = ReturnType<typeof estadoDoCaixa>;

type Objeto = Record<string, unknown>;

const objeto = (corpo: unknown): Objeto =>
  typeof corpo === 'object' && corpo !== null && !Array.isArray(corpo) ? (corpo as Objeto) : {};
const texto = (v: unknown): string => (typeof v === 'string' ? v : '');
const numero = (v: unknown): number => (typeof v === 'number' ? v : Number.NaN);

/** Converte cada recusa num status HTTP e numa mensagem para o operador. */
function respostaDeErro(erro: unknown): Resposta {
  const corpo = (status: number) => ({ status, corpo: { erro: (erro as Error).name, mensagem: (erro as Error).message } });
  if (erro instanceof AutorizacaoNecessariaError) return corpo(403);
  if (erro instanceof ProdutoNaoEncontradoError) return corpo(404);
  if (erro instanceof OperacaoDeCaixaError || erro instanceof CancelamentoRecusadoError) return corpo(409);
  if (erro instanceof EstoqueInsuficienteError) return corpo(422);
  if (erro instanceof DadosInvalidosError || (erro instanceof Error && erro.name === 'ContratoInvalidoError')) return corpo(400);
  throw erro; // erro inesperado: não é recusa de regra, é defeito, e precisa aparecer
}

export function criarApi(caixa: Caixa) {
  const ok = (corpo: unknown = estadoDoCaixa(caixa)): Resposta => ({ status: 200, corpo });

  function rotear(metodo: string, caminho: string, corpo: unknown): Resposta {
    const d = objeto(corpo);
    if (metodo === 'GET' && caminho === '/api/estado') return ok();

    if (metodo === 'POST' && caminho === '/api/caixa/abrir') {
      caixa.abrirCaixa(texto(d['operador']), numero(d['fundoCentavos']));
      return ok();
    }
    if (metodo === 'POST' && caminho === '/api/caixa/movimentar') {
      const tipo = d['tipo'] === 'SANGRIA' ? 'SANGRIA' : d['tipo'] === 'SUPRIMENTO' ? 'SUPRIMENTO' : null;
      if (tipo === null) throw new DadosInvalidosError('tipo: use SANGRIA ou SUPRIMENTO');
      caixa.movimentarCaixa(tipo, numero(d['valorCentavos']), texto(d['motivo']));
      return ok();
    }
    if (metodo === 'GET' && caminho === '/api/caixa/relatorio') return ok(caixa.relatorioParcial());
    if (metodo === 'POST' && caminho === '/api/caixa/fechar') {
      return ok({ relatorio: caixa.fecharCaixa(numero(d['contadoCentavos'])), estado: estadoDoCaixa(caixa) });
    }

    if (metodo === 'POST' && caminho === '/api/vendas') {
      const { venda, alertasEstoque } = caixa.registrarVenda(d as unknown as PedidoDeVenda);
      return ok({ venda, alertasEstoque, estado: estadoDoCaixa(caixa) });
    }
    const cancelar = /^\/api\/vendas\/([^/]+)\/cancelar$/.exec(caminho);
    if (metodo === 'POST' && cancelar !== null) {
      caixa.cancelarVenda(decodeURIComponent(cancelar[1] ?? ''), texto(d['motivo']), texto(d['autorizadoPor']));
      return ok();
    }
    const buscar = /^\/api\/vendas\/([^/]+)$/.exec(caminho);
    if (metodo === 'GET' && buscar !== null) {
      const achada = caixa.buscarVenda(decodeURIComponent(buscar[1] ?? ''));
      return achada === undefined
        ? { status: 404, corpo: { erro: 'NaoEncontrada', mensagem: 'Venda não encontrada neste caixa.' } }
        : ok(achada);
    }
    return { status: 404, corpo: { erro: 'RotaDesconhecida', mensagem: `${metodo} ${caminho} não existe` } };
  }

  return {
    tratar(metodo: string, caminho: string, corpo?: unknown): Resposta {
      try {
        return rotear(metodo.toUpperCase(), caminho.split('?')[0] ?? caminho, corpo);
      } catch (erro) {
        return respostaDeErro(erro);
      }
    },
  };
}

export type ApiDoCaixa = ReturnType<typeof criarApi>;
