'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getAllRows, addRow, updateRow, deleteRow } = require('../sheets');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const items = await getAllRows('INVENTORY');
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { Name, Style, ABV, Format, Units, PricePerUnit, LowStockThreshold, Notes } = req.body;
    if (!Name) return res.status(400).json({ error: 'Name is required' });

    const item = {
      ID: uuidv4(),
      Name: Name.trim(),
      Style: Style || '',
      ABV: ABV || '',
      Format: Format || '',
      Units: Units !== undefined ? String(Units) : '0',
      PricePerUnit: PricePerUnit || '',
      LowStockThreshold: LowStockThreshold !== undefined ? String(LowStockThreshold) : '5',
      Notes: Notes || '',
      LastUpdated: new Date().toISOString().split('T')[0],
    };

    await addRow('INVENTORY', item);
    res.status(201).json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const updates = { ...req.body };
    delete updates.ID;
    delete updates.Units; // Units are managed exclusively via /api/stock-movements
    updates.LastUpdated = new Date().toISOString().split('T')[0];
    const updated = await updateRow('INVENTORY', req.params.id, updates);
    res.json(updated);
  } catch (err) {
    res.status(err.message.includes('not found') ? 404 : 500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await deleteRow('INVENTORY', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(err.message.includes('not found') ? 404 : 500).json({ error: err.message });
  }
});

module.exports = router;
