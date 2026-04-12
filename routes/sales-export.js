'use strict';

const express = require('express');
const { getAllRows } = require('../db');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { start, end, location } = req.query;
    if (!start || !end) return res.status(400).json({ error: 'start and end query params required' });

    let [orders, accounts] = await Promise.all([
      getAllRows('ORDERS'),
      getAllRows('ACCOUNTS'),
    ]);

    // Location filter
    if (location) {
      orders = orders.filter(o => o.Location === location);
    }

    // Date range + exclude Cancelled/Pre-Sale/Draft
    orders = orders.filter(o => {
      const d = (o.OrderDate || '').substring(0, 10);
      return d >= start && d <= end && o.Status !== 'Cancelled' && o.Status !== 'Pre-Sale' && o.Status !== 'Draft';
    });

    // Build account lookup
    const accountMap = Object.fromEntries(accounts.map(a => [a.ID, a]));

    // Build order rows with account info
    const rows = orders.map(o => {
      const acct = accountMap[o.AccountID] || {};
      const subtotal = parseFloat(o.OrderAmount || 0);
      const tax = parseFloat(o.TaxAmount || 0);
      return {
        orderDate: (o.OrderDate || '').substring(0, 10),
        invoiceNumber: o.InvoiceNumber || '',
        accountName: o.AccountName || acct.Name || '',
        abcLicense: acct.ABCLicense || '',
        address: acct.Address || '',
        city: acct.City || '',
        state: acct.State || '',
        zip: acct.Zip || '',
        subtotal,
        tax,
        total: subtotal + tax,
      };
    });

    // Sort by date ascending
    rows.sort((a, b) => a.orderDate.localeCompare(b.orderDate));

    // Totals
    const totals = rows.reduce((t, r) => {
      t.subtotal += r.subtotal;
      t.tax += r.tax;
      t.total += r.total;
      return t;
    }, { subtotal: 0, tax: 0, total: 0 });

    res.json({ orders: rows, totals, count: rows.length });
  } catch (err) {
    console.error(`[sales-export] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
