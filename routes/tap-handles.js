'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getAllRows, getRow, addRow, updateRow, deleteRow } = require('../db');
const { processMentions } = require('../lib/notifications');

const router = express.Router();

// GET /api/tap-handles — returns tap handle records, optionally filtered by accountId
router.get('/', async (req, res) => {
  try {
    const rows = await getAllRows('TAP_HANDLES');
    if (req.query.accountId) {
      return res.json(rows.filter(r => r.AccountID === req.query.accountId));
    }
    res.json(rows);
  } catch (err) {
    console.error(`[tap-handles] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/tap-handles/summary — per-account outstanding tap handle counts
router.get('/summary', async (req, res) => {
  try {
    const rows = await getAllRows('TAP_HANDLES');
    const summary = {};
    for (const r of rows) {
      const qty = parseInt(r.Quantity) || 0;
      const collected = parseInt(r.CollectedQuantity) || 0;
      const outstanding = qty - collected;
      if (outstanding <= 0) continue;
      if (!summary[r.AccountID]) {
        summary[r.AccountID] = { accountId: r.AccountID, accountName: r.AccountName, outstanding: 0 };
      }
      summary[r.AccountID].outstanding += outstanding;
    }
    res.json(Object.values(summary));
  } catch (err) {
    console.error(`[tap-handles] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/tap-handles — create a tap handle record
router.post('/', async (req, res) => {
  try {
    const { accountId, accountName, quantity, deployedDate, notes } = req.body;
    if (!accountId || !quantity) return res.status(400).json({ error: 'accountId and quantity are required' });

    const record = {
      ID: uuidv4(),
      AccountID: accountId,
      AccountName: accountName || '',
      Quantity: String(quantity),
      DeployedDate: deployedDate || new Date().toISOString().split('T')[0],
      CollectedDate: '',
      CollectedQuantity: '0',
      Notes: notes || '',
      CreatedAt: new Date().toISOString(),
    };
    await addRow('TAP_HANDLES', record);
    processMentions({ newText: record.Notes, oldText: '', entityType: 'tap-handle', entityName: record.AccountName, entityId: record.ID, accountId: record.AccountID, user: req.user, mentionerName: req.user.name, baseUrl: req.protocol + '://' + req.get('host') }).catch(err => console.error('[notifications]', err));
    res.json(record);
  } catch (err) {
    console.error(`[tap-handles] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/tap-handles/:id — update a tap handle record (mark collected)
router.put('/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const existing = getRow('TAP_HANDLES', id);
    const oldNotes = existing?.Notes || '';
    const updates = {};
    const allowed = ['CollectedDate', 'CollectedQuantity', 'Notes'];
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    const updated = await updateRow('TAP_HANDLES', id, updates);
    processMentions({ newText: updated.Notes, oldText: oldNotes, entityType: 'tap-handle', entityName: updated.AccountName, entityId: updated.ID, accountId: updated.AccountID, user: req.user, mentionerName: req.user.name, baseUrl: req.protocol + '://' + req.get('host') }).catch(err => console.error('[notifications]', err));
    res.json(updated);
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 500;
    console.error(`[tap-handles] ${err.message}`);
    res.status(status).json({ error: status === 404 ? 'Not found' : 'Internal server error' });
  }
});

// DELETE /api/tap-handles/:id — delete a tap handle record
router.delete('/:id', async (req, res) => {
  try {
    await deleteRow('TAP_HANDLES', req.params.id);
    res.json({ success: true });
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 500;
    console.error(`[tap-handles] ${err.message}`);
    res.status(status).json({ error: status === 404 ? 'Not found' : 'Internal server error' });
  }
});

module.exports = router;
