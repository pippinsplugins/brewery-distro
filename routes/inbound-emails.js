'use strict';

const express = require('express');
const { getAllRows, getRow, updateRow, deleteRow } = require('../db');
const inboundService = require('../inbound-email-service');
const { matchAccount } = inboundService;

const router = express.Router();

/**
 * GET /api/inbound-emails
 * List inbound email records, newest first. Supports:
 *   - ?status= filter (pending|parsed|order_created|error|skipped)
 *   - ?page= and ?perPage= for pagination (default: page 1, 25 per page)
 *
 * Body text is truncated to 200 chars. Each item includes computed flags:
 *   - _accountMatched: whether the parsed account name matched an existing account
 *   - _orderMissing: true if the linked order was deleted after email processing
 *
 * @returns {{ items: Array, total: number, page: number, perPage: number }}
 */
router.get('/', (req, res) => {
  try {
    let emails = getAllRows('INBOUND_EMAILS');
    if (req.query.status) {
      emails = emails.filter(e => e.Status === req.query.status);
    }
    // Sort newest first
    emails.sort((a, b) => (b.ReceivedAt || b.CreatedAt || '').localeCompare(a.ReceivedAt || a.CreatedAt || ''));

    const total = emails.length;

    // Pagination — default to first 25
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const perPage = parseInt(req.query.perPage) || 25;
    if (perPage > 0) {
      const start = (page - 1) * perPage;
      emails = emails.slice(start, start + perPage);
    }

    // Load accounts once for all match checks
    const accounts = getAllRows('ACCOUNTS');

    const items = emails.map(e => {
      const row = {
        ...e,
        Body: e.Body ? e.Body.substring(0, 200) + (e.Body.length > 200 ? '...' : '') : '',
      };
      // Check if linked order actually exists
      if (e.Status === 'order_created' && e.OrderID) {
        const order = getRow('ORDERS', e.OrderID);
        if (!order) row._orderMissing = true;
      }
      if (e.ParsedData) {
        try {
          const parsed = JSON.parse(e.ParsedData);
          const senderEmail = e.From ? (e.From.match(/<([^>]+)>/) || [])[1] || e.From : '';
          const matched = matchAccount(parsed.accountName, accounts, senderEmail);
          row._accountMatched = !!matched;
        } catch { /* ignore */ }
      }
      return row;
    });

    res.json({ items, total, page, perPage });
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

    // Include account match and order existence info
    const result = { ...email };
    if (email.Status === 'order_created' && email.OrderID) {
      const order = getRow('ORDERS', email.OrderID);
      if (!order) result._orderMissing = true;
    }
    if (email.ParsedData) {
      try {
        const parsed = JSON.parse(email.ParsedData);
        const accounts = getAllRows('ACCOUNTS');
        const senderEmail = email.From ? (email.From.match(/<([^>]+)>/) || [])[1] || email.From : '';
        const matched = matchAccount(parsed.accountName, accounts, senderEmail);
        result._accountMatched = !!matched;
        result._accountMatchedName = matched ? matched.Name : '';
      } catch { /* ignore parse errors */ }
    }
    res.json(result);
  } catch (err) {
    console.error('[inbound-emails]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/inbound-emails/:id/retry
 * Re-parse a previously failed or errored email. Resets status to 'pending'
 * and runs the full processing pipeline again (Gemini parse + order creation).
 * Useful after fixing a Gemini API key or account mismatch.
 */
router.post('/:id/retry', async (req, res) => {
  try {
    const email = getRow('INBOUND_EMAILS', req.params.id);
    if (!email) return res.status(404).json({ error: 'Email not found' });

    // Reset status so processInboundEmail picks it up cleanly
    updateRow('INBOUND_EMAILS', email.ID, { Status: 'pending', Error: '', OrderID: '' });
    const freshEmail = getRow('INBOUND_EMAILS', email.ID);

    await inboundService.processInboundEmail(freshEmail);

    res.json(getRow('INBOUND_EMAILS', email.ID));
  } catch (err) {
    console.error('[inbound-emails] retry error:', err.message);
    updateRow('INBOUND_EMAILS', req.params.id, { Status: 'error', Error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/inbound-emails/:id/create-order
 * Manually create a Draft order from already-parsed email data.
 * Used when auto-creation failed (e.g. no account match) and the user
 * has since created the account and wants to create the order without
 * re-parsing.
 * Returns 400 if the email already has an OrderID or has no ParsedData.
 */
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

    // Extract sender email for account matching
    const senderEmail = email.From ? (email.From.match(/<([^>]+)>/) || [])[1] || email.From : '';
    const result = await inboundService.createDraftOrder(parsed, email.ID, senderEmail, email);
    res.json(result);
  } catch (err) {
    console.error('[inbound-emails] create-order error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/inbound-emails/:id/reset — reset to parsed (e.g. when linked order is missing)
router.put('/:id/reset', (req, res) => {
  try {
    const email = getRow('INBOUND_EMAILS', req.params.id);
    if (!email) return res.status(404).json({ error: 'Email not found' });
    updateRow('INBOUND_EMAILS', email.ID, { Status: 'parsed', OrderID: '' });
    res.json(getRow('INBOUND_EMAILS', email.ID));
  } catch (err) {
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
