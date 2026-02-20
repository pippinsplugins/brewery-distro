'use strict';

const express = require('express');
const path = require('path');
require('dotenv').config();

const { initializeSheets } = require('./sheets');
const inventoryRoutes = require('./routes/inventory');
const accountsRoutes  = require('./routes/accounts');
const outreachRoutes  = require('./routes/outreach');
const remindersRoutes = require('./routes/reminders');
const staffRoutes     = require('./routes/staff');
const salesRoutes     = require('./routes/sales');
const dashboardRoutes = require('./routes/dashboard');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/inventory', inventoryRoutes);
app.use('/api/accounts',  accountsRoutes);
app.use('/api/outreach',  outreachRoutes);
app.use('/api/reminders', remindersRoutes);
app.use('/api/staff',     staffRoutes);
app.use('/api/sales',     salesRoutes);
app.use('/api/dashboard', dashboardRoutes);

app.get('/api/status', (req, res) => {
  res.json({
    configured: !!(process.env.SPREADSHEET_ID && (process.env.GOOGLE_KEY_FILE || process.env.GOOGLE_SERVICE_ACCOUNT_KEY)),
    spreadsheetId: process.env.SPREADSHEET_ID || null,
  });
});

// SPA catch-all
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function start() {
  try {
    console.log('Connecting to Google Sheets...');
    await initializeSheets();
    console.log('Google Sheets initialized successfully.');
    app.listen(PORT, () => {
      console.log(`Brewery Distribution app running at http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Startup error:', err.message);
    console.error('Starting server anyway — check /api/status for configuration help.');
    app.listen(PORT, () => {
      console.log(`Server running (degraded) at http://localhost:${PORT}`);
    });
  }
}

start();
