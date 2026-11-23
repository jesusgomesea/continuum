// Migrações do banco da nuvem (docs/04, seções 3 e 6): numeradas, em ordem, uma vez só, nunca editadas.
// Mesmas regras das migrações dos bancos locais (pacotes/sync/src/migracoes.ts), agora no PostgreSQL.
import type pg from 'pg';

export interface MigracaoNuvem {
  readonly numero: number;
  readonly nome: string;
  readonly sql: string;
}

/** Tabelas de cliente: todas têm cliente_id e ficam sob o isolamento (Row Level Security). */
export const TABELAS_DE_CLIENTE = [
  'parametros_cliente', 'lojas', 'usuarios', 'dispositivos', 'auditoria',
  'produtos', 'movimentacoes', 'sessoes_caixa', 'vendas', 'itens_venda', 'pagamentos', 'cancelamentos', 'movimentos_caixa',
  'origens', 'eventos_recebidos', 'alteracoes', 'cursores_descida', 'sinais_de_vida',
] as const;

const somenteInclusao = (tabela: string) => `
  CREATE TRIGGER ${tabela}_somente_inclusao BEFORE UPDATE OR DELETE ON ${tabela}
    FOR EACH ROW EXECUTE FUNCTION recusar_alteracao();`;

const PLATAFORMA = `
  CREATE FUNCTION recusar_alteracao() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    RAISE EXCEPTION '%: registros não são editados nem apagados', TG_TABLE_NAME;
  END;
  $$;

  CREATE TABLE clientes (
    id             uuid PRIMARY KEY,
    tipo_documento text NOT NULL CHECK (tipo_documento IN ('CNPJ', 'CPF')),
    documento      text NOT NULL UNIQUE,
    nome           text NOT NULL CHECK (btrim(nome) <> ''),
    nome_fantasia  text,
    segmento       text NOT NULL,
    dominio        text NOT NULL UNIQUE,
    plano          text NOT NULL DEFAULT 'mvp',
    situacao       text NOT NULL DEFAULT 'ativo' CHECK (situacao IN ('ativo', 'suspenso')),
    criado_em      timestamptz NOT NULL DEFAULT now(),
    CHECK ((tipo_documento = 'CNPJ' AND documento ~ '^[0-9]{14}$') OR (tipo_documento = 'CPF' AND documento ~ '^[0-9]{11}$'))
  );

  CREATE TABLE parametros_cliente (
    cliente_id          uuid PRIMARY KEY REFERENCES clientes (id),
    modelo              text NOT NULL,
    modulos             jsonb NOT NULL DEFAULT '[]',
    comprovante         jsonb NOT NULL DEFAULT '{}',
    regra_estoque       text NOT NULL DEFAULT 'bloquear' CHECK (regra_estoque IN ('bloquear', 'permitir_alerta')),
    limite_desconto_pct integer NOT NULL DEFAULT 10 CHECK (limite_desconto_pct BETWEEN 0 AND 100),
    marca               jsonb NOT NULL DEFAULT '{}',
    versao              integer NOT NULL DEFAULT 1 CHECK (versao >= 1)
  );

  CREATE TABLE lojas (
    id            uuid PRIMARY KEY,
    cliente_id    uuid NOT NULL REFERENCES clientes (id),
    nome_reduzido text NOT NULL CHECK (nome_reduzido ~ '^[A-Z0-9]{1,10}$'),
    nome          text NOT NULL,
    endereco      jsonb NOT NULL DEFAULT '{}',
    telefone      text,
    UNIQUE (cliente_id, nome_reduzido)
  );

  CREATE TABLE usuarios (
    id         uuid PRIMARY KEY,
    cliente_id uuid NOT NULL REFERENCES clientes (id),
    nome       text NOT NULL,
    email      text NOT NULL,
    senha_hash text NOT NULL,
    perfil     text NOT NULL CHECK (perfil IN ('dono', 'gerente', 'operador', 'supervisor')),
    ativo      boolean NOT NULL DEFAULT true,
    UNIQUE (cliente_id, email)
  );

  CREATE TABLE dispositivos (
    id                   uuid PRIMARY KEY,
    cliente_id           uuid NOT NULL REFERENCES clientes (id),
    loja_id              uuid NOT NULL REFERENCES lojas (id),
    tipo                 text NOT NULL CHECK (tipo IN ('agente', 'pdv')),
    numero_caixa         integer CHECK (numero_caixa BETWEEN 1 AND 9),
    situacao             text NOT NULL DEFAULT 'pendente' CHECK (situacao IN ('pendente', 'ativo', 'expirado', 'desativado')),
    codigo_ativacao_hash text,
    codigo_expira_em     timestamptz,
    credencial_hash      text,
    versao_instalada     text,
    CHECK ((tipo = 'pdv') = (numero_caixa IS NOT NULL)),
    UNIQUE (loja_id, numero_caixa)
  );

  CREATE TABLE equipe_continuum (
    id         uuid PRIMARY KEY,
    nome       text NOT NULL,
    email      text NOT NULL UNIQUE,
    senha_hash text NOT NULL,
    papel      text NOT NULL
  );

  CREATE TABLE auditoria (
    id         uuid PRIMARY KEY,
    cliente_id uuid REFERENCES clientes (id), -- nulo = ação da plataforma (Central)
    autor_id   uuid NOT NULL,
    acao       text NOT NULL,
    alvo       text NOT NULL,
    dados      jsonb NOT NULL DEFAULT '{}',
    em         timestamptz NOT NULL DEFAULT now()
  );
  ${somenteInclusao('auditoria')}
`;

const OPERACAO = `
  CREATE TABLE produtos (
    id             uuid PRIMARY KEY,
    cliente_id     uuid NOT NULL REFERENCES clientes (id),
    nome           text NOT NULL CHECK (btrim(nome) <> ''),
    preco_centavos bigint NOT NULL CHECK (preco_centavos >= 0),
    unidade        text NOT NULL CHECK (unidade IN ('un', 'kg', 'l')),
    ean            text CHECK (ean ~ '^[0-9]{13}$'),
    estoque_minimo integer NOT NULL DEFAULT 0 CHECK (estoque_minimo >= 0),
    version        integer NOT NULL CHECK (version >= 1),
    alterado_em    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (cliente_id, ean)
  );

  CREATE TABLE sessoes_caixa (
    id                uuid PRIMARY KEY,
    cliente_id        uuid NOT NULL REFERENCES clientes (id),
    dispositivo_id    uuid NOT NULL REFERENCES dispositivos (id),
    operador          text NOT NULL,
    fundo_centavos    bigint NOT NULL CHECK (fundo_centavos >= 0),
    aberta_em         timestamptz NOT NULL,
    fechada_em        timestamptz,
    contado_centavos  bigint,
    esperado_centavos bigint,
    relatorio         jsonb
  );

  CREATE TABLE vendas (
    id                uuid PRIMARY KEY,
    cliente_id        uuid NOT NULL REFERENCES clientes (id),
    loja_id           uuid NOT NULL REFERENCES lojas (id),
    dispositivo_id    uuid NOT NULL REFERENCES dispositivos (id),
    sessao_id         uuid NOT NULL REFERENCES sessoes_caixa (id),
    codigo            text NOT NULL,
    numero            bigint NOT NULL CHECK (numero >= 1),
    bruto_centavos    bigint NOT NULL CHECK (bruto_centavos >= 0),
    desconto_centavos bigint NOT NULL CHECK (desconto_centavos >= 0),
    liquido_centavos  bigint NOT NULL,
    troco_centavos    bigint NOT NULL CHECK (troco_centavos >= 0),
    documento_cliente text,
    ocorrido_em       timestamptz NOT NULL,
    CHECK (liquido_centavos = bruto_centavos - desconto_centavos),
    UNIQUE (cliente_id, codigo)
  );
  ${somenteInclusao('vendas')}

  CREATE TABLE movimentacoes (
    id             uuid PRIMARY KEY,
    cliente_id     uuid NOT NULL REFERENCES clientes (id),
    loja_id        uuid NOT NULL REFERENCES lojas (id),
    produto_id     uuid NOT NULL REFERENCES produtos (id),
    tipo           text NOT NULL CHECK (tipo IN ('ENTRADA', 'VENDA', 'AJUSTE', 'ESTORNO')),
    quantidade     bigint NOT NULL CHECK (quantidade <> 0),
    venda_id       uuid REFERENCES vendas (id),
    motivo         text,
    dispositivo_id uuid REFERENCES dispositivos (id),
    ocorrido_em    timestamptz NOT NULL,
    CHECK (tipo <> 'ENTRADA' OR quantidade > 0),
    CHECK (tipo <> 'VENDA' OR quantidade < 0),
    CHECK ((tipo = 'VENDA') = (venda_id IS NOT NULL))
  );
  ${somenteInclusao('movimentacoes')}

  CREATE TABLE itens_venda (
    id                      uuid PRIMARY KEY,
    cliente_id              uuid NOT NULL REFERENCES clientes (id),
    venda_id                uuid NOT NULL REFERENCES vendas (id),
    posicao                 integer NOT NULL CHECK (posicao >= 1),
    produto_id              uuid NOT NULL REFERENCES produtos (id),
    quantidade              bigint NOT NULL CHECK (quantidade > 0),
    preco_unitario_centavos bigint NOT NULL CHECK (preco_unitario_centavos >= 0),
    desconto_centavos       bigint NOT NULL DEFAULT 0 CHECK (desconto_centavos >= 0),
    movimentacao_id         uuid NOT NULL UNIQUE,
    UNIQUE (venda_id, posicao)
  );
  ${somenteInclusao('itens_venda')}

  CREATE TABLE pagamentos (
    id             uuid PRIMARY KEY,
    cliente_id     uuid NOT NULL REFERENCES clientes (id),
    venda_id       uuid NOT NULL REFERENCES vendas (id),
    forma          text NOT NULL CHECK (forma IN ('dinheiro', 'debito', 'credito', 'pix')),
    valor_centavos bigint NOT NULL CHECK (valor_centavos > 0)
  );
  ${somenteInclusao('pagamentos')}

  CREATE TABLE cancelamentos (
    venda_id       uuid PRIMARY KEY REFERENCES vendas (id),
    cliente_id     uuid NOT NULL REFERENCES clientes (id),
    motivo         text NOT NULL,
    autorizado_por text NOT NULL,
    cancelado_em   timestamptz NOT NULL
  );
  ${somenteInclusao('cancelamentos')}

  CREATE TABLE movimentos_caixa (
    id             uuid PRIMARY KEY,
    cliente_id     uuid NOT NULL REFERENCES clientes (id),
    sessao_id      uuid NOT NULL REFERENCES sessoes_caixa (id),
    tipo           text NOT NULL CHECK (tipo IN ('SANGRIA', 'SUPRIMENTO')),
    valor_centavos bigint NOT NULL CHECK (valor_centavos > 0),
    motivo         text NOT NULL,
    ocorrido_em    timestamptz NOT NULL
  );
  ${somenteInclusao('movimentos_caixa')}

  -- Índices principais (docs/04, seção 3.5)
  CREATE INDEX movimentacoes_saldo ON movimentacoes (cliente_id, produto_id, quantidade);
  CREATE INDEX vendas_por_dia ON vendas (cliente_id, loja_id, ocorrido_em);
`;

const SINCRONIZACAO = `
  CREATE TABLE origens (
    dispositivo_id uuid PRIMARY KEY REFERENCES dispositivos (id),
    cliente_id     uuid NOT NULL REFERENCES clientes (id),
    ultima_seq     bigint NOT NULL DEFAULT 0 CHECK (ultima_seq >= 0)
  );

  CREATE TABLE eventos_recebidos (
    origem_id   uuid NOT NULL REFERENCES origens (dispositivo_id),
    seq         bigint NOT NULL CHECK (seq >= 1),
    id          uuid NOT NULL UNIQUE,
    cliente_id  uuid NOT NULL REFERENCES clientes (id),
    tipo        text NOT NULL,
    versao      integer NOT NULL,
    dados       jsonb NOT NULL,
    ocorrido_em timestamptz NOT NULL,
    recebido_em timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (origem_id, seq)
  );
  ${somenteInclusao('eventos_recebidos')}

  CREATE TABLE alteracoes (
    seq         bigserial PRIMARY KEY,
    cliente_id  uuid NOT NULL REFERENCES clientes (id),
    entidade    text NOT NULL CHECK (entidade IN ('produto', 'parametros', 'loja')),
    entidade_id uuid NOT NULL,
    versao      integer NOT NULL,
    dados       jsonb NOT NULL,
    em          timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX alteracoes_descida ON alteracoes (cliente_id, seq);

  CREATE TABLE cursores_descida (
    dispositivo_id uuid PRIMARY KEY REFERENCES dispositivos (id),
    cliente_id     uuid NOT NULL REFERENCES clientes (id),
    ultima_seq     bigint NOT NULL DEFAULT 0
  );

  CREATE TABLE sinais_de_vida (
    dispositivo_id  uuid PRIMARY KEY REFERENCES dispositivos (id),
    cliente_id      uuid NOT NULL REFERENCES clientes (id),
    estado          text NOT NULL,
    fila_pendente   integer NOT NULL,
    caixa_aberto    boolean NOT NULL,
    ultima_venda_em timestamptz,
    versao          text NOT NULL,
    recebido_em     timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX sinais_por_cliente ON sinais_de_vida (cliente_id);
`;

// O isolamento (docs/04, seção 3.4). "nullif(...)": sem cliente informado, o pedido não enxerga nada.
const CLIENTE_DO_PEDIDO = "nullif(current_setting('app.cliente_id', true), '')::uuid";

const ISOLAMENTO = `
  DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'continuum_app') THEN CREATE ROLE continuum_app NOLOGIN; END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'continuum_central') THEN CREATE ROLE continuum_central NOLOGIN; END IF;
  END $$;

  GRANT USAGE ON SCHEMA public TO continuum_app, continuum_central;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ${TABELAS_DE_CLIENTE.join(', ')} TO continuum_app;
  GRANT SELECT ON clientes TO continuum_app;
  GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO continuum_app;
  GRANT SELECT ON ALL TABLES IN SCHEMA public TO continuum_central;

  ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
  ALTER TABLE clientes FORCE ROW LEVEL SECURITY;
  CREATE POLICY so_o_proprio_cliente ON clientes TO continuum_app USING (id = ${CLIENTE_DO_PEDIDO});
  CREATE POLICY central_le_tudo ON clientes FOR SELECT TO continuum_central USING (true);

  ${TABELAS_DE_CLIENTE.map(
    (t) => `
  ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;
  ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;
  CREATE POLICY so_do_cliente ON ${t} TO continuum_app
    USING (cliente_id = ${CLIENTE_DO_PEDIDO}) WITH CHECK (cliente_id = ${CLIENTE_DO_PEDIDO});
  CREATE POLICY central_le_tudo ON ${t} FOR SELECT TO continuum_central USING (true);`,
  ).join('\n')}
`;

// Migração 5: a entrada e o ajuste de estoque feitos no ERP também descem para os caixas da loja.
const ESTOQUE_DESCE = `
  ALTER TABLE alteracoes DROP CONSTRAINT alteracoes_entidade_check;
  ALTER TABLE alteracoes ADD CONSTRAINT alteracoes_entidade_check CHECK (entidade IN ('produto', 'parametros', 'loja', 'estoque'));
`;

export const MIGRACOES_NUVEM: readonly MigracaoNuvem[] = [
  { numero: 1, nome: 'plataforma', sql: PLATAFORMA },
  { numero: 2, nome: 'operacao', sql: OPERACAO },
  { numero: 3, nome: 'sincronizacao', sql: SINCRONIZACAO },
  { numero: 4, nome: 'isolamento_por_cliente', sql: ISOLAMENTO },
  { numero: 5, nome: 'estoque_desce', sql: ESTOQUE_DESCE },
];

/** Aplica, cada uma na sua transação, as migrações que faltam. Recusa migração antiga editada. */
export async function aplicarMigracoesNuvem(conexao: pg.PoolClient, lista: readonly MigracaoNuvem[] = MIGRACOES_NUVEM): Promise<number[]> {
  lista.forEach((m, i) => {
    if (m.numero !== i + 1) throw new Error(`migração "${m.nome}": esperado o número ${i + 1}, recebido ${m.numero}`);
  });
  await conexao.query(`CREATE TABLE IF NOT EXISTS migracoes (
    numero integer PRIMARY KEY, nome text NOT NULL, aplicada_em timestamptz NOT NULL DEFAULT now())`);
  const gravadas = (await conexao.query<{ numero: number; nome: string }>('SELECT numero, nome FROM migracoes ORDER BY numero')).rows;
  for (const g of gravadas) {
    const doPrograma = lista[g.numero - 1];
    if (doPrograma === undefined) throw new Error(`o banco está na migração ${g.numero}, mais nova que este programa: atualize o programa`);
    if (doPrograma.nome !== g.nome) throw new Error(`a migração ${g.numero} foi aplicada como "${g.nome}" e o programa tem "${doPrograma.nome}": migração antiga não se edita`);
  }
  const aplicadas: number[] = [];
  for (const m of lista.slice(gravadas.length)) {
    try {
      await conexao.query('BEGIN');
      await conexao.query(m.sql);
      await conexao.query('INSERT INTO migracoes (numero, nome) VALUES ($1, $2)', [m.numero, m.nome]);
      await conexao.query('COMMIT');
    } catch (erro) {
      await conexao.query('ROLLBACK');
      throw new Error(`migração ${m.numero} (${m.nome}) falhou: ${(erro as Error).message}`, { cause: erro });
    }
    aplicadas.push(m.numero);
  }
  return aplicadas;
}
