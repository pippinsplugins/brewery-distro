'use strict';

const express        = require('express');
const path           = require('path');
const session        = require('express-session');
const passport       = require('passport');
require('dotenv').config();

// Auth routes configure the passport strategies as a side-effect of requiring.
const authRoutes = require('./routes/auth');
const requireAuth = require('./middleware/requireAuth');

const { initializeSheets, migrateInventoryToProducts } = require('./sheets');
const productsRoutes  = require('./routes/products');
const inventoryRoutes = require('./routes/inventory');
const accountsRoutes  = require('./routes/accounts');
const outreachRoutes  = require('./routes/outreach');
const remindersRoutes = require('./routes/reminders');
const staffRoutes     = require('./routes/staff');
const ordersRoutes         = require('./routes/orders');
const dashboardRoutes      = require('./routes/dashboard');
const webhooksRoutes       = require('./routes/webhooks');
const stockMovementsRoutes = require('./routes/stock-movements');
const settingsRoutes       = require('./routes/settings');
const kegTrackingRoutes    = require('./routes/keg-tracking');
const tapHandlesRoutes     = require('./routes/tap-handles');
const emailRoutes          = require('./routes/email');
const orderItemsRoutes     = require('./routes/order-items');

const app  = express();
const PORT = process.env.PORT || 3000;

// Trust first proxy (DigitalOcean App Platform, Heroku, etc.)
// Required so Express correctly sees HTTPS behind a load-balancer,
// which in turn makes secure cookies and OAuth callback URLs work.
app.set('trust proxy', 1);

// ── Body parsing ──────────────────────────────────────────────────────────
app.use(express.json());

// ── Session ───────────────────────────────────────────────────────────────
app.use(session({
  secret:            process.env.SESSION_SECRET || 'change-me-in-production',
  resave:            false,
  saveUninitialized: false,
  rolling:           true, // Reset expiry on every request so active users stay logged in
  cookie: {
    httpOnly: true,
    // Set secure:true when behind HTTPS in production.
    secure:   process.env.NODE_ENV === 'production',
    maxAge:   24 * 60 * 60 * 1000, // 24 hours
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
app.use('/api/products',  requireAuth, productsRoutes);
app.use('/api/inventory', requireAuth, inventoryRoutes);
app.use('/api/accounts',  requireAuth, accountsRoutes);
app.use('/api/outreach',  requireAuth, outreachRoutes);
app.use('/api/reminders', requireAuth, remindersRoutes);
app.use('/api/staff',     requireAuth, staffRoutes);
app.use('/api/orders',          requireAuth, ordersRoutes);
app.use('/api/stock-movements', requireAuth, stockMovementsRoutes);
app.use('/api/dashboard',       requireAuth, dashboardRoutes);
app.use('/api/settings',        requireAuth, settingsRoutes);
app.use('/api/keg-tracking',    requireAuth, kegTrackingRoutes);
app.use('/api/tap-handles',     requireAuth, tapHandlesRoutes);
app.use('/api/email',           requireAuth, emailRoutes);
app.use('/api/order-items',     requireAuth, orderItemsRoutes);

// Status endpoint (public – used by the frontend before auth).
app.get('/api/status', (req, res) => {
  res.json({
    configured: true,
    dataSource: 'sqlite',
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
    console.log('Initializing database...');
    await initializeSheets();
    await migrateInventoryToProducts();
    console.log('Database initialized successfully.');
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
