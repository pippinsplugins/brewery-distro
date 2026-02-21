'use strict';

const { google } = require('googleapis');
require('dotenv').config();

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

const SHEETS = {
  INVENTORY: 'Inventory',
  ACCOUNTS:  'Accounts',
  OUTREACH:  'Outreach',
  REMINDERS: 'Reminders',
  STAFF:     'Staff',
  ORDERS:    'Orders',
};

// HEADERS defines every column each sheet should have.
// On startup, any missing columns are automatically appended (migration-safe).
const HEADERS = {
  INVENTORY: ['ID', 'Name', 'Style', 'ABV', 'Format', 'Units', 'PricePerUnit', 'LowStockThreshold', 'Notes', 'LastUpdated'],
  ACCOUNTS:  ['ID', 'Name', 'Type', 'ContactName', 'Email', 'Phone', 'PreferredMethod', 'Address', 'City', 'State', 'Status', 'Notes', 'LastContacted', 'StaffID', 'StaffName', 'CreatedAt'],
  OUTREACH:  ['ID', 'AccountID', 'AccountName', 'Date', 'Method', 'Notes', 'FollowUpDate', 'FollowUpStatus', 'CreatedAt'],
  REMINDERS: ['ID', 'Type', 'AccountID', 'AccountName', 'Title', 'DueDate', 'Priority', 'Notes', 'Completed', 'StaffID', 'StaffName', 'Recurrence', 'RecurrenceParentID', 'CreatedAt'],
  STAFF:     ['ID', 'Name', 'Email', 'Phone', 'Role', 'Active', 'Notes', 'CreatedAt'],
  ORDERS:    ['ID', 'AccountID', 'AccountName', 'StaffID', 'StaffName', 'OrderDate', 'DeliveryDate', 'InvoiceNumber', 'OrderAmount', 'TaxAmount', 'Notes', 'Status', 'Delivered', 'CreatedAt'],
};

// Cached sheet header rows — avoids an extra API call on every write
const headerCache = {};

// Cached numeric sheet IDs needed for row deletion batchUpdate
const sheetIdCache = {};

// Convert 0-based column index to spreadsheet letter (0→A, 25→Z, 26→AA…)
function indexToCol(i) {
  let col = '';
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    col = String.fromCharCode(65 + r) + col;
    n = Math.floor((n - 1) / 26);
  }
  return col;
}

async function getSheetHeaders(sheetName, forceRefresh = false) {
  if (!forceRefresh && headerCache[sheetName]) return headerCache[sheetName];
  const client = await getClient();
  const res = await client.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A1:1`,
  });
  const headers = (res.data.values || [[]])[0] || [];
  headerCache[sheetName] = headers;
  return headers;
}

async function getAuth() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    return new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  }
  return new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_KEY_FILE || 'credentials.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

async function getClient() {
  const auth = await getAuth();
  return google.sheets({ version: 'v4', auth });
}

async function getSpreadsheetSheets() {
  const client = await getClient();
  const res = await client.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  for (const sheet of res.data.sheets) {
    sheetIdCache[sheet.properties.title] = sheet.properties.sheetId;
  }
  return res.data.sheets.map(s => s.properties.title);
}

async function initializeSheets() {
  if (!SPREADSHEET_ID) {
    throw new Error('SPREADSHEET_ID is not set in environment variables.');
  }

  const client = await getClient();
  const existingSheets = await getSpreadsheetSheets();
  const toCreate = Object.values(SHEETS).filter(name => !existingSheets.includes(name));

  if (toCreate.length > 0) {
    await client.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: toCreate.map(title => ({ addSheet: { properties: { title } } })),
      },
    });
    // Refresh cache after creating new sheets
    await getSpreadsheetSheets();
  }

  // Write or migrate headers for every sheet
  for (const [key, sheetName] of Object.entries(SHEETS)) {
    const existing = await getSheetHeaders(sheetName, true);
    const expected = HEADERS[key];

    if (existing.length === 0) {
      // Brand-new or empty sheet — write full header row
      await client.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetName}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [expected] },
      });
      headerCache[sheetName] = expected;
    } else {
      // Existing sheet — append any new columns that aren't present yet
      const missing = expected.filter(h => !existing.includes(h));
      if (missing.length > 0) {
        const startCol = indexToCol(existing.length);
        await client.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${sheetName}!${startCol}1`,
          valueInputOption: 'RAW',
          requestBody: { values: [missing] },
        });
        headerCache[sheetName] = [...existing, ...missing];
        console.log(`  Migrated ${sheetName}: added columns [${missing.join(', ')}]`);
      }
    }
  }
}

async function getRawRows(sheetName) {
  const client = await getClient();
  const res = await client.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A:Z`,
  });
  return res.data.values || [];
}

function rowsToObjects(rows) {
  if (!rows || rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1)
    .filter(row => row.some(cell => cell !== '' && cell !== undefined))
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = row[i] !== undefined ? String(row[i]) : '';
      });
      return obj;
    });
}

function objectToRow(obj, headers) {
  return headers.map(h => (obj[h] !== undefined && obj[h] !== null) ? String(obj[h]) : '');
}

async function getAllRows(sheetKey) {
  const rows = await getRawRows(SHEETS[sheetKey]);
  return rowsToObjects(rows);
}

async function addRow(sheetKey, data) {
  const client = await getClient();
  const sheetName = SHEETS[sheetKey];
  // Always use the actual sheet header order so columns align correctly
  const headers = await getSheetHeaders(sheetName);
  const row = headers.map(h => (data[h] != null) ? String(data[h]) : '');

  await client.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A:A`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });

  return data;
}

async function updateRow(sheetKey, id, updates) {
  const client = await getClient();
  const sheetName = SHEETS[sheetKey];
  const rows = await getRawRows(sheetName);

  if (rows.length < 2) throw new Error('Record not found');

  // Use the sheet's own first row as the authoritative column order
  const sheetHeaders = rows[0];
  const dataIndex = rows.findIndex((row, i) => i > 0 && row[0] === id);
  if (dataIndex === -1) throw new Error(`Record with ID ${id} not found`);

  const existing = {};
  sheetHeaders.forEach((h, i) => { existing[h] = rows[dataIndex][i] || ''; });
  const updated = { ...existing, ...updates };
  const newRow = sheetHeaders.map(h => (updated[h] != null) ? String(updated[h]) : '');

  const sheetRow = dataIndex + 1; // 1-indexed sheet row
  await client.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A${sheetRow}`,
    valueInputOption: 'RAW',
    requestBody: { values: [newRow] },
  });

  return updated;
}

async function deleteRow(sheetKey, id) {
  const client = await getClient();
  const sheetName = SHEETS[sheetKey];
  const rows = await getRawRows(sheetName);

  const dataIndex = rows.findIndex((row, i) => i > 0 && row[0] === id);
  if (dataIndex === -1) throw new Error(`Record with ID ${id} not found`);

  // Get numeric sheet ID from cache or fetch it
  if (!sheetIdCache[sheetName]) {
    await getSpreadsheetSheets();
  }
  const sheetId = sheetIdCache[sheetName];

  await client.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId,
            dimension: 'ROWS',
            startIndex: dataIndex,     // 0-indexed
            endIndex: dataIndex + 1,
          },
        },
      }],
    },
  });

  return true;
}

module.exports = { initializeSheets, getAllRows, addRow, updateRow, deleteRow, SHEETS, HEADERS };
