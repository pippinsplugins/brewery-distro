'use strict';

const express  = require('express');
const passport = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');

const router = express.Router();

// ── Passport configuration ─────────────────────────────────────────────────

const ALLOWED_DOMAIN = process.env.GOOGLE_ALLOWED_DOMAIN || '';

passport.use(new GoogleStrategy(
  {
    clientID:     process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL:  process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback',
    // hd restricts the Google sign-in picker to the workspace domain,
    // but we also verify it server-side in the verify callback below.
    hd: ALLOWED_DOMAIN || undefined,
  },
  function verify(accessToken, refreshToken, profile, done) {
    // Enforce Google Workspace domain restriction.
    if (ALLOWED_DOMAIN) {
      const hostedDomain = profile._json && profile._json.hd;
      if (hostedDomain !== ALLOWED_DOMAIN) {
        return done(null, false, {
          message: `Access restricted to @${ALLOWED_DOMAIN} accounts.`,
        });
      }
    }

    // Store only the fields we actually need in the session.
    const user = {
      id:     profile.id,
      name:   profile.displayName,
      email:  (profile.emails && profile.emails[0] && profile.emails[0].value) || '',
      photo:  (profile.photos && profile.photos[0] && profile.photos[0].value) || '',
    };

    return done(null, user);
  },
));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// ── Auth routes ───────────────────────────────────────────────────────────

// Kick off OAuth flow – sends the user to Google.
router.get('/google', passport.authenticate('google', {
  scope: ['profile', 'email'],
  prompt: 'select_account',
}));

// Google redirects here after the user grants (or denies) access.
router.get('/google/callback',
  passport.authenticate('google', {
    failureRedirect: '/login?error=access_denied',
    failWithError: false,
  }),
  (req, res) => {
    // Successful authentication – go to the app.
    res.redirect('/');
  },
);

// Returns the currently authenticated user (or 401).
router.get('/me', (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return res.json({ user: req.user });
  }
  res.status(401).json({ user: null });
});

// Clear the session and log out.
router.post('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy(() => {
      res.redirect('/login');
    });
  });
});

module.exports = router;
