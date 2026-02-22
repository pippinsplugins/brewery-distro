'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getAllRows, addRow, updateRow } = require('../sheets');

const router = express.Router();

// GET /api/stock-movements?inventoryId=X
router.get('/', async (req, res) => {
  try {
    const { inventoryId } = req.query;
    let rows = await getAllRows('STOCK_MOVEMENTS');
    if (inventoryId) rows = rows.filter(r => r.InventoryID === inventoryId);
    rows.sort((a, b) => (b.Date || b.CreatedAt || '').localeCompare(a.Date || a.CreatedAt || ''));
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/stock-movements/bulk
// Confirms delivery: records one movement per line item, decrements inventory, marks order delivered.
// Body: { orderId, items: [{ inventoryId, quantity }], notes, date }
router.post('/bulk', async (req, res) => {
  try {
    const { orderId, items, notes, date } = req.body;
    if (!orderId) return res.status(400).json({ error: 'orderId is required' });
    if (!Array.isArray(items)) return res.status(400).json({ error: 'items must be an array' });

    const inventory = await getAllRows('INVENTORY');
    const movDate   = date || new Date().toISOString().split('T')[0];
    const createdAt = new Date().toISOString();
    const movements = [];

    for (const item of items) {
      const qty = parseInt(item.quantity);
      if (!item.inventoryId || !qty || qty <= 0) continue;

      const inv = inventory.find(i => i.ID === item.inventoryId);
      if (!inv) continue;

      const movement = {
        ID:            uuidv4(),
        InventoryID:   item.inventoryId,
        InventoryName: [inv.Name, inv.Format].filter(Boolean).join(' — '),
        OrderID:       orderId,
        Type:          'sale',
        Quantity:      String(-qty),
        Notes:         notes || '',
        Date:          movDate,
        CreatedAt:     createdAt,
      };
      await addRow('STOCK_MOVEMENTS', movement);
      movements.push(movement);

      const newUnits = Math.max(0, parseInt(inv.Units || '0') - qty);
      await updateRow('INVENTORY', item.inventoryId, {
        Units:       String(newUnits),
        LastUpdated: movDate,
      });
    }

    await updateRow('ORDERS', orderId, { Delivered: 'true' });
    res.json({ movements });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/stock-movements
// Single manual adjustment (received, write-off, or general adjustment).
// Body: { inventoryId, type, quantity, notes, date }
router.post('/', async (req, res) => {
  try {
    const { inventoryId, type, quantity, notes, date } = req.body;
    if (!inventoryId) return res.status(400).json({ error: 'inventoryId is required' });

    const VALID_TYPES = ['received', 'write-off', 'adjustment'];
    if (!VALID_TYPES.includes(type)) return res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` });

    const qty = parseInt(quantity);
    if (!qty || qty <= 0) return res.status(400).json({ error: 'quantity must be a positive integer' });

    const inventory = await getAllRows('INVENTORY');
    const inv = inventory.find(i => i.ID === inventoryId);
    if (!inv) return res.status(404).json({ error: 'Inventory item not found' });

    // received = add stock; write-off and adjustment = remove stock
    const delta     = type === 'received' ? qty : -qty;
    const movDate   = date || new Date().toISOString().split('T')[0];
    const createdAt = new Date().toISOString();

    const movement = {
      ID:            uuidv4(),
      InventoryID:   inventoryId,
      InventoryName: [inv.Name, inv.Format].filter(Boolean).join(' — '),
      OrderID:       '',
      Type:          type,
      Quantity:      String(delta),
      Notes:         notes || '',
      Date:          movDate,
      CreatedAt:     createdAt,
    };
    await addRow('STOCK_MOVEMENTS', movement);

    const newUnits = Math.max(0, parseInt(inv.Units || '0') + delta);
    await updateRow('INVENTORY', inventoryId, {
      Units:       String(newUnits),
      LastUpdated: movDate,
    });

    res.json({ movement, newUnits });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
