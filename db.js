'use strict';

const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'brewery.db');

// ── Table definitions ─────────────────────────────────────────────────

const TABLES = {
  PRODUCTS:        'Products',
  INVENTORY:       'Inventory',
  ACCOUNTS:        'Accounts',
  OUTREACH:        'Outreach',
  REMINDERS:       'Reminders',
  STAFF:           'Staff',
  ORDERS:          'Orders',
  STOCK_MOVEMENTS: 'StockMovements',
  SETTINGS:        'Settings',
  KEG_TRACKING:    'KegTracking',
  TAP_HANDLES:     'TapHandles',
  EMAIL_LOG:       'EmailLog',
  ORDER_ITEMS:     'OrderItems',
  NOTIFICATIONS:   'Notifications',
};

// HEADERS defines every column each table should have.
// On startup, any missing columns are automatically added (migration-safe).
const HEADERS = {
  PRODUCTS:  ['ID', 'Name', 'Style', 'ABV', 'Format', 'PricePerUnit', 'Notes', 'CreatedAt'],
  INVENTORY: ['ID', 'Name', 'Location', 'Style', 'ABV', 'Format', 'Units', 'PricePerUnit', 'LowStockThreshold', 'Notes', 'LastUpdated', 'ProductID', 'ProductName'],
  ACCOUNTS:  ['ID', 'Name', 'Type', 'Tags', 'ContactName', 'Email', 'AdditionalEmails', 'Phone', 'PreferredMethod', 'BillingContactName', 'BillingEmail', 'BillingPhone', 'Address', 'City', 'State', 'Zip', 'ABCLicense', 'ChargeDeposits', 'Taxable', 'Status', 'Notes', 'LastContacted', 'StaffID', 'StaffName', 'QboCustomerId', 'CreatedAt'],
  OUTREACH:  ['ID', 'AccountID', 'AccountName', 'Date', 'Method', 'Notes', 'FollowUpDate', 'FollowUpStatus', 'CreatedAt'],
  REMINDERS: ['ID', 'Type', 'AccountID', 'AccountName', 'Title', 'DueDate', 'Priority', 'Notes', 'Completed', 'StaffID', 'StaffName', 'Recurrence', 'RecurrenceParentID', 'CreatedAt'],
  STAFF:     ['ID', 'Name', 'Email', 'Phone', 'Role', 'Active', 'Notes', 'CreatedAt'],
  ORDERS:          ['ID', 'AccountID', 'AccountName', 'Location', 'StaffID', 'StaffName', 'OrderDate', 'DeliveryDate', 'InvoiceNumber', 'OrderAmount', 'TaxAmount', 'DepositAmount', 'Notes', 'RequestedProducts', 'Status', 'Delivered', 'QboInvoiceId', 'QboSyncStatus', 'QboSyncError', 'CreatedAt'],
  STOCK_MOVEMENTS: ['ID', 'InventoryID', 'InventoryName', 'OrderID', 'Type', 'Quantity', 'Notes', 'Date', 'CreatedAt'],
  SETTINGS:        ['ID', 'Key', 'Value', 'UpdatedAt'],
  KEG_TRACKING:    ['ID', 'AccountID', 'AccountName', 'OrderID', 'InventoryID', 'ProductName', 'Format', 'Quantity', 'DepositPerUnit', 'DepositTotal', 'DepositRefunded', 'DeliveredDate', 'ReturnedDate', 'ReturnedQuantity', 'Notes', 'CreatedAt'],
  TAP_HANDLES:     ['ID', 'AccountID', 'AccountName', 'Quantity', 'DeployedDate', 'CollectedDate', 'CollectedQuantity', 'Notes', 'CreatedAt'],
  EMAIL_LOG:       ['ID', 'SenderName', 'SenderEmail', 'Recipients', 'Subject', 'Body', 'Type', 'AccountIDs', 'Status', 'Error', 'CreatedAt'],
  ORDER_ITEMS:     ['ID', 'OrderID', 'InventoryID', 'ProductName', 'Format', 'Quantity', 'UnitPrice', 'LineTotal', 'CreatedAt'],
  NOTIFICATIONS:   ['ID', 'Type', 'Channel', 'RecipientStaffID', 'RecipientName', 'RecipientEmail', 'SenderName', 'SenderEmail', 'EntityType', 'EntityID', 'EntityName', 'Message', 'Status', 'Error', 'CreatedAt'],
};

// ── Database connection ───────────────────────────────────────────────

let _db;

function getDb() {
  if (!_db) {
    const dir = path.dirname(DB_PATH);
    fs.mkdirSync(dir, { recursive: true });
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    // Foreign keys disabled: schema uses no FK constraints (all IDs are
    // application-managed TEXT columns with manual cascade deletes).
    _db.pragma('foreign_keys = OFF');
  }
  return _db;
}

// ── Initialization ────────────────────────────────────────────────────

function initializeDatabase() {
  const db = getDb();

  for (const [key, tableName] of Object.entries(TABLES)) {
    const columns = HEADERS[key];

    // Build column definitions — all TEXT, ID is PRIMARY KEY
    const colDefs = columns.map(col =>
      col === 'ID'
        ? '"ID" TEXT PRIMARY KEY'
        : `"${col}" TEXT DEFAULT ''`
    ).join(', ');

    db.exec(`CREATE TABLE IF NOT EXISTS "${tableName}" (${colDefs})`);

    // Migration-safe: add any new columns that don't exist yet
    const existingCols = db.pragma(`table_info("${tableName}")`).map(c => c.name);
    for (const col of columns) {
      if (!existingCols.includes(col)) {
        db.exec(`ALTER TABLE "${tableName}" ADD COLUMN "${col}" TEXT DEFAULT ''`);
        console.log(`  Migrated ${tableName}: added column ${col}`);
      }
    }
  }
}

// ── CRUD operations ───────────────────────────────────────────────────

function getAllRows(tableKey) {
  const db = getDb();
  const tableName = TABLES[tableKey];
  const columns = HEADERS[tableKey];

  const rows = db.prepare(`SELECT * FROM "${tableName}"`).all();

  // Convert all values to strings for consistent API responses
  return rows.map(row => {
    const obj = {};
    for (const col of columns) {
      obj[col] = row[col] != null ? String(row[col]) : '';
    }
    return obj;
  });
}

function addRow(tableKey, data) {
  const db = getDb();
  const tableName = TABLES[tableKey];
  const columns = HEADERS[tableKey];

  const presentCols = columns.filter(col => data[col] != null);
  const colNames    = presentCols.map(c => `"${c}"`).join(', ');
  const placeholders = presentCols.map(() => '?').join(', ');
  const values       = presentCols.map(col => String(data[col]));

  db.prepare(`INSERT INTO "${tableName}" (${colNames}) VALUES (${placeholders})`).run(...values);

  return data;
}

function updateRow(tableKey, id, updates) {
  const db = getDb();
  const tableName = TABLES[tableKey];
  const columns = HEADERS[tableKey];

  // Fetch existing row
  const existing = db.prepare(`SELECT * FROM "${tableName}" WHERE "ID" = ?`).get(id);
  if (!existing) throw new Error(`Record with ID ${id} not found`);

  // Merge updates into existing (all values as strings)
  const merged = {};
  for (const col of columns) {
    merged[col] = existing[col] != null ? String(existing[col]) : '';
  }
  for (const [key, val] of Object.entries(updates)) {
    if (columns.includes(key)) {
      merged[key] = val != null ? String(val) : '';
    }
  }

  // Build SET clause for all non-ID columns
  const setCols   = columns.filter(c => c !== 'ID');
  const setClause = setCols.map(c => `"${c}" = ?`).join(', ');
  const setValues = setCols.map(c => merged[c]);

  db.prepare(`UPDATE "${tableName}" SET ${setClause} WHERE "ID" = ?`).run(...setValues, id);

  return merged;
}

function getRow(tableKey, id) {
  const db = getDb();
  const tableName = TABLES[tableKey];
  const columns = HEADERS[tableKey];
  const row = db.prepare(`SELECT * FROM "${tableName}" WHERE "ID" = ?`).get(id);
  if (!row) return null;
  const obj = {};
  for (const col of columns) {
    obj[col] = row[col] != null ? String(row[col]) : '';
  }
  return obj;
}

function deleteRow(tableKey, id) {
  const db = getDb();
  const tableName = TABLES[tableKey];

  const existing = db.prepare(`SELECT "ID" FROM "${tableName}" WHERE "ID" = ?`).get(id);
  if (!existing) throw new Error(`Record with ID ${id} not found`);

  db.prepare(`DELETE FROM "${tableName}" WHERE "ID" = ?`).run(id);
  return true;
}

// ── Inventory → Products migration (one-time, idempotent) ─────────────

function migrateInventoryToProducts() {
  const { v4: uuidv4 } = require('uuid');
  const inventoryRows = getAllRows('INVENTORY');
  if (inventoryRows.length === 0) return;

  // Detect any inventory row that has a Name but no ProductID — covers both
  // the original old-style rows (with Style data) and orphaned rows created by
  // the pre-fix import flow (Style: '', ProductID: '').
  const needsMigration = inventoryRows.some(r => r.Name && !r.ProductID);
  if (!needsMigration) return;

  console.log('Migrating INVENTORY to PRODUCTS + per-location inventory...');

  // Extract unique products by compound key
  const productMap = new Map();
  for (const row of inventoryRows) {
    if (row.ProductID) continue; // already migrated
    const key = [row.Name || '', row.Style || '', row.ABV || '', row.Format || '', row.PricePerUnit || ''].join('|||');
    if (!productMap.has(key)) {
      productMap.set(key, {
        ID: uuidv4(),
        Name: row.Name || '',
        Style: row.Style || '',
        ABV: row.ABV || '',
        Format: row.Format || '',
        PricePerUnit: row.PricePerUnit || '',
        Notes: row.Notes || '',
        CreatedAt: new Date().toISOString(),
      });
    }
  }

  // Write products
  for (const product of productMap.values()) {
    addRow('PRODUCTS', product);
  }
  console.log(`  Created ${productMap.size} products`);

  // Update inventory rows with ProductID reference
  for (const row of inventoryRows) {
    if (row.ProductID) continue;
    const key = [row.Name || '', row.Style || '', row.ABV || '', row.Format || '', row.PricePerUnit || ''].join('|||');
    const product = productMap.get(key);
    if (product) {
      updateRow('INVENTORY', row.ID, {
        ProductID: product.ID,
        ProductName: product.Name,
      });
    }
  }
  console.log('  Updated inventory rows with ProductID references');
}

// ── Product Formats → Inventory migration (one-time, idempotent) ──────
// 1. Copies Format and PricePerUnit from each Product to its linked Inventory
//    rows (where the inventory row's own values are empty).
// 2. Merges products that share the same Name+Style+ABV into a single product,
//    re-pointing inventory rows from duplicates to the surviving product and
//    preserving each format as a variation on inventory rows.

function migrateProductFormatsToInventory() {
  const products = getAllRows('PRODUCTS');
  const inventory = getAllRows('INVENTORY');
  if (products.length === 0) return;

  // Phase 1: Copy Format/PricePerUnit from products down to inventory rows
  let copiedCount = 0;
  for (const inv of inventory) {
    if (!inv.ProductID) continue;
    const product = products.find(p => p.ID === inv.ProductID);
    if (!product) continue;

    const updates = {};
    if (!inv.Format && product.Format) updates.Format = product.Format;
    if (!inv.PricePerUnit && product.PricePerUnit) updates.PricePerUnit = product.PricePerUnit;

    if (Object.keys(updates).length > 0) {
      updateRow('INVENTORY', inv.ID, updates);
      copiedCount++;
    }
  }
  if (copiedCount > 0) {
    console.log(`  Migrated Format/PricePerUnit to ${copiedCount} inventory rows`);
  }

  // Phase 2: Merge same-name products into one, keeping formats as variations
  // Group products by Name only — variants of the same product may differ in
  // Style/ABV (one entry filled in, another not), so those aren't part of the key.
  const groups = new Map(); // key → [product, ...]
  for (const p of products) {
    const key = (p.Name || '').toLowerCase().trim();
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }

  let mergedProducts = 0;
  let deletedProducts = 0;
  for (const [, group] of groups) {
    if (group.length <= 1) continue; // nothing to merge

    // Pick survivor: prefer the one with the most data (Style+ABV filled), then earliest CreatedAt
    group.sort((a, b) => {
      const aScore = (a.Style ? 1 : 0) + (a.ABV ? 1 : 0);
      const bScore = (b.Style ? 1 : 0) + (b.ABV ? 1 : 0);
      if (bScore !== aScore) return bScore - aScore; // more data first
      return (a.CreatedAt || '').localeCompare(b.CreatedAt || '');
    });
    const survivor = group[0];
    const duplicates = group.slice(1);

    // Inherit any missing fields from duplicates into the survivor
    for (const dup of duplicates) {
      if (!survivor.Style && dup.Style) survivor.Style = dup.Style;
      if (!survivor.ABV && dup.ABV) survivor.ABV = dup.ABV;
      if (!survivor.Notes && dup.Notes) survivor.Notes = dup.Notes;
    }

    // Re-read inventory to get up-to-date state (Phase 1 may have updated it)
    const currentInventory = getAllRows('INVENTORY');

    for (const dup of duplicates) {
      // Find inventory rows pointing to the duplicate
      const dupInvRows = currentInventory.filter(i => i.ProductID === dup.ID);

      for (const inv of dupInvRows) {
        // Check if the survivor already has an inventory row at this location+format
        const fmt = inv.Format || dup.Format || '';
        const existingAtLoc = currentInventory.find(i =>
          i.ProductID === survivor.ID &&
          i.Location === inv.Location &&
          (i.Format || '') === fmt
        );

        if (existingAtLoc) {
          // Merge units into the existing row and delete the duplicate inventory row
          const mergedUnits = parseInt(existingAtLoc.Units || '0') + parseInt(inv.Units || '0');
          updateRow('INVENTORY', existingAtLoc.ID, { Units: String(mergedUnits) });
          deleteRow('INVENTORY', inv.ID);
        } else {
          // Re-point to the survivor product
          updateRow('INVENTORY', inv.ID, {
            ProductID: survivor.ID,
            ProductName: survivor.Name,
            Format: fmt,
            PricePerUnit: inv.PricePerUnit || dup.PricePerUnit || '',
          });
        }
      }

      // Delete the duplicate product row
      deleteRow('PRODUCTS', dup.ID);
      deletedProducts++;
    }

    // Update survivor: clear Format/PricePerUnit (they live on inventory now),
    // and persist any fields inherited from duplicates (Style, ABV, Notes)
    updateRow('PRODUCTS', survivor.ID, {
      Format: '',
      PricePerUnit: '',
      Style: survivor.Style || '',
      ABV: survivor.ABV || '',
      Notes: survivor.Notes || '',
    });

    mergedProducts++;
  }

  if (mergedProducts > 0) {
    console.log(`  Merged ${mergedProducts} product groups (deleted ${deletedProducts} duplicate product rows)`);
  }
}

module.exports = { initializeDatabase, migrateInventoryToProducts, migrateProductFormatsToInventory, getAllRows, getRow, addRow, updateRow, deleteRow, TABLES, HEADERS };
