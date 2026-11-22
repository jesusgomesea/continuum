// Leitores: as peças pequenas com que cada contrato confere um evento.
// Reconstruído de OLD/app/dist/cloud-api/leitura.js, agora em TypeScript.
//
// Cada leitor recebe um valor "desconhecido" (veio da rede, do banco ou da tela) e devolve o valor
// já com o tipo certo, ou lança ContratoInvalidoError dizendo ONDE está o problema
// (o "caminho", como "dados.itens[2].quantidade") e O QUE se esperava.

/** Evento (ou sinal de vida) fora do formato combinado. */
export class ContratoInvalidoError extends Error {
  override name = 'ContratoInvalidoError';
  /** Onde está o problema, por exemplo "dados.itens[0].quantidade". */
  readonly caminho: string;

  constructor(caminho: string, mensagem: string) {
    super(`${caminho}: ${mensagem}`);
    this.caminho = caminho;
  }
}

/** Objeto JSON comum, com chaves de texto. */
export type Objeto = Record<string, unknown>;

// Só a forma canônica, em minúsculas: o PostgreSQL devolve assim e os ids são comparados como texto.
const PADRAO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// ISO 8601 em UTC com milissegundos, como Date.toISOString() grava na origem.
const PADRAO_INSTANTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const mostrar = (valor: unknown): string => JSON.stringify(valor) ?? String(valor);

export function lerObjeto(valor: unknown, caminho: string): Objeto {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) {
    throw new ContratoInvalidoError(caminho, 'informe um objeto');
  }
  return valor as Objeto;
}

export function lerLista(valor: unknown, caminho: string): unknown[] {
  if (!Array.isArray(valor)) throw new ContratoInvalidoError(caminho, 'informe uma lista');
  return valor;
}

export function lerUuid(valor: unknown, caminho: string): string {
  if (typeof valor !== 'string' || !PADRAO_UUID.test(valor)) {
    throw new ContratoInvalidoError(caminho, `informe um UUID em minúsculas (recebido: ${mostrar(valor)})`);
  }
  return valor;
}

export function lerTexto(valor: unknown, caminho: string): string {
  if (typeof valor !== 'string' || valor.trim() === '') {
    throw new ContratoInvalidoError(caminho, 'informe um texto não vazio');
  }
  return valor;
}

export function lerBooleano(valor: unknown, caminho: string): boolean {
  if (typeof valor !== 'boolean') throw new ContratoInvalidoError(caminho, 'informe verdadeiro ou falso');
  return valor;
}

/** Inteiro exato a partir de `minimo` (dinheiro é sempre inteiro em centavos). */
export function lerInteiro(valor: unknown, caminho: string, minimo = Number.MIN_SAFE_INTEGER): number {
  if (typeof valor !== 'number' || !Number.isSafeInteger(valor) || valor < minimo) {
    const faixa = minimo === Number.MIN_SAFE_INTEGER ? '' : ` a partir de ${minimo}`;
    throw new ContratoInvalidoError(caminho, `informe um número inteiro${faixa} (recebido: ${mostrar(valor)})`);
  }
  return valor;
}

/** Instante em UTC, como "2026-11-21T13:45:00.000Z". Recusa datas que não existem (31 de fevereiro). */
export function lerInstante(valor: unknown, caminho: string): string {
  const valido =
    typeof valor === 'string' &&
    PADRAO_INSTANTE.test(valor) &&
    !Number.isNaN(new Date(valor).getTime()) &&
    new Date(valor).toISOString() === valor;
  if (!valido) {
    throw new ContratoInvalidoError(caminho, `informe um instante ISO 8601 em UTC (recebido: ${mostrar(valor)})`);
  }
  return valor;
}

/** Um dos valores da lista combinada (ex.: forma de pagamento). */
export function lerOpcao<const T extends string>(valor: unknown, caminho: string, opcoes: readonly T[]): T {
  if (typeof valor !== 'string' || !(opcoes as readonly string[]).includes(valor)) {
    throw new ContratoInvalidoError(caminho, `use um destes: ${opcoes.join(', ')} (recebido: ${mostrar(valor)})`);
  }
  return valor as T;
}

/** Campo que pode vir vazio: null (ou ausente) vira null; senão, passa pelo leitor. */
export function ouNull<T>(valor: unknown, caminho: string, leitor: (v: unknown, c: string) => T): T | null {
  return valor === null || valor === undefined ? null : leitor(valor, caminho);
}

/** Recusa chaves que o contrato não conhece: um erro de digitação não passa em silêncio. */
export function semChavesExtras(objeto: Objeto, caminho: string, permitidas: readonly string[]): void {
  for (const chave of Object.keys(objeto)) {
    if (!permitidas.includes(chave)) {
      throw new ContratoInvalidoError(`${caminho}.${chave}`, 'campo desconhecido neste contrato');
    }
  }
}
