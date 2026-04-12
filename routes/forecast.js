'use strict';

const express = require('express');
const { getAllRows } = require('../db');

const router = express.Router();

function bucketKey(dateStr, granularity) {
  if (!dateStr) return '';
  const d = dateStr.substring(0, 10);
  if (granularity === 'day') return d;
  if (granularity === 'month') return d.substring(0, 7);
  // week: ISO week
  const dt = new Date(d + 'T00:00:00');
  const jan1 = new Date(dt.getFullYear(), 0, 1);
  const dayOfYear = Math.floor((dt - jan1) / 86400000) + 1;
  const weekNum = Math.ceil((dayOfYear + jan1.getDay()) / 7);
  return `${dt.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

router.get('/', async (req, res) => {
  try {
    const { start, end, location } = req.query;
    if (!start || !end) return res.status(400).json({ error: 'start and end query params required' });

    let [orders, orderItems, productRows] = await Promise.all([
      getAllRows('ORDERS'),
      getAllRows('ORDER_ITEMS'),
      getAllRows('PRODUCTS'),
    ]);

    // Location filter
    if (location) {
      orders = orders.filter(o => o.Location === location);
    }

    // Determine granularity based on date range span
    const startDate = new Date(start + 'T00:00:00');
    const endDate = new Date(end + 'T00:00:00');
    const daySpan = Math.round((endDate - startDate) / 86400000) + 1;
    const granularity = daySpan <= 31 ? 'day' : daySpan <= 90 ? 'week' : 'month';

    // Filter orders by date range, exclude Cancelled/Pre-Sale/Draft
    const salesOrders = orders.filter(o => {
      const d = (o.OrderDate || '').substring(0, 10);
      if (d < start || d > end) return false;
      if (o.Status === 'Cancelled' || o.Status === 'Pre-Sale' || o.Status === 'Draft') return false;
      return true;
    });

    const salesOrderIds = new Set(salesOrders.map(o => o.ID));
    const productNames = new Set(productRows.map(p => p.Name));
    const salesItems = orderItems.filter(i => salesOrderIds.has(i.OrderID) && productNames.has(i.ProductName));

    // Compute weeks and months in the period
    const weeks = Math.max(1, daySpan / 7);
    const months = Math.max(1, daySpan / 30.44);

    // Group items by ProductName + Format
    const productAgg = {};
    // Also build per-product trend buckets
    const allBuckets = new Set();

    // Build order date lookup
    const orderDateMap = {};
    for (const o of salesOrders) {
      orderDateMap[o.ID] = (o.OrderDate || '').substring(0, 10);
    }

    for (const item of salesItems) {
      const key = `${item.ProductName || ''}|||${item.Format || ''}`;
      const qty = parseInt(item.Quantity || 0);

      if (!productAgg[key]) {
        productAgg[key] = {
          productName: item.ProductName || '',
          format: item.Format || '',
          totalQty: 0,
          trend: {},
        };
      }

      const a = productAgg[key];
      a.totalQty += qty;

      // Trend bucketing
      const orderDate = orderDateMap[item.OrderID];
      if (orderDate) {
        const bk = bucketKey(orderDate, granularity);
        allBuckets.add(bk);
        if (!a.trend[bk]) a.trend[bk] = 0;
        a.trend[bk] += qty;
      }
    }

    // Sort buckets
    const sortedBuckets = [...allBuckets].sort();

    // Build product results
    let totalQty = 0;
    const products = Object.values(productAgg).map(p => {
      totalQty += p.totalQty;
      return {
        productName: p.productName,
        format: p.format,
        totalQty: p.totalQty,
        avgPerWeek: Math.round((p.totalQty / weeks) * 100) / 100,
        avgPerMonth: Math.round((p.totalQty / months) * 100) / 100,
        trend: sortedBuckets.map(bk => ({ period: bk, qty: p.trend[bk] || 0 })),
      };
    });

    // Sort by totalQty descending
    products.sort((a, b) => b.totalQty - a.totalQty);

    res.json({
      products,
      totals: {
        totalQty,
        avgPerWeek: Math.round((totalQty / weeks) * 100) / 100,
        avgPerMonth: Math.round((totalQty / months) * 100) / 100,
      },
      meta: {
        weeks: Math.round(weeks * 100) / 100,
        months: Math.round(months * 100) / 100,
        granularity,
        buckets: sortedBuckets,
      },
    });
  } catch (err) {
    console.error(`[forecast] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
