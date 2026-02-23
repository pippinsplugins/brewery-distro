'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getAllRows, addRow, updateRow, deleteRow } = require('../sheets');

const router = express.Router();

// GET /api/products — all products (location-independent)
router.get('/', async (req, res) => {
  try {
    const products = await getAllRows('PRODUCTS');
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/products — create product + auto-create inventory rows at every location
router.post('/', async (req, res) => {
  try {
    const { Name, Style, ABV, Format, PricePerUnit, Notes } = req.body;
    if (!Name) return res.status(400).json({ error: 'Name is required' });

    const product = {
      ID: uuidv4(),
      Name: Name.trim(),
      Style: Style || '',
      ABV: ABV || '',
      Format: Format || '',
      PricePerUnit: PricePerUnit || '',
      Notes: Notes || '',
      CreatedAt: new Date().toISOString(),
    };
    await addRow('PRODUCTS', product);

    // Read locations from settings
    const settings = await getAllRows('SETTINGS');
    const locRow = settings.find(s => s.Key === 'locations');
    let locations = ['Hutchinson', 'Mission']; // defaults
    if (locRow) {
      try { locations = JSON.parse(locRow.Value); } catch (e) { /* use defaults */ }
    }

    // Auto-create inventory row at each location
    const inventoryRows = [];
    const today = new Date().toISOString().split('T')[0];
    for (const loc of locations) {
      const inv = {
        ID: uuidv4(),
        ProductID: product.ID,
        ProductName: product.Name,
        Location: loc,
        Units: '0',
        LowStockThreshold: '5',
        LastUpdated: today,
      };
      await addRow('INVENTORY', inv);
      inventoryRows.push(inv);
    }

    res.status(201).json({ product, inventoryRows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/products/:id — update product; cascade Name changes to inventory
router.put('/:id', async (req, res) => {
  try {
    const updates = { ...req.body };
    delete updates.ID;
    delete updates.CreatedAt;

    const products = await getAllRows('PRODUCTS');
    const existing = products.find(p => p.ID === req.params.id);
    if (!existing) return res.status(404).json({ error: 'Product not found' });

    const updated = await updateRow('PRODUCTS', req.params.id, updates);

    // Cascade ProductName if Name changed
    if (updates.Name && updates.Name !== existing.Name) {
      const inventory = await getAllRows('INVENTORY');
      const related = inventory.filter(i => i.ProductID === req.params.id);
      for (const inv of related) {
        await updateRow('INVENTORY', inv.ID, { ProductName: updates.Name });
      }
    }

    res.json(updated);
  } catch (err) {
    res.status(err.message.includes('not found') ? 404 : 500).json({ error: err.message });
  }
});

// DELETE /api/products/:id — refuse if stock > 0 anywhere; delete inventory rows + product
router.delete('/:id', async (req, res) => {
  try {
    const inventory = await getAllRows('INVENTORY');
    const related = inventory.filter(i => i.ProductID === req.params.id);

    // Check for non-zero stock
    const hasStock = related.some(i => parseInt(i.Units || '0') > 0);
    if (hasStock) {
      return res.status(400).json({ error: 'Cannot delete product with stock remaining. Adjust inventory to zero first.' });
    }

    // Delete all inventory rows for this product
    for (const inv of related) {
      await deleteRow('INVENTORY', inv.ID);
    }

    // Delete the product
    await deleteRow('PRODUCTS', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(err.message.includes('not found') ? 404 : 500).json({ error: err.message });
  }
});

module.exports = router;
