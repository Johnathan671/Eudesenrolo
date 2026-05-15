// routes/misc.js — reviews, categories, notifications, users
const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { body } = require('express-validator');
const { validate, sanitizeBody } = require('../middleware/validate');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { db } = require('../models/database');

// ─── CATEGORIES ──────────────────────────────────────────────────────────────
router.get('/categories', (req, res) => {
  const cats = db.prepare(`
    SELECT c.*, COUNT(p.id) AS product_count
    FROM categories c
    LEFT JOIN products p ON p.category_id=c.id AND p.status='active'
    GROUP BY c.id ORDER BY c.sort_order ASC
  `).all();
  res.json(cats);
});

// ─── REVIEWS ─────────────────────────────────────────────────────────────────
router.post('/reviews', authenticate, sanitizeBody,
  [
    body('seller_id').notEmpty(),
    body('stars').isInt({ min: 1, max: 5 }).withMessage('Estrelas: 1–5'),
    body('comment').optional().isLength({ max: 1000 }),
  ],
  validate,
  (req, res) => {
    try {
      const { seller_id, product_id, stars, comment } = req.body;
      if (seller_id === req.user.id) return res.status(400).json({ error: 'Não pode avaliar a si mesmo' });

      const id = uuidv4();
      db.prepare('INSERT INTO reviews (id, product_id, reviewer_id, seller_id, stars, comment) VALUES (?,?,?,?,?,?)').run(
        id, product_id||null, req.user.id, seller_id, parseInt(stars), comment||null
      );

      // Update seller reputation
      const { avg, cnt } = db.prepare("SELECT AVG(stars) AS avg, COUNT(*) AS cnt FROM reviews WHERE seller_id=?").get(seller_id);
      db.prepare("UPDATE users SET reputation=?, total_reviews=? WHERE id=?").run(avg||0, cnt||0, seller_id);

      res.status(201).json({ message: 'Avaliação registrada!' });
    } catch (err) {
      if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Você já avaliou este vendedor para este produto' });
      res.status(500).json({ error: 'Erro ao registrar avaliação' });
    }
  }
);

router.get('/reviews/:userId', (req, res) => {
  const reviews = db.prepare(`
    SELECT r.*, u.name AS reviewer_name, u.avatar AS reviewer_avatar, p.title AS product_title
    FROM reviews r
    JOIN users u ON r.reviewer_id=u.id
    LEFT JOIN products p ON r.product_id=p.id
    WHERE r.seller_id=? ORDER BY r.created_at DESC LIMIT 20
  `).all(req.params.userId);
  const { avg, total } = db.prepare("SELECT AVG(stars) AS avg, COUNT(*) AS total FROM reviews WHERE seller_id=?").get(req.params.userId);
  res.json({ reviews, avg: avg ? parseFloat(avg.toFixed(1)) : 0, total: total || 0 });
});

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────
router.get('/notifications', authenticate, (req, res) => {
  const notifs = db.prepare("SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 30").all(req.user.id);
  const unread = db.prepare("SELECT COUNT(*) AS c FROM notifications WHERE user_id=? AND read=0").get(req.user.id).c;
  res.json({ notifications: notifs, unread });
});

router.put('/notifications/read-all', authenticate, (req, res) => {
  db.prepare("UPDATE notifications SET read=1 WHERE user_id=?").run(req.user.id);
  res.json({ message: 'Marcadas como lidas' });
});

router.put('/notifications/:id/read', authenticate, (req, res) => {
  db.prepare("UPDATE notifications SET read=1 WHERE id=? AND user_id=?").run(req.params.id, req.user.id);
  res.json({ message: 'ok' });
});

// ─── USER PROFILE (public) ────────────────────────────────────────────────────
router.get('/users/:id/profile', optionalAuth, (req, res) => {
  const user = db.prepare(`
    SELECT id, name, avatar, city, state, bio, verified, premium, reputation, total_reviews, total_sales, created_at
    FROM users WHERE id=? AND banned=0
  `).get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

  const ads = db.prepare(`
    SELECT p.id, p.title, p.price, p.condition, p.created_at,
      (SELECT url FROM product_images WHERE product_id=p.id AND is_primary=1 LIMIT 1) AS primary_image
    FROM products p WHERE p.seller_id=? AND p.status='active'
    ORDER BY p.featured DESC, p.created_at DESC LIMIT 12
  `).all(req.params.id);

  const { avg, total } = db.prepare("SELECT AVG(stars) AS avg, COUNT(*) AS total FROM reviews WHERE seller_id=?").get(req.params.id);
  res.json({ user, ads, rating: { avg: avg ? parseFloat(avg.toFixed(1)) : 0, total: total||0 } });
});

// ─── MY FAVORITES ─────────────────────────────────────────────────────────────
router.get('/favorites', authenticate, (req, res) => {
  const favs = db.prepare(`
    SELECT p.id, p.title, p.price, p.condition, p.state, p.city,
      (SELECT url FROM product_images WHERE product_id=p.id AND is_primary=1 LIMIT 1) AS primary_image,
      u.name AS seller_name, f.created_at AS favorited_at
    FROM favorites f
    JOIN products p ON f.product_id=p.id
    JOIN users u ON p.seller_id=u.id
    WHERE f.user_id=? AND p.status='active'
    ORDER BY f.created_at DESC
  `).all(req.user.id);
  res.json(favs);
});

// ─── MY ADS ───────────────────────────────────────────────────────────────────
router.get('/my-ads', authenticate, (req, res) => {
  const ads = db.prepare(`
    SELECT p.*, c.name AS category_name,
      (SELECT url FROM product_images WHERE product_id=p.id AND is_primary=1 LIMIT 1) AS primary_image,
      (SELECT COUNT(*) FROM favorites WHERE product_id=p.id) AS favorites_count
    FROM products p LEFT JOIN categories c ON p.category_id=c.id
    WHERE p.seller_id=?
    ORDER BY p.created_at DESC
  `).all(req.user.id);
  res.json(ads);
});

// ─── STATES LIST ──────────────────────────────────────────────────────────────
router.get('/states', (req, res) => {
  res.json([
    'AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT',
    'PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'
  ]);
});

module.exports = router;
