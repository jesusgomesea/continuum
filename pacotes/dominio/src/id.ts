// Identificadores UUID v7 (ADR 002 do OLD): criados pelo programa, nunca pelo banco.
//
// O v7 começa com a hora (em milissegundos) e termina com sorteio. Assim os ids saem em ordem de
// criação (bom para o banco) e dois caixas sem rede nunca geram o mesmo id.
// Feito à mão para não depender de pacote externo; funciona no Node e no navegador.

/** Gera um UUID v7 em minúsculas, como "019a0b7c-1111-7222-8333-44445555abcd". */
export function gerarId(agora: number = Date.now()): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // 48 bits iniciais: milissegundos desde 1970.
  let ms = agora;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ms % 256;
    ms = Math.floor(ms / 256);
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70; // versão 7
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // variante RFC 9562
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Função que fornece ids novos. Os testes trocam por uma sequência previsível. */
export type GeradorDeId = () => string;
