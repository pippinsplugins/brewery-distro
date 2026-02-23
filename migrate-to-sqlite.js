#!/usr/bin/env node
'use strict';

/**
 * One-time migration: Google Sheets → SQLite
 *
 * Usage:  node migrate-to-sqlite.js
 *
 * Prerequisites:
 *   - .env must still have SPREADSHEET_ID and Google credentials configured
 *   - npm install must have been run (needs googleapis + better-sqlite3)
 *
 * This script:
 *   1. Connects to Google Sheets using the original sheets module
 *   2. Reads all rows from every table
 *   3. Creates the SQLite database and tables
 *   4. Inserts all rows into SQLite
 *   5. Prints a summary
 *
 * Safe to re-run — uses INSERT OR REPLACE so existing rows are overwritten.
 */

require('dotenv').config();

const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

// Import from the original Google Sheets module.
// Try sheets.js.bak first (if already renamed), then fall back to sheets.js.
let sheetsModule;
try {
  sheetsModule = require('./sheets.js.bak');
} catch (_) {
  sheetsModule = require('./sheets');
}
const { initializeSheets: initSheets, getAllRows: getSheetsRows, SHEETS, HEADERS } = sheetsModule;

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'brewery.db');

async function migrate() {
  console.log('=== Google Sheets → SQLite Migration ===\n');

  // ── Step 1: Connect to Google Sheets ─────────────────────────────
  console.log('Connecting to Google Sheets...');
  await initSheets();
  console.log('Connected.\n');

  // ── Step 2: Read all data ────────────────────────────────────────
  console.log('Reading data from Google Sheets...');
  const allData = {};
  for (const key of Object.keys(SHEETS)) {
    const rows = await getSheetsRows(key);
    allData[key] = rows;
    console.log(`  ${SHEETS[key]}: ${rows.length} rows`);
  }

  const totalRows = Object.values(allData).reduce((sum, rows) => sum + rows.length, 0);
  console.log(`\nTotal: ${totalRows} rows across ${Object.keys(SHEETS).length} tables.\n`);

  // ── Step 3: Create SQLite database ───────────────────────────────
  const dir = path.dirname(DB_PATH);
  fs.mkdirSync(dir, { recursive: true });

  // Back up existing DB file if present
  if (fs.existsSync(DB_PATH)) {
    const backup = DB_PATH + '.bak.' + Date.now();
    fs.copyFileSync(DB_PATH, backup);
    console.log(`Backed up existing DB to ${path.basename(backup)}`);
  }

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  // ── Step 4: Create tables and insert data ────────────────────────
  console.log('Creating SQLite tables and inserting data...');

  for (const [key, tableName] of Object.entries(SHEETS)) {
    const columns = HEADERS[key];

    // Create table
    const colDefs = columns.map(col =>
      col === 'ID'
        ? '"ID" TEXT PRIMARY KEY'
        : `"${col}" TEXT DEFAULT ''`
    ).join(', ');
    db.exec(`CREATE TABLE IF NOT EXISTS "${tableName}" (${colDefs})`);

    // Insert rows using a transaction for performance
    const rows = allData[key];
    if (rows.length > 0) {
      const colNames     = columns.map(c => `"${c}"`).join(', ');
      const placeholders = columns.map(() => '?').join(', ');
      const insert = db.prepare(
        `INSERT OR REPLACE INTO "${tableName}" (${colNames}) VALUES (${placeholders})`
      );

      const insertMany = db.transaction((rows) => {
        for (const row of rows) {
          const values = columns.map(col => row[col] != null ? String(row[col]) : '');
          insert.run(...values);
        }
      });

      insertMany(rows);
      console.log(`  ${tableName}: ${rows.length} rows inserted`);
    } else {
      console.log(`  ${tableName}: empty (table created)`);
    }
  }

  db.close();

  // ── Done ─────────────────────────────────────────────────────────
  console.log(`\nMigration complete! Database: ${DB_PATH}`);
  console.log(`\nNext steps:`);
  console.log(`  1. mv sheets.js sheets.js.bak`);
  console.log(`  2. mv db.js sheets.js`);
  console.log(`  3. Restart the server`);
}

migrate().catch(err => {
  console.error('\nMigration failed:', err.message);
  process.exit(1);
});
