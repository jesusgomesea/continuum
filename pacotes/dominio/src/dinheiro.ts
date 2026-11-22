// Dinheiro em centavos inteiros (regra herdada do OLD).
//
// Por quê: o computador guarda números "quebrados" (0,1 + 0,2) de forma aproximada, e somar
// preços assim gera erros de centavo. Em centavos inteiros, R$ 18,90 vira 1890 e toda conta é exata.
// Só na hora de mostrar na tela ou no comprovante o valor vira texto em reais.

/** Valor em centavos: inteiro e seguro (1890 = R$ 18,90). */
export type Centavos = number;

/** Verdadeiro se o valor é um inteiro de centavos válido (pode ser negativo, como num estorno). */
export function ehCentavos(valor: unknown): valor is Centavos {
  return typeof valor === 'number' && Number.isSafeInteger(valor);
}

function exigirCentavos(valor: number, nome: string): void {
  if (!ehCentavos(valor)) {
    throw new RangeError(`${nome}: informe um inteiro em centavos (recebido: ${String(valor)})`);
  }
}

/** Soma valores em centavos, recusando qualquer valor que não seja inteiro. */
export function somarCentavos(...valores: Centavos[]): Centavos {
  let total = 0;
  for (const v of valores) {
    exigirCentavos(v, 'somarCentavos');
    total += v;
  }
  exigirCentavos(total, 'somarCentavos (total)');
  return total;
}

/**
 * Preço unitário × quantidade, arredondando para o centavo mais próximo (meio centavo sobe).
 * A quantidade pode ser fracionada (1,25 kg); o resultado é sempre inteiro.
 */
export function multiplicarCentavos(precoUnitario: Centavos, quantidade: number): Centavos {
  exigirCentavos(precoUnitario, 'multiplicarCentavos (preço)');
  if (!Number.isFinite(quantidade) || quantidade < 0) {
    throw new RangeError(`multiplicarCentavos: quantidade inválida (${String(quantidade)})`);
  }
  // Arredonda o valor absoluto para que -0,5 e 0,5 se comportem igual (meio centavo "para longe do zero").
  const bruto = precoUnitario * quantidade;
  const resultado = Math.sign(bruto) * Math.round(Math.abs(bruto) + Number.EPSILON);
  return resultado === 0 ? 0 : resultado; // evita o -0
}

/** Mostra centavos em reais, no padrão brasileiro: 123456 → "R$ 1.234,56"; -500 → "-R$ 5,00". */
export function formatarReais(valor: Centavos): string {
  exigirCentavos(valor, 'formatarReais');
  const negativo = valor < 0;
  const absoluto = Math.abs(valor);
  const reais = Math.floor(absoluto / 100);
  const centavos = String(absoluto % 100).padStart(2, '0');
  const reaisComPontos = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negativo ? '-' : ''}R$ ${reaisComPontos},${centavos}`;
}

/**
 * Lê um valor digitado em reais e devolve centavos, sem passar por número quebrado.
 * Aceita "18,90", "18.90", "R$ 1.234,56", "1234", "0,5" (= 50 centavos) e "-5,00".
 * Lança erro se o texto não for um valor em reais (letras, mais de 2 casas decimais etc.).
 */
export function lerReais(texto: string): Centavos {
  const limpo = texto.replace(/R\$/gi, '').replace(/\s/g, '');
  const m = /^(-?)(\d{1,3}(?:\.\d{3})+|\d+)?(?:[,.](\d{1,2}))?$/.exec(limpo);
  if (m === null || (m[2] === undefined && m[3] === undefined)) {
    throw new RangeError(`Valor em reais inválido: "${texto}"`);
  }
  const sinal = m[1] === '-' ? -1 : 1;
  const reais = Number((m[2] ?? '0').replace(/\./g, ''));
  const centavos = Number((m[3] ?? '0').padEnd(2, '0'));
  const total = sinal * (reais * 100 + centavos);
  exigirCentavos(total, 'lerReais');
  return total === 0 ? 0 : total;
}
