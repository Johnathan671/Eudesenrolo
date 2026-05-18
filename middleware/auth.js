// middleware/auth.js — CellMart
const jwt = require('jsonwebtoken');
const { pool } = require('../models/database');

async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token não fornecido' });
  }
  const token = header.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const result = await pool.query(
      'SELECT id, name, email, role, avatar, verified, banned, banned_reason FROM users WHERE id = $1',
      [decoded.id]
    );
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Usuário não encontrado' });
    if (user.banned) return res.status(403).json({ error: 'Conta suspensa: ' + (user.banned_reason || 'violação dos termos') });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso restrito a administradores' });
  }
  next();
}

async function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  req.user = null;
  if (!header?.startsWith('Bearer ')) return next();
  try {
    const decoded = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
    const result = await pool.query(
      'SELECT id, name, email, role, avatar, verified FROM users WHERE id = $1',
      [decoded.id]
    );
    req.user = result.rows[0] || null;
  } catch { /* ignore */ }
  next();
}

module.exports = { authenticate, requireAdmin, optionalAuth };
