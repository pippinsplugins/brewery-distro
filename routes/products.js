'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getAllRows, addRow, updateRow, deleteRow } = require('../db');

const router = express.Router();

// GET /api/products — all products (location-independent)
router.get('/', async (req, res) => {
  try {
    const products = await getAllRows('PRODUCTS');
    res.json(products);
  } catch (err) {
    console.error(`[products] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/products — create product + auto-create inventory rows at every location
router.post('/', async (req, res) => {
  try {
    const { Name, Style, ABV, Format, PricePerUnit, Notes, variations } = req.body;
    if (!Name) return res.status(400).json({ error: 'Name is required' });

    // Product row: Format/PricePerUnit are empty; they live on inventory rows
    const product = {
      ID: uuidv4(),
      Name: Name.trim(),
      Style: Style || '',
      ABV: ABV || '',
      Format: '',
      PricePerUnit: '',
      Notes: Notes || '',
      CreatedAt: new Date().toISOString(),
    };
    await addRow('PRODUCTS', product);

    // Read locations from settings
    const settings = await getAllRows('SETTINGS');
    const locRow = settings.find(s => s.Key === 'locations');
    let locations = [];
    if (locRow) {
      try { locations = JSON.parse(locRow.Value); } catch (e) { /* use defaults */ }
    }

    // Determine variations: use new array or fall back to legacy single Format field
    const vars = Array.isArray(variations) && variations.length > 0
      ? variations
      : [{ format: Format || '', pricePerUnit: PricePerUnit || '' }];

    // Auto-create inventory rows at each location for each variation
    const inventoryRows = [];
    const today = new Date().toISOString().split('T')[0];
    for (const v of vars) {
      for (const loc of locations) {
        const inv = {
          ID: uuidv4(),
          ProductID: product.ID,
          ProductName: product.Name,
          Format: v.format || '',
          PricePerUnit: v.pricePerUnit || '',
          Location: loc,
          Units: '0',
          LowStockThreshold: '5',
          LastUpdated: today,
        };
        await addRow('INVENTORY', inv);
        inventoryRows.push(inv);
      }
    }

    res.status(201).json({ product, inventoryRows });
  } catch (err) {
    console.error(`[products] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/products/:id — update product fields (not Format/PricePerUnit); cascade Name changes
router.put('/:id', async (req, res) => {
  try {
    const updates = { ...req.body };
    delete updates.ID;
    delete updates.CreatedAt;
    // Format and PricePerUnit now live on inventory rows, not the product
    delete updates.Format;
    delete updates.PricePerUnit;

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
    const status = err.message.includes('not found') ? 404 : 500;
    console.error(`[products] ${err.message}`);
    res.status(status).json({ error: status === 404 ? 'Not found' : 'Internal server error' });
  }
});

// GET /api/products/:id/variations — deduplicated formats from inventory
router.get('/:id/variations', async (req, res) => {
  try {
    const inventory = await getAllRows('INVENTORY');
    const related = inventory.filter(i => i.ProductID === req.params.id);

    // Deduplicate by Format
    const formatMap = new Map();
    for (const inv of related) {
      const fmt = inv.Format || '';
      if (!formatMap.has(fmt)) {
        formatMap.set(fmt, { format: fmt, pricePerUnit: inv.PricePerUnit || '', locations: [] });
      }
      formatMap.get(fmt).locations.push({ location: inv.Location, inventoryId: inv.ID, units: inv.Units || '0' });
    }

    res.json([...formatMap.values()]);
  } catch (err) {
    console.error(`[products] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/products/:id/variations — add a new format variation
router.post('/:id/variations', async (req, res) => {
  try {
    const { format, pricePerUnit } = req.body;
    const products = await getAllRows('PRODUCTS');
    const product = products.find(p => p.ID === req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    // Check for duplicate format
    const inventory = await getAllRows('INVENTORY');
    const existing = inventory.find(i => i.ProductID === req.params.id && (i.Format || '') === (format || ''));
    if (existing) return res.status(400).json({ error: 'This format already exists for this product' });

    // Read locations
    const settings = await getAllRows('SETTINGS');
    const locRow = settings.find(s => s.Key === 'locations');
    let locations = [];
    if (locRow) {
      try { locations = JSON.parse(locRow.Value); } catch (e) { /* ignore */ }
    }

    const inventoryRows = [];
    const today = new Date().toISOString().split('T')[0];
    for (const loc of locations) {
      const inv = {
        ID: uuidv4(),
        ProductID: req.params.id,
        ProductName: product.Name,
        Format: format || '',
        PricePerUnit: pricePerUnit || '',
        Location: loc,
        Units: '0',
        LowStockThreshold: '5',
        LastUpdated: today,
      };
      await addRow('INVENTORY', inv);
      inventoryRows.push(inv);
    }

    res.status(201).json({ format: format || '', pricePerUnit: pricePerUnit || '', inventoryRows });
  } catch (err) {
    console.error(`[products] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/products/:id/variations/:format — remove a format variation
router.delete('/:id/variations/:format', async (req, res) => {
  try {
    const format = decodeURIComponent(req.params.format);
    const inventory = await getAllRows('INVENTORY');
    const related = inventory.filter(i => i.ProductID === req.params.id && (i.Format || '') === format);

    if (related.length === 0) return res.status(404).json({ error: 'Variation not found' });

    // Refuse if any have stock > 0
    const hasStock = related.some(i => parseInt(i.Units || '0') > 0);
    if (hasStock) {
      return res.status(400).json({ error: 'Cannot delete variation with stock remaining. Adjust inventory to zero first.' });
    }

    for (const inv of related) {
      await deleteRow('INVENTORY', inv.ID);
    }

    res.json({ success: true });
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 500;
    console.error(`[products] ${err.message}`);
    res.status(status).json({ error: status === 404 ? 'Not found' : 'Internal server error' });
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
    const status = err.message.includes('not found') ? 404 : 500;
    console.error(`[products] ${err.message}`);
    res.status(status).json({ error: status === 404 ? 'Not found' : 'Internal server error' });
  }
});

module.exports = router;
