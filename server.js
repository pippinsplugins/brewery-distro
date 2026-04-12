'use strict';

const express        = require('express');
const path           = require('path');
const session        = require('express-session');
const passport       = require('passport');
const helmet         = require('helmet');
const rateLimit      = require('express-rate-limit');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// ── Startup guards ───────────────────────────────────────────────────────
if (!process.env.SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET environment variable is not set. Exiting.');
  process.exit(1);
}

// Auth routes configure the passport strategies as a side-effect of requiring.
const authRoutes = require('./routes/auth');
const requireAuth = require('./middleware/requireAuth');

const { getDb, initializeDatabase, migrateInventoryToProducts, migrateProductFormatsToInventory } = require('./db');
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
const notificationsRoutes  = require('./routes/notifications');
const qboRoutes            = require('./routes/qbo');
const reportsRoutes        = require('./routes/reports');
const gallonageRoutes      = require('./routes/gallonage');
const salesExportRoutes    = require('./routes/sales-export');
const forecastRoutes       = require('./routes/forecast');
const creditsRoutes        = require('./routes/credits');
const apiWebhooksRoutes    = require('./routes/api-webhooks');
const inboundEmailRoutes   = require('./routes/inbound-emails');
const inboundEmailService  = require('./inbound-email-service');

const app  = express();
const PORT = process.env.PORT || 3000;
const BASE_PATH = process.env.BASE_PATH || ''; // e.g. '/trb' for sub-path deployments

// Trust first proxy (DigitalOcean App Platform, Heroku, etc.)
// Required so Express correctly sees HTTPS behind a load-balancer,
// which in turn makes secure cookies and OAuth callback URLs work.
app.set('trust proxy', 1);

// ── Security headers ─────────────────────────────────────────────────────
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:    ["'self'"],
      scriptSrc:     ["'self'", "'unsafe-inline'", "https://unpkg.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc:      ["'self'", "'unsafe-inline'", "https://unpkg.com"],
      imgSrc:        ["'self'", "data:", "https:"],
      connectSrc:    ["'self'", "https://unpkg.com", "https://nominatim.openstreetmap.org", "https://appcenter.intuit.com"],
    },
  },
}));

// ── Rate limiting ────────────────────────────────────────────────────────
app.use('/auth',      rateLimit({ windowMs: 60_000, max: 10,  standardHeaders: true, legacyHeaders: false }));
app.use('/api/email', rateLimit({ windowMs: 60_000, max: 20,  standardHeaders: true, legacyHeaders: false }));
app.use('/api',      rateLimit({ windowMs: 60_000, max: 100, standardHeaders: true, legacyHeaders: false }));

// ── Body parsing ──────────────────────────────────────────────────────────
// Capture raw body for QBO webhook signature verification (must precede global json parser)
app.use('/webhooks/qbo', express.json({
  verify: (req, res, buf) => { req.rawBody = buf; }
}));
app.use(express.json());

// ── Session ───────────────────────────────────────────────────────────────
const SqliteStore = require('better-sqlite3-session-store')(session);

app.use(session({
  store: new SqliteStore({
    client: getDb(),
    expired: { clear: true, intervalMs: 15 * 60 * 1000 }, // Clean up expired sessions every 15 min
  }),
  secret:            process.env.SESSION_SECRET,
  name:              BASE_PATH ? `sid.${BASE_PATH.slice(1)}` : 'connect.sid',
  resave:            false,
  saveUninitialized: false,
  rolling:           true, // Reset expiry on every request so active users stay logged in
  cookie: {
    httpOnly: true,
    // Set secure:true when behind HTTPS in production.
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
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
app.use('/auth/qbo', qboRoutes.authRouter);

// Serve public pages (no auth required).
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'privacy.html'));
});
app.get('/terms', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'terms.html'));
});

// ── CSRF protection ──────────────────────────────────────────────────────
// Require X-Requested-With header on state-changing API requests.
// Browsers block cross-origin requests from setting custom headers,
// so this prevents CSRF even if SameSite cookies are bypassed.
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  // API key auth is exempt (not session-based, not vulnerable to CSRF).
  // Check for API key header directly since requireAuth hasn't run yet.
  const authHeader = req.headers['authorization'] || '';
  const hasApiKey = authHeader.startsWith('Bearer ') || !!req.headers['x-api-key'];
  if (hasApiKey) return next();
  if (req.headers['x-requested-with'] !== 'XMLHttpRequest') {
    return res.status(403).json({ error: 'Forbidden — missing CSRF header' });
  }
  next();
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
app.use('/api/notifications',  requireAuth, notificationsRoutes);
app.use('/api/qbo',            requireAuth, qboRoutes.apiRouter);
app.use('/api/reports',        requireAuth, reportsRoutes);
app.use('/api/gallonage',      requireAuth, gallonageRoutes);
app.use('/api/sales-export',  requireAuth, salesExportRoutes);
app.use('/api/forecast',      requireAuth, forecastRoutes);
app.use('/api/credits',        requireAuth, creditsRoutes);
app.use('/api/webhooks',       requireAuth, apiWebhooksRoutes);
app.use('/api/inbound-emails', requireAuth, inboundEmailRoutes);

// Status endpoint (public – used by the frontend before auth).
app.get('/api/status', (req, res) => {
  res.json({
    configured: true,
    dataSource: 'sqlite',
    basePath: BASE_PATH,
  });
});

// Webhook routes (protected by their own bearer-token auth, not session auth).
app.use('/webhooks', webhooksRoutes);

// ── Public home page ────────────────────────────────────────────────────────
// Google app verification requires the home page to be accessible without login.
// Authenticated users get the SPA; guests see the landing/login page.
app.get('/', (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// ── SPA catch-all (requires auth) ─────────────────────────────────────────
app.get('*', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Server startup ─────────────────────────────────────────────────────────
async function start() {
  try {
    console.log('Initializing database...');
    await initializeDatabase();
    await migrateInventoryToProducts();
    await migrateProductFormatsToInventory();
    console.log('Database initialized successfully.');
    // Fix email orders with missing Location
    try { inboundEmailService.fixEmailOrderLocations(); } catch (e) { console.warn('[inbound-email] fixEmailOrderLocations:', e.message); }
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
