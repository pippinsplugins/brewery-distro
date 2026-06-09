'use strict';

const crypto      = require('crypto');
const express     = require('express');
const OAuthClient = require('intuit-oauth');
const { isQboConfigured, getOAuthClient, getStoredTokens, storeTokens, clearTokens, syncOrderToQbo, resyncOrderToQbo, fetchTaxCodes, clearTaxInfoCache, createPayment, getCustomerPaymentSummary, refreshOrderInvoicePdf, QBO_APP_URL } = require('../qbo-service');

const authRouter = express.Router();
const apiRouter  = express.Router();

// Build the OAuth redirect URI Intuit will call back. Honors the env override
// when set, otherwise derives it from the incoming request + BASE_PATH so
// sub-path deployments (e.g. /trb) get the right public-facing URL. Both the
// authorize and token-exchange steps must produce IDENTICAL strings or Intuit
// rejects with "redirect_uri does not match".
function computeRedirectUri(req) {
  if (process.env.QBO_REDIRECT_URI) return process.env.QBO_REDIRECT_URI;
  const basePath = process.env.BASE_PATH || '';
  return `${req.protocol}://${req.get('host')}${basePath}/auth/qbo/callback`;
}

// ── OAuth flow (public, mounted at /auth/qbo) ───────────────────

// GET /auth/qbo — redirect to Intuit OAuth
authRouter.get('/', (req, res) => {
  if (!isQboConfigured()) {
    return res.status(503).json({ error: 'QuickBooks is not configured' });
  }

  const redirectUri = computeRedirectUri(req);
  console.log(`[qbo] OAuth start — redirect_uri=${redirectUri}`);

  // Generate a random nonce to prevent CSRF on the OAuth callback
  const state = crypto.randomBytes(16).toString('hex');
  req.session.qboOAuthState = state;

  const oauthClient = getOAuthClient(redirectUri);
  const authUri = oauthClient.authorizeUri({
    scope:    [OAuthClient.scopes.Accounting],
    state,
  });
  res.redirect(authUri);
});

// GET /auth/qbo/callback — exchange code for tokens
authRouter.get('/callback', async (req, res) => {
  try {
    const basePath = process.env.BASE_PATH || '';

    // Verify the OAuth state nonce to prevent CSRF
    if (!req.session.qboOAuthState || req.query.state !== req.session.qboOAuthState) {
      console.error('[qbo] OAuth state mismatch — possible CSRF attempt');
      return res.redirect(basePath + '/#settings?qboError=invalid_state');
    }
    delete req.session.qboOAuthState;

    const redirectUri = computeRedirectUri(req);

    const oauthClient = getOAuthClient(redirectUri);
    const authResponse = await oauthClient.createToken(req.url);
    const tokenData = authResponse.getJson();

    await storeTokens({
      accessToken:  tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      realmId:      req.query.realmId,
      expiresAt:    Date.now() + (tokenData.expires_in || 3600) * 1000,
    });

    res.redirect(basePath + '/#settings');
  } catch (err) {
    console.error('[qbo] OAuth callback error:', err.message);
    const basePath = process.env.BASE_PATH || '';
    res.redirect(basePath + '/#settings?qboError=auth_failed');
  }
});

// ── API routes (protected, mounted at /api/qbo) ─────────────────

// GET /api/qbo/status
apiRouter.get('/status', async (req, res) => {
  try {
    const configured = isQboConfigured();
    const tokens = configured ? await getStoredTokens() : null;
    const connected = !!(tokens && tokens.accessToken && tokens.realmId);
    res.json({
      configured,
      connected,
      realmId: connected ? tokens.realmId : null,
      appUrl:  connected ? QBO_APP_URL : null,
      redirectUri: computeRedirectUri(req),
    });
  } catch (err) {
    console.error('[qbo]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/qbo/disconnect
apiRouter.post('/disconnect', async (req, res) => {
  try {
    await clearTokens();
    res.json({ success: true });
  } catch (err) {
    console.error('[qbo]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/qbo/tax-codes — list available tax codes from QBO
apiRouter.get('/tax-codes', async (req, res) => {
  try {
    const codes = await fetchTaxCodes();
    res.json(codes);
  } catch (err) {
    console.error('[qbo]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/qbo/tax-code — save selected tax code ID
apiRouter.post('/tax-code', async (req, res) => {
  try {
    const { taxCodeId } = req.body;
    const { v4: uuidv4 } = require('uuid');
    const { getAllRows, addRow, updateRow } = require('../db');
    const rows = await getAllRows('SETTINGS');
    const existing = rows.find(r => r.Key === 'qboTaxCodeId');
    const now = new Date().toISOString().split('T')[0];
    if (existing) {
      await updateRow('SETTINGS', existing.ID, { Value: taxCodeId || '', UpdatedAt: now });
    } else {
      await addRow('SETTINGS', { ID: uuidv4(), Key: 'qboTaxCodeId', Value: taxCodeId || '', UpdatedAt: now });
    }
    clearTaxInfoCache();
    res.json({ success: true });
  } catch (err) {
    console.error('[qbo]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/qbo/invoice-pdf/:orderId — serve saved invoice PDF.
// If the local cache is missing for any reason (InvoicePdf not set, or the
// file was deleted/never persisted), re-download from QBO and try once more
// before giving up. Requires the order to have a QboInvoiceId.
apiRouter.get('/invoice-pdf/:orderId', async (req, res) => {
  try {
    const { getRow } = require('../db');
    const path = require('path');
    const fs = require('fs');
    let order = getRow('ORDERS', req.params.orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    const invoicesDir = path.resolve(path.join(__dirname, '..', 'data', 'invoices'));

    // Resolve a path candidate that's guarded against traversal. Returns
    // null when InvoicePdf is unset or the resolved path escapes the dir.
    const candidatePath = () => {
      if (!order.InvoicePdf) return null;
      const p = path.resolve(path.join(invoicesDir, order.InvoicePdf));
      if (!p.startsWith(invoicesDir + path.sep)) return null;
      return p;
    };

    let pdfPath = candidatePath();
    if (!pdfPath || !fs.existsSync(pdfPath)) {
      // Cache miss — refetch from QBO if we have an invoice id to refetch with.
      if (!order.QboInvoiceId) {
        return res.status(404).json({ error: 'Invoice PDF not found' });
      }
      try {
        await refreshOrderInvoicePdf(req.params.orderId, order.QboInvoiceId);
      } catch (err) {
        console.error('[qbo] PDF refetch failed:', err.message);
      }
      order = getRow('ORDERS', req.params.orderId);
      pdfPath = candidatePath();
      if (!pdfPath || !fs.existsSync(pdfPath)) {
        return res.status(404).json({ error: 'Invoice PDF unavailable' });
      }
    }
    res.sendFile(pdfPath, { headers: { 'Content-Type': 'application/pdf' } });
  } catch (err) {
    console.error('[qbo]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/qbo/payment/:orderId — create QBO payment for a paid order
apiRouter.post('/payment/:orderId', async (req, res) => {
  try {
    if (!isQboConfigured()) return res.status(503).json({ error: 'QuickBooks is not configured' });
    const tokens = await getStoredTokens();
    if (!tokens || !tokens.accessToken) return res.status(503).json({ error: 'QuickBooks is not connected' });

    const { getRow, updateRow } = require('../db');
    const order = getRow('ORDERS', req.params.orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (!order.QboInvoiceId) return res.status(400).json({ error: 'Order has no QBO invoice' });
    if (order.QboPaymentId) return res.status(400).json({ error: 'Payment already synced to QBO' });

    const account = getRow('ACCOUNTS', order.AccountID);
    if (!account) return res.status(400).json({ error: 'Account not found' });

    const payment = await createPayment(order, account);
    const qboPaymentId = String(payment.Id);
    await updateRow('ORDERS', req.params.orderId, { QboPaymentId: qboPaymentId });
    console.log(`[qbo] Payment created for order ${req.params.orderId} → QBO Payment ${qboPaymentId}`);
    res.json({ success: true, QboPaymentId: qboPaymentId });
  } catch (err) {
    console.error('[qbo] Payment creation failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/qbo/sync/:orderId — manual retry
apiRouter.post('/sync/:orderId', async (req, res) => {
  try {
    await syncOrderToQbo(req.params.orderId);
    const { getRow } = require('../db');
    const order = getRow('ORDERS', req.params.orderId);
    if (!order) return res.json({ error: 'Order not found' });
    if (order.QboSyncStatus !== 'synced' && !order.QboSyncError) {
      order.QboSyncError = 'QBO sync failed — check Settings for connection issues';
    }
    res.json(order);
  } catch (err) {
    console.error('[qbo]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/qbo/resync/:orderId — push edits to an existing invoice + re-send.
// Called by the order-edit client when line items, amounts, or recipients
// change on an already-synced, unpaid order. Skips paid/cancelled orders.
apiRouter.post('/resync/:orderId', async (req, res) => {
  try {
    const result = await resyncOrderToQbo(req.params.orderId);
    const { getRow } = require('../db');
    const order = getRow('ORDERS', req.params.orderId);
    res.json({ ...result, order });
  } catch (err) {
    console.error('[qbo]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/qbo/customer/:accountId/payment-summary — heuristic look at the
// customer's recent QBO payments to surface "last paid by Card", etc. on
// the account profile and order modal. Returns { available: false } when
// QBO isn't connected or the account isn't synced — UI hides itself.
apiRouter.get('/customer/:accountId/payment-summary', async (req, res) => {
  try {
    if (!isQboConfigured()) return res.json({ available: false, reason: 'not-configured' });
    const tokens = await getStoredTokens();
    if (!tokens || !tokens.accessToken) return res.json({ available: false, reason: 'not-connected' });
    const { getRow } = require('../db');
    const account = getRow('ACCOUNTS', req.params.accountId);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    if (!account.QboCustomerId) return res.json({ available: false, reason: 'not-synced' });
    const summary = await getCustomerPaymentSummary(account.QboCustomerId);
    if (!summary) return res.json({ available: true, summary: null });
    res.json({ available: true, summary });
  } catch (err) {
    console.error('[qbo]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = { authRouter, apiRouter };
