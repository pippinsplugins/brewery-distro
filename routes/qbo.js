'use strict';

const express     = require('express');
const OAuthClient = require('intuit-oauth');
const { isQboConfigured, getOAuthClient, getStoredTokens, storeTokens, clearTokens, syncOrderToQbo, QBO_APP_URL } = require('../qbo-service');

const authRouter = express.Router();
const apiRouter  = express.Router();

// ── OAuth flow (public, mounted at /auth/qbo) ───────────────────

// GET /auth/qbo — redirect to Intuit OAuth
authRouter.get('/', (req, res) => {
  if (!isQboConfigured()) {
    return res.status(503).json({ error: 'QuickBooks is not configured' });
  }

  const redirectUri = process.env.QBO_REDIRECT_URI
    || `${req.protocol}://${req.get('host')}/auth/qbo/callback`;

  const oauthClient = getOAuthClient(redirectUri);
  const authUri = oauthClient.authorizeUri({
    scope:    [OAuthClient.scopes.Accounting],
    state:    'qbo-connect',
  });
  res.redirect(authUri);
});

// GET /auth/qbo/callback — exchange code for tokens
authRouter.get('/callback', async (req, res) => {
  try {
    const redirectUri = process.env.QBO_REDIRECT_URI
      || `${req.protocol}://${req.get('host')}/auth/qbo/callback`;

    const oauthClient = getOAuthClient(redirectUri);
    const authResponse = await oauthClient.createToken(req.url);
    const tokenData = authResponse.getJson();

    await storeTokens({
      accessToken:  tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      realmId:      req.query.realmId,
      expiresAt:    Date.now() + (tokenData.expires_in || 3600) * 1000,
    });

    res.redirect('/#settings');
  } catch (err) {
    console.error('[qbo] OAuth callback error:', err.message);
    res.redirect('/#settings?qboError=auth_failed');
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

// POST /api/qbo/sync/:orderId — manual retry
apiRouter.post('/sync/:orderId', async (req, res) => {
  try {
    await syncOrderToQbo(req.params.orderId);
    const { getRow } = require('../db');
    const order = getRow('ORDERS', req.params.orderId);
    res.json(order || { error: 'Order not found' });
  } catch (err) {
    console.error('[qbo]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = { authRouter, apiRouter };
