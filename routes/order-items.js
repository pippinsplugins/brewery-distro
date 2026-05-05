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

// GET /api/order-items/counts — line-item count and end-customer summary per
// order, used by the orders list for the items badge and the indirect-delivery
// "→ Venue" annotation. Shape: { [orderId]: { count: N, endCustomers: [...] } }.
router.get('/counts', async (req, res) => {
  try {
    const items = await getAllRows('ORDER_ITEMS');
    const summary = {};
    for (const item of items) {
      if (!item.OrderID) continue;
      if (!summary[item.OrderID]) summary[item.OrderID] = { count: 0, endCustomers: [] };
      summary[item.OrderID].count++;
      const name = item.EndCustomerName || '';
      if (name && !summary[item.OrderID].endCustomers.includes(name)) {
        summary[item.OrderID].endCustomers.push(name);
      }
    }
    res.json(summary);
  } catch (err) {
    console.error(`[order-items] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/order-items — create a single item
router.post('/', async (req, res) => {
  try {
    const { OrderID, InventoryID, ProductName, Format, PriceTier, Quantity, UnitPrice, LineTotal, EndCustomerAccountID, EndCustomerName } = req.body;
    if (!OrderID) return res.status(400).json({ error: 'OrderID is required' });

    const item = {
      ID: uuidv4(),
      OrderID,
      InventoryID: InventoryID || '',
      ProductName: ProductName || '',
      Format: Format || '',
      PriceTier: PriceTier || '',
      Quantity: Quantity || '0',
      UnitPrice: UnitPrice || '0',
      LineTotal: LineTotal || '0',
      EndCustomerAccountID: EndCustomerAccountID || '',
      EndCustomerName: EndCustomerName || '',
      CreatedAt: new Date().toISOString(),
    };

    await addRow('ORDER_ITEMS', item);
    res.status(201).json(item);
  } catch (err) {
    console.error(`[order-items] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/order-items/bulk
 * Create multiple order line items in a single request. Used by the order
 * delivery confirmation flow to replace all items atomically.
 *
 * Each item may include:
 *   OrderID, InventoryID, ProductName, Format, PriceTier, Quantity,
 *   UnitPrice, LineTotal, Taxable
 *
 * NOTE: Typically preceded by DELETE /api/order-items?orderId= to replace
 * the full set of items for an order.
 *
 * @body {{ items: Array<object> }}
 * @returns {Array<object>} Created item records
 */
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
        PriceTier: raw.PriceTier || '',
        Quantity: String(raw.Quantity || '0'),
        UnitPrice: String(raw.UnitPrice || '0'),
        LineTotal: String(raw.LineTotal || '0'),
        Taxable: raw.Taxable || '',
        EndCustomerAccountID: raw.EndCustomerAccountID || '',
        EndCustomerName: raw.EndCustomerName || '',
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
