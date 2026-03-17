'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getAllRows, addRow, updateRow, deleteRow } = require('../db');

const router = express.Router();

// GET /api/credits — list credits, optionally filtered by accountId
router.get('/', async (req, res) => {
  try {
    const rows = await getAllRows('ACCOUNT_CREDITS');
    if (req.query.accountId) {
      return res.json(rows.filter(r => r.AccountID === req.query.accountId));
    }
    res.json(rows);
  } catch (err) {
    console.error(`[credits] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/credits/balance/:accountId — computed balance
router.get('/balance/:accountId', async (req, res) => {
  try {
    const rows = await getAllRows('ACCOUNT_CREDITS');
    const acctRows = rows.filter(r => r.AccountID === req.params.accountId);
    const balance = acctRows.reduce((sum, r) => {
      const amt = parseFloat(r.Amount) || 0;
      return r.Type === 'credit' ? sum + amt : sum - amt;
    }, 0);
    res.json({ balance: Math.max(0, parseFloat(balance.toFixed(2))) });
  } catch (err) {
    console.error(`[credits] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/credits — create a credit record
router.post('/', async (req, res) => {
  try {
    const { accountId, accountName, type, amount, orderId, reason, notes } = req.body;
    if (!accountId || !amount) return res.status(400).json({ error: 'accountId and amount are required' });
    if (!['credit', 'applied'].includes(type)) return res.status(400).json({ error: 'type must be "credit" or "applied"' });

    const record = {
      ID: uuidv4(),
      AccountID: accountId,
      AccountName: accountName || '',
      Type: type,
      Amount: String(parseFloat(amount).toFixed(2)),
      OrderID: orderId || '',
      Reason: reason || '',
      Notes: notes || '',
      CreatedAt: new Date().toISOString(),
    };
    await addRow('ACCOUNT_CREDITS', record);
    res.json(record);
  } catch (err) {
    console.error(`[credits] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/credits/:id — update amount/reason/notes (credit type only)
router.put('/:id', async (req, res) => {
  try {
    const updates = {};
    const allowed = ['Amount', 'Reason', 'Notes'];
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (updates.Amount) updates.Amount = String(parseFloat(updates.Amount).toFixed(2));
    const updated = await updateRow('ACCOUNT_CREDITS', req.params.id, updates);
    res.json(updated);
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 500;
    console.error(`[credits] ${err.message}`);
    res.status(status).json({ error: status === 404 ? 'Not found' : 'Internal server error' });
  }
});

// DELETE /api/credits/:id — delete a credit record
router.delete('/:id', async (req, res) => {
  try {
    await deleteRow('ACCOUNT_CREDITS', req.params.id);
    res.json({ success: true });
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 500;
    console.error(`[credits] ${err.message}`);
    res.status(status).json({ error: status === 404 ? 'Not found' : 'Internal server error' });
  }
});

module.exports = router;
