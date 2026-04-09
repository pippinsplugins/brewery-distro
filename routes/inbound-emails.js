'use strict';

const express = require('express');
const { getAllRows, getRow, updateRow, deleteRow } = require('../db');
const inboundService = require('../inbound-email-service');

const router = express.Router();

// GET /api/inbound-emails — list emails (optional ?status= filter)
router.get('/', (req, res) => {
  try {
    let emails = getAllRows('INBOUND_EMAILS');
    if (req.query.status) {
      emails = emails.filter(e => e.Status === req.query.status);
    }
    // Sort newest first
    emails.sort((a, b) => (b.ReceivedAt || b.CreatedAt || '').localeCompare(a.ReceivedAt || a.CreatedAt || ''));
    // Don't send full body in list view
    res.json(emails.map(e => ({
      ...e,
      Body: e.Body ? e.Body.substring(0, 200) + (e.Body.length > 200 ? '...' : '') : '',
    })));
  } catch (err) {
    console.error('[inbound-emails]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/inbound-emails/polling/status — polling status
router.get('/polling/status', (req, res) => {
  try {
    res.json({
      enabled: inboundService.getSetting('inboundEmailEnabled') === 'true',
      interval: parseInt(inboundService.getSetting('inboundEmailInterval')) || 300,
      lastPoll: inboundService.getSetting('inboundEmailLastPoll') || '',
      lastError: inboundService.getSetting('inboundEmailLastError') || '',
      isRunning: inboundService.isRunning(),
      targetAddress: inboundService.getSetting('inboundEmail') || '',
    });
  } catch (err) {
    console.error('[inbound-emails]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/inbound-emails/:id — single email detail
router.get('/:id', (req, res) => {
  try {
    const email = getRow('INBOUND_EMAILS', req.params.id);
    if (!email) return res.status(404).json({ error: 'Email not found' });
    res.json(email);
  } catch (err) {
    console.error('[inbound-emails]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/inbound-emails/poll-now — trigger immediate poll
// Uses the logged-in user's OAuth tokens (most up-to-date scopes).
router.post('/poll-now', async (req, res) => {
  try {
    const userTokens = req.user ? { accessToken: req.user.accessToken, refreshToken: req.user.refreshToken } : null;
    const result = await inboundService.pollOnce(userTokens);
    res.json(result);
  } catch (err) {
    console.error('[inbound-emails] poll-now error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/inbound-emails/polling/start — start polling
router.post('/polling/start', (req, res) => {
  try {
    inboundService.startPolling();
    res.json({ success: true, isRunning: inboundService.isRunning() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/inbound-emails/polling/stop — stop polling
router.post('/polling/stop', (req, res) => {
  try {
    inboundService.stopPolling();
    res.json({ success: true, isRunning: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/inbound-emails/:id/retry — re-parse a failed/pending email
router.post('/:id/retry', async (req, res) => {
  try {
    const email = getRow('INBOUND_EMAILS', req.params.id);
    if (!email) return res.status(404).json({ error: 'Email not found' });

    const accounts = getAllRows('ACCOUNTS');
    const products = getAllRows('PRODUCTS');
    const inventoryRows = getAllRows('INVENTORY');
    const productList = products.map(p => {
      const formats = inventoryRows
        .filter(i => i.ProductID === p.ID && i.Format)
        .map(i => i.Format);
      return { Name: p.Name, formats: [...new Set(formats)] };
    });

    const parsed = await inboundService.parseEmailWithGemini(email.Body, email.Subject, accounts, productList);
    updateRow('INBOUND_EMAILS', email.ID, {
      Status: 'parsed',
      ParsedData: JSON.stringify(parsed),
      Error: '',
    });

    res.json({ ...getRow('INBOUND_EMAILS', email.ID), parsedData: parsed });
  } catch (err) {
    console.error('[inbound-emails] retry error:', err.message);
    updateRow('INBOUND_EMAILS', req.params.id, { Status: 'error', Error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// POST /api/inbound-emails/:id/create-order — manually create draft from parsed data
router.post('/:id/create-order', async (req, res) => {
  try {
    const email = getRow('INBOUND_EMAILS', req.params.id);
    if (!email) return res.status(404).json({ error: 'Email not found' });
    if (email.OrderID) return res.status(400).json({ error: 'Order already created for this email' });

    let parsed;
    try {
      parsed = JSON.parse(email.ParsedData);
    } catch {
      return res.status(400).json({ error: 'Email has no parsed data. Retry parsing first.' });
    }

    const result = await inboundService.createDraftOrder(parsed, email.ID);
    res.json(result);
  } catch (err) {
    console.error('[inbound-emails] create-order error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/inbound-emails/:id/skip — mark as skipped
router.put('/:id/skip', (req, res) => {
  try {
    const email = getRow('INBOUND_EMAILS', req.params.id);
    if (!email) return res.status(404).json({ error: 'Email not found' });
    updateRow('INBOUND_EMAILS', email.ID, { Status: 'skipped' });
    res.json(getRow('INBOUND_EMAILS', email.ID));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/inbound-emails/:id
router.delete('/:id', (req, res) => {
  try {
    deleteRow('INBOUND_EMAILS', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
