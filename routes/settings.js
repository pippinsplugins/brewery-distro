'use strict';

const crypto = require('crypto');
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getAllRows, addRow, updateRow } = require('../db');

const router = express.Router();

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Strip sensitive keys from a settings key-value map before returning it to
 * the client. Replaces secrets with boolean presence flags:
 *   - geminiApiKey → geminiApiKeySet: true
 *   - inboundEmailWebhookToken → inboundEmailWebhookTokenSet: true
 * Also removes: qboTokens, apiKeys, google_refresh_token:* keys.
 * Parses JSON values for: locations, accountTags, styles, kegDeposits.
 *
 * @param {object} settings - Raw key-value map from the Settings table
 * @returns {object} Sanitized settings safe for client consumption
 */
function sanitizeSettings(settings) {
  // Flag presence of secrets before removing them
  const hasGeminiKey = !!settings.geminiApiKey;
  const hasWebhookToken = !!settings.inboundEmailWebhookToken;
  const twilioConfigured = !!(settings.twilioAccountSid && settings.twilioAuthToken && settings.twilioFromNumber);

  // Remove known secret keys
  delete settings.qboTokens;
  delete settings.apiKeys;
  delete settings.geminiApiKey;
  delete settings.inboundEmailWebhookToken;
  delete settings.twilioAccountSid;
  delete settings.twilioAuthToken;

  // Remove Google refresh tokens (stored as google_refresh_token:<profileId>)
  for (const key of Object.keys(settings)) {
    if (key.startsWith('google_refresh_token:')) delete settings[key];
  }

  if (hasGeminiKey) settings.geminiApiKeySet = true;
  if (hasWebhookToken) settings.inboundEmailWebhookTokenSet = true;
  if (twilioConfigured) settings.twilioConfigured = true;

  // Parse JSON values
  if (settings.locations) {
    try { settings.locations = JSON.parse(settings.locations); }
    catch (e) { settings.locations = []; }
  }
  if (settings.accountTags) {
    try { settings.accountTags = JSON.parse(settings.accountTags); }
    catch (e) { settings.accountTags = []; }
  }
  if (settings.styles) {
    try { settings.styles = JSON.parse(settings.styles); }
    catch (e) { settings.styles = []; }
  }
  if (settings.kegDeposits) {
    try { settings.kegDeposits = JSON.parse(settings.kegDeposits); }
    catch (e) { settings.kegDeposits = {}; }
  }
  return settings;
}

// GET /api/settings — returns settings as a key-value map
router.get('/', async (req, res) => {
  try {
    const rows = await getAllRows('SETTINGS');
    const settings = {};
    for (const row of rows) {
      settings[row.Key] = row.Value;
    }
    res.json(sanitizeSettings(settings));
  } catch (err) {
    console.error(`[settings] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Keys that may be set through the general settings PUT endpoint.
// Secrets (qboTokens, apiKeys, google_refresh_token:*, inboundEmailWebhookToken)
// are managed through dedicated endpoints and cannot be overwritten here.
const ALLOWED_SETTINGS_KEYS = new Set([
  'locations', 'accountTags', 'styles', 'kegDeposits', 'companyName',
  'inboundEmail', 'geminiApiKey', 'qboTaxCodeId',
  'twilioAccountSid', 'twilioAuthToken', 'twilioFromNumber',
]);

// PUT /api/settings — accepts a key-value map, upserts each key
router.put('/', async (req, res) => {
  try {
    const incoming = req.body;
    const rows = await getAllRows('SETTINGS');
    const existingByKey = {};
    for (const row of rows) {
      existingByKey[row.Key] = row;
    }

    for (const [key, rawValue] of Object.entries(incoming)) {
      if (!ALLOWED_SETTINGS_KEYS.has(key)) continue; // Skip unknown/sensitive keys
      const value = (typeof rawValue === 'object') ? JSON.stringify(rawValue) : String(rawValue);
      const now = new Date().toISOString().split('T')[0];

      if (existingByKey[key]) {
        await updateRow('SETTINGS', existingByKey[key].ID, { Value: value, UpdatedAt: now });
      } else {
        await addRow('SETTINGS', { ID: uuidv4(), Key: key, Value: value, UpdatedAt: now });
      }
    }

    // Return updated settings
    const updated = await getAllRows('SETTINGS');
    const result = {};
    for (const row of updated) result[row.Key] = row.Value;
    res.json(sanitizeSettings(result));
  } catch (err) {
    console.error(`[settings] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/settings/rename-location — renames a location and updates all associated records
router.put('/rename-location', async (req, res) => {
  try {
    const { oldName, newName, locations } = req.body;
    if (!oldName || !newName) return res.status(400).json({ error: 'oldName and newName are required' });

    // Update the locations list in settings
    const settingsRows = await getAllRows('SETTINGS');
    const existingByKey = {};
    for (const row of settingsRows) existingByKey[row.Key] = row;
    const locValue = JSON.stringify(locations);
    const now = new Date().toISOString().split('T')[0];
    if (existingByKey.locations) {
      await updateRow('SETTINGS', existingByKey.locations.ID, { Value: locValue, UpdatedAt: now });
    } else {
      await addRow('SETTINGS', { ID: uuidv4(), Key: 'locations', Value: locValue, UpdatedAt: now });
    }

    // Update all inventory records with the old location
    const inventory = await getAllRows('INVENTORY');
    let inventoryUpdated = 0;
    for (const item of inventory) {
      if (item.Location === oldName) {
        await updateRow('INVENTORY', item.ID, { Location: newName });
        inventoryUpdated++;
      }
    }

    // Update all order records with the old location
    const orders = await getAllRows('ORDERS');
    let ordersUpdated = 0;
    for (const order of orders) {
      if (order.Location === oldName) {
        await updateRow('ORDERS', order.ID, { Location: newName });
        ordersUpdated++;
      }
    }

    // Return updated settings
    const updated = await getAllRows('SETTINGS');
    const result = {};
    for (const row of updated) result[row.Key] = row.Value;
    const safe = sanitizeSettings(result);
    safe._renamed = { inventoryUpdated, ordersUpdated };
    res.json(safe);
  } catch (err) {
    console.error(`[settings] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/settings/rename-account-tag — renames a tag and updates all associated accounts
router.put('/rename-account-tag', async (req, res) => {
  try {
    const { oldName, newName, accountTags } = req.body;
    if (!oldName || !newName) return res.status(400).json({ error: 'oldName and newName are required' });

    // Update the account tags list in settings
    const settingsRows = await getAllRows('SETTINGS');
    const existingByKey = {};
    for (const row of settingsRows) existingByKey[row.Key] = row;
    const tagsValue = JSON.stringify(accountTags);
    const now = new Date().toISOString().split('T')[0];
    if (existingByKey.accountTags) {
      await updateRow('SETTINGS', existingByKey.accountTags.ID, { Value: tagsValue, UpdatedAt: now });
    } else {
      await addRow('SETTINGS', { ID: uuidv4(), Key: 'accountTags', Value: tagsValue, UpdatedAt: now });
    }

    // Update all account records that have the old tag
    const accounts = await getAllRows('ACCOUNTS');
    let accountsUpdated = 0;
    for (const acct of accounts) {
      let tags = [];
      try { tags = JSON.parse(acct.Tags || '[]'); } catch (e) { tags = []; }
      const idx = tags.indexOf(oldName);
      if (idx !== -1) {
        tags[idx] = newName;
        await updateRow('ACCOUNTS', acct.ID, { Tags: JSON.stringify(tags) });
        accountsUpdated++;
      }
    }

    // Return updated settings
    const updated = await getAllRows('SETTINGS');
    const result = {};
    for (const row of updated) result[row.Key] = row.Value;
    const safe = sanitizeSettings(result);
    safe._renamed = { accountsUpdated };
    res.json(safe);
  } catch (err) {
    console.error(`[settings] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/settings/rename-style — renames a style and updates all associated products and inventory
router.put('/rename-style', async (req, res) => {
  try {
    const { oldName, newName, styles } = req.body;
    if (!oldName || !newName) return res.status(400).json({ error: 'oldName and newName are required' });

    // Update the styles list in settings
    const settingsRows = await getAllRows('SETTINGS');
    const existingByKey = {};
    for (const row of settingsRows) existingByKey[row.Key] = row;
    const stylesValue = JSON.stringify(styles);
    const now = new Date().toISOString().split('T')[0];
    if (existingByKey.styles) {
      await updateRow('SETTINGS', existingByKey.styles.ID, { Value: stylesValue, UpdatedAt: now });
    } else {
      await addRow('SETTINGS', { ID: uuidv4(), Key: 'styles', Value: stylesValue, UpdatedAt: now });
    }

    // Update all product records with the old style
    const products = await getAllRows('PRODUCTS');
    let productsUpdated = 0;
    for (const p of products) {
      if (p.Style === oldName) {
        await updateRow('PRODUCTS', p.ID, { Style: newName });
        productsUpdated++;
      }
    }

    // Update all inventory records with the old style
    const inventory = await getAllRows('INVENTORY');
    let inventoryUpdated = 0;
    for (const item of inventory) {
      if (item.Style === oldName) {
        await updateRow('INVENTORY', item.ID, { Style: newName });
        inventoryUpdated++;
      }
    }

    // Return updated settings
    const updated = await getAllRows('SETTINGS');
    const result = {};
    for (const row of updated) result[row.Key] = row.Value;
    const safe = sanitizeSettings(result);
    safe._renamed = { productsUpdated, inventoryUpdated };
    res.json(safe);
  } catch (err) {
    console.error(`[settings] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Inbound Email Webhook Token ──────────────────────────────────

// POST /api/settings/inbound-email-webhook-token — generate a new webhook token
router.post('/inbound-email-webhook-token', async (req, res) => {
  try {
    const token = crypto.randomBytes(32).toString('hex');
    const rows = await getAllRows('SETTINGS');
    const existing = rows.find(r => r.Key === 'inboundEmailWebhookToken');
    const now = new Date().toISOString().split('T')[0];
    if (existing) {
      await updateRow('SETTINGS', existing.ID, { Value: token, UpdatedAt: now });
    } else {
      await addRow('SETTINGS', { ID: uuidv4(), Key: 'inboundEmailWebhookToken', Value: token, UpdatedAt: now });
    }
    res.json({ token });
  } catch (err) {
    console.error(`[settings] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/settings/inbound-email-webhook-token/reveal — return the current token
router.post('/inbound-email-webhook-token/reveal', async (req, res) => {
  try {
    const rows = await getAllRows('SETTINGS');
    const row = rows.find(r => r.Key === 'inboundEmailWebhookToken');
    if (!row || !row.Value) return res.status(404).json({ error: 'No webhook token configured. Generate one first.' });
    res.json({ token: row.Value });
  } catch (err) {
    console.error(`[settings] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── API Key helpers ──────────────────────────────────────────────

function getApiKeys() {
  const rows = getAllRows('SETTINGS');
  const row = rows.find(r => r.Key === 'apiKeys');
  if (!row) return [];
  try { return JSON.parse(row.Value || '[]'); } catch { return []; }
}

function saveApiKeys(keys) {
  const rows = getAllRows('SETTINGS');
  const row = rows.find(r => r.Key === 'apiKeys');
  const value = JSON.stringify(keys);
  const now = new Date().toISOString().split('T')[0];
  if (row) {
    updateRow('SETTINGS', row.ID, { Value: value, UpdatedAt: now });
  } else {
    addRow('SETTINGS', { ID: uuidv4(), Key: 'apiKeys', Value: value, UpdatedAt: now });
  }
}

// GET /api/settings/api-keys — list keys (never expose hash)
router.get('/api-keys', async (req, res) => {
  try {
    const keys = getApiKeys();
    res.json(keys.map(k => ({ id: k.id, name: k.name, prefix: k.prefix, createdAt: k.createdAt })));
  } catch (err) {
    console.error(`[settings] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/settings/api-keys — generate a new key
router.post('/api-keys', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });

    const raw = crypto.randomBytes(32).toString('hex'); // 64-char hex
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    const prefix = raw.slice(0, 8);

    const keys = getApiKeys();
    keys.push({ id: uuidv4(), name: name.trim(), hash, prefix, createdAt: new Date().toISOString() });
    saveApiKeys(keys);

    // Return full key once — caller must save it
    res.status(201).json({ key: raw, name: name.trim(), prefix });
  } catch (err) {
    console.error(`[settings] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/settings/api-keys/:id — revoke a key
router.delete('/api-keys/:id', async (req, res) => {
  try {
    const keys = getApiKeys();
    const idx = keys.findIndex(k => k.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'API key not found' });
    keys.splice(idx, 1);
    saveApiKeys(keys);
    res.json({ success: true });
  } catch (err) {
    console.error(`[settings] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
