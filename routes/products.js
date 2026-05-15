// routes/products.js
const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { body, query } = require('express-validator');
const { validate, sanitizeBody } = require('../middleware/validate');
const { authenticate, optionalAuth } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { db } = require('../models/database');
const path = require('path');
const fs = require('fs');

// ─── List / Search ──────────────────────────────────────────────────────────
router.get('/', optionalAuth, (req, res) => {
  try {
    const {
      q = '', category, condition, state, city,
      minPrice, maxPrice, featured,
      sort = 'recent', page = 1, limit = 20
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const params = [];
    let where = "p.status = 'active'";

    if (q) {
      where += ` AND (p.title LIKE ? OR p.description LIKE ?)`;
      params.push(`%${q}%`, `%${q}%`);
    }
    if (category) { where += ` AND c.slug = ?`; params.push(category); }
    if (condition) { where += ` AND p.condition = ?`; params.push(condition); }
    if (state)    { where += ` AND p.state = ?`; params.push(state); }
    if (city)     { where += ` AND p.city LIKE ?`; params.push(`%${city}%`); }
    if (minPrice) { where += ` AND p.price >= ?`; params.push(parseFloat(minPrice)); }
    if (maxPrice) { where += ` AND p.price <= ?`; params.push(parseFloat(maxPrice)); }
    if (featured === '1') { where += ` AND p.featured = 1`; }

    const orderMap = {
      recent:    'p.boosted DESC, p.featured DESC, p.created_at DESC',
      price_asc: 'p.price ASC',
      price_desc:'p.price DESC',
      views:     'p.views DESC',
    };
    const order = orderMap[sort] || orderMap.recent;

    const sql = `
      SELECT p.*, c.name AS category_name, c.slug AS category_slug, c.icon AS category_icon,
        u.name AS seller_name, u.avatar AS seller_avatar, u.verified AS seller_verified,
        u.reputation AS seller_reputation, u.total_reviews AS seller_reviews,
        (SELECT url FROM product_images WHERE product_id=p.id AND is_primary=1 LIMIT 1) AS primary_image,
        (SELECT COUNT(*) FROM favorites WHERE product_id=p.id) AS favorites_count
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN users u ON p.seller_id = u.id
      WHERE ${where}
      ORDER BY ${order}
      LIMIT ? OFFSET ?
    `;
    const countSql = `
      SELECT COUNT(*) AS total FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE ${where}
    `;

    const products = db.prepare(sql).all(...params, parseInt(limit), offset);
    const { total } = db.prepare(countSql).get(...params);
    res.json({ products, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar anúncios' });
  }
});

// ─── Autocomplete ───────────────────────────────────────────────────────────
router.get('/autocomplete', (req, res) => {
  const { q = '' } = req.query;
  if (q.length < 2) return res.json([]);
  const rows = db.prepare(`
    SELECT DISTINCT title FROM products
    WHERE status='active' AND title LIKE ?
    ORDER BY views DESC LIMIT 8
  `).all(`%${q}%`);
  res.json(rows.map(r => r.title));
});

// ─── Get single product ─────────────────────────────────────────────────────
router.get('/:id', optionalAuth, (req, res) => {
  try {
    const product = db.prepare(`
      SELECT p.*, c.name AS category_name, c.slug AS category_slug, c.icon AS category_icon,
        u.id AS seller_id, u.name AS seller_name, u.avatar AS seller_avatar,
        u.verified AS seller_verified, u.reputation AS seller_reputation,
        u.total_reviews AS seller_reviews, u.total_sales AS seller_sales,
        u.city AS seller_city, u.state AS seller_state, u.created_at AS seller_since,
        (SELECT COUNT(*) FROM favorites WHERE product_id=p.id) AS favorites_count,
        (SELECT COUNT(*) FROM products WHERE seller_id=u.id AND status='active') AS seller_active_ads
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN users u ON p.seller_id = u.id
      WHERE p.id = ? AND (p.status = 'active' OR p.seller_id = ?)
    `).get(req.params.id, req.user?.id || '');

    if (!product) return res.status(404).json({ error: 'Anúncio não encontrado' });

    const images = db.prepare('SELECT * FROM product_images WHERE product_id=? ORDER BY is_primary DESC, sort_order ASC').all(req.params.id);
    const reviews = db.prepare(`
      SELECT r.*, u.name AS reviewer_name, u.avatar AS reviewer_avatar
      FROM reviews r JOIN users u ON r.reviewer_id = u.id
      WHERE r.seller_id = ? ORDER BY r.created_at DESC LIMIT 5
    `).all(product.seller_id);

    // Increment views (async-ish)
    db.prepare("UPDATE products SET views=views+1 WHERE id=?").run(req.params.id);

    // Favorited by current user?
    let isFavorited = false;
    if (req.user) {
      isFavorited = !!db.prepare('SELECT 1 FROM favorites WHERE user_id=? AND product_id=?').get(req.user.id, req.params.id);
    }

    // Related products
    const related = db.prepare(`
      SELECT p.id, p.title, p.price, p.condition,
        (SELECT url FROM product_images WHERE product_id=p.id AND is_primary=1 LIMIT 1) AS primary_image
      FROM products p
      WHERE p.category_id=? AND p.id!=? AND p.status='active'
      ORDER BY p.created_at DESC LIMIT 4
    `).all(product.category_id, req.params.id);

    res.json({ product, images, reviews, isFavorited, related });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar anúncio' });
  }
});

// ─── Create product ─────────────────────────────────────────────────────────
router.post('/', authenticate, upload.array('images', 8),
  sanitizeBody,
  [
    body('title').trim().isLength({ min: 5, max: 120 }).withMessage('Título: 5–120 caracteres'),
    body('price').isFloat({ min: 0 }).withMessage('Preço inválido'),
    body('condition').isIn(['novo','seminovo','usado','pecas']).withMessage('Condição inválida'),
    body('category_id').isInt().withMessage('Categoria obrigatória'),
  ],
  validate,
  (req, res) => {
    try {
      const { title, description, price, price_negotiable, condition, category_id, city, state, neighborhood } = req.body;
      const id = uuidv4();
      db.prepare(`
        INSERT INTO products (id, title, description, price, price_negotiable, condition, category_id, seller_id, city, state, neighborhood)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, title, description||'', parseFloat(price), price_negotiable ? 1 : 0, condition, parseInt(category_id), req.user.id, city||null, state||null, neighborhood||null);

      // Save images
      if (req.files && req.files.length > 0) {
        const insertImg = db.prepare('INSERT INTO product_images (product_id, url, is_primary, sort_order) VALUES (?,?,?,?)');
        req.files.forEach((f, i) => {
          insertImg.run(id, `/uploads/products/${f.filename}`, i === 0 ? 1 : 0, i);
        });
      }

      // Update seller stats
      db.prepare("UPDATE users SET total_sales=total_sales+1 WHERE id=?").run(req.user.id);

      const product = db.prepare('SELECT * FROM products WHERE id=?').get(id);
      res.status(201).json(product);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Erro ao criar anúncio' });
    }
  }
);

// ─── Update product ─────────────────────────────────────────────────────────
router.put('/:id', authenticate, upload.array('newImages', 8), sanitizeBody, (req, res) => {
  try {
    const product = db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
    if (!product) return res.status(404).json({ error: 'Anúncio não encontrado' });
    if (product.seller_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Sem permissão' });
    }
    const { title, description, price, price_negotiable, condition, city, state, neighborhood, status } = req.body;
    db.prepare(`
      UPDATE products SET
        title=COALESCE(?,title), description=COALESCE(?,description),
        price=COALESCE(?,price), price_negotiable=COALESCE(?,price_negotiable),
        condition=COALESCE(?,condition), city=COALESCE(?,city),
        state=COALESCE(?,state), neighborhood=COALESCE(?,neighborhood),
        status=COALESCE(?,status), updated_at=datetime('now')
      WHERE id=?
    `).run(title||null, description||null, price?parseFloat(price):null,
        price_negotiable!=null?parseInt(price_negotiable):null,
        condition||null, city||null, state||null, neighborhood||null,
        status||null, req.params.id);

    if (req.files?.length > 0) {
      const insertImg = db.prepare('INSERT INTO product_images (product_id, url, sort_order) VALUES (?,?,?)');
      const existing = db.prepare('SELECT COUNT(*) AS c FROM product_images WHERE product_id=?').get(req.params.id).c;
      req.files.forEach((f, i) => insertImg.run(req.params.id, `/uploads/products/${f.filename}`, existing + i));
    }
    res.json({ message: 'Anúncio atualizado' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar' });
  }
});

// ─── Delete product ─────────────────────────────────────────────────────────
router.delete('/:id', authenticate, (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Não encontrado' });
  if (product.seller_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Sem permissão' });
  }
  // Delete images from disk
  const images = db.prepare('SELECT url FROM product_images WHERE product_id=?').all(req.params.id);
  images.forEach(img => {
    const filePath = path.join(__dirname, '..', img.url);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });
  db.prepare('DELETE FROM products WHERE id=?').run(req.params.id);
  res.json({ message: 'Anúncio removido' });
});

// ─── Favorite ───────────────────────────────────────────────────────────────
router.post('/:id/favorite', authenticate, (req, res) => {
  const existing = db.prepare('SELECT 1 FROM favorites WHERE user_id=? AND product_id=?').get(req.user.id, req.params.id);
  if (existing) {
    db.prepare('DELETE FROM favorites WHERE user_id=? AND product_id=?').run(req.user.id, req.params.id);
    res.json({ favorited: false });
  } else {
    db.prepare('INSERT OR IGNORE INTO favorites (user_id, product_id) VALUES (?,?)').run(req.user.id, req.params.id);
    res.json({ favorited: true });
  }
});

// ─── Report ─────────────────────────────────────────────────────────────────
router.post('/:id/report', authenticate, sanitizeBody,
  [body('reason').notEmpty().withMessage('Motivo obrigatório')],
  validate,
  (req, res) => {
    db.prepare('INSERT INTO reports (product_id, user_id, reason, details) VALUES (?,?,?,?)').run(
      req.params.id, req.user.id, req.body.reason, req.body.details || null
    );
    res.json({ message: 'Denúncia registrada. Obrigado!' });
  }
);

// ─── Seller's products ──────────────────────────────────────────────────────
router.get('/seller/:sellerId', optionalAuth, (req, res) => {
  const products = db.prepare(`
    SELECT p.*, c.name AS category_name, c.icon AS category_icon,
      (SELECT url FROM product_images WHERE product_id=p.id AND is_primary=1 LIMIT 1) AS primary_image,
      (SELECT COUNT(*) FROM favorites WHERE product_id=p.id) AS favorites_count
    FROM products p
    LEFT JOIN categories c ON p.category_id=c.id
    WHERE p.seller_id=? AND p.status='active'
    ORDER BY p.featured DESC, p.created_at DESC
  `).all(req.params.sellerId);
  res.json(products);
});

module.exports = router;
