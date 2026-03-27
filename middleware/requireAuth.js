'use strict';

const crypto = require('crypto');
const { getAllRows } = require('../db');

/**
 * Middleware that requires an authenticated session or valid API key.
 * Returns 401 JSON for API requests and redirects to /login for browser requests.
 */
function requireAuth(req, res, next) {
  // 1. Session auth (unchanged)
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }

  // 2. API key auth — check Authorization: Bearer <key> or X-API-Key header
  const authHeader = req.headers['authorization'] || '';
  const bearerKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const apiKey = bearerKey || (req.headers['x-api-key'] || '').trim();

  if (apiKey) {
    const hash = crypto.createHash('sha256').update(apiKey).digest('hex');

    try {
      const rows = getAllRows('SETTINGS');
      const row = rows.find(r => r.Key === 'apiKeys');
      if (row) {
        const keys = JSON.parse(row.Value || '[]');
        const match = keys.find(k => k.hash === hash);
        if (match) {
          req.apiKeyAuth = true;
          req.apiKeyName = match.name;
          return next();
        }
      }
    } catch (e) {
      // Fall through to 401
    }
  }

  // API requests get a JSON 401 so the frontend can handle it gracefully.
  if (req.originalUrl.startsWith('/api/')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Browser requests redirect to the login page.
  const basePath = process.env.BASE_PATH || '';
  res.redirect(basePath + '/login');
}

module.exports = requireAuth;
