// models/migration_payments.js
// Execute isso UMA VEZ para adicionar as tabelas de pagamento
// Rode: node models/migration_payments.js

require('dotenv').config();
const { pool } = require('./database');

async function migrate() {
  try {
    // Adiciona pix_key na tabela users
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS pix_key TEXT`);

    // Cria tabela de pedidos
    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL REFERENCES products(id),
        buyer_id TEXT NOT NULL REFERENCES users(id),
        seller_id TEXT NOT NULL REFERENCES users(id),
        valor_total REAL NOT NULL,
        taxa_site REAL NOT NULL,
        repasse_vendedor REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending','awaiting_confirmation','paid','repassed','rejected')),
        comprovante TEXT,
        repasse_info TEXT,
        paid_at TIMESTAMP,
        repassed_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    console.log('✅ Migração de pagamentos concluída!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Erro na migração:', err);
    process.exit(1);
  }
}

migrate();
