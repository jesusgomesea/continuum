// Migrações do caixa.db (docs/04-banco-de-dados.md, seções 3.2 e 4.1).
// As tabelas de operação são iguais às da nuvem, sem cliente_id (o banco do caixa é de um cliente só).
// Uma migração aplicada nunca é editada: mudança nova = migração nova no fim da lista.
import { SQL_FILA } from '@continuum/sync';
import type { Migracao } from '@continuum/sync';

/** Gatilho que impede editar e apagar (tabelas append-only: "nada se perde"). */
const somenteInclusao = (tabela: string) => `
  CREATE TRIGGER ${tabela}_sem_update BEFORE UPDATE ON ${tabela}
  BEGIN SELECT RAISE(ABORT, '${tabela}: registros não são editados'); END;
  CREATE TRIGGER ${tabela}_sem_delete BEFORE DELETE ON ${tabela}
  BEGIN SELECT RAISE(ABORT, '${tabela}: registros não são apagados'); END;
`;

const OPERACAO = `
  CREATE TABLE produtos (
    id             TEXT    PRIMARY KEY,
    nome           TEXT    NOT NULL CHECK (trim(nome) <> ''),
    preco_centavos INTEGER NOT NULL CHECK (preco_centavos >= 0),
    unidade        TEXT    NOT NULL CHECK (unidade IN ('un', 'kg', 'l')),
    ean            TEXT    UNIQUE CHECK (ean IS NULL OR length(ean) = 13),
    estoque_minimo INTEGER NOT NULL DEFAULT 0 CHECK (estoque_minimo >= 0),
    version        INTEGER NOT NULL CHECK (version >= 1),
    alterado_em    TEXT    NOT NULL
  ) STRICT;

  CREATE TABLE sessoes_caixa (
    id                TEXT    PRIMARY KEY,
    dispositivo_id    TEXT    NOT NULL,
    operador          TEXT    NOT NULL CHECK (trim(operador) <> ''),
    fundo_centavos    INTEGER NOT NULL CHECK (fundo_centavos >= 0),
    aberta_em         TEXT    NOT NULL,
    fechada_em        TEXT,
    contado_centavos  INTEGER CHECK (contado_centavos >= 0),
    esperado_centavos INTEGER,
    relatorio         TEXT
  ) STRICT;
  -- No máximo uma sessão aberta por caixa.
  CREATE UNIQUE INDEX uma_sessao_aberta ON sessoes_caixa (dispositivo_id) WHERE fechada_em IS NULL;
  -- Sessão fechada não muda mais; aberta só muda para ser fechada.
  CREATE TRIGGER sessoes_fechada_imutavel BEFORE UPDATE ON sessoes_caixa
  WHEN OLD.fechada_em IS NOT NULL OR NEW.fechada_em IS NULL
    OR NEW.id <> OLD.id OR NEW.operador <> OLD.operador OR NEW.fundo_centavos <> OLD.fundo_centavos OR NEW.aberta_em <> OLD.aberta_em
  BEGIN SELECT RAISE(ABORT, 'sessoes_caixa: sessão fechada não muda; aberta só pode ser fechada'); END;
  CREATE TRIGGER sessoes_sem_delete BEFORE DELETE ON sessoes_caixa
  BEGIN SELECT RAISE(ABORT, 'sessoes_caixa: registros não são apagados'); END;

  CREATE TABLE vendas (
    id                TEXT    PRIMARY KEY,
    loja_id           TEXT    NOT NULL,
    dispositivo_id    TEXT    NOT NULL,
    sessao_id         TEXT    NOT NULL REFERENCES sessoes_caixa (id),
    codigo            TEXT    NOT NULL UNIQUE,
    numero            INTEGER NOT NULL UNIQUE CHECK (numero >= 1),
    bruto_centavos    INTEGER NOT NULL CHECK (bruto_centavos >= 0),
    desconto_centavos INTEGER NOT NULL CHECK (desconto_centavos >= 0),
    liquido_centavos  INTEGER NOT NULL,
    troco_centavos    INTEGER NOT NULL CHECK (troco_centavos >= 0),
    documento_cliente TEXT,
    ocorrido_em       TEXT    NOT NULL,
    CHECK (liquido_centavos = bruto_centavos - desconto_centavos)
  ) STRICT;
  ${somenteInclusao('vendas')}

  CREATE TABLE movimentacoes (
    id             TEXT    PRIMARY KEY,
    loja_id        TEXT    NOT NULL,
    produto_id     TEXT    NOT NULL REFERENCES produtos (id),
    tipo           TEXT    NOT NULL CHECK (tipo IN ('ENTRADA', 'VENDA', 'AJUSTE', 'ESTORNO')),
    quantidade     INTEGER NOT NULL CHECK (quantidade <> 0),
    venda_id       TEXT    REFERENCES vendas (id),
    motivo         TEXT,
    dispositivo_id TEXT    NOT NULL,
    ocorrido_em    TEXT    NOT NULL,
    CHECK (tipo <> 'ENTRADA' OR quantidade > 0),
    CHECK (tipo <> 'VENDA' OR quantidade < 0),
    CHECK ((tipo = 'VENDA') = (venda_id IS NOT NULL))
  ) STRICT;
  -- O saldo é a soma: com a quantidade no índice, a soma lê só o índice (do OLD: 21 ms → 3,4 ms).
  CREATE INDEX movimentacoes_saldo ON movimentacoes (produto_id, quantidade);
  ${somenteInclusao('movimentacoes')}

  CREATE TABLE itens_venda (
    id                      TEXT    PRIMARY KEY,
    venda_id                TEXT    NOT NULL REFERENCES vendas (id),
    posicao                 INTEGER NOT NULL CHECK (posicao >= 1),
    produto_id              TEXT    NOT NULL REFERENCES produtos (id),
    quantidade              INTEGER NOT NULL CHECK (quantidade > 0),
    preco_unitario_centavos INTEGER NOT NULL CHECK (preco_unitario_centavos >= 0),
    desconto_centavos       INTEGER NOT NULL CHECK (desconto_centavos >= 0),
    movimentacao_id         TEXT    NOT NULL UNIQUE REFERENCES movimentacoes (id),
    UNIQUE (venda_id, posicao)
  ) STRICT;
  ${somenteInclusao('itens_venda')}

  CREATE TABLE pagamentos (
    id             TEXT    PRIMARY KEY,
    venda_id       TEXT    NOT NULL REFERENCES vendas (id),
    forma          TEXT    NOT NULL CHECK (forma IN ('dinheiro', 'debito', 'credito', 'pix')),
    valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0)
  ) STRICT;
  ${somenteInclusao('pagamentos')}

  CREATE TABLE cancelamentos (
    venda_id       TEXT PRIMARY KEY REFERENCES vendas (id),
    motivo         TEXT NOT NULL CHECK (trim(motivo) <> ''),
    autorizado_por TEXT NOT NULL CHECK (trim(autorizado_por) <> ''),
    cancelado_em   TEXT NOT NULL
  ) STRICT;
  ${somenteInclusao('cancelamentos')}

  CREATE TABLE movimentos_caixa (
    id             TEXT    PRIMARY KEY,
    sessao_id      TEXT    NOT NULL REFERENCES sessoes_caixa (id),
    tipo           TEXT    NOT NULL CHECK (tipo IN ('SANGRIA', 'SUPRIMENTO')),
    valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0),
    motivo         TEXT    NOT NULL CHECK (trim(motivo) <> ''),
    ocorrido_em    TEXT    NOT NULL
  ) STRICT;
  ${somenteInclusao('movimentos_caixa')}
`;

const LOCAIS = `
  -- Quem é este caixa (dispositivo, loja, nome reduzido, número do caixa). Preenchido na ativação.
  CREATE TABLE config_local (
    chave TEXT PRIMARY KEY,
    valor TEXT NOT NULL
  ) STRICT;

  -- Cópia dos parâmetros do cliente (regra de estoque, limite de desconto...). Desce do Central.
  CREATE TABLE parametros (
    versao INTEGER PRIMARY KEY CHECK (versao >= 1),
    dados  TEXT    NOT NULL
  ) STRICT;

  -- O próximo número de venda do caixa; nunca repete.
  CREATE TABLE sequencia_venda (
    numero_caixa  INTEGER PRIMARY KEY CHECK (numero_caixa BETWEEN 1 AND 9),
    ultimo_numero INTEGER NOT NULL CHECK (ultimo_numero >= 0)
  ) STRICT;
  CREATE TRIGGER sequencia_so_avanca BEFORE UPDATE ON sequencia_venda
  WHEN NEW.ultimo_numero <= OLD.ultimo_numero
  BEGIN SELECT RAISE(ABORT, 'sequencia_venda: o número da venda só avança'); END;

  -- Até onde o caixa já recebeu produtos e preços (descida, Passo 3.3).
  CREATE TABLE cursor_descida (
    unica      INTEGER PRIMARY KEY CHECK (unica = 1),
    ultima_seq INTEGER NOT NULL DEFAULT 0
  ) STRICT;

  -- Estado da conexão (máquina de estados do OLD, usada pelo Sync Engine no Passo 3.2).
  CREATE TABLE estado_sync (
    unica             INTEGER PRIMARY KEY CHECK (unica = 1),
    estado            TEXT    NOT NULL DEFAULT 'saudavel',
    modo              TEXT    NOT NULL DEFAULT 'automatico',
    falhas_seguidas   INTEGER NOT NULL DEFAULT 0,
    sucessos_seguidos INTEGER NOT NULL DEFAULT 0
  ) STRICT;
`;

export const MIGRACOES_CAIXA: readonly Migracao[] = [
  { numero: 1, nome: 'fila', sql: SQL_FILA },
  { numero: 2, nome: 'operacao', sql: OPERACAO },
  { numero: 3, nome: 'tabelas_locais', sql: LOCAIS },
  {
    numero: 4,
    nome: 'chaves_venda',
    sql: `
      -- Cada tentativa de venda tem uma chave; a mesma chave de novo devolve a mesma venda (clique duplo).
      CREATE TABLE chaves_venda (
        chave    TEXT PRIMARY KEY,
        venda_id TEXT NOT NULL UNIQUE REFERENCES vendas (id)
      ) STRICT;
      ${somenteInclusao('chaves_venda')}
    `,
  },
];
