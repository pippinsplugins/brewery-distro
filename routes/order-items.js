'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getAllRows, addRow, deleteRow } = require('../db');

const router = express.Router();

// GET /api/order-items?orderId=<id> — get line items for an order
router.get('/', async (req, res) => {
  try {
    const { orderId } = req.query;
    let items = await getAllRows('ORDER_ITEMS');
    if (orderId) items = items.filter(i => i.OrderID === orderId);
    res.json(items);
  } catch (err) {
    console.error(`[order-items] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/order-items/counts — get item counts per order (for badges)
router.get('/counts', async (req, res) => {
  try {
    const items = await getAllRows('ORDER_ITEMS');
    const counts = {};
    for (const item of items) {
      if (item.OrderID) {
        counts[item.OrderID] = (counts[item.OrderID] || 0) + 1;
      }
    }
    res.json(counts);
  } catch (err) {
    console.error(`[order-items] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/order-items — create a single item
router.post('/', async (req, res) => {
  try {
    const { OrderID, InventoryID, ProductName, Format, Quantity, UnitPrice, LineTotal } = req.body;
    if (!OrderID) return res.status(400).json({ error: 'OrderID is required' });

    const item = {
      ID: uuidv4(),
      OrderID,
      InventoryID: InventoryID || '',
      ProductName: ProductName || '',
      Format: Format || '',
      Quantity: Quantity || '0',
      UnitPrice: UnitPrice || '0',
      LineTotal: LineTotal || '0',
      CreatedAt: new Date().toISOString(),
    };

    await addRow('ORDER_ITEMS', item);
    res.status(201).json(item);
  } catch (err) {
    console.error(`[order-items] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/order-items/bulk — create multiple items at once
router.post('/bulk', async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items array is required' });
    }

    const created = [];
    for (const raw of items) {
      const item = {
        ID: uuidv4(),
        OrderID: raw.OrderID || '',
        InventoryID: raw.InventoryID || '',
        ProductName: raw.ProductName || '',
        Format: raw.Format || '',
        Quantity: String(raw.Quantity || '0'),
        UnitPrice: String(raw.UnitPrice || '0'),
        LineTotal: String(raw.LineTotal || '0'),
        CreatedAt: new Date().toISOString(),
      };
      await addRow('ORDER_ITEMS', item);
      created.push(item);
    }

    res.status(201).json(created);
  } catch (err) {
    console.error(`[order-items] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/order-items?orderId=<id> — delete all items for an order
router.delete('/', async (req, res) => {
  try {
    const { orderId } = req.query;
    if (!orderId) return res.status(400).json({ error: 'orderId query param is required' });

    const items = await getAllRows('ORDER_ITEMS');
    const toDelete = items.filter(i => i.OrderID === orderId);
    for (const item of toDelete) {
      await deleteRow('ORDER_ITEMS', item.ID);
    }

    res.json({ success: true, deleted: toDelete.length });
  } catch (err) {
    console.error(`[order-items] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
