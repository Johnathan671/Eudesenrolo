// routes/messages.js
const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { body } = require('express-validator');
const { validate, sanitizeBody } = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { db } = require('../models/database');

// ─── List my conversations ──────────────────────────────────────────────────
router.get('/', authenticate, (req, res) => {
  const convs = db.prepare(`
    SELECT c.*,
      p.title AS product_title,
      (SELECT url FROM product_images WHERE product_id=p.id AND is_primary=1 LIMIT 1) AS product_image,
      buyer.name AS buyer_name, buyer.avatar AS buyer_avatar,
      seller.name AS seller_name, seller.avatar AS seller_avatar,
      (SELECT COUNT(*) FROM messages m WHERE m.conversation_id=c.id AND m.read=0 AND m.sender_id!=?) AS unread_count
    FROM conversations c
    JOIN products p ON c.product_id=p.id
    JOIN users buyer ON c.buyer_id=buyer.id
    JOIN users seller ON c.seller_id=seller.id
    WHERE c.buyer_id=? OR c.seller_id=?
    ORDER BY c.last_msg_at DESC
  `).all(req.user.id, req.user.id, req.user.id);
  res.json(convs);
});

// ─── Get or create conversation ─────────────────────────────────────────────
router.post('/start', authenticate, sanitizeBody,
  [body('product_id').notEmpty().withMessage('Produto obrigatório')],
  validate,
  (req, res) => {
    try {
      const { product_id, first_message } = req.body;
      const product = db.prepare('SELECT * FROM products WHERE id=? AND status="active"').get(product_id);
      if (!product) return res.status(404).json({ error: 'Produto não encontrado' });
      if (product.seller_id === req.user.id) return res.status(400).json({ error: 'Você não pode contatar a si mesmo' });

      let conv = db.prepare('SELECT * FROM conversations WHERE product_id=? AND buyer_id=?').get(product_id, req.user.id);
      if (!conv) {
        const id = uuidv4();
        db.prepare('INSERT INTO conversations (id, product_id, buyer_id, seller_id) VALUES (?,?,?,?)').run(id, product_id, req.user.id, product.seller_id);
        conv = db.prepare('SELECT * FROM conversations WHERE id=?').get(id);
      }

      // Send first message if provided
      if (first_message?.trim()) {
        const msgId = uuidv4();
        db.prepare('INSERT INTO messages (id, conversation_id, sender_id, content) VALUES (?,?,?,?)').run(msgId, conv.id, req.user.id, first_message.trim());
        db.prepare("UPDATE conversations SET last_msg=?, last_msg_at=datetime('now') WHERE id=?").run(first_message.trim().slice(0, 60), conv.id);
        // Notify seller
        db.prepare('INSERT INTO notifications (user_id, type, message, link) VALUES (?,?,?,?)').run(
          product.seller_id, 'message', `Nova mensagem de ${req.user.name} sobre "${product.title}"`, `/messages/${conv.id}`
        );
      }
      res.json(conv);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Erro ao iniciar conversa' });
    }
  }
);

// ─── Get messages in conversation ──────────────────────────────────────────
router.get('/:convId', authenticate, (req, res) => {
  const conv = db.prepare('SELECT * FROM conversations WHERE id=?').get(req.params.convId);
  if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });
  if (conv.buyer_id !== req.user.id && conv.seller_id !== req.user.id) {
    return res.status(403).json({ error: 'Sem permissão' });
  }
  const messages = db.prepare(`
    SELECT m.*, u.name AS sender_name, u.avatar AS sender_avatar
    FROM messages m JOIN users u ON m.sender_id=u.id
    WHERE m.conversation_id=?
    ORDER BY m.created_at ASC
  `).all(req.params.convId);

  // Mark as read
  db.prepare("UPDATE messages SET read=1 WHERE conversation_id=? AND sender_id!=?").run(req.params.convId, req.user.id);

  // Product info
  const product = db.prepare(`
    SELECT p.id, p.title, p.price, p.status,
      (SELECT url FROM product_images WHERE product_id=p.id AND is_primary=1 LIMIT 1) AS primary_image,
      buyer.name AS buyer_name, buyer.avatar AS buyer_avatar,
      seller.name AS seller_name, seller.avatar AS seller_avatar
    FROM conversations c JOIN products p ON c.product_id=p.id
    JOIN users buyer ON c.buyer_id=buyer.id JOIN users seller ON c.seller_id=seller.id
    WHERE c.id=?
  `).get(req.params.convId);

  res.json({ messages, product, conv });
});

// ─── Send message ────────────────────────────────────────────────────────────
router.post('/:convId/send', authenticate, sanitizeBody,
  [body('content').trim().isLength({ min: 1, max: 2000 }).withMessage('Mensagem inválida')],
  validate,
  (req, res) => {
    try {
      const conv = db.prepare('SELECT * FROM conversations WHERE id=?').get(req.params.convId);
      if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });
      if (conv.buyer_id !== req.user.id && conv.seller_id !== req.user.id) {
        return res.status(403).json({ error: 'Sem permissão' });
      }
      const msgId = uuidv4();
      db.prepare('INSERT INTO messages (id, conversation_id, sender_id, content) VALUES (?,?,?,?)').run(msgId, conv.id, req.user.id, req.body.content);
      db.prepare("UPDATE conversations SET last_msg=?, last_msg_at=datetime('now') WHERE id=?").run(req.body.content.slice(0, 60), conv.id);

      const otherId = conv.buyer_id === req.user.id ? conv.seller_id : conv.buyer_id;
      db.prepare('INSERT INTO notifications (user_id, type, message, link) VALUES (?,?,?,?)').run(
        otherId, 'message', `Nova mensagem de ${req.user.name}`, `/messages.html#${conv.id}`
      );

      const msg = db.prepare(`SELECT m.*, u.name AS sender_name, u.avatar AS sender_avatar FROM messages m JOIN users u ON m.sender_id=u.id WHERE m.id=?`).get(msgId);
      res.status(201).json(msg);
    } catch (err) {
      res.status(500).json({ error: 'Erro ao enviar mensagem' });
    }
  }
);

// ─── Unread count ────────────────────────────────────────────────────────────
router.get('/unread/count', authenticate, (req, res) => {
  const { count } = db.prepare(`
    SELECT COUNT(*) AS count FROM messages m
    JOIN conversations c ON m.conversation_id=c.id
    WHERE (c.buyer_id=? OR c.seller_id=?) AND m.sender_id!=? AND m.read=0
  `).get(req.user.id, req.user.id, req.user.id);
  res.json({ count });
});

module.exports = router;
