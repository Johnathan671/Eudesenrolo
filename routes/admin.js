// routes/admin.js
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { body } = require('express-validator');
const { validate, sanitizeBody } = require('../middleware/validate');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { db } = require('../models/database');

// All admin routes require auth + admin role
router.use(authenticate, requireAdmin);

// ─── Dashboard Stats ─────────────────────────────────────────────────────────
router.get('/stats', (req, res) => {
  const stats = {
    users:       db.prepare("SELECT COUNT(*) AS c FROM users WHERE role='user'").get().c,
    products:    db.prepare("SELECT COUNT(*) AS c FROM products WHERE status='active'").get().c,
    pending:     db.prepare("SELECT COUNT(*) AS c FROM products WHERE status='pending'").get().c,
    reports:     db.prepare("SELECT COUNT(*) AS c FROM reports WHERE resolved=0").get().c,
    banned:      db.prepare("SELECT COUNT(*) AS c FROM users WHERE banned=1").get().c,
    totalViews:  db.prepare("SELECT SUM(views) AS c FROM products").get().c || 0,
    newUsersDay: db.prepare("SELECT COUNT(*) AS c FROM users WHERE created_at >= datetime('now','-1 day')").get().c,
    newAdsDay:   db.prepare("SELECT COUNT(*) AS c FROM products WHERE created_at >= datetime('now','-1 day')").get().c,
    topCategories: db.prepare(`
      SELECT c.name, c.icon, COUNT(p.id) AS total
      FROM categories c LEFT JOIN products p ON p.category_id=c.id AND p.status='active'
      GROUP BY c.id ORDER BY total DESC LIMIT 6
    `).all(),
    recentUsers: db.prepare("SELECT id, name, email, role, verified, banned, created_at FROM users ORDER BY created_at DESC LIMIT 5").all(),
  };
  res.json(stats);
});

// ─── Users Management ────────────────────────────────────────────────────────
router.get('/users', (req, res) => {
  const { q = '', role, banned, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page)-1)*parseInt(limit);
  let where = '1=1';
  const params = [];
  if (q) { where += ' AND (name LIKE ? OR email LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
  if (role) { where += ' AND role=?'; params.push(role); }
  if (banned === '1') where += ' AND banned=1';
  if (banned === '0') where += ' AND banned=0';

  const users = db.prepare(`
    SELECT id, name, email, role, verified, premium, banned, banned_reason,
      reputation, total_reviews, total_sales, created_at
    FROM users WHERE ${where}
    ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), offset);
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM users WHERE ${where}`).get(...params);
  res.json({ users, total });
});

router.put('/users/:id/ban', sanitizeBody, (req, res) => {
  const { reason } = req.body;
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Não pode banir a si mesmo' });
  db.prepare("UPDATE users SET banned=1, banned_reason=? WHERE id=?").run(reason||'Violação dos termos', req.params.id);
  db.prepare("UPDATE products SET status='paused' WHERE seller_id=?").run(req.params.id);
  res.json({ message: 'Usuário banido' });
});

router.put('/users/:id/unban', (req, res) => {
  db.prepare("UPDATE users SET banned=0, banned_reason=NULL WHERE id=?").run(req.params.id);
  res.json({ message: 'Usuário desbanido' });
});

router.put('/users/:id/verify', (req, res) => {
  db.prepare("UPDATE users SET verified=1 WHERE id=?").run(req.params.id);
  res.json({ message: 'Usuário verificado' });
});

router.delete('/users/:id', (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Não pode excluir a si mesmo' });
  db.prepare('DELETE FROM users WHERE id=?').run(req.params.id);
  res.json({ message: 'Usuário removido' });
});

// ─── Products Management ──────────────────────────────────────────────────────
router.get('/products', (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page)-1)*parseInt(limit);
  let where = '1=1';
  const params = [];
  if (status) { where += ' AND p.status=?'; params.push(status); }

  const products = db.prepare(`
    SELECT p.*, u.name AS seller_name, u.email AS seller_email,
      c.name AS category_name,
      (SELECT url FROM product_images WHERE product_id=p.id AND is_primary=1 LIMIT 1) AS primary_image,
      (SELECT COUNT(*) FROM reports WHERE product_id=p.id AND resolved=0) AS open_reports
    FROM products p
    LEFT JOIN users u ON p.seller_id=u.id
    LEFT JOIN categories c ON p.category_id=c.id
    WHERE ${where}
    ORDER BY open_reports DESC, p.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), offset);
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM products p WHERE ${where}`).get(...params);
  res.json({ products, total });
});

router.put('/products/:id/approve', (req, res) => {
  db.prepare("UPDATE products SET status='active' WHERE id=?").run(req.params.id);
  res.json({ message: 'Anúncio aprovado' });
});

router.put('/products/:id/reject', sanitizeBody, (req, res) => {
  const { reason } = req.body;
  db.prepare("UPDATE products SET status='rejected', admin_notes=? WHERE id=?").run(reason||null, req.params.id);
  res.json({ message: 'Anúncio rejeitado' });
});

router.put('/products/:id/feature', (req, res) => {
  const p = db.prepare("SELECT featured FROM products WHERE id=?").get(req.params.id);
  const newVal = p?.featured ? 0 : 1;
  db.prepare("UPDATE products SET featured=? WHERE id=?").run(newVal, req.params.id);
  res.json({ message: newVal ? 'Em destaque!' : 'Destaque removido', featured: newVal });
});

router.delete('/products/:id', (req, res) => {
  db.prepare('DELETE FROM products WHERE id=?').run(req.params.id);
  res.json({ message: 'Anúncio removido' });
});

// ─── Reports ──────────────────────────────────────────────────────────────────
router.get('/reports', (req, res) => {
  const reports = db.prepare(`
    SELECT r.*, p.title AS product_title, u.name AS reporter_name, u.email AS reporter_email
    FROM reports r
    LEFT JOIN products p ON r.product_id=p.id
    LEFT JOIN users u ON r.user_id=u.id
    WHERE r.resolved=0
    ORDER BY r.created_at DESC
  `).all();
  res.json(reports);
});

router.put('/reports/:id/resolve', (req, res) => {
  db.prepare("UPDATE reports SET resolved=1 WHERE id=?").run(req.params.id);
  res.json({ message: 'Denúncia resolvida' });
});

// ─── Categories Management ────────────────────────────────────────────────────
router.post('/categories', sanitizeBody,
  [body('name').notEmpty(), body('slug').notEmpty()],
  validate,
  (req, res) => {
    const { name, slug, icon, color } = req.body;
    db.prepare('INSERT OR IGNORE INTO categories (name, slug, icon, color) VALUES (?,?,?,?)').run(name, slug, icon||'📦', color||'#6366f1');
    res.status(201).json({ message: 'Categoria criada' });
  }
);

// ─── Notifications ────────────────────────────────────────────────────────────
router.post('/notify', sanitizeBody, (req, res) => {
  const { user_id, message, type, link } = req.body;
  if (user_id === 'all') {
    const users = db.prepare("SELECT id FROM users WHERE role='user'").all();
    const ins = db.prepare('INSERT INTO notifications (user_id, type, message, link) VALUES (?,?,?,?)');
    const tx = db.transaction(() => users.forEach(u => ins.run(u.id, type||'info', message, link||null)));
    tx();
    res.json({ message: `Notificação enviada para ${users.length} usuários` });
  } else {
    db.prepare('INSERT INTO notifications (user_id, type, message, link) VALUES (?,?,?,?)').run(user_id, type||'info', message, link||null);
    res.json({ message: 'Notificação enviada' });
  }
});

module.exports = router;
