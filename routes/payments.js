// routes/payments.js
const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { body } = require('express-validator');
const { validate, sanitizeBody } = require('../middleware/validate');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { pool } = require('../models/database');

const TAXA_SITE = 0.05; // 5% para o site
const REPASSE_VENDEDOR = 0.95; // 95% para o vendedor

// ─── Comprador: iniciar pagamento (gera ordem) ──────────────────────────────
router.post('/order', authenticate, sanitizeBody,
  [body('product_id').notEmpty().withMessage('Produto obrigatório')],
  validate,
  async (req, res) => {
    try {
      const { product_id } = req.body;

      const product = (await pool.query(
        `SELECT p.*, u.name AS seller_name, u.pix_key AS seller_pix
         FROM products p JOIN users u ON p.seller_id = u.id
         WHERE p.id = $1 AND p.status = 'active'`, [product_id]
      )).rows[0];

      if (!product) return res.status(404).json({ error: 'Produto não encontrado ou indisponível' });
      if (product.seller_id === req.user.id) return res.status(400).json({ error: 'Você não pode comprar seu próprio produto' });

      // Verifica se já tem ordem pendente
      const existing = (await pool.query(
        `SELECT id FROM orders WHERE product_id = $1 AND buyer_id = $2 AND status = 'pending'`,
        [product_id, req.user.id]
      )).rows[0];
      if (existing) return res.json({ order_id: existing.id, already_exists: true });

      const valor_total = parseFloat(product.price);
      const taxa_site = parseFloat((valor_total * TAXA_SITE).toFixed(2));
      const repasse_vendedor = parseFloat((valor_total * REPASSE_VENDEDOR).toFixed(2));

      const id = uuidv4();
      await pool.query(
        `INSERT INTO orders (id, product_id, buyer_id, seller_id, valor_total, taxa_site, repasse_vendedor, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')`,
        [id, product_id, req.user.id, product.seller_id, valor_total, taxa_site, repasse_vendedor]
      );

      res.status(201).json({
        order_id: id,
        product_title: product.title,
        valor_total,
        taxa_site,
        repasse_vendedor,
        pix_key: process.env.ADM_PIX_KEY || 'eudesenrolo@pix.com',
        pix_name: process.env.ADM_PIX_NAME || 'Eudesenrolo',
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Erro ao criar pedido' });
    }
  }
);

// ─── Comprador: confirmar que fez o pix ────────────────────────────────────
router.post('/order/:id/confirm', authenticate, sanitizeBody,
  [body('comprovante').optional().isLength({ max: 500 })],
  validate,
  async (req, res) => {
    try {
      const order = (await pool.query('SELECT * FROM orders WHERE id = $1', [req.params.id])).rows[0];
      if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });
      if (order.buyer_id !== req.user.id) return res.status(403).json({ error: 'Sem permissão' });
      if (order.status !== 'pending') return res.status(400).json({ error: 'Pedido já processado' });

      await pool.query(
        `UPDATE orders SET status = 'awaiting_confirmation', comprovante = $1, updated_at = NOW() WHERE id = $2`,
        [req.body.comprovante || null, req.params.id]
      );

      // Notifica o admin
      const admins = (await pool.query(`SELECT id FROM users WHERE role = 'admin'`)).rows;
      for (const adm of admins) {
        await pool.query(
          `INSERT INTO notifications (user_id, type, message, link) VALUES ($1, 'info', $2, $3)`,
          [adm.id, `💰 Novo pagamento aguardando confirmação — Pedido #${req.params.id.slice(0,8)}`, `/pages/admin.html#payments`]
        );
      }

      res.json({ message: 'Pagamento enviado para confirmação!' });
    } catch (err) {
      res.status(500).json({ error: 'Erro ao confirmar pagamento' });
    }
  }
);

// ─── Comprador: ver meus pedidos ───────────────────────────────────────────
router.get('/my-orders', authenticate, async (req, res) => {
  const orders = (await pool.query(
    `SELECT o.*, p.title AS product_title, p.price AS product_price,
      (SELECT url FROM product_images WHERE product_id = p.id AND is_primary = 1 LIMIT 1) AS product_image,
      u.name AS seller_name
     FROM orders o
     JOIN products p ON o.product_id = p.id
     JOIN users u ON o.seller_id = u.id
     WHERE o.buyer_id = $1
     ORDER BY o.created_at DESC`,
    [req.user.id]
  )).rows;
  res.json(orders);
});

// ─── Vendedor: ver minhas vendas ───────────────────────────────────────────
router.get('/my-sales', authenticate, async (req, res) => {
  const sales = (await pool.query(
    `SELECT o.*, p.title AS product_title,
      (SELECT url FROM product_images WHERE product_id = p.id AND is_primary = 1 LIMIT 1) AS product_image,
      u.name AS buyer_name
     FROM orders o
     JOIN products p ON o.product_id = p.id
     JOIN users u ON o.buyer_id = u.id
     WHERE o.seller_id = $1
     ORDER BY o.created_at DESC`,
    [req.user.id]
  )).rows;
  res.json(sales);
});

// ─── ADMIN: listar todos os pedidos ───────────────────────────────────────
router.get('/admin/orders', authenticate, requireAdmin, async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  let where = '1=1';
  const params = [];
  let idx = 1;
  if (status) { where += ` AND o.status = $${idx}`; params.push(status); idx++; }

  const orders = (await pool.query(
    `SELECT o.*,
      p.title AS product_title,
      buyer.name AS buyer_name, buyer.email AS buyer_email,
      seller.name AS seller_name, seller.email AS seller_email, seller.pix_key AS seller_pix
     FROM orders o
     JOIN products p ON o.product_id = p.id
     JOIN users buyer ON o.buyer_id = buyer.id
     JOIN users seller ON o.seller_id = seller.id
     WHERE ${where}
     ORDER BY o.created_at DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, parseInt(limit), offset]
  )).rows;

  const total = parseInt((await pool.query(
    `SELECT COUNT(*) AS c FROM orders o WHERE ${where}`, params
  )).rows[0].c);

  const stats = (await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'pending') AS pendentes,
      COUNT(*) FILTER (WHERE status = 'awaiting_confirmation') AS aguardando,
      COUNT(*) FILTER (WHERE status = 'paid') AS pagos,
      COUNT(*) FILTER (WHERE status = 'repassed') AS repassados,
      COALESCE(SUM(taxa_site) FILTER (WHERE status IN ('paid','repassed')), 0) AS total_taxa,
      COALESCE(SUM(repasse_vendedor) FILTER (WHERE status = 'repassed'), 0) AS total_repassado,
      COALESCE(SUM(repasse_vendedor) FILTER (WHERE status = 'paid'), 0) AS a_repassar
    FROM orders
  `)).rows[0];

  res.json({ orders, total, stats });
});

// ─── ADMIN: confirmar pagamento recebido ───────────────────────────────────
router.put('/admin/orders/:id/confirm-payment', authenticate, requireAdmin, async (req, res) => {
  try {
    const order = (await pool.query('SELECT * FROM orders WHERE id = $1', [req.params.id])).rows[0];
    if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });
    if (!['awaiting_confirmation', 'pending'].includes(order.status)) {
      return res.status(400).json({ error: 'Pedido não pode ser confirmado neste status' });
    }

    await pool.query(
      `UPDATE orders SET status = 'paid', paid_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [req.params.id]
    );

    // Marca produto como vendido
    await pool.query(`UPDATE products SET status = 'sold' WHERE id = $1`, [order.product_id]);

    // Notifica comprador
    await pool.query(
      `INSERT INTO notifications (user_id, type, message, link) VALUES ($1, 'success', $2, $3)`,
      [order.buyer_id, `✅ Seu pagamento foi confirmado! Pedido #${req.params.id.slice(0,8)}`, `/pages/my-orders.html`]
    );

    // Notifica vendedor
    await pool.query(
      `INSERT INTO notifications (user_id, type, message, link) VALUES ($1, 'success', $2, $3)`,
      [order.seller_id, `🎉 Venda confirmada! Você receberá R$ ${order.repasse_vendedor} em breve. Pedido #${req.params.id.slice(0,8)}`, `/pages/my-sales.html`]
    );

    res.json({ message: 'Pagamento confirmado!' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao confirmar pagamento' });
  }
});

// ─── ADMIN: marcar repasse feito ao vendedor ───────────────────────────────
router.put('/admin/orders/:id/repasse', authenticate, requireAdmin, sanitizeBody, async (req, res) => {
  try {
    const order = (await pool.query('SELECT * FROM orders WHERE id = $1', [req.params.id])).rows[0];
    if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });
    if (order.status !== 'paid') return res.status(400).json({ error: 'Pagamento ainda não confirmado' });

    await pool.query(
      `UPDATE orders SET status = 'repassed', repassed_at = NOW(), repasse_info = $1, updated_at = NOW() WHERE id = $2`,
      [req.body.info || null, req.params.id]
    );

    // Notifica vendedor
    await pool.query(
      `INSERT INTO notifications (user_id, type, message, link) VALUES ($1, 'success', $2, $3)`,
      [order.seller_id, `💸 R$ ${order.repasse_vendedor} repassado para sua conta! Pedido #${req.params.id.slice(0,8)}`, `/pages/my-sales.html`]
    );

    res.json({ message: 'Repasse registrado!' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao registrar repasse' });
  }
});

// ─── ADMIN: rejeitar pagamento ─────────────────────────────────────────────
router.put('/admin/orders/:id/reject', authenticate, requireAdmin, sanitizeBody, async (req, res) => {
  try {
    const order = (await pool.query('SELECT * FROM orders WHERE id = $1', [req.params.id])).rows[0];
    if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });

    await pool.query(
      `UPDATE orders SET status = 'rejected', updated_at = NOW() WHERE id = $1`, [req.params.id]
    );

    await pool.query(
      `INSERT INTO notifications (user_id, type, message, link) VALUES ($1, 'warning', $2, $3)`,
      [order.buyer_id, `❌ Pagamento não confirmado. Entre em contato. Pedido #${req.params.id.slice(0,8)}`, `/pages/my-orders.html`]
    );

    res.json({ message: 'Pedido rejeitado' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao rejeitar pedido' });
  }
});

// ─── Vendedor: salvar chave PIX ────────────────────────────────────────────
router.put('/pix-key', authenticate, sanitizeBody,
  [body('pix_key').notEmpty().withMessage('Chave PIX obrigatória')],
  validate,
  async (req, res) => {
    await pool.query(`UPDATE users SET pix_key = $1 WHERE id = $2`, [req.body.pix_key, req.user.id]);
    res.json({ message: 'Chave PIX salva!' });
  }
);

module.exports = router;
