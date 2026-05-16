// routes/admin.js
const router = require('express').Router();
const { body } = require('express-validator');
const { validate, sanitizeBody } = require('../middleware/validate');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { pool } = require('../models/database');

router.use(authenticate, requireAdmin);

router.get('/stats', async (req, res) => {
  const [users, products, pending, reports, banned, totalViews, newUsersDay, newAdsDay, topCategories, recentUsers] = await Promise.all([
    pool.query("SELECT COUNT(*) AS c FROM users WHERE role='user'"),
    pool.query("SELECT COUNT(*) AS c FROM products WHERE status='active'"),
    pool.query("SELECT COUNT(*) AS c FROM products WHERE status='pending'"),
    pool.query("SELECT COUNT(*) AS c FROM reports WHERE resolved=0"),
    pool.query("SELECT COUNT(*) AS c FROM users WHERE banned=1"),
    pool.query("SELECT SUM(views) AS c FROM products"),
    pool.query("SELECT COUNT(*) AS c FROM users WHERE created_at >= NOW() - INTERVAL '1 day'"),
    pool.query("SELECT COUNT(*) AS c FROM products WHERE created_at >= NOW() - INTERVAL '1 day'"),
    pool.query(`SELECT c.name, c.icon, COUNT(p.id) AS total FROM categories c LEFT JOIN products p ON p.category_id=c.id AND p.status='active' GROUP BY c.id ORDER BY total DESC LIMIT 6`),
    pool.query("SELECT id, name, email, role, verified, banned, created_at FROM users ORDER BY created_at DESC LIMIT 5"),
  ]);
  res.json({
    users: parseInt(users.rows[0].c),
    products: parseInt(products.rows[0].c),
    pending: parseInt(pending.rows[0].c),
    reports: parseInt(reports.rows[0].c),
    banned: parseInt(banned.rows[0].c),
    totalViews: parseInt(totalViews.rows[0].c) || 0,
    newUsersDay: parseInt(newUsersDay.rows[0].c),
    newAdsDay: parseInt(newAdsDay.rows[0].c),
    topCategories: topCategories.rows,
    recentUsers: recentUsers.rows,
  });
});

router.get('/users', async (req, res) => {
  const { q = '', role, banned, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page)-1)*parseInt(limit);
  const params = [];
  let idx = 1;
  let where = '1=1';
  if (q) { where += ` AND (name ILIKE $${idx} OR email ILIKE $${idx+1})`; params.push(`%${q}%`, `%${q}%`); idx += 2; }
  if (role) { where += ` AND role=$${idx}`; params.push(role); idx++; }
  if (banned === '1') where += ' AND banned=1';
  if (banned === '0') where += ' AND banned=0';

  const users = (await pool.query(
    `SELECT id, name, email, role, verified, premium, banned, banned_reason, reputation, total_reviews, total_sales, created_at FROM users WHERE ${where} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx+1}`,
    [...params, parseInt(limit), offset]
  )).rows;
  const total = parseInt((await pool.query(`SELECT COUNT(*) AS total FROM users WHERE ${where}`, params)).rows[0].total);
  res.json({ users, total });
});

router.put('/users/:id/ban', sanitizeBody, async (req, res) => {
  const { reason } = req.body;
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Não pode banir a si mesmo' });
  await pool.query("UPDATE users SET banned=1, banned_reason=$1 WHERE id=$2", [reason||'Violação dos termos', req.params.id]);
  await pool.query("UPDATE products SET status='paused' WHERE seller_id=$1", [req.params.id]);
  res.json({ message: 'Usuário banido' });
});

router.put('/users/:id/unban', async (req, res) => {
  await pool.query("UPDATE users SET banned=0, banned_reason=NULL WHERE id=$1", [req.params.id]);
  res.json({ message: 'Usuário desbanido' });
});

router.put('/users/:id/verify', async (req, res) => {
  await pool.query("UPDATE users SET verified=1 WHERE id=$1", [req.params.id]);
  res.json({ message: 'Usuário verificado' });
});

router.delete('/users/:id', async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Não pode excluir a si mesmo' });
  await pool.query('DELETE FROM users WHERE id=$1', [req.params.id]);
  res.json({ message: 'Usuário removido' });
});

router.get('/products', async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page)-1)*parseInt(limit);
  const params = [];
  let idx = 1;
  let where = '1=1';
  if (status) { where += ` AND p.status=$${idx}`; params.push(status); idx++; }

  const products = (await pool.query(
    `SELECT p.*, u.name AS seller_name, u.email AS seller_email, c.name AS category_name,
      (SELECT url FROM product_images WHERE product_id=p.id AND is_primary=1 LIMIT 1) AS primary_image,
      (SELECT COUNT(*) FROM reports WHERE product_id=p.id AND resolved=0) AS open_reports
    FROM products p LEFT JOIN users u ON p.seller_id=u.id LEFT JOIN categories c ON p.category_id=c.id
    WHERE ${where} ORDER BY open_reports DESC, p.created_at DESC LIMIT $${idx} OFFSET $${idx+1}`,
    [...params, parseInt(limit), offset]
  )).rows;
  const total = parseInt((await pool.query(`SELECT COUNT(*) AS total FROM products p WHERE ${where}`, params)).rows[0].total);
  res.json({ products, total });
});

router.put('/products/:id/approve', async (req, res) => {
  await pool.query("UPDATE products SET status='active' WHERE id=$1", [req.params.id]);
  res.json({ message: 'Anúncio aprovado' });
});

router.put('/products/:id/reject', sanitizeBody, async (req, res) => {
  await pool.query("UPDATE products SET status='rejected', admin_notes=$1 WHERE id=$2", [req.body.reason||null, req.params.id]);
  res.json({ message: 'Anúncio rejeitado' });
});

router.put('/products/:id/feature', async (req, res) => {
  const p = (await pool.query("SELECT featured FROM products WHERE id=$1", [req.params.id])).rows[0];
  const newVal = p?.featured ? 0 : 1;
  await pool.query("UPDATE products SET featured=$1 WHERE id=$2", [newVal, req.params.id]);
  res.json({ message: newVal ? 'Em destaque!' : 'Destaque removido', featured: newVal });
});

router.delete('/products/:id', async (req, res) => {
  await pool.query('DELETE FROM products WHERE id=$1', [req.params.id]);
  res.json({ message: 'Anúncio removido' });
});

router.get('/reports', async (req, res) => {
  const reports = (await pool.query(`
    SELECT r.*, p.title AS product_title, u.name AS reporter_name, u.email AS reporter_email
    FROM reports r LEFT JOIN products p ON r.product_id=p.id LEFT JOIN users u ON r.user_id=u.id
    WHERE r.resolved=0 ORDER BY r.created_at DESC
  `)).rows;
  res.json(reports);
});

router.put('/reports/:id/resolve', async (req, res) => {
  await pool.query("UPDATE reports SET resolved=1 WHERE id=$1", [req.params.id]);
  res.json({ message: 'Denúncia resolvida' });
});

router.post('/categories', sanitizeBody,
  [body('name').notEmpty(), body('slug').notEmpty()],
  validate,
  async (req, res) => {
    const { name, slug, icon, color } = req.body;
    await pool.query('INSERT INTO categories (name, slug, icon, color) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [name, slug, icon||'📦', color||'#6366f1']);
    res.status(201).json({ message: 'Categoria criada' });
  }
);

router.post('/notify', sanitizeBody, async (req, res) => {
  const { user_id, message, type, link } = req.body;
  if (user_id === 'all') {
    const users = (await pool.query("SELECT id FROM users WHERE role='user'")).rows;
    for (const u of users) {
      await pool.query('INSERT INTO notifications (user_id, type, message, link) VALUES ($1,$2,$3,$4)', [u.id, type||'info', message, link||null]);
    }
    res.json({ message: `Notificação enviada para ${users.length} usuários` });
  } else {
    await pool.query('INSERT INTO notifications (user_id, type, message, link) VALUES ($1,$2,$3,$4)', [user_id, type||'info', message, link||null]);
    res.json({ message: 'Notificação enviada' });
  }
});

module.exports = router;
