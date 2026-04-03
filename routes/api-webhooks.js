'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getAllRows, getRow, addRow, updateRow } = require('../db');

const router = express.Router();

function createError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function logWebhook(apiKeyName, action, payload, status, error) {
  try {
    addRow('WEBHOOK_LOG', {
      ID: uuidv4(),
      ApiKeyName: apiKeyName || '',
      Action: action || '',
      Payload: typeof payload === 'object' ? JSON.stringify(payload) : String(payload || ''),
      Status: status || '',
      Error: error || '',
      CreatedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[api-webhooks] Failed to log webhook:', e.message);
  }
}

// ── Action handlers ──────────────────────────────────────────────

async function handleInventoryUpdate(data) {
  const { inventoryId, quantity, mode, notes, date } = data;
  if (!inventoryId) throw createError(400, 'data.inventoryId is required');

  const qty = parseInt(quantity);
  if (isNaN(qty) || qty === 0) throw createError(400, 'data.quantity must be a non-zero integer');

  const inv = await getRow('INVENTORY', inventoryId);
  if (!inv) throw createError(404, `Inventory item ${inventoryId} not found`);

  const products = await getAllRows('PRODUCTS');
  const product = products.find(p => p.ID === inv.ProductID) || {};
  const invName = inv.ProductName || product.Name || inv.Name || '';
  const invFormat = inv.Format || product.Format || '';
  const movDate = date || new Date().toISOString().split('T')[0];
  const currentUnits = parseInt(inv.Units || '0');

  let newUnits;
  let delta;
  if (mode === 'absolute') {
    if (qty < 0) throw createError(400, 'Absolute quantity cannot be negative');
    delta = qty - currentUnits;
    newUnits = qty;
  } else {
    // default: delta
    delta = qty;
    newUnits = Math.max(0, currentUnits + delta);
  }

  const type = delta >= 0 ? 'received' : 'adjustment';

  const movement = {
    ID: uuidv4(),
    InventoryID: inventoryId,
    InventoryName: [invName, invFormat].filter(Boolean).join(' — '),
    OrderID: '',
    Type: type,
    Quantity: String(delta),
    Notes: notes || 'API webhook',
    Date: movDate,
    CreatedAt: new Date().toISOString(),
  };
  await addRow('STOCK_MOVEMENTS', movement);
  await updateRow('INVENTORY', inventoryId, { Units: String(newUnits), LastUpdated: movDate });

  return { movement, newUnits };
}

async function handleProductCreate(data) {
  const { name, style, abv, notes, variations } = data;
  if (!name) throw createError(400, 'data.name is required');

  const product = {
    ID: uuidv4(),
    Name: name.trim(),
    Style: style || '',
    ABV: abv || '',
    Format: '',
    PricePerUnit: '',
    Notes: notes || '',
    CreatedAt: new Date().toISOString(),
  };
  await addRow('PRODUCTS', product);

  // Read locations from settings
  const settings = await getAllRows('SETTINGS');
  const locRow = settings.find(s => s.Key === 'locations');
  let locations = [];
  if (locRow) {
    try { locations = JSON.parse(locRow.Value); } catch { /* ignore */ }
  }

  const vars = Array.isArray(variations) && variations.length > 0
    ? variations
    : [{ format: '', pricePerUnit: '' }];

  const inventoryRows = [];
  const today = new Date().toISOString().split('T')[0];
  for (const v of vars) {
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

  return { product, inventoryRows };
}

async function handleProductUpdate(data) {
  const { productId, name: lookupName, updates } = data;
  if (!productId && !lookupName) throw createError(400, 'data.productId or data.name is required');
  if (!updates || typeof updates !== 'object') throw createError(400, 'data.updates is required');

  let id = productId;
  if (!id && lookupName) {
    const products = await getAllRows('PRODUCTS');
    const match = products.find(p => p.Name && p.Name.toLowerCase() === lookupName.toLowerCase().trim());
    if (!match) throw createError(404, `Product named "${lookupName}" not found`);
    id = match.ID;
  }

  const existing = await getRow('PRODUCTS', id);
  if (!existing) throw createError(404, `Product ${id} not found`);

  // Only allow safe fields
  const allowed = { Name: updates.name, Style: updates.style, ABV: updates.abv, Notes: updates.notes };
  const clean = {};
  for (const [k, v] of Object.entries(allowed)) {
    if (v !== undefined) clean[k] = v;
  }
  if (Object.keys(clean).length === 0) throw createError(400, 'No valid update fields provided (name, style, abv, notes)');

  const updated = await updateRow('PRODUCTS', id, clean);

  // Cascade name change
  if (clean.Name && clean.Name !== existing.Name) {
    const inventory = await getAllRows('INVENTORY');
    const related = inventory.filter(i => i.ProductID === id);
    for (const inv of related) {
      await updateRow('INVENTORY', inv.ID, { ProductName: clean.Name });
    }
  }

  return { product: updated };
}

async function handleOrderCreate(data) {
  const { accountId, accountName, orderDate, orderAmount, taxAmount, notes, location,
          staffId, staffName, invoiceNumber, requestedProducts, status, delivered, deliveryDate } = data;

  if (!accountId && !accountName) throw createError(400, 'data.accountId or data.accountName is required');

  // Resolve account
  let resolvedAccountId = accountId;
  let resolvedAccountName = accountName;
  if (!resolvedAccountId && resolvedAccountName) {
    const accounts = await getAllRows('ACCOUNTS');
    const match = accounts.find(a => a.Name && a.Name.toLowerCase() === resolvedAccountName.toLowerCase().trim());
    if (!match) throw createError(404, `Account named "${resolvedAccountName}" not found`);
    resolvedAccountId = match.ID;
    resolvedAccountName = match.Name;
  }

  // Resolve staff
  let resolvedStaffId = staffId || '';
  let resolvedStaffName = staffName || '';
  if (!resolvedStaffId && resolvedStaffName) {
    const staff = await getAllRows('STAFF');
    const match = staff.find(s => s.Name && s.Name.toLowerCase() === resolvedStaffName.toLowerCase());
    if (match) { resolvedStaffId = match.ID; resolvedStaffName = match.Name; }
  }

  const now = new Date().toISOString();
  const today = now.split('T')[0];
  const rawDate = orderDate || today;
  const fullDate = rawDate.includes('T') ? rawDate : rawDate + 'T' + now.split('T')[1];

  const VALID_STATUSES = new Set(['Draft', 'Pending', 'Paid', 'Cancelled', 'Pre-Sale']);
  let orderStatus = status || 'Pending';
  orderStatus = orderStatus.charAt(0).toUpperCase() + orderStatus.slice(1);
  if (!VALID_STATUSES.has(orderStatus)) orderStatus = 'Pending';

  const order = {
    ID: uuidv4(),
    AccountID: resolvedAccountId,
    AccountName: resolvedAccountName,
    Location: location || '',
    StaffID: resolvedStaffId,
    StaffName: resolvedStaffName,
    OrderDate: fullDate,
    DeliveryDate: deliveryDate || '',
    InvoiceNumber: invoiceNumber || '',
    OrderAmount: orderAmount || '0',
    TaxAmount: taxAmount || '0',
    Notes: notes || '',
    RequestedProducts: requestedProducts || '',
    Status: orderStatus,
    Delivered: delivered === true || delivered === 'true' ? 'true' : 'false',
    CreatedAt: now,
  };
  await addRow('ORDERS', order);

  return { order };
}

// ── Action dispatch ──────────────────────────────────────────────

const ACTIONS = {
  'inventory.update': handleInventoryUpdate,
  'product.create':   handleProductCreate,
  'product.update':   handleProductUpdate,
  'order.create':     handleOrderCreate,
};

// ── POST /api/webhooks/incoming ──────────────────────────────────

router.post('/incoming', async (req, res) => {
  const { action, data } = req.body;
  const apiKeyName = req.apiKeyName || '';

  if (!action) {
    logWebhook(apiKeyName, '', req.body, 'error', 'Missing action');
    return res.status(400).json({ error: 'action is required' });
  }

  const handler = ACTIONS[action];
  if (!handler) {
    logWebhook(apiKeyName, action, data, 'error', `Unknown action: ${action}`);
    return res.status(400).json({ error: `Unknown action: ${action}. Valid actions: ${Object.keys(ACTIONS).join(', ')}` });
  }

  try {
    const result = await handler(data || {});
    logWebhook(apiKeyName, action, data, 'success', '');
    res.status(200).json(result);
  } catch (err) {
    const status = err.statusCode || 500;
    const message = err.message || 'Internal server error';
    logWebhook(apiKeyName, action, data, 'error', message);
    console.error(`[api-webhooks] ${action}: ${message}`);
    res.status(status).json({ error: message });
  }
});

// ── GET /api/webhooks/log ────────────────────────────────────────

router.get('/log', async (req, res) => {
  try {
    const rows = await getAllRows('WEBHOOK_LOG');
    rows.sort((a, b) => (b.CreatedAt || '').localeCompare(a.CreatedAt || ''));
    res.json(rows.slice(0, 100));
  } catch (err) {
    console.error(`[api-webhooks] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
