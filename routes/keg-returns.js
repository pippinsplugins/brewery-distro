'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getAllRows, addRow } = require('../db');

const router = express.Router();

// GET /api/keg-returns?orderId=<id>|accountId=<id>
// Returns the per-event log of kegs returned during a delivery. Each row
// captures a snapshot of the return (qty, deposit refunded, date) tied to
// the delivery OrderID. Filter by orderId for the "kegs returned on this
// order" view, or by accountId for the account's full return history.
router.get('/', async (req, res) => {
  try {
    const { orderId, accountId } = req.query;
    let rows = await getAllRows('KEG_RETURNS');
    if (orderId)   rows = rows.filter(r => r.OrderID   === orderId);
    if (accountId) rows = rows.filter(r => r.AccountID === accountId);
    rows.sort((a, b) => (b.CreatedAt || '').localeCompare(a.CreatedAt || ''));
    res.json(rows);
  } catch (err) {
    console.error(`[keg-returns] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/keg-returns — record one keg return event.
// Called by the delivery-confirm flow once per outstanding-keg row that the
// user entered a quantity for. The corresponding KEG_TRACKING row's
// ReturnedQuantity is updated separately by that flow; this row exists for
// historical look-back per delivery order.
router.post('/', async (req, res) => {
  try {
    const {
      AccountID, AccountName, OrderID, KegTrackingID,
      ProductName, Format, Quantity, DepositPerUnit, DepositRefunded,
      ReturnedDate, Notes,
    } = req.body;
    if (!OrderID)       return res.status(400).json({ error: 'OrderID is required' });
    if (!KegTrackingID) return res.status(400).json({ error: 'KegTrackingID is required' });
    if (!Quantity)      return res.status(400).json({ error: 'Quantity is required' });

    const row = {
      ID: uuidv4(),
      AccountID:       AccountID       || '',
      AccountName:     AccountName     || '',
      OrderID,
      KegTrackingID,
      ProductName:     ProductName     || '',
      Format:          Format          || '',
      Quantity:        String(Quantity),
      DepositPerUnit:  DepositPerUnit  || '',
      DepositRefunded: DepositRefunded || '',
      ReturnedDate:    ReturnedDate    || new Date().toISOString().split('T')[0],
      Notes:           Notes           || '',
      CreatedAt:       new Date().toISOString(),
    };
    await addRow('KEG_RETURNS', row);
    res.status(201).json(row);
  } catch (err) {
    console.error(`[keg-returns] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
