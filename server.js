'use strict';

const express        = require('express');
const path           = require('path');
const session        = require('express-session');
const passport       = require('passport');
require('dotenv').config();

// Auth routes configure the passport strategies as a side-effect of requiring.
const authRoutes = require('./routes/auth');
const requireAuth = require('./middleware/requireAuth');

const { initializeSheets } = require('./sheets');
const inventoryRoutes = require('./routes/inventory');
const accountsRoutes  = require('./routes/accounts');
const outreachRoutes  = require('./routes/outreach');
const remindersRoutes = require('./routes/reminders');
const staffRoutes     = require('./routes/staff');
const ordersRoutes    = require('./routes/orders');
const dashboardRoutes = require('./routes/dashboard');
const webhooksRoutes  = require('./routes/webhooks');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Body parsing ──────────────────────────────────────────────────────────
app.use(express.json());

// ── Session ───────────────────────────────────────────────────────────────
app.use(session({
  secret:            process.env.SESSION_SECRET || 'change-me-in-production',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    // Set secure:true when behind HTTPS in production.
    secure:   process.env.NODE_ENV === 'production',
    maxAge:   8 * 60 * 60 * 1000, // 8 hours
  },
}));

// ── Passport ──────────────────────────────────────────────────────────────
app.use(passport.initialize());
app.use(passport.session());

// ── Public static files (login page lives here) ───────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── Auth routes (public – no authentication required) ─────────────────────
app.use('/auth', authRoutes);

// Serve the login page directly.
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// ── Protected API routes ──────────────────────────────────────────────────
app.use('/api/inventory', requireAuth, inventoryRoutes);
app.use('/api/accounts',  requireAuth, accountsRoutes);
app.use('/api/outreach',  requireAuth, outreachRoutes);
app.use('/api/reminders', requireAuth, remindersRoutes);
app.use('/api/staff',     requireAuth, staffRoutes);
app.use('/api/orders',    requireAuth, ordersRoutes);
app.use('/api/dashboard', requireAuth, dashboardRoutes);

// Status endpoint (public – used by the frontend before auth).
app.get('/api/status', (req, res) => {
  res.json({
    configured:    !!(process.env.SPREADSHEET_ID && (process.env.GOOGLE_KEY_FILE || process.env.GOOGLE_SERVICE_ACCOUNT_KEY)),
    spreadsheetId: process.env.SPREADSHEET_ID || null,
  });
});

// Webhook routes (protected by their own bearer-token auth, not session auth).
app.use('/webhooks', webhooksRoutes);

// ── SPA catch-all (requires auth) ─────────────────────────────────────────
app.get('*', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Server startup ─────────────────────────────────────────────────────────
async function start() {
  try {
    console.log('Connecting to Google Sheets...');
    await initializeSheets();
    console.log('Google Sheets initialized successfully.');
    app.listen(PORT, () => {
      console.log(`Brewery Distribution app running at http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Startup error:', err.message);
    console.error('Starting server anyway — check /api/status for configuration help.');
    app.listen(PORT, () => {
      console.log(`Server running (degraded) at http://localhost:${PORT}`);
    });
  }
}

start();
