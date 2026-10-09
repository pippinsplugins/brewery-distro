'use strict';

// Product Buyers report — accounts that purchased one or more selected
// products (optionally narrowed by format, date range, and location).
// Pre-Sale / Cancelled / Draft orders are excluded by convention (matches
// Reports, Gallonage, Sales Export). Groups by billing AccountID; end-
// customer handling intentionally out of scope for v1.

const express = require('express');
const { getAllRows } = require('../db');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { start, end, location } = req.query;
    const productNames = (req.query.productNames || '').split(',').map(s => s.trim()).filter(Boolean);
    const formats     = (req.query.formats     || '').split(',').map(s => s.trim()).filter(Boolean);

    if (productNames.length === 0) {
      return res.status(400).json({ error: 'productNames query param is required' });
    }

    const [orders, orderItems, accounts] = await Promise.all([
      getAllRows('ORDERS'),
      getAllRows('ORDER_ITEMS'),
      getAllRows('ACCOUNTS'),
    ]);

    // Filter orders: exclude Cancelled / Pre-Sale / Draft, apply location
    // and date range if present. Build an id-set so the subsequent order-
    // items filter is a cheap lookup instead of a nested scan.
    let filteredOrders = orders.filter(o =>
      o.Status !== 'Cancelled' && o.Status !== 'Pre-Sale' && o.Status !== 'Draft'
    );
    if (location) filteredOrders = filteredOrders.filter(o => o.Location === location);
    if (start) filteredOrders = filteredOrders.filter(o => (o.OrderDate || '').substring(0, 10) >= start);
    if (end)   filteredOrders = filteredOrders.filter(o => (o.OrderDate || '').substring(0, 10) <= end);

    const orderMap = Object.fromEntries(filteredOrders.map(o => [o.ID, o]));
    const orderIds = new Set(filteredOrders.map(o => o.ID));
    const productNameSet = new Set(productNames);
    const formatSet = formats.length ? new Set(formats) : null;

    const matchingItems = orderItems.filter(i =>
      orderIds.has(i.OrderID) &&
      productNameSet.has(i.ProductName) &&
      (!formatSet || formatSet.has(i.Format || ''))
    );

    // Group by AccountID. Within each account, break down by product+format
    // so the UI can render a per-product qty summary.
    const accountMap = Object.fromEntries(accounts.map(a => [a.ID, a]));
    const buyers = {};
    for (const item of matchingItems) {
      const order = orderMap[item.OrderID];
      if (!order) continue;
      const aid = order.AccountID || '';
      if (!aid) continue;
      if (!buyers[aid]) {
        const acct = accountMap[aid] || {};
        buyers[aid] = {
          accountId: aid,
          accountName: order.AccountName || acct.Name || '',
          contactName: acct.ContactName || '',
          email: acct.Email || '',
          billingEmail: acct.BillingEmail || '',
          phone: acct.Phone || '',
          totalUnits: 0,
          orderIds: new Set(),
          firstPurchase: '',
          lastPurchase: '',
          products: {},
        };
      }
      const b = buyers[aid];
      const qty = parseInt(item.Quantity || '0');
      b.totalUnits += qty;
      b.orderIds.add(item.OrderID);
      const pKey = `${item.ProductName}|||${item.Format || ''}`;
      if (!b.products[pKey]) {
        b.products[pKey] = { productName: item.ProductName, format: item.Format || '', qty: 0 };
      }
      b.products[pKey].qty += qty;
      const d = (order.OrderDate || '').substring(0, 10);
      if (!b.firstPurchase || d < b.firstPurchase) b.firstPurchase = d;
      if (!b.lastPurchase  || d > b.lastPurchase)  b.lastPurchase  = d;
    }

    const buyersList = Object.values(buyers).map(b => ({
      ...b,
      orderCount: b.orderIds.size,
      orderIds: undefined,
      products: Object.values(b.products).sort((a, b) => b.qty - a.qty),
    })).sort((a, b) => b.totalUnits - a.totalUnits);

    const totalUnits = buyersList.reduce((s, b) => s + b.totalUnits, 0);
    const totalOrders = new Set(matchingItems.map(i => i.OrderID)).size;

    res.json({
      buyers: buyersList,
      totals: {
        accountCount: buyersList.length,
        orderCount: totalOrders,
        totalUnits,
      },
    });
  } catch (err) {
    console.error(`[product-buyers] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
