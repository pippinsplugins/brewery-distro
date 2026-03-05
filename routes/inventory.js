'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getAllRows, addRow, updateRow, deleteRow } = require('../db');

const router = express.Router();

// Helper: enrich inventory rows with product data so the response shape
// matches what all existing consumers (orders product picker, delivery
// confirmation, dashboard) expect.
async function enrichInventory(items) {
  const products = await getAllRows('PRODUCTS');
  const productMap = Object.fromEntries(products.map(p => [p.ID, p]));
  return items.map(inv => {
    const product = productMap[inv.ProductID] || {};
    return {
      ...inv,
      Name: inv.ProductName || product.Name || inv.Name || '',
      Style: product.Style || inv.Style || '',
      ABV: product.ABV || inv.ABV || '',
      Format: inv.Format || product.Format || '',
      PricePerUnit: inv.PricePerUnit || product.PricePerUnit || '',
    };
  });
}

router.get('/', async (req, res) => {
  try {
    const { location } = req.query;
    let items = await getAllRows('INVENTORY');
    if (location) items = items.filter(i => i.Location === location);
    items = await enrichInventory(items);
    res.json(items);
  } catch (err) {
    console.error(`[inventory] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/inventory — add a product to a specific location
router.post('/', async (req, res) => {
  try {
    const { ProductID, Location, Units, LowStockThreshold, Name, Style, ABV, Format, PricePerUnit, Notes } = req.body;

    // Support legacy create (full product fields) for backward compatibility
    if (!ProductID && Name) {
      const item = {
        ID: uuidv4(),
        Name: Name.trim(),
        Location: Location || '',
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
      return res.status(201).json(item);
    }

    // New-style: add product to a location
    if (!ProductID) return res.status(400).json({ error: 'ProductID is required' });
    if (!Location) return res.status(400).json({ error: 'Location is required' });

    // Verify product exists
    const products = await getAllRows('PRODUCTS');
    const product = products.find(p => p.ID === ProductID);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    // Check if already exists at this location (Format-aware)
    const inventory = await getAllRows('INVENTORY');
    const existing = inventory.find(i => i.ProductID === ProductID && i.Location === Location && (i.Format || '') === (Format || ''));
    if (existing) return res.status(400).json({ error: 'Product already exists at this location' });

    const item = {
      ID: uuidv4(),
      ProductID,
      ProductName: product.Name,
      Format: Format || '',
      PricePerUnit: PricePerUnit || '',
      Location,
      Units: '0',
      LowStockThreshold: LowStockThreshold !== undefined ? String(LowStockThreshold) : '5',
      LastUpdated: new Date().toISOString().split('T')[0],
    };
    await addRow('INVENTORY', item);
    res.status(201).json(item);
  } catch (err) {
    console.error(`[inventory] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
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
    const status = err.message.includes('not found') ? 404 : 500;
    console.error(`[inventory] ${err.message}`);
    res.status(status).json({ error: status === 404 ? 'Not found' : 'Internal server error' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await deleteRow('INVENTORY', req.params.id);
    res.json({ success: true });
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 500;
    console.error(`[inventory] ${err.message}`);
    res.status(status).json({ error: status === 404 ? 'Not found' : 'Internal server error' });
  }
});

module.exports = router;
