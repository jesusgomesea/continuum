// O teste de queda roda junto com os outros testes, numa versão menor.
import { describe, expect, it } from 'vitest';
import { rodarTesteDeQueda } from '../src/index.ts';

describe('teste de queda (caixas → agente)', () => {
  it('com falhas de rede aleatórias e uma queda total, nada se perde e nada duplica', async () => {
    const r = await rodarTesteDeQueda({ caixas: 2, vendasPorCaixa: 25, chanceDeFalha: 0.5, vendasNaQuedaTotal: 8, tempoMaximoMs: 30_000 });
    expect(r.caixas.flatMap((c) => c.divergencias)).toEqual([]);
    expect(r.aprovado).toBe(true);
    expect(r.vendas).toBe(50);
    expect(r.falhasProvocadas.derrubar + r.falhasProvocadas['perder-resposta'] + r.falhasProvocadas.indisponivel).toBeGreaterThan(0);
  }, 60_000);
});
