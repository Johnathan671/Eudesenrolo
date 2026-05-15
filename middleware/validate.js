// middleware/validate.js
const { validationResult } = require('express-validator');
const xss = require('xss');

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array().map(e => e.msg) });
  }
  next();
}

function sanitizeBody(req, res, next) {
  const sanitize = (obj) => {
    if (!obj) return obj;
    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === 'string') {
        obj[key] = xss(obj[key].trim());
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        sanitize(obj[key]);
      }
    }
  };
  sanitize(req.body);
  sanitize(req.query);
  next();
}

module.exports = { validate, sanitizeBody };
