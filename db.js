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
};

// HEADERS defines every column each table should have.
// On startup, any missing columns are automatically added (migration-safe).
const HEADERS = {
  PRODUCTS:  ['ID', 'Name', 'Style', 'ABV', 'Format', 'PricePerUnit', 'Notes', 'CreatedAt'],
  INVENTORY: ['ID', 'Name', 'Location', 'Style', 'ABV', 'Format', 'Units', 'PricePerUnit', 'LowStockThreshold', 'Notes', 'LastUpdated', 'ProductID', 'ProductName'],
  ACCOUNTS:  ['ID', 'Name', 'Type', 'Tags', 'ContactName', 'Email', 'AdditionalEmails', 'Phone', 'PreferredMethod', 'Address', 'City', 'State', 'Zip', 'ABCLicense', 'ChargeDeposits', 'Status', 'Notes', 'LastContacted', 'StaffID', 'StaffName', 'CreatedAt'],
  OUTREACH:  ['ID', 'AccountID', 'AccountName', 'Date', 'Method', 'Notes', 'FollowUpDate', 'FollowUpStatus', 'CreatedAt'],
  REMINDERS: ['ID', 'Type', 'AccountID', 'AccountName', 'Title', 'DueDate', 'Priority', 'Notes', 'Completed', 'StaffID', 'StaffName', 'Recurrence', 'RecurrenceParentID', 'CreatedAt'],
  STAFF:     ['ID', 'Name', 'Email', 'Phone', 'Role', 'Active', 'Notes', 'CreatedAt'],
  ORDERS:          ['ID', 'AccountID', 'AccountName', 'Location', 'StaffID', 'StaffName', 'OrderDate', 'DeliveryDate', 'InvoiceNumber', 'OrderAmount', 'TaxAmount', 'DepositAmount', 'Notes', 'RequestedProducts', 'Status', 'Delivered', 'CreatedAt'],
  STOCK_MOVEMENTS: ['ID', 'InventoryID', 'InventoryName', 'OrderID', 'Type', 'Quantity', 'Notes', 'Date', 'CreatedAt'],
  SETTINGS:        ['ID', 'Key', 'Value', 'UpdatedAt'],
  KEG_TRACKING:    ['ID', 'AccountID', 'AccountName', 'OrderID', 'InventoryID', 'ProductName', 'Format', 'Quantity', 'DepositPerUnit', 'DepositTotal', 'DepositRefunded', 'DeliveredDate', 'ReturnedDate', 'ReturnedQuantity', 'Notes', 'CreatedAt'],
  TAP_HANDLES:     ['ID', 'AccountID', 'AccountName', 'Quantity', 'DeployedDate', 'CollectedDate', 'CollectedQuantity', 'Notes', 'CreatedAt'],
  EMAIL_LOG:       ['ID', 'SenderName', 'SenderEmail', 'Recipients', 'Subject', 'Body', 'Type', 'AccountIDs', 'Status', 'Error', 'CreatedAt'],
  ORDER_ITEMS:     ['ID', 'OrderID', 'InventoryID', 'ProductName', 'Format', 'Quantity', 'UnitPrice', 'LineTotal', 'CreatedAt'],
};

// ── Database connection ───────────────────────────────────────────────

let _db;

function getDb() {
  if (!_db) {
    const dir = path.dirname(DB_PATH);
    fs.mkdirSync(dir, { recursive: true });
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
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

  // Detect old format: has Style data but no ProductID
  const needsMigration = inventoryRows.some(r => r.Style && !r.ProductID);
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

module.exports = { initializeDatabase, migrateInventoryToProducts, getAllRows, addRow, updateRow, deleteRow, TABLES, HEADERS };
