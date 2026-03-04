'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getAllRows, addRow, updateRow } = require('../db');
const { processMentions } = require('../lib/notifications');

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
    console.error(`[keg-tracking] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
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
        summary[r.AccountID] = { accountId: r.AccountID, accountName: r.AccountName, outstanding: 0, depositOutstanding: 0 };
      }
      summary[r.AccountID].outstanding += outstanding;
      const depTotal = parseFloat(r.DepositTotal) || 0;
      const depRefunded = parseFloat(r.DepositRefunded) || 0;
      if (depTotal > 0) {
        summary[r.AccountID].depositOutstanding += (depTotal - depRefunded);
      }
    }
    res.json(Object.values(summary));
  } catch (err) {
    console.error(`[keg-tracking] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/keg-tracking — create a keg tracking record
router.post('/', async (req, res) => {
  try {
    const { accountId, accountName, orderId, inventoryId, productName, format, quantity, depositPerUnit, deliveredDate, notes } = req.body;
    if (!accountId || !quantity) return res.status(400).json({ error: 'accountId and quantity are required' });

    const depPerUnit = parseFloat(depositPerUnit) || 0;
    const qty = parseInt(quantity) || 0;
    const record = {
      ID: uuidv4(),
      AccountID: accountId,
      AccountName: accountName || '',
      OrderID: orderId || '',
      InventoryID: inventoryId || '',
      ProductName: productName || '',
      Format: format || '',
      Quantity: String(quantity),
      DepositPerUnit: depPerUnit ? String(depPerUnit) : '',
      DepositTotal: depPerUnit ? String((depPerUnit * qty).toFixed(2)) : '',
      DepositRefunded: depPerUnit ? '0' : '',
      DeliveredDate: deliveredDate || new Date().toISOString().split('T')[0],
      ReturnedDate: '',
      ReturnedQuantity: '0',
      Notes: notes || '',
      CreatedAt: new Date().toISOString(),
    };
    await addRow('KEG_TRACKING', record);
    processMentions({ newText: record.Notes, oldText: '', entityType: 'keg', entityName: record.AccountName, entityId: record.ID, accountId: record.AccountID, user: req.user, mentionerName: req.user.name, baseUrl: req.protocol + '://' + req.get('host') }).catch(err => console.error('[notifications]', err));
    res.json(record);
  } catch (err) {
    console.error(`[keg-tracking] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/keg-tracking/:id — update a keg tracking record (mark returned)
router.put('/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const updates = {};
    const allowed = ['ReturnedDate', 'ReturnedQuantity', 'DepositRefunded', 'Notes'];
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    const updated = await updateRow('KEG_TRACKING', id, updates);
    res.json(updated);
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 500;
    console.error(`[keg-tracking] ${err.message}`);
    res.status(status).json({ error: status === 404 ? 'Not found' : 'Internal server error' });
  }
});

module.exports = router;
