'use strict';

const express  = require('express');
const passport = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const { getRow, addRow, updateRow, getAllRows } = require('../db');

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
      // Omit hd so the Google picker shows all accounts, including personal
      // ones that may belong to whitelisted staff members.
    },
    function verify(accessToken, refreshToken, profile, done) {
      // Enforce Google Workspace domain restriction.
      if (ALLOWED_DOMAINS.length > 0) {
        const hostedDomain = ((profile._json && profile._json.hd) || '').toLowerCase();
        if (!ALLOWED_DOMAINS.includes(hostedDomain)) {
          // Check if the email belongs to a staff member (staff Email field
          // supports comma-separated values).
          const userEmail = ((profile.emails && profile.emails[0] && profile.emails[0].value) || '').toLowerCase();
          const staffRows = getAllRows('STAFF');
          const staffEmails = new Set();
          for (const s of staffRows) {
            if (s.Email) {
              for (const e of s.Email.split(',')) {
                staffEmails.add(e.trim().toLowerCase());
              }
            }
          }
          if (!userEmail || !staffEmails.has(userEmail)) {
            return done(null, false, {
              message: `Access restricted to @${ALLOWED_DOMAINS.join(', @')} accounts.`,
            });
          }
        }
      }

      // Google only returns a refreshToken on the initial consent.
      // Persist it so subsequent logins (which skip consent) can reuse it.
      const settingsKey = `google_refresh_token:${profile.id}`;
      let effectiveRefreshToken = refreshToken || '';
      if (effectiveRefreshToken) {
        // Save new refresh token
        console.log(`[auth] New refresh token received for ${profile.displayName} — saving`);
        const existing = getRow('SETTINGS', settingsKey);
        if (existing) {
          updateRow('SETTINGS', settingsKey, { Value: effectiveRefreshToken, UpdatedAt: new Date().toISOString() });
        } else {
          addRow('SETTINGS', { ID: settingsKey, Key: settingsKey, Value: effectiveRefreshToken, UpdatedAt: new Date().toISOString() });
        }
      } else {
        console.log(`[auth] No new refresh token for ${profile.displayName} — using stored token`);
        // Load previously saved refresh token
        const saved = getRow('SETTINGS', settingsKey);
        if (saved && saved.Value) effectiveRefreshToken = saved.Value;
      }

      // Store only the fields we actually need in the session.
      const user = {
        id:           profile.id,
        name:         profile.displayName,
        email:        (profile.emails && profile.emails[0] && profile.emails[0].value) || '',
        photo:        (profile.photos && profile.photos[0] && profile.photos[0].value) || '',
        accessToken:  accessToken  || '',
        refreshToken: effectiveRefreshToken,
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
// Use ?prompt=consent to force re-consent (e.g. after adding new scopes).
router.get('/google', requireOAuthConfig, (req, res, next) => {
  const forceConsent = req.query.prompt === 'consent';
  passport.authenticate('google', {
    scope: ['profile', 'email', 'https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.readonly'],
    accessType: 'offline',
    prompt: forceConsent ? 'consent' : 'select_account',
    approvalPrompt: forceConsent ? 'force' : undefined,
  })(req, res, next);
});

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
