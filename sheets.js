'use strict';

const { google } = require('googleapis');
require('dotenv').config();

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

const SHEETS = {
  INVENTORY: 'Inventory',
  ACCOUNTS: 'Accounts',
  OUTREACH: 'Outreach',
  REMINDERS: 'Reminders',
};

const HEADERS = {
  INVENTORY: ['ID', 'Name', 'Style', 'ABV', 'Format', 'Units', 'PricePerUnit', 'LowStockThreshold', 'Notes', 'LastUpdated'],
  ACCOUNTS: ['ID', 'Name', 'Type', 'ContactName', 'Email', 'Phone', 'PreferredMethod', 'Address', 'City', 'State', 'Status', 'Notes', 'LastContacted', 'CreatedAt'],
  OUTREACH: ['ID', 'AccountID', 'AccountName', 'Date', 'Method', 'Notes', 'FollowUpDate', 'FollowUpStatus', 'CreatedAt'],
  REMINDERS: ['ID', 'Type', 'AccountID', 'AccountName', 'Title', 'DueDate', 'Priority', 'Notes', 'Completed', 'CreatedAt'],
};

// Cache sheet numeric IDs after first fetch to minimize API calls for deletions
const sheetIdCache = {};

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

  // Write headers if the sheet is empty
  for (const [key, sheetName] of Object.entries(SHEETS)) {
    const res = await client.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1:1`,
    });
    const firstRow = (res.data.values || [[]])[0] || [];
    if (firstRow.length === 0) {
      await client.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetName}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [HEADERS[key]] },
      });
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
  const headers = HEADERS[sheetKey];
  const row = objectToRow(data, headers);

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
  const headers = HEADERS[sheetKey];
  const rows = await getRawRows(sheetName);

  if (rows.length < 2) throw new Error('Record not found');

  // rows[0] is headers; data starts at rows[1] (sheet row 2)
  const dataIndex = rows.findIndex((row, i) => i > 0 && row[0] === id);
  if (dataIndex === -1) throw new Error(`Record with ID ${id} not found`);

  const existing = {};
  rows[0].forEach((h, i) => { existing[h] = rows[dataIndex][i] || ''; });
  const updated = { ...existing, ...updates };
  const newRow = objectToRow(updated, headers);

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
