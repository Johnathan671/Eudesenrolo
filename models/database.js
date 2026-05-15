// models/database.js — CellMart v2
const Database = require('better-sqlite3');
const path = require('path');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || './database.sqlite';
const db = new Database(path.resolve(DB_PATH));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('cache_size = -32000');

function initDB() {
  db.exec(`
    -- ─── USERS ────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      email         TEXT NOT NULL UNIQUE,
      password      TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user')),
      avatar        TEXT,
      phone         TEXT,
      city          TEXT,
      state         TEXT,
      bio           TEXT,
      reputation    REAL NOT NULL DEFAULT 0,
      total_reviews INTEGER NOT NULL DEFAULT 0,
      total_sales   INTEGER NOT NULL DEFAULT 0,
      verified      INTEGER NOT NULL DEFAULT 0,
      premium       INTEGER NOT NULL DEFAULT 0,
      premium_until TEXT,
      banned        INTEGER NOT NULL DEFAULT 0,
      banned_reason TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ─── CATEGORIES ───────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS categories (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      name  TEXT NOT NULL UNIQUE,
      slug  TEXT NOT NULL UNIQUE,
      icon  TEXT,
      color TEXT DEFAULT '#6366f1',
      sort_order INTEGER DEFAULT 0
    );

    -- ─── PRODUCTS ─────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS products (
      id              TEXT PRIMARY KEY,
      title           TEXT NOT NULL,
      description     TEXT,
      price           REAL NOT NULL CHECK(price >= 0),
      price_negotiable INTEGER NOT NULL DEFAULT 0,
      condition       TEXT NOT NULL DEFAULT 'usado' CHECK(condition IN ('novo','seminovo','usado','pecas')),
      category_id     INTEGER REFERENCES categories(id),
      seller_id       TEXT NOT NULL REFERENCES users(id),
      city            TEXT,
      state           TEXT,
      neighborhood    TEXT,
      status          TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','sold','paused','rejected','pending')),
      featured        INTEGER NOT NULL DEFAULT 0,
      featured_until  TEXT,
      boosted         INTEGER NOT NULL DEFAULT 0,
      boosted_until   TEXT,
      views           INTEGER NOT NULL DEFAULT 0,
      admin_notes     TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ─── PRODUCT IMAGES ───────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS product_images (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id  TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      url         TEXT NOT NULL,
      is_primary  INTEGER NOT NULL DEFAULT 0,
      sort_order  INTEGER NOT NULL DEFAULT 0
    );

    -- ─── FAVORITES ────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS favorites (
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, product_id)
    );

    -- ─── CONVERSATIONS ────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS conversations (
      id          TEXT PRIMARY KEY,
      product_id  TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      buyer_id    TEXT NOT NULL REFERENCES users(id),
      seller_id   TEXT NOT NULL REFERENCES users(id),
      last_msg    TEXT,
      last_msg_at TEXT DEFAULT (datetime('now')),
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(product_id, buyer_id)
    );

    -- ─── MESSAGES ─────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS messages (
      id              TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      sender_id       TEXT NOT NULL REFERENCES users(id),
      content         TEXT NOT NULL,
      read            INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ─── REVIEWS ──────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS reviews (
      id          TEXT PRIMARY KEY,
      product_id  TEXT REFERENCES products(id) ON DELETE SET NULL,
      reviewer_id TEXT NOT NULL REFERENCES users(id),
      seller_id   TEXT NOT NULL REFERENCES users(id),
      stars       INTEGER NOT NULL CHECK(stars BETWEEN 1 AND 5),
      comment     TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(reviewer_id, seller_id, product_id)
    );

    -- ─── NOTIFICATIONS ────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS notifications (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type       TEXT NOT NULL DEFAULT 'info',
      message    TEXT NOT NULL,
      link       TEXT,
      read       INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ─── REPORTS ──────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS reports (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id TEXT REFERENCES products(id) ON DELETE CASCADE,
      user_id    TEXT NOT NULL REFERENCES users(id),
      reason     TEXT NOT NULL,
      details    TEXT,
      resolved   INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ─── INDEXES ──────────────────────────────────────────────────────────
    CREATE INDEX IF NOT EXISTS idx_products_seller   ON products(seller_id);
    CREATE INDEX IF NOT EXISTS idx_products_status   ON products(status);
    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
    CREATE INDEX IF NOT EXISTS idx_products_price    ON products(price);
    CREATE INDEX IF NOT EXISTS idx_products_featured ON products(featured, status);
    CREATE INDEX IF NOT EXISTS idx_products_created  ON products(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_reviews_seller    ON reviews(seller_id);
    CREATE INDEX IF NOT EXISTS idx_favorites_user    ON favorites(user_id);
    CREATE INDEX IF NOT EXISTS idx_messages_conv     ON messages(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_notif_user        ON notifications(user_id, read);
    CREATE VIRTUAL TABLE IF NOT EXISTS products_fts USING fts5(
      title, description, content=products, content_rowid=rowid
    );
  `);
  console.log('✅ Banco de dados CellMart inicializado');
}

module.exports = { db, initDB };
