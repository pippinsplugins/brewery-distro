'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getAllRows, getRow, addRow, updateRow, deleteRow } = require('../db');

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

// GET /api/products/:id — single product
router.get('/:id', async (req, res) => {
  try {
    const product = await getRow('PRODUCTS', req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json(product);
  } catch (err) {
    console.error(`[products] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/products
 * Create a product and auto-create inventory rows at every configured location.
 *
 * Format and PricePerUnit live on inventory rows, not the product row.
 * Pass `variations` array for multi-format products:
 *   [{ format, pricePerUnit, prices: [{ label, price }, ...] }]
 * Falls back to a single variation from legacy `Format`/`PricePerUnit` fields.
 * Multi-tier pricing is stored as JSON in the inventory `Prices` column;
 * `PricePerUnit` is set to the first tier price.
 */
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
      // Build Prices JSON from prices array; set PricePerUnit to first price
      let pricesJson = '';
      let primaryPrice = v.pricePerUnit || '';
      if (Array.isArray(v.prices) && v.prices.length > 0) {
        pricesJson = JSON.stringify(v.prices);
        primaryPrice = v.prices[0].price || primaryPrice;
      }
      for (const loc of locations) {
        const inv = {
          ID: uuidv4(),
          ProductID: product.ID,
          ProductName: product.Name,
          Format: v.format || '',
          PricePerUnit: primaryPrice,
          Prices: pricesJson,
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

/**
 * PUT /api/products/:id
 * Update product fields. Format and PricePerUnit are stripped from updates —
 * they are managed on inventory rows via the /variations endpoints.
 * If Name changes, ProductName is cascaded to all linked inventory rows.
 */
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

/**
 * GET /api/products/:id/variations
 * Returns format variations for a product, deduplicated by Format value.
 * Each variation includes:
 *   - format: the format string
 *   - pricePerUnit: primary price
 *   - prices: multi-tier pricing array (parsed from Prices JSON)
 *   - locations: array of { location, inventoryId, units } for each location
 */
router.get('/:id/variations', async (req, res) => {
  try {
    const inventory = await getAllRows('INVENTORY');
    const related = inventory.filter(i => i.ProductID === req.params.id);

    // Deduplicate by Format
    const formatMap = new Map();
    for (const inv of related) {
      const fmt = inv.Format || '';
      if (!formatMap.has(fmt)) {
        // Parse Prices JSON; fall back to single-price array from PricePerUnit
        let prices = [];
        if (inv.Prices) {
          try { prices = JSON.parse(inv.Prices); } catch { /* ignore */ }
        }
        if (prices.length === 0 && inv.PricePerUnit) {
          prices = [{ label: '', price: inv.PricePerUnit }];
        }
        formatMap.set(fmt, { format: fmt, pricePerUnit: inv.PricePerUnit || '', prices, locations: [] });
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
    const { format, pricePerUnit, prices } = req.body;
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

    // Build Prices JSON; set PricePerUnit to first price
    let pricesJson = '';
    let primaryPrice = pricePerUnit || '';
    if (Array.isArray(prices) && prices.length > 0) {
      pricesJson = JSON.stringify(prices);
      primaryPrice = prices[0].price || primaryPrice;
    }

    const inventoryRows = [];
    const today = new Date().toISOString().split('T')[0];
    for (const loc of locations) {
      const inv = {
        ID: uuidv4(),
        ProductID: req.params.id,
        ProductName: product.Name,
        Format: format || '',
        PricePerUnit: primaryPrice,
        Prices: pricesJson,
        Location: loc,
        Units: '0',
        LowStockThreshold: '5',
        LastUpdated: today,
      };
      await addRow('INVENTORY', inv);
      inventoryRows.push(inv);
    }

    res.status(201).json({ format: format || '', pricePerUnit: primaryPrice, inventoryRows });
  } catch (err) {
    console.error(`[products] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/products/:id/variations/:format
 * Remove a format variation. Deletes all inventory rows for this product
 * at every location with the given format.
 * Refused with 400 if any of those rows have stock > 0.
 * The format value must be URL-encoded (e.g. "1%2F6+Keg" for "1/6 Keg").
 */
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

/**
 * DELETE /api/products/:id
 * Delete a product and all its inventory rows.
 * Refused with 400 if any inventory row has stock > 0.
 * Use stock movements to zero out stock before deleting.
 */
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
