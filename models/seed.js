// models/seed.js — Popula banco com admin + categorias (PostgreSQL)
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { pool, initDB } = require('./database');

async function seed() {
  await initDB();

  // ─── Admin ──────────────────────────────────────────────────────────────
  const existing = await pool.query('SELECT id FROM users WHERE email = $1', ['gustavop797@gmail.com']);
  if (!existing.rows.length) {
    const hash = await bcrypt.hash('Guga1233', 12);
    await pool.query(
      `INSERT INTO users (id, name, email, password, role, verified) VALUES ($1,$2,$3,$4,'admin',1)`,
      [uuidv4(), 'Administrador', 'gustavop797@gmail.com', hash]
    );
    console.log('✅ Admin criado: gustavop797@gmail.com / Guga1233');
  } else {
    console.log('ℹ️  Admin já existe.');
  }

  // ─── Categories ─────────────────────────────────────────────────────────
  const cats = [
    { name: 'Celulares e Tablets', slug: 'celulares',   icon: '📱', color: '#3b82f6', sort_order: 1 },
    { name: 'Eletrônicos',         slug: 'eletronicos', icon: '💻', color: '#6366f1', sort_order: 2 },
    { name: 'Veículos',            slug: 'veiculos',    icon: '🚗', color: '#10b981', sort_order: 3 },
    { name: 'Imóveis',             slug: 'imoveis',     icon: '🏠', color: '#f59e0b', sort_order: 4 },
    { name: 'Moda e Beleza',       slug: 'moda',        icon: '👗', color: '#ec4899', sort_order: 5 },
    { name: 'Esportes',            slug: 'esportes',    icon: '⚽', color: '#8b5cf6', sort_order: 6 },
    { name: 'Móveis e Casa',       slug: 'moveis',      icon: '🛋️', color: '#06b6d4', sort_order: 7 },
    { name: 'Empregos',            slug: 'empregos',    icon: '💼', color: '#f97316', sort_order: 8 },
    { name: 'Serviços',            slug: 'servicos',    icon: '🔧', color: '#84cc16', sort_order: 9 },
    { name: 'Outros',              slug: 'outros',      icon: '📦', color: '#64748b', sort_order: 10 },
  ];

  for (const c of cats) {
    await pool.query(
      `INSERT INTO categories (name, slug, icon, color, sort_order) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT(slug) DO UPDATE SET name=EXCLUDED.name, icon=EXCLUDED.icon, color=EXCLUDED.color`,
      [c.name, c.slug, c.icon, c.color, c.sort_order]
    );
  }
  console.log('✅ Categorias inseridas.');
  console.log('\n🎉 Seed concluído!');
}

module.exports = { seed };

// ─── BUG CORRIGIDO: seed.js não tinha auto-execução ─────────────────────────
// Quando chamado via `npm run seed` (node models/seed.js), a função seed()
// nunca era invocada — apenas exportada. Admin nunca era criado standalone.
if (require.main === module) {
  seed()
    .then(() => process.exit(0))
    .catch(err => { console.error('❌ Erro no seed:', err.message); process.exit(1); });
}
