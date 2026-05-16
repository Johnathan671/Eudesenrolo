// routes/messages.js
const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { body } = require('express-validator');
const { validate, sanitizeBody } = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { pool } = require('../models/database');

router.get('/', authenticate, async (req, res) => {
  const convs = (await pool.query(`
    SELECT c.*,
      p.title AS product_title,
      (SELECT url FROM product_images WHERE product_id=p.id AND is_primary=1 LIMIT 1) AS product_image,
      buyer.name AS buyer_name, buyer.avatar AS buyer_avatar,
      seller.name AS seller_name, seller.avatar AS seller_avatar,
      (SELECT COUNT(*) FROM messages m WHERE m.conversation_id=c.id AND m.read=0 AND m.sender_id!=$1) AS unread_count
    FROM conversations c
    JOIN products p ON c.product_id=p.id
    JOIN users buyer ON c.buyer_id=buyer.id
    JOIN users seller ON c.seller_id=seller.id
    WHERE c.buyer_id=$2 OR c.seller_id=$3
    ORDER BY c.last_msg_at DESC
  `, [req.user.id, req.user.id, req.user.id])).rows;
  res.json(convs);
});

router.post('/start', authenticate, sanitizeBody,
  [body('product_id').notEmpty().withMessage('Produto obrigatório')],
  validate,
  async (req, res) => {
    try {
      const { product_id, first_message } = req.body;
      const product = (await pool.query(`SELECT * FROM products WHERE id=$1 AND status='active'`, [product_id])).rows[0];
      if (!product) return res.status(404).json({ error: 'Produto não encontrado' });
      if (product.seller_id === req.user.id) return res.status(400).json({ error: 'Você não pode contatar a si mesmo' });

      let conv = (await pool.query('SELECT * FROM conversations WHERE product_id=$1 AND buyer_id=$2', [product_id, req.user.id])).rows[0];
      if (!conv) {
        const id = uuidv4();
        await pool.query('INSERT INTO conversations (id, product_id, buyer_id, seller_id) VALUES ($1,$2,$3,$4)', [id, product_id, req.user.id, product.seller_id]);
        conv = (await pool.query('SELECT * FROM conversations WHERE id=$1', [id])).rows[0];
      }

      if (first_message?.trim()) {
        const msgId = uuidv4();
        await pool.query('INSERT INTO messages (id, conversation_id, sender_id, content) VALUES ($1,$2,$3,$4)', [msgId, conv.id, req.user.id, first_message.trim()]);
        await pool.query("UPDATE conversations SET last_msg=$1, last_msg_at=NOW() WHERE id=$2", [first_message.trim().slice(0, 60), conv.id]);
        await pool.query('INSERT INTO notifications (user_id, type, message, link) VALUES ($1,$2,$3,$4)',
          [product.seller_id, 'message', `Nova mensagem de ${req.user.name} sobre "${product.title}"`, `/messages/${conv.id}`]);
      }
      res.json(conv);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Erro ao iniciar conversa' });
    }
  }
);

router.get('/unread/count', authenticate, async (req, res) => {
  const result = await pool.query(`
    SELECT COUNT(*) AS count FROM messages m
    JOIN conversations c ON m.conversation_id=c.id
    WHERE (c.buyer_id=$1 OR c.seller_id=$2) AND m.sender_id!=$3 AND m.read=0
  `, [req.user.id, req.user.id, req.user.id]);
  res.json({ count: parseInt(result.rows[0].count) });
});

router.get('/:convId', authenticate, async (req, res) => {
  const conv = (await pool.query('SELECT * FROM conversations WHERE id=$1', [req.params.convId])).rows[0];
  if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });
  if (conv.buyer_id !== req.user.id && conv.seller_id !== req.user.id) return res.status(403).json({ error: 'Sem permissão' });

  const messages = (await pool.query(`
    SELECT m.*, u.name AS sender_name, u.avatar AS sender_avatar
    FROM messages m JOIN users u ON m.sender_id=u.id
    WHERE m.conversation_id=$1 ORDER BY m.created_at ASC
  `, [req.params.convId])).rows;

  await pool.query("UPDATE messages SET read=1 WHERE conversation_id=$1 AND sender_id!=$2", [req.params.convId, req.user.id]);

  const product = (await pool.query(`
    SELECT p.id, p.title, p.price, p.status,
      (SELECT url FROM product_images WHERE product_id=p.id AND is_primary=1 LIMIT 1) AS primary_image,
      buyer.name AS buyer_name, buyer.avatar AS buyer_avatar,
      seller.name AS seller_name, seller.avatar AS seller_avatar
    FROM conversations c JOIN products p ON c.product_id=p.id
    JOIN users buyer ON c.buyer_id=buyer.id JOIN users seller ON c.seller_id=seller.id
    WHERE c.id=$1
  `, [req.params.convId])).rows[0];

  res.json({ messages, product, conv });
});

router.post('/:convId/send', authenticate, sanitizeBody,
  [body('content').trim().isLength({ min: 1, max: 2000 }).withMessage('Mensagem inválida')],
  validate,
  async (req, res) => {
    try {
      const conv = (await pool.query('SELECT * FROM conversations WHERE id=$1', [req.params.convId])).rows[0];
      if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });
      if (conv.buyer_id !== req.user.id && conv.seller_id !== req.user.id) return res.status(403).json({ error: 'Sem permissão' });

      const msgId = uuidv4();
      await pool.query('INSERT INTO messages (id, conversation_id, sender_id, content) VALUES ($1,$2,$3,$4)', [msgId, conv.id, req.user.id, req.body.content]);
      await pool.query("UPDATE conversations SET last_msg=$1, last_msg_at=NOW() WHERE id=$2", [req.body.content.slice(0, 60), conv.id]);

      const otherId = conv.buyer_id === req.user.id ? conv.seller_id : conv.buyer_id;
      await pool.query('INSERT INTO notifications (user_id, type, message, link) VALUES ($1,$2,$3,$4)',
        [otherId, 'message', `Nova mensagem de ${req.user.name}`, `/messages.html#${conv.id}`]);

      const msg = (await pool.query(`
        SELECT m.*, u.name AS sender_name, u.avatar AS sender_avatar
        FROM messages m JOIN users u ON m.sender_id=u.id WHERE m.id=$1
      `, [msgId])).rows[0];
      res.status(201).json(msg);
    } catch (err) {
      res.status(500).json({ error: 'Erro ao enviar mensagem' });
    }
  }
);

module.exports = router;
