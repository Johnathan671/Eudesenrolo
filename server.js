// server.js — CellMart v2
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const path = require('path');
const { initDB } = require('./models/database');

const app = express();

// ─── Init DB ────────────────────────────────────────────────────────────────
initDB();

// ─── Security ───────────────────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false, // Handled by frontend
}));

app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true,
  methods: ['GET','POST','PUT','DELETE','PATCH','OPTIONS'],
}));

// Rate limiting
app.use('/api/auth/login',    rateLimit({ windowMs: 60*60*1000, max: 20, message: { error: 'Muitas tentativas. Aguarde 1 hora.' } }));
app.use('/api/auth/register', rateLimit({ windowMs: 60*60*1000, max: 10, message: { error: 'Limite de cadastros atingido.' } }));
app.use('/api/',              rateLimit({ windowMs: 15*60*1000, max: 300, message: { error: 'Muitas requisições.' } }));

// ─── Body Parsing ───────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Logging ────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'production') app.use(morgan('dev'));

// ─── Static Uploads ─────────────────────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ─── Routes ─────────────────────────────────────────────────────────────────
app.use('/api/auth',     require('./routes/auth'));
app.use('/api/products', require('./routes/products'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/admin',    require('./routes/admin'));
app.use('/api',          require('./routes/misc'));

// ─── Health ─────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', version: '2.0.0' }));

// ─── Frontend ────────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ─── 404 ────────────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Rota não encontrada' }));

// ─── Error Handler ──────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Arquivo muito grande (max 5MB)' });
  res.status(500).json({ error: 'Erro interno do servidor' });
});

// ─── Start ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🚀 CellMart API rodando em http://localhost:${PORT}`);
  console.log(`📦 Ambiente: ${process.env.NODE_ENV || 'development'}`);
  console.log(`\n👉 Para criar admin e categorias: npm run seed\n`);
});

module.exports = app;
