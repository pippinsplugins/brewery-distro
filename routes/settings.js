'use strict';

const crypto = require('crypto');
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getAllRows, addRow, updateRow } = require('../db');

const router = express.Router();

// GET /api/settings — returns settings as a key-value map
router.get('/', async (req, res) => {
  try {
    const rows = await getAllRows('SETTINGS');
    const settings = {};
    for (const row of rows) {
      settings[row.Key] = row.Value;
    }
    // Strip sensitive data — flag presence before deleting
    const hasGeminiKey = !!settings.geminiApiKey;
    const hasWebhookToken = !!settings.inboundEmailWebhookToken;
    delete settings.qboTokens;
    delete settings.apiKeys;
    delete settings.geminiApiKey;
    delete settings.inboundEmailWebhookToken;
    if (hasGeminiKey) settings.geminiApiKeySet = true;
    if (hasWebhookToken) settings.inboundEmailWebhookTokenSet = true;
    // Parse JSON values
    if (settings.locations) {
      try { settings.locations = JSON.parse(settings.locations); }
      catch (e) { settings.locations = []; }
    }
    if (settings.accountTags) {
      try { settings.accountTags = JSON.parse(settings.accountTags); }
      catch (e) { settings.accountTags = []; }
    }
    if (settings.kegDeposits) {
      try { settings.kegDeposits = JSON.parse(settings.kegDeposits); }
      catch (e) { settings.kegDeposits = {}; }
    }
    res.json(settings);
  } catch (err) {
    console.error(`[settings] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

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
    for (const row of updated) {
      result[row.Key] = row.Value;
    }
    delete result.qboTokens;
    delete result.apiKeys;
    delete result.geminiApiKey;
    delete result.inboundEmailWebhookToken;
    if (result.locations) {
      try { result.locations = JSON.parse(result.locations); }
      catch (e) { result.locations = []; }
    }
    if (result.accountTags) {
      try { result.accountTags = JSON.parse(result.accountTags); }
      catch (e) { result.accountTags = []; }
    }
    if (result.kegDeposits) {
      try { result.kegDeposits = JSON.parse(result.kegDeposits); }
      catch (e) { result.kegDeposits = {}; }
    }
    res.json(result);
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
    delete result.qboTokens;
    if (result.locations) {
      try { result.locations = JSON.parse(result.locations); }
      catch (e) { result.locations = []; }
    }
    if (result.accountTags) {
      try { result.accountTags = JSON.parse(result.accountTags); }
      catch (e) { result.accountTags = []; }
    }
    result._renamed = { inventoryUpdated, ordersUpdated };
    res.json(result);
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
    delete result.qboTokens;
    if (result.locations) {
      try { result.locations = JSON.parse(result.locations); }
      catch (e) { result.locations = []; }
    }
    if (result.accountTags) {
      try { result.accountTags = JSON.parse(result.accountTags); }
      catch (e) { result.accountTags = []; }
    }
    result._renamed = { accountsUpdated };
    res.json(result);
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
