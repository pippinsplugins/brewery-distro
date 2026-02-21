'use strict';

/**
 * Middleware that requires an authenticated session.
 * Returns 401 JSON for API requests and redirects to /login for browser requests.
 */
function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }

  // API requests get a JSON 401 so the frontend can handle it gracefully.
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Browser requests redirect to the login page.
  res.redirect('/login');
}

module.exports = requireAuth;
