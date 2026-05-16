// routes/misc.js
const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { body } = require('express-validator');
const { validate, sanitizeBody } = require('../middleware/validate');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { pool } = require('../models/database');

router.get('/categories', async (req, res) => {
  const cats = (await pool.query(`
    SELECT c.*, COUNT(p.id) AS product_count
    FROM categories c
    LEFT JOIN products p ON p.category_id=c.id AND p.status='active'
    GROUP BY c.id ORDER BY c.sort_order ASC
  `)).rows;
  res.json(cats);
});

router.post('/reviews', authenticate, sanitizeBody,
  [
    body('seller_id').notEmpty(),
    body('stars').isInt({ min: 1, max: 5 }).withMessage('Estrelas: 1–5'),
    body('comment').optional().isLength({ max: 1000 }),
  ],
  validate,
  async (req, res) => {
    try {
      const { seller_id, product_id, stars, comment } = req.body;
      if (seller_id === req.user.id) return res.status(400).json({ error: 'Não pode avaliar a si mesmo' });
      const id = uuidv4();
      await pool.query('INSERT INTO reviews (id, product_id, reviewer_id, seller_id, stars, comment) VALUES ($1,$2,$3,$4,$5,$6)',
        [id, product_id||null, req.user.id, seller_id, parseInt(stars), comment||null]);
      const stats = (await pool.query("SELECT AVG(stars) AS avg, COUNT(*) AS cnt FROM reviews WHERE seller_id=$1", [seller_id])).rows[0];
      await pool.query("UPDATE users SET reputation=$1, total_reviews=$2 WHERE id=$3", [stats.avg||0, stats.cnt||0, seller_id]);
      res.status(201).json({ message: 'Avaliação registrada!' });
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'Você já avaliou este vendedor para este produto' });
      res.status(500).json({ error: 'Erro ao registrar avaliação' });
    }
  }
);

router.get('/reviews/:userId', async (req, res) => {
  const reviews = (await pool.query(`
    SELECT r.*, u.name AS reviewer_name, u.avatar AS reviewer_avatar, p.title AS product_title
    FROM reviews r JOIN users u ON r.reviewer_id=u.id LEFT JOIN products p ON r.product_id=p.id
    WHERE r.seller_id=$1 ORDER BY r.created_at DESC LIMIT 20
  `, [req.params.userId])).rows;
  const stats = (await pool.query("SELECT AVG(stars) AS avg, COUNT(*) AS total FROM reviews WHERE seller_id=$1", [req.params.userId])).rows[0];
  res.json({ reviews, avg: stats.avg ? parseFloat(parseFloat(stats.avg).toFixed(1)) : 0, total: parseInt(stats.total) || 0 });
});

router.get('/notifications', authenticate, async (req, res) => {
  const notifs = (await pool.query("SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30", [req.user.id])).rows;
  const unread = parseInt((await pool.query("SELECT COUNT(*) AS c FROM notifications WHERE user_id=$1 AND read=0", [req.user.id])).rows[0].c);
  res.json({ notifications: notifs, unread });
});

router.put('/notifications/read-all', authenticate, async (req, res) => {
  await pool.query("UPDATE notifications SET read=1 WHERE user_id=$1", [req.user.id]);
  res.json({ message: 'Marcadas como lidas' });
});

router.put('/notifications/:id/read', authenticate, async (req, res) => {
  await pool.query("UPDATE notifications SET read=1 WHERE id=$1 AND user_id=$2", [req.params.id, req.user.id]);
  res.json({ message: 'ok' });
});

router.get('/users/:id/profile', optionalAuth, async (req, res) => {
  const user = (await pool.query(`
    SELECT id, name, avatar, city, state, bio, verified, premium, reputation, total_reviews, total_sales, created_at
    FROM users WHERE id=$1 AND banned=0
  `, [req.params.id])).rows[0];
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

  const ads = (await pool.query(`
    SELECT p.id, p.title, p.price, p.condition, p.created_at,
      (SELECT url FROM product_images WHERE product_id=p.id AND is_primary=1 LIMIT 1) AS primary_image
    FROM products p WHERE p.seller_id=$1 AND p.status='active'
    ORDER BY p.featured DESC, p.created_at DESC LIMIT 12
  `, [req.params.id])).rows;

  const stats = (await pool.query("SELECT AVG(stars) AS avg, COUNT(*) AS total FROM reviews WHERE seller_id=$1", [req.params.id])).rows[0];
  res.json({ user, ads, rating: { avg: stats.avg ? parseFloat(parseFloat(stats.avg).toFixed(1)) : 0, total: parseInt(stats.total)||0 } });
});

router.get('/favorites', authenticate, async (req, res) => {
  const favs = (await pool.query(`
    SELECT p.id, p.title, p.price, p.condition, p.state, p.city,
      (SELECT url FROM product_images WHERE product_id=p.id AND is_primary=1 LIMIT 1) AS primary_image,
      u.name AS seller_name, f.created_at AS favorited_at
    FROM favorites f JOIN products p ON f.product_id=p.id JOIN users u ON p.seller_id=u.id
    WHERE f.user_id=$1 AND p.status='active' ORDER BY f.created_at DESC
  `, [req.user.id])).rows;
  res.json(favs);
});

router.get('/my-ads', authenticate, async (req, res) => {
  const ads = (await pool.query(`
    SELECT p.*, c.name AS category_name,
      (SELECT url FROM product_images WHERE product_id=p.id AND is_primary=1 LIMIT 1) AS primary_image,
      (SELECT COUNT(*) FROM favorites WHERE product_id=p.id) AS favorites_count
    FROM products p LEFT JOIN categories c ON p.category_id=c.id
    WHERE p.seller_id=$1 ORDER BY p.created_at DESC
  `, [req.user.id])).rows;
  res.json(ads);
});

router.get('/states', (req, res) => {
  res.json(['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO']);
});

module.exports = router;
