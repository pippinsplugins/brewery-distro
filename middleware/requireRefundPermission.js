'use strict';

const { getAllRows } = require('../db');

// Refund mutations are restricted to staff with Role='Account Manager'
// (see issue #462 — refunds move real money and reverse tax liability,
// so we gate them behind an explicit role check rather than treating
// them as a default authenticated action). API-key requests are blocked
// unconditionally since refunds are a human-initiated flow.
const ALLOWED_ROLES = new Set(['Account Manager']);

function requireRefundPermission(req, res, next) {
  if (req.apiKeyAuth) {
    return res.status(403).json({ error: 'Refunds cannot be issued via API key' });
  }
  const email = (req.user && req.user.email || '').toLowerCase();
  if (!email) return res.status(403).json({ error: 'Refund permission denied' });

  try {
    // STAFF.Email is a comma-separated list of addresses (matches the
    // /auth/me lookup pattern in routes/auth.js). Exact-match against the
    // whole field would deny anyone with more than one address on file.
    const staff = getAllRows('STAFF');
    const record = staff.find(s =>
      (s.Email || '').split(',').map(e => e.trim().toLowerCase()).includes(email)
    );
    if (record && ALLOWED_ROLES.has(record.Role) && record.Active !== 'false') {
      return next();
    }
  } catch (err) {
    console.error(`[refund-permission] ${err.message}`);
    return res.status(500).json({ error: 'Internal server error' });
  }
  return res.status(403).json({ error: 'Refunds are limited to Account Managers' });
}

module.exports = requireRefundPermission;
