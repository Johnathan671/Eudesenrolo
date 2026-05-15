// models/seed.js — Popula banco com admin + categorias
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { db, initDB } = require('./database');

async function seed() {
  initDB();

  // ─── Admin ──────────────────────────────────────────────────────────────
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get('gustavop797@gmail.com');
  if (!existing) {
    const hash = await bcrypt.hash('Guga1233', 12);
    db.prepare(`
      INSERT INTO users (id, name, email, password, role, verified)
      VALUES (?, ?, ?, ?, 'admin', 1)
    `).run(uuidv4(), 'Administrador', 'gustavop797@gmail.com', hash);
    console.log('✅ Admin criado: gustavop797@gmail.com / Guga1233');
  } else {
    console.log('ℹ️  Admin já existe.');
  }

  // ─── Categories ─────────────────────────────────────────────────────────
  const cats = [
    { name: 'Celulares e Tablets', slug: 'celulares', icon: '📱', color: '#3b82f6', sort_order: 1 },
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

  const upsert = db.prepare(`
    INSERT INTO categories (name, slug, icon, color, sort_order)
    VALUES (@name, @slug, @icon, @color, @sort_order)
    ON CONFLICT(slug) DO UPDATE SET name=excluded.name, icon=excluded.icon, color=excluded.color
  `);
  const insertMany = db.transaction((items) => items.forEach(c => upsert.run(c)));
  insertMany(cats);
  console.log('✅ Categorias inseridas.');

  console.log('\n🎉 Seed concluído! Execute: npm run dev');
  process.exit(0);
}

seed().catch(e => { console.error(e); process.exit(1); });
