'use strict';

const express = require('express');
const { getAllRows } = require('../db');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { start, end, location, excludeTypes } = req.query;
    if (!start || !end) return res.status(400).json({ error: 'start and end query params required' });

    let [orders, accounts, refunds] = await Promise.all([
      getAllRows('ORDERS'),
      getAllRows('ACCOUNTS'),
      getAllRows('REFUNDS'),
    ]);

    // Location filter — refunds inherit their order's location so we
    // filter refunds through the order map after the orders themselves
    // have been narrowed.
    const orderLocationBeforeFilter = Object.fromEntries(orders.map(o => [o.ID, o.Location || '']));
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

    // Exclude account types
    if (excludeTypes) {
      const excluded = new Set(excludeTypes.split(',').map(s => s.trim()).filter(Boolean));
      orders = orders.filter(o => {
        const acct = accountMap[o.AccountID];
        return !acct || !excluded.has(acct.Type);
      });
    }

    // Available account types for filter UI
    const availableTypes = [...new Set(accounts.map(a => a.Type).filter(Boolean))].sort();

    // Build order rows with account info
    const rows = orders.map(o => {
      const acct = accountMap[o.AccountID] || {};
      const subtotal = parseFloat(o.OrderAmount || 0);
      const tax = parseFloat(o.TaxAmount || 0);
      return {
        type: 'Sale',
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

    // Refund rows — attributed by RefundDate. Emitted as negative amounts
    // so downstream spreadsheet totals net correctly. Filtered by the
    // same location and account-type exclusions as the sale rows.
    const excludedTypeSet = excludeTypes
      ? new Set(excludeTypes.split(',').map(s => s.trim()).filter(Boolean))
      : null;
    const orderMap = Object.fromEntries((await getAllRows('ORDERS')).map(o => [o.ID, o]));
    for (const r of refunds) {
      const rDate = (r.RefundDate || '').substring(0, 10);
      if (rDate < start || rDate > end) continue;
      if (location && orderLocationBeforeFilter[r.OrderID] !== location) continue;
      const acct = accountMap[r.AccountID] || {};
      if (excludedTypeSet && acct.Type && excludedTypeSet.has(acct.Type)) continue;
      const relatedOrder = orderMap[r.OrderID] || {};
      const rSub = parseFloat(r.Amount || 0);
      const rTax = parseFloat(r.TaxAmount || 0);
      rows.push({
        type: 'Refund',
        orderDate: rDate,
        invoiceNumber: relatedOrder.InvoiceNumber || '',
        accountName: r.AccountName || acct.Name || '',
        abcLicense: acct.ABCLicense || '',
        address: acct.Address || '',
        city: acct.City || '',
        state: acct.State || '',
        zip: acct.Zip || '',
        subtotal: -rSub,
        tax: -rTax,
        total: -(rSub + rTax),
      });
    }

    // Sort by date ascending
    rows.sort((a, b) => a.orderDate.localeCompare(b.orderDate));

    // Totals (net — refunds already carry negative sign)
    const totals = rows.reduce((t, r) => {
      t.subtotal += r.subtotal;
      t.tax += r.tax;
      t.total += r.total;
      return t;
    }, { subtotal: 0, tax: 0, total: 0 });

    res.json({ orders: rows, totals, count: rows.length, meta: { availableTypes } });
  } catch (err) {
    console.error(`[sales-export] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
