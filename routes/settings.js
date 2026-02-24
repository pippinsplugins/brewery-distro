'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getAllRows, addRow, updateRow } = require('../sheets');

const router = express.Router();

// GET /api/settings — returns settings as a key-value map
router.get('/', async (req, res) => {
  try {
    const rows = await getAllRows('SETTINGS');
    const settings = {};
    for (const row of rows) {
      settings[row.Key] = row.Value;
    }
    // Parse JSON values
    if (settings.locations) {
      try { settings.locations = JSON.parse(settings.locations); }
      catch (e) { settings.locations = []; }
    }
    if (settings.accountTypes) {
      try { settings.accountTypes = JSON.parse(settings.accountTypes); }
      catch (e) { settings.accountTypes = []; }
    }
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    if (result.locations) {
      try { result.locations = JSON.parse(result.locations); }
      catch (e) { result.locations = []; }
    }
    if (result.accountTypes) {
      try { result.accountTypes = JSON.parse(result.accountTypes); }
      catch (e) { result.accountTypes = []; }
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    if (result.locations) {
      try { result.locations = JSON.parse(result.locations); }
      catch (e) { result.locations = []; }
    }
    if (result.accountTypes) {
      try { result.accountTypes = JSON.parse(result.accountTypes); }
      catch (e) { result.accountTypes = []; }
    }
    result._renamed = { inventoryUpdated, ordersUpdated };
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/settings/rename-account-type — renames an account type and updates all associated records
router.put('/rename-account-type', async (req, res) => {
  try {
    const { oldName, newName, accountTypes } = req.body;
    if (!oldName || !newName) return res.status(400).json({ error: 'oldName and newName are required' });

    // Update the account types list in settings
    const settingsRows = await getAllRows('SETTINGS');
    const existingByKey = {};
    for (const row of settingsRows) existingByKey[row.Key] = row;
    const typesValue = JSON.stringify(accountTypes);
    const now = new Date().toISOString().split('T')[0];
    if (existingByKey.accountTypes) {
      await updateRow('SETTINGS', existingByKey.accountTypes.ID, { Value: typesValue, UpdatedAt: now });
    } else {
      await addRow('SETTINGS', { ID: uuidv4(), Key: 'accountTypes', Value: typesValue, UpdatedAt: now });
    }

    // Update all account records with the old type
    const accounts = await getAllRows('ACCOUNTS');
    let accountsUpdated = 0;
    for (const acct of accounts) {
      if (acct.Type === oldName) {
        await updateRow('ACCOUNTS', acct.ID, { Type: newName });
        accountsUpdated++;
      }
    }

    // Return updated settings
    const updated = await getAllRows('SETTINGS');
    const result = {};
    for (const row of updated) result[row.Key] = row.Value;
    if (result.locations) {
      try { result.locations = JSON.parse(result.locations); }
      catch (e) { result.locations = []; }
    }
    if (result.accountTypes) {
      try { result.accountTypes = JSON.parse(result.accountTypes); }
      catch (e) { result.accountTypes = []; }
    }
    result._renamed = { accountsUpdated };
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
