'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getAllRows, addRow, updateRow } = require('../sheets');

const router = express.Router();

// GET /api/keg-tracking — returns keg records, optionally filtered by accountId
router.get('/', async (req, res) => {
  try {
    const rows = await getAllRows('KEG_TRACKING');
    if (req.query.accountId) {
      return res.json(rows.filter(r => r.AccountID === req.query.accountId));
    }
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/keg-tracking/summary — per-account outstanding keg counts
router.get('/summary', async (req, res) => {
  try {
    const rows = await getAllRows('KEG_TRACKING');
    const summary = {};
    for (const r of rows) {
      const qty = parseInt(r.Quantity) || 0;
      const returned = parseInt(r.ReturnedQuantity) || 0;
      const outstanding = qty - returned;
      if (outstanding <= 0) continue;
      if (!summary[r.AccountID]) {
        summary[r.AccountID] = { accountId: r.AccountID, accountName: r.AccountName, outstanding: 0 };
      }
      summary[r.AccountID].outstanding += outstanding;
    }
    res.json(Object.values(summary));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/keg-tracking — create a keg tracking record
router.post('/', async (req, res) => {
  try {
    const { accountId, accountName, orderId, inventoryId, productName, format, quantity, deliveredDate, notes } = req.body;
    if (!accountId || !quantity) return res.status(400).json({ error: 'accountId and quantity are required' });

    const record = {
      ID: uuidv4(),
      AccountID: accountId,
      AccountName: accountName || '',
      OrderID: orderId || '',
      InventoryID: inventoryId || '',
      ProductName: productName || '',
      Format: format || '',
      Quantity: String(quantity),
      DeliveredDate: deliveredDate || new Date().toISOString().split('T')[0],
      ReturnedDate: '',
      ReturnedQuantity: '0',
      Notes: notes || '',
      CreatedAt: new Date().toISOString(),
    };
    await addRow('KEG_TRACKING', record);
    res.json(record);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/keg-tracking/:id — update a keg tracking record (mark returned)
router.put('/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const updates = {};
    const allowed = ['ReturnedDate', 'ReturnedQuantity', 'Notes'];
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    const updated = await updateRow('KEG_TRACKING', id, updates);
    res.json(updated);
  } catch (err) {
    res.status(err.message.includes('not found') ? 404 : 500).json({ error: err.message });
  }
});

module.exports = router;
