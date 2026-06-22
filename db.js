import pg from "pg";

const { Pool } = pg;
const { DATABASE_URL } = process.env;

if (!DATABASE_URL) {
  console.error("Falta DATABASE_URL no ambiente (string de conexao do Postgres).");
  process.exit(1);
}

const isLocal = /localhost|127\.0\.0\.1/.test(DATABASE_URL);

export const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cartoes (
      id            UUID PRIMARY KEY,
      customer      JSONB NOT NULL,
      address       JSONB,
      payment_token TEXT  NOT NULL,
      card_mask     TEXT,
      criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS assinaturas (
      id               UUID PRIMARY KEY,
      cartao_id        UUID NOT NULL REFERENCES cartoes(id),
      valor            INTEGER NOT NULL,            -- centavos
      intervalo_dias   INTEGER NOT NULL DEFAULT 7,
      proxima_cobranca DATE NOT NULL,
      ativa            BOOLEAN NOT NULL DEFAULT true,
      tentativas       INTEGER NOT NULL DEFAULT 0,
      criada_em        TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

// ---- Cartoes ----
export async function salvarCartao({ id, customer, address, paymentToken, cardMask }) {
  await pool.query(
    `INSERT INTO cartoes (id, customer, address, payment_token, card_mask)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, JSON.stringify(customer), address ? JSON.stringify(address) : null, paymentToken, cardMask || null]
  );
}

export async function buscarCartao(id) {
  const { rows } = await pool.query(
    `SELECT customer, address, payment_token AS "paymentToken" FROM cartoes WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

// ---- Assinaturas ----
export async function criarAssinatura({ id, cartaoId, valor, intervaloDias, proximaCobranca }) {
  await pool.query(
    `INSERT INTO assinaturas (id, cartao_id, valor, intervalo_dias, proxima_cobranca)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, cartaoId, valor, intervaloDias, proximaCobranca]
  );
}

// Lista assinaturas + dados do cartao para a tela de demo.
export async function listarAssinaturas() {
  const { rows } = await pool.query(
    `SELECT a.id, a.valor, a.intervalo_dias, a.proxima_cobranca, a.ativa, a.tentativas,
            c.customer->>'name' AS nome, c.card_mask
       FROM assinaturas a JOIN cartoes c ON c.id = a.cartao_id
   ORDER BY a.criada_em DESC`
  );
  return rows;
}

// Assinaturas ativas cujo vencimento ja chegou (para o agendador cobrar).
export async function assinaturasParaCobrar() {
  const { rows } = await pool.query(
    `SELECT a.id AS assinatura_id, a.valor, a.intervalo_dias,
            c.customer, c.address, c.payment_token AS "paymentToken"
       FROM assinaturas a JOIN cartoes c ON c.id = a.cartao_id
      WHERE a.ativa = true AND a.proxima_cobranca <= CURRENT_DATE`
  );
  return rows;
}

// Cobranca OK: avanca a proxima data e zera o contador de falhas.
export async function registrarCobrancaOk(assinaturaId) {
  await pool.query(
    `UPDATE assinaturas
        SET proxima_cobranca = proxima_cobranca + intervalo_dias, tentativas = 0
      WHERE id = $1`,
    [assinaturaId]
  );
}

// Cobranca falhou: incrementa falhas; desativa ao atingir maxTentativas.
export async function registrarFalha(assinaturaId, maxTentativas) {
  await pool.query(
    `UPDATE assinaturas
        SET tentativas = tentativas + 1,
            ativa = (tentativas + 1 < $2)
      WHERE id = $1`,
    [assinaturaId, maxTentativas]
  );
}

// Busca uma assinatura + e-mail/nome do cliente (para cancelamento e avisos).
export async function buscarAssinatura(id) {
  const { rows } = await pool.query(
    `SELECT a.ativa, a.valor, a.intervalo_dias,
            c.customer->>'email' AS email, c.customer->>'name' AS nome
       FROM assinaturas a JOIN cartoes c ON c.id = a.cartao_id
      WHERE a.id = $1`,
    [id]
  );
  return rows[0] || null;
}

// Cancela uma assinatura (nao ha mais cobrancas). Retorna true se existia/atualizou.
export async function cancelarAssinatura(id) {
  const r = await pool.query(
    `UPDATE assinaturas SET ativa = false WHERE id = $1 AND ativa = true`,
    [id]
  );
  return r.rowCount > 0;
}
