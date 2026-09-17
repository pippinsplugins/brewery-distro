'use strict';

// Refunds — per-order financial refund records with per-line detail.
// This PR (see #462) ships read-only endpoints so the schema can migrate
// safely and the UI can begin surfacing existing refunds; the create/void
// endpoints follow in a later slice once the frontend modal + QBO sync
// paths are ready.
//
// Refunds are always accessed in the context of an order or an account,
// so GET requires one of those two query params — a bare listing would
// be expensive and has no known caller.

const express = require('express');
const { getAllRows, getRow } = require('../db');

const router = express.Router();

// GET /api/refunds?orderId=<id>|accountId=<id>
// Returns the refund rows (without items) for a specific order or account.
router.get('/', async (req, res) => {
  try {
    const { orderId, accountId } = req.query;
    if (!orderId && !accountId) {
      return res.status(400).json({ error: 'orderId or accountId is required' });
    }
    let rows = await getAllRows('REFUNDS');
    if (orderId)   rows = rows.filter(r => r.OrderID   === orderId);
    if (accountId) rows = rows.filter(r => r.AccountID === accountId);
    rows.sort((a, b) => (b.RefundDate || b.CreatedAt || '').localeCompare(a.RefundDate || a.CreatedAt || ''));
    res.json(rows);
  } catch (err) {
    console.error(`[refunds] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/refunds/:id — single refund with its line items.
router.get('/:id', async (req, res) => {
  try {
    const refund = await getRow('REFUNDS', req.params.id);
    if (!refund) return res.status(404).json({ error: 'Refund not found' });
    const allItems = await getAllRows('REFUND_ITEMS');
    const items = allItems.filter(i => i.RefundID === req.params.id);
    res.json({ ...refund, items });
  } catch (err) {
    console.error(`[refunds] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
