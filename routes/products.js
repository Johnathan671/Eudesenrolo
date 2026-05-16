// routes/products.js
const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { body } = require('express-validator');
const { validate, sanitizeBody } = require('../middleware/validate');
const { authenticate, optionalAuth } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { pool } = require('../models/database');
const path = require('path');
const fs = require('fs');

// ─── List / Search ──────────────────────────────────────────────────────────
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { q = '', category, condition, state, city, minPrice, maxPrice, featured, sort = 'recent', page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const params = [];
    let idx = 1;
    let where = "p.status = 'active'";

    if (q) { where += ` AND (p.title ILIKE $${idx} OR p.description ILIKE $${idx+1})`; params.push(`%${q}%`, `%${q}%`); idx += 2; }
    if (category) { where += ` AND c.slug = $${idx}`; params.push(category); idx++; }
    if (condition) { where += ` AND p.condition = $${idx}`; params.push(condition); idx++; }
    if (state) { where += ` AND p.state = $${idx}`; params.push(state); idx++; }
    if (city) { where += ` AND p.city ILIKE $${idx}`; params.push(`%${city}%`); idx++; }
    if (minPrice) { where += ` AND p.price >= $${idx}`; params.push(parseFloat(minPrice)); idx++; }
    if (maxPrice) { where += ` AND p.price <= $${idx}`; params.push(parseFloat(maxPrice)); idx++; }
    if (featured === '1') { where += ` AND p.featured = 1`; }

    const orderMap = {
      recent:     'p.boosted DESC, p.featured DESC, p.created_at DESC',
      price_asc:  'p.price ASC',
      price_desc: 'p.price DESC',
      views:      'p.views DESC',
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
      LIMIT $${idx} OFFSET $${idx+1}
    `;
    const countSql = `SELECT COUNT(*) AS total FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE ${where}`;

    const products = (await pool.query(sql, [...params, parseInt(limit), offset])).rows;
    const total = parseInt((await pool.query(countSql, params)).rows[0].total);
    res.json({ products, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar anúncios' });
  }
});

// ─── Autocomplete ───────────────────────────────────────────────────────────
router.get('/autocomplete', async (req, res) => {
  const { q = '' } = req.query;
  if (q.length < 2) return res.json([]);
  const rows = (await pool.query(
    `SELECT DISTINCT title FROM products WHERE status='active' AND title ILIKE $1 ORDER BY views DESC LIMIT 8`,
    [`%${q}%`]
  )).rows;
  res.json(rows.map(r => r.title));
});

// ─── Get single product ─────────────────────────────────────────────────────
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const result = await pool.query(`
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
      WHERE p.id = $1 AND (p.status = 'active' OR p.seller_id = $2)
    `, [req.params.id, req.user?.id || '']);

    const product = result.rows[0];
    if (!product) return res.status(404).json({ error: 'Anúncio não encontrado' });

    const images = (await pool.query('SELECT * FROM product_images WHERE product_id=$1 ORDER BY is_primary DESC, sort_order ASC', [req.params.id])).rows;
    const reviews = (await pool.query(`
      SELECT r.*, u.name AS reviewer_name, u.avatar AS reviewer_avatar
      FROM reviews r JOIN users u ON r.reviewer_id = u.id
      WHERE r.seller_id = $1 ORDER BY r.created_at DESC LIMIT 5
    `, [product.seller_id])).rows;

    await pool.query("UPDATE products SET views=views+1 WHERE id=$1", [req.params.id]);

    let isFavorited = false;
    if (req.user) {
      const fav = await pool.query('SELECT 1 FROM favorites WHERE user_id=$1 AND product_id=$2', [req.user.id, req.params.id]);
      isFavorited = fav.rows.length > 0;
    }

    const related = (await pool.query(`
      SELECT p.id, p.title, p.price, p.condition,
        (SELECT url FROM product_images WHERE product_id=p.id AND is_primary=1 LIMIT 1) AS primary_image
      FROM products p
      WHERE p.category_id=$1 AND p.id!=$2 AND p.status='active'
      ORDER BY p.created_at DESC LIMIT 4
    `, [product.category_id, req.params.id])).rows;

    res.json({ product, images, reviews, isFavorited, related });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar anúncio' });
  }
});

// ─── Create product ─────────────────────────────────────────────────────────
router.post('/', authenticate, upload.array('images', 8), sanitizeBody,
  [
    body('title').trim().isLength({ min: 5, max: 120 }).withMessage('Título: 5–120 caracteres'),
    body('price').isFloat({ min: 0 }).withMessage('Preço inválido'),
    body('condition').isIn(['novo','seminovo','usado','pecas']).withMessage('Condição inválida'),
    body('category_id').isInt().withMessage('Categoria obrigatória'),
  ],
  validate,
  async (req, res) => {
    try {
      const { title, description, price, price_negotiable, condition, category_id, city, state, neighborhood } = req.body;
      const id = uuidv4();
      await pool.query(
        `INSERT INTO products (id, title, description, price, price_negotiable, condition, category_id, seller_id, city, state, neighborhood)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [id, title, description||'', parseFloat(price), price_negotiable ? 1 : 0, condition, parseInt(category_id), req.user.id, city||null, state||null, neighborhood||null]
      );

      if (req.files && req.files.length > 0) {
        for (let i = 0; i < req.files.length; i++) {
          await pool.query(
            'INSERT INTO product_images (product_id, url, is_primary, sort_order) VALUES ($1,$2,$3,$4)',
            [id, `/uploads/products/${req.files[i].filename}`, i === 0 ? 1 : 0, i]
          );
        }
      }

      await pool.query("UPDATE users SET total_sales=total_sales+1 WHERE id=$1", [req.user.id]);
      const product = (await pool.query('SELECT * FROM products WHERE id=$1', [id])).rows[0];
      res.status(201).json(product);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Erro ao criar anúncio' });
    }
  }
);

// ─── Update product ─────────────────────────────────────────────────────────
router.put('/:id', authenticate, upload.array('newImages', 8), sanitizeBody, async (req, res) => {
  try {
    const product = (await pool.query('SELECT * FROM products WHERE id=$1', [req.params.id])).rows[0];
    if (!product) return res.status(404).json({ error: 'Anúncio não encontrado' });
    if (product.seller_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Sem permissão' });

    const { title, description, price, price_negotiable, condition, city, state, neighborhood, status } = req.body;
    await pool.query(
      `UPDATE products SET title=COALESCE($1,title), description=COALESCE($2,description),
        price=COALESCE($3,price), price_negotiable=COALESCE($4,price_negotiable),
        condition=COALESCE($5,condition), city=COALESCE($6,city),
        state=COALESCE($7,state), neighborhood=COALESCE($8,neighborhood),
        status=COALESCE($9,status), updated_at=NOW() WHERE id=$10`,
      [title||null, description||null, price?parseFloat(price):null,
        price_negotiable!=null?parseInt(price_negotiable):null,
        condition||null, city||null, state||null, neighborhood||null, status||null, req.params.id]
    );

    if (req.files?.length > 0) {
      const existing = parseInt((await pool.query('SELECT COUNT(*) AS c FROM product_images WHERE product_id=$1', [req.params.id])).rows[0].c);
      for (let i = 0; i < req.files.length; i++) {
        await pool.query('INSERT INTO product_images (product_id, url, sort_order) VALUES ($1,$2,$3)',
          [req.params.id, `/uploads/products/${req.files[i].filename}`, existing + i]);
      }
    }
    res.json({ message: 'Anúncio atualizado' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar' });
  }
});

// ─── Delete product ─────────────────────────────────────────────────────────
router.delete('/:id', authenticate, async (req, res) => {
  const product = (await pool.query('SELECT * FROM products WHERE id=$1', [req.params.id])).rows[0];
  if (!product) return res.status(404).json({ error: 'Não encontrado' });
  if (product.seller_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Sem permissão' });
  const images = (await pool.query('SELECT url FROM product_images WHERE product_id=$1', [req.params.id])).rows;
  images.forEach(img => {
    const filePath = path.join(__dirname, '..', img.url);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });
  await pool.query('DELETE FROM products WHERE id=$1', [req.params.id]);
  res.json({ message: 'Anúncio removido' });
});

// ─── Favorite ───────────────────────────────────────────────────────────────
router.post('/:id/favorite', authenticate, async (req, res) => {
  const existing = (await pool.query('SELECT 1 FROM favorites WHERE user_id=$1 AND product_id=$2', [req.user.id, req.params.id])).rows[0];
  if (existing) {
    await pool.query('DELETE FROM favorites WHERE user_id=$1 AND product_id=$2', [req.user.id, req.params.id]);
    res.json({ favorited: false });
  } else {
    await pool.query('INSERT INTO favorites (user_id, product_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user.id, req.params.id]);
    res.json({ favorited: true });
  }
});

// ─── Report ─────────────────────────────────────────────────────────────────
router.post('/:id/report', authenticate, sanitizeBody,
  [body('reason').notEmpty().withMessage('Motivo obrigatório')],
  validate,
  async (req, res) => {
    await pool.query('INSERT INTO reports (product_id, user_id, reason, details) VALUES ($1,$2,$3,$4)',
      [req.params.id, req.user.id, req.body.reason, req.body.details || null]);
    res.json({ message: 'Denúncia registrada. Obrigado!' });
  }
);

// ─── Seller's products ──────────────────────────────────────────────────────
router.get('/seller/:sellerId', optionalAuth, async (req, res) => {
  const products = (await pool.query(`
    SELECT p.*, c.name AS category_name, c.icon AS category_icon,
      (SELECT url FROM product_images WHERE product_id=p.id AND is_primary=1 LIMIT 1) AS primary_image,
      (SELECT COUNT(*) FROM favorites WHERE product_id=p.id) AS favorites_count
    FROM products p LEFT JOIN categories c ON p.category_id=c.id
    WHERE p.seller_id=$1 AND p.status='active'
    ORDER BY p.featured DESC, p.created_at DESC
  `, [req.params.sellerId])).rows;
  res.json(products);
});

module.exports = router;
