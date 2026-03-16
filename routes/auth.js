'use strict';

const express  = require('express');
const passport = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');

const router = express.Router();

// ── Passport configuration ─────────────────────────────────────────────────

const ALLOWED_DOMAINS = (process.env.GOOGLE_ALLOWED_DOMAIN || '')
  .split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
const oauthConfigured = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

if (oauthConfigured) {
  passport.use(new GoogleStrategy(
    {
      clientID:     process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL:  process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback',
      // hd restricts the Google sign-in picker to the workspace domain.
      // Only works with a single domain; when multiple are configured we
      // omit it and rely on server-side verification below.
      hd: ALLOWED_DOMAINS.length === 1 ? ALLOWED_DOMAINS[0] : undefined,
    },
    function verify(accessToken, refreshToken, profile, done) {
      // Enforce Google Workspace domain restriction.
      if (ALLOWED_DOMAINS.length > 0) {
        const hostedDomain = ((profile._json && profile._json.hd) || '').toLowerCase();
        if (!ALLOWED_DOMAINS.includes(hostedDomain)) {
          return done(null, false, {
            message: `Access restricted to @${ALLOWED_DOMAINS.join(', @')} accounts.`,
          });
        }
      }

      // Store only the fields we actually need in the session.
      const user = {
        id:           profile.id,
        name:         profile.displayName,
        email:        (profile.emails && profile.emails[0] && profile.emails[0].value) || '',
        photo:        (profile.photos && profile.photos[0] && profile.photos[0].value) || '',
        accessToken:  accessToken  || '',
        refreshToken: refreshToken || '',
      };

      return done(null, user);
    },
  ));
} else {
  console.warn('[auth] GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set – OAuth login is disabled.');
}

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// Helper – used by OAuth routes to reject when not configured.
function requireOAuthConfig(req, res, next) {
  if (!oauthConfigured) {
    return res.status(503).send(
      'Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your .env file.',
    );
  }
  next();
}

// ── Auth routes ───────────────────────────────────────────────────────────

const basePath = process.env.BASE_PATH || '';

// Kick off OAuth flow – sends the user to Google.
router.get('/google', requireOAuthConfig, passport.authenticate('google', {
  scope: ['profile', 'email', 'https://www.googleapis.com/auth/gmail.send'],
  accessType: 'offline',
  prompt: 'select_account',
}));

// Google redirects here after the user grants (or denies) access.
router.get('/google/callback',
  requireOAuthConfig,
  passport.authenticate('google', {
    failureRedirect: basePath + '/login?error=access_denied',
    failWithError: false,
  }),
  (req, res) => {
    // Successful authentication – go to the app.
    res.redirect(basePath + '/');
  },
);

// Returns the currently authenticated user (or 401).
// Only expose safe profile fields — never return OAuth tokens.
router.get('/me', (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated()) {
    const { id, name, email, photo } = req.user;
    return res.json({ user: { id, name, email, photo } });
  }
  res.status(401).json({ user: null });
});

// Clear the session and log out.
router.post('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy(() => {
      res.redirect(basePath + '/login');
    });
  });
});

module.exports = router;
