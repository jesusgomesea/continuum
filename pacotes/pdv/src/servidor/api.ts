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
import type { Caixa, PedidoDoCaixa } from '../caixa.ts';
import { OperacaoDeCaixaError } from '../caixa.ts';
import { comprovanteHtml } from '../comprovante.ts';
import type { Sincronizacao } from '../sincronizacao.ts';

export interface Resposta {
  status: number;
  corpo: unknown;
  /** 'html' para páginas (o comprovante); sem isso, JSON. */
  tipo?: 'html';
}

/** O retrato do caixa que a tela precisa para se desenhar. */
export function estadoDoCaixa(caixa: Caixa, sincronizacao: Sincronizacao | null = null) {
  return {
    identidade: caixa.identidade(),
    sessao: caixa.sessaoAberta() ?? null,
    parametros: caixa.parametros(),
    filaPendente: caixa.fila.contarPendentes(),
    catalogo: caixa.catalogo(),
    ultimasVendas: caixa.ultimasVendas(10),
    /** Situação do envio ao agente (null quando o caixa roda sem agente, como nos testes). */
    sincronizacao: sincronizacao?.resumo() ?? null,
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

/** A sincronização pode nascer depois (só liga quando o caixa é ativado): por isso pode vir como função. */
export type FonteDaSincronizacao = Sincronizacao | null | (() => Sincronizacao | null);

export function criarApi(caixa: Caixa, sincronizacao: FonteDaSincronizacao = null) {
  const estado = () => estadoDoCaixa(caixa, typeof sincronizacao === 'function' ? sincronizacao() : sincronizacao);
  const ok = (corpo: unknown = estado()): Resposta => ({ status: 200, corpo });

  function rotear(metodo: string, caminho: string, consulta: string, corpo: unknown): Resposta {
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
      return ok({ relatorio: caixa.fecharCaixa(numero(d['contadoCentavos'])), estado: estado() });
    }

    if (metodo === 'POST' && caminho === '/api/vendas') {
      const { venda, alertasEstoque, repetida } = caixa.registrarVenda(d as unknown as PedidoDoCaixa);
      return ok({ venda, alertasEstoque, repetida, estado: estado() });
    }
    const cancelar = /^\/api\/vendas\/([^/]+)\/cancelar$/.exec(caminho);
    if (metodo === 'POST' && cancelar !== null) {
      caixa.cancelarVenda(decodeURIComponent(cancelar[1] ?? ''), texto(d['motivo']), texto(d['autorizadoPor']), texto(d['pin']));
      return ok();
    }
    const buscar = /^\/api\/vendas\/([^/]+)$/.exec(caminho);
    if (metodo === 'GET' && buscar !== null) {
      const achada = caixa.buscarVenda(decodeURIComponent(buscar[1] ?? ''));
      return achada === undefined
        ? { status: 404, corpo: { erro: 'NaoEncontrada', mensagem: 'Venda não encontrada neste caixa.' } }
        : ok(achada);
    }
    // Comprovante (página para imprimir): /comprovante/CODIGO?reimpressao=1&imprimir=1
    const comprovante = /^\/comprovante\/([^/]+)$/.exec(caminho);
    if (metodo === 'GET' && comprovante !== null) {
      const busca = new URLSearchParams(consulta);
      const dados = caixa.dadosDoComprovante(decodeURIComponent(comprovante[1] ?? ''), busca.get('reimpressao') === '1');
      if (dados === undefined) return { status: 404, tipo: 'html', corpo: '<p>Venda não encontrada neste caixa.</p>' };
      return { status: 200, tipo: 'html', corpo: comprovanteHtml(dados, caixa.configuracaoDoComprovante(), busca.get('imprimir') === '1') };
    }
    return { status: 404, corpo: { erro: 'RotaDesconhecida', mensagem: `${metodo} ${caminho} não existe` } };
  }

  return {
    tratar(metodo: string, caminho: string, corpo?: unknown): Resposta {
      try {
        const [rota = caminho, consulta = ''] = caminho.split('?');
        return rotear(metodo.toUpperCase(), rota, consulta, corpo);
      } catch (erro) {
        return respostaDeErro(erro);
      }
    },
  };
}

export type ApiDoCaixa = ReturnType<typeof criarApi>;
