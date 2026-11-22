// Banco próprio do caixa (dados/pdv/pdv.db): o que é do PDV e não do cadastro da loja.
// Sessões de caixa, sangria/suprimento, pagamentos, descontos, documento do cliente,
// cancelamentos e EAN dos produtos. Nada aqui vai para a outbox: a nuvem só aceita
// os 4 eventos do LAB (produto criado/alterado, movimentação, venda), e um tipo
// novo bloquearia a fila da loja inteira. Estoque e venda continuam no vendas.db.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, renameSync } from 'node:fs';

/** PIN de supervisor da demonstração, gravado com hash na primeira execução. */
export const PIN_PADRAO = '1234';

export const ESQUEMA_CAIXA = `
  CREATE TABLE IF NOT EXISTS config (
    chave TEXT PRIMARY KEY,
    valor TEXT NOT NULL
  ) STRICT;

  -- Uma sessão = do abrir ao fechar o caixa (turno do operador).
  CREATE TABLE IF NOT EXISTS sessoes (
    id                TEXT    PRIMARY KEY,
    caixa             TEXT    NOT NULL,
    operador          TEXT    NOT NULL CHECK (trim(operador) <> ''),
    aberta_em         TEXT    NOT NULL,
    fundo_centavos    INTEGER NOT NULL CHECK (fundo_centavos >= 0),
    fechada_em        TEXT,
    contado_centavos  INTEGER,
    esperado_centavos INTEGER,
    relatorio         TEXT
  ) STRICT;
  CREATE UNIQUE INDEX IF NOT EXISTS uma_sessao_aberta_por_caixa ON sessoes (caixa) WHERE fechada_em IS NULL;

  CREATE TRIGGER IF NOT EXISTS sessao_fechada_imutavel
  BEFORE UPDATE ON sessoes WHEN OLD.fechada_em IS NOT NULL
  BEGIN SELECT RAISE(ABORT, 'sessoes: sessão fechada não muda'); END;

  -- Sangria (retirada de dinheiro) e suprimento (reforço de troco).
  CREATE TABLE IF NOT EXISTS movimentos (
    id             TEXT    PRIMARY KEY,
    sessao_id      TEXT    NOT NULL REFERENCES sessoes (id),
    tipo           TEXT    NOT NULL CHECK (tipo IN ('SANGRIA', 'SUPRIMENTO')),
    valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0),
    motivo         TEXT    NOT NULL CHECK (trim(motivo) <> ''),
    operador       TEXT    NOT NULL,
    em             TEXT    NOT NULL
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS movimentos_sem_update BEFORE UPDATE ON movimentos
  BEGIN SELECT RAISE(ABORT, 'movimentos: não são editados'); END;
  CREATE TRIGGER IF NOT EXISTS movimentos_sem_delete BEFORE DELETE ON movimentos
  BEGIN SELECT RAISE(ABORT, 'movimentos: não são apagados'); END;

  -- A parte do caixa de cada venda. A chave (idempotência) é a chave primária:
  -- a mesma chave nunca grava duas vendas, nem depois de reiniciar.
  CREATE TABLE IF NOT EXISTS vendas_caixa (
    chave              TEXT    PRIMARY KEY,
    venda_id           TEXT    NOT NULL UNIQUE,
    numero             INTEGER NOT NULL,
    codigo             TEXT    NOT NULL UNIQUE,
    sessao_id          TEXT    REFERENCES sessoes (id),
    caixa              TEXT    NOT NULL,
    operador           TEXT,
    bruto_centavos     INTEGER NOT NULL CHECK (bruto_centavos >= 0),
    desconto_centavos  INTEGER NOT NULL DEFAULT 0 CHECK (desconto_centavos >= 0),
    liquido_centavos   INTEGER NOT NULL CHECK (liquido_centavos >= 0),
    pagamentos         TEXT    NOT NULL,
    troco_centavos     INTEGER NOT NULL DEFAULT 0 CHECK (troco_centavos >= 0),
    documento          TEXT,
    itens              TEXT    NOT NULL,
    seq                INTEGER,
    ocorrido_em        TEXT    NOT NULL,
    cancelada_em       TEXT,
    cancelamento       TEXT,
    CHECK (liquido_centavos = bruto_centavos - desconto_centavos)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS vendas_caixa_por_sessao ON vendas_caixa (sessao_id);

  -- Só o cancelamento muda uma venda do caixa, e uma vez só.
  CREATE TRIGGER IF NOT EXISTS vendas_caixa_imutavel
  BEFORE UPDATE OF chave, venda_id, numero, codigo, sessao_id, caixa, operador, bruto_centavos,
    desconto_centavos, liquido_centavos, pagamentos, troco_centavos, documento, itens, seq, ocorrido_em
  ON vendas_caixa
  BEGIN SELECT RAISE(ABORT, 'vendas_caixa: a venda não é editada (cancelamento é estorno)'); END;
  CREATE TRIGGER IF NOT EXISTS vendas_caixa_cancela_uma_vez
  BEFORE UPDATE OF cancelada_em, cancelamento ON vendas_caixa WHEN OLD.cancelada_em IS NOT NULL
  BEGIN SELECT RAISE(ABORT, 'vendas_caixa: venda já cancelada'); END;
  CREATE TRIGGER IF NOT EXISTS vendas_caixa_sem_delete BEFORE DELETE ON vendas_caixa
  BEGIN SELECT RAISE(ABORT, 'vendas_caixa: vendas não são apagadas'); END;

  -- EAN-13 de cada produto (o cadastro da loja ainda não tem esse campo).
  CREATE TABLE IF NOT EXISTS eans (
    produto_id TEXT PRIMARY KEY,
    ean        TEXT NOT NULL UNIQUE CHECK (length(ean) = 13)
  ) STRICT;
`;

export function prepararBancoCaixa(banco) {
  banco.executar('PRAGMA journal_mode = WAL');
  banco.transacao(() => {
    banco.executar(ESQUEMA_CAIXA);
    if (banco.consultarUma("SELECT 1 FROM config WHERE chave = 'pin_supervisor'") === undefined) {
      banco.rodar("INSERT INTO config (chave, valor) VALUES ('pin_supervisor', ?)", hashPin(PIN_PADRAO));
    }
  });
}

/** scrypt com sal: o PIN nunca fica em texto puro no disco. */
export function hashPin(pin) {
  const sal = randomBytes(16);
  return `scrypt:${sal.toString('hex')}:${scryptSync(String(pin), sal, 32).toString('hex')}`;
}

export function conferePin(banco, pin) {
  if (typeof pin !== 'string' || pin.length === 0 || pin.length > 32) return false;
  const linha = banco.consultarUma("SELECT valor FROM config WHERE chave = 'pin_supervisor'");
  const [, salHex, hashHex] = String(linha?.['valor'] ?? '').split(':');
  if (!salHex || !hashHex) return false;
  const esperado = Buffer.from(hashHex, 'hex');
  const obtido = scryptSync(pin, Buffer.from(salHex, 'hex'), esperado.length);
  return timingSafeEqual(esperado, obtido);
}

/**
 * Traz as vendas do histórico antigo (vendas-do-caixa.jsonl, versão anterior do PDV)
 * para o pdv.db, uma vez. As que o banco da loja não tem mais (lab:reset) ficam de fora.
 * O arquivo é renomeado para .migrado, não apagado.
 */
export function migrarHistoricoJsonl(bancoCaixa, bancoLoja, arquivo, caixa) {
  if (!arquivo || !existsSync(arquivo)) return 0;
  const lidos = [];
  for (const linha of readFileSync(arquivo, 'utf8').split('\n').filter(Boolean)) {
    try {
      const r = JSON.parse(linha);
      if (typeof r.chave === 'string' && typeof r.vendaId === 'string' && typeof r.codigo === 'string') lidos.push(r);
    } catch { /* linha cortada: ignora só ela */ }
  }
  let migrados = 0;
  if (lidos.length > 0) {
    const existem = new Set(bancoLoja
      .consultar(`SELECT id FROM vendas WHERE id IN (${lidos.map(() => '?').join(', ')})`, ...lidos.map((r) => r.vendaId))
      .map((l) => String(l['id'])));
    bancoCaixa.transacao(() => {
      for (const r of lidos) {
        if (!existem.has(r.vendaId)) continue;
        const pag = r.pagamento ?? { forma: 'dinheiro', recebidoCentavos: r.totalCentavos, trocoCentavos: 0 };
        const forma = pag.forma === 'cartao' ? 'credito' : pag.forma;
        migrados += bancoCaixa.rodar(
          `INSERT OR IGNORE INTO vendas_caixa (chave, venda_id, numero, codigo, sessao_id, caixa, operador, bruto_centavos,
             desconto_centavos, liquido_centavos, pagamentos, troco_centavos, documento, itens, seq, ocorrido_em)
           VALUES (?, ?, ?, ?, NULL, ?, NULL, ?, 0, ?, ?, ?, NULL, ?, ?, ?)`,
          r.chave, r.vendaId, r.numero, r.codigo, caixa, r.totalCentavos, r.totalCentavos,
          JSON.stringify([{ forma, valorCentavos: pag.recebidoCentavos ?? r.totalCentavos }]), pag.trocoCentavos ?? 0,
          JSON.stringify((r.itens ?? []).map((i) => ({ ...i, descontoCentavos: 0 }))), r.seq ?? null, r.ocorridoEm,
        );
      }
    });
  }
  renameSync(arquivo, `${arquivo}.migrado`);
  return migrados;
}
