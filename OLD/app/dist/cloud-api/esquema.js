// Número fixo do advisory lock que serializa a criação do esquema entre processos.
const TRAVA_ESQUEMA = 10_010;
/**
 * Tabelas da nuvem simulada (ADR 010).
 * - origens: última seq aplicada de cada origem (ADR 004).
 * - eventos_recebidos: cada evento aceito, uma vez só; o id é a chave (ADR 002).
 * - produtos, movimentacoes, vendas, itens_venda: dados consolidados, aplicados
 *   na mesma transação em que o evento é gravado.
 * - conflitos: produto.alterado recebido mas não aplicado (ADR 004).
 * Datas vindas da origem ficam em texto ISO 8601 UTC, exatamente como chegaram.
 */
const ESQUEMA = `
  CREATE OR REPLACE FUNCTION recusar_alteracao() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    RAISE EXCEPTION '%: registros não são editados nem apagados', TG_TABLE_NAME;
  END;
  $$;

  CREATE TABLE IF NOT EXISTS origens (
    id         UUID   PRIMARY KEY,
    ultima_seq BIGINT NOT NULL DEFAULT 0 CHECK (ultima_seq >= 0)
  );

  CREATE TABLE IF NOT EXISTS eventos_recebidos (
    id          UUID        PRIMARY KEY,
    origem_id   UUID        NOT NULL REFERENCES origens (id),
    seq         BIGINT      NOT NULL CHECK (seq >= 1),
    tipo        TEXT        NOT NULL,
    ocorrido_em TEXT        NOT NULL,
    dados       JSONB       NOT NULL,
    recebido_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (origem_id, seq)
  );

  CREATE TABLE IF NOT EXISTS produtos (
    id             UUID    PRIMARY KEY,
    nome           TEXT    NOT NULL CHECK (btrim(nome) <> ''),
    preco_centavos BIGINT  NOT NULL CHECK (preco_centavos >= 0),
    version        INTEGER NOT NULL CHECK (version >= 1),
    criado_em      TEXT    NOT NULL,
    alterado_em    TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS vendas (
    id             UUID   PRIMARY KEY,
    origem_id      UUID   NOT NULL REFERENCES origens (id),
    numero         BIGINT NOT NULL CHECK (numero >= 1),
    total_centavos BIGINT NOT NULL CHECK (total_centavos >= 0),
    ocorrido_em    TEXT   NOT NULL,
    -- O número de exibição é da origem: duas origens podem ter a venda 1.
    UNIQUE (origem_id, numero)
  );

  CREATE TABLE IF NOT EXISTS movimentacoes (
    id          UUID   PRIMARY KEY,
    produto_id  UUID   NOT NULL REFERENCES produtos (id),
    tipo        TEXT   NOT NULL CHECK (tipo IN ('ENTRADA', 'VENDA', 'AJUSTE', 'DEVOLUCAO', 'ESTORNO')),
    quantidade  BIGINT NOT NULL CHECK (quantidade <> 0),
    venda_id    UUID   REFERENCES vendas (id),
    motivo      TEXT,
    ocorrido_em TEXT   NOT NULL,
    CHECK (tipo NOT IN ('ENTRADA', 'DEVOLUCAO') OR quantidade > 0),
    CHECK (tipo <> 'VENDA' OR quantidade < 0),
    CHECK ((tipo = 'VENDA') = (venda_id IS NOT NULL))
  );

  CREATE INDEX IF NOT EXISTS movimentacoes_por_produto ON movimentacoes (produto_id);

  -- Sem chave estrangeira em movimentacao_id: na outbox, a venda chega antes
  -- das movimentações que apontam para ela (src/vendas/vendas.ts).
  CREATE TABLE IF NOT EXISTS itens_venda (
    id                      UUID    PRIMARY KEY,
    venda_id                UUID    NOT NULL REFERENCES vendas (id),
    posicao                 INTEGER NOT NULL CHECK (posicao >= 1),
    produto_id              UUID    NOT NULL REFERENCES produtos (id),
    quantidade              BIGINT  NOT NULL CHECK (quantidade > 0),
    preco_unitario_centavos BIGINT  NOT NULL CHECK (preco_unitario_centavos >= 0),
    movimentacao_id         UUID    NOT NULL UNIQUE,
    UNIQUE (venda_id, posicao)
  );

  CREATE TABLE IF NOT EXISTS conflitos (
    evento_id        UUID        PRIMARY KEY REFERENCES eventos_recebidos (id),
    produto_id       UUID        NOT NULL,
    version_esperada INTEGER     NOT NULL,
    -- NULL quando o produto nem existe na nuvem.
    version_atual    INTEGER,
    registrado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE OR REPLACE TRIGGER eventos_recebidos_imutaveis BEFORE UPDATE OR DELETE ON eventos_recebidos
    FOR EACH ROW EXECUTE FUNCTION recusar_alteracao();
  CREATE OR REPLACE TRIGGER movimentacoes_imutaveis BEFORE UPDATE OR DELETE ON movimentacoes
    FOR EACH ROW EXECUTE FUNCTION recusar_alteracao();
  CREATE OR REPLACE TRIGGER vendas_imutaveis BEFORE UPDATE OR DELETE ON vendas
    FOR EACH ROW EXECUTE FUNCTION recusar_alteracao();
  CREATE OR REPLACE TRIGGER itens_venda_imutaveis BEFORE UPDATE OR DELETE ON itens_venda
    FOR EACH ROW EXECUTE FUNCTION recusar_alteracao();
  CREATE OR REPLACE TRIGGER conflitos_imutaveis BEFORE UPDATE OR DELETE ON conflitos
    FOR EACH ROW EXECUTE FUNCTION recusar_alteracao();
`;
/**
 * Cria as tabelas da nuvem, se ainda não existirem. Pode ser chamada por
 * vários processos ao mesmo tempo: a trava faz um esperar o outro.
 */
export async function criarEsquemaNuvem(banco) {
    await banco.transacao(async (tx) => {
        await tx.executar(`SELECT pg_advisory_xact_lock(${TRAVA_ESQUEMA})`);
        await tx.executar(ESQUEMA);
    });
}
//# sourceMappingURL=esquema.js.map