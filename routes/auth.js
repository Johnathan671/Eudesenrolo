// routes/auth.js
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { body } = require('express-validator');
const { validate, sanitizeBody } = require('../middleware/validate');
const { pool } = require('../models/database');
const { authenticate } = require('../middleware/auth');

router.post('/register', sanitizeBody,
  [
    body('name').trim().isLength({ min: 2, max: 80 }).withMessage('Nome deve ter 2–80 caracteres'),
    body('email').isEmail().normalizeEmail().withMessage('E-mail inválido'),
    body('password').isLength({ min: 6 }).withMessage('Senha deve ter pelo menos 6 caracteres'),
    body('phone').optional().isMobilePhone('pt-BR').withMessage('Telefone inválido'),
  ],
  validate,
  async (req, res) => {
    try {
      const { name, email, password, phone, city, state } = req.body;
      const exists = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
      if (exists.rows.length) return res.status(409).json({ error: 'E-mail já cadastrado' });
      const hash = await bcrypt.hash(password, 12);
      const id = uuidv4();
      await pool.query(
        'INSERT INTO users (id, name, email, password, phone, city, state) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [id, name, email, hash, phone||null, city||null, state||null]
      );
      const token = jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });
      const user = (await pool.query('SELECT id, name, email, role, avatar, verified FROM users WHERE id = $1', [id])).rows[0];
      res.status(201).json({ token, user });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Erro ao criar conta' });
    }
  }
);

router.post('/login', sanitizeBody,
  [
    body('email').isEmail().normalizeEmail().withMessage('E-mail inválido'),
    body('password').notEmpty().withMessage('Senha obrigatória'),
  ],
  validate,
  async (req, res) => {
    try {
      const { email, password } = req.body;
      const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
      const user = result.rows[0];
      if (!user) return res.status(401).json({ error: 'Credenciais inválidas' });
      if (user.banned) return res.status(403).json({ error: 'Conta suspensa: ' + (user.banned_reason || 'violação dos termos') });
      const ok = await bcrypt.compare(password, user.password);
      if (!ok) return res.status(401).json({ error: 'Credenciais inválidas' });
      const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });
      const { password: _, ...safe } = user;
      res.json({ token, user: safe });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Erro ao fazer login' });
    }
  }
);

router.get('/me', authenticate, async (req, res) => {
  const result = await pool.query(
    'SELECT id, name, email, role, avatar, phone, city, state, bio, verified, premium, reputation, total_reviews, total_sales, created_at FROM users WHERE id = $1',
    [req.user.id]
  );
  res.json(result.rows[0]);
});

router.put('/profile', authenticate, sanitizeBody,
  [
    body('name').optional().trim().isLength({ min: 2, max: 80 }),
    body('phone').optional({ nullable: true }),
    body('bio').optional().isLength({ max: 500 }),
  ],
  validate,
  async (req, res) => {
    try {
      const { name, phone, city, state, bio } = req.body;
      await pool.query(
        `UPDATE users SET name=COALESCE($1,name), phone=COALESCE($2,phone),
          city=COALESCE($3,city), state=COALESCE($4,state), bio=COALESCE($5,bio),
          updated_at=NOW() WHERE id=$6`,
        [name||null, phone||null, city||null, state||null, bio||null, req.user.id]
      );
      const user = (await pool.query(
        'SELECT id, name, email, role, avatar, phone, city, state, bio, verified, premium FROM users WHERE id = $1',
        [req.user.id]
      )).rows[0];
      res.json(user);
    } catch (err) {
      res.status(500).json({ error: 'Erro ao atualizar perfil' });
    }
  }
);

router.put('/password', authenticate,
  [
    body('currentPassword').notEmpty().withMessage('Senha atual obrigatória'),
    body('newPassword').isLength({ min: 6 }).withMessage('Nova senha: mínimo 6 caracteres'),
  ],
  validate,
  async (req, res) => {
    try {
      const result = await pool.query('SELECT password FROM users WHERE id = $1', [req.user.id]);
      const ok = await bcrypt.compare(req.body.currentPassword, result.rows[0].password);
      if (!ok) return res.status(400).json({ error: 'Senha atual incorreta' });
      const hash = await bcrypt.hash(req.body.newPassword, 12);
      await pool.query('UPDATE users SET password=$1, updated_at=NOW() WHERE id=$2', [hash, req.user.id]);
      res.json({ message: 'Senha alterada com sucesso' });
    } catch {
      res.status(500).json({ error: 'Erro ao alterar senha' });
    }
  }
);

module.exports = router;
