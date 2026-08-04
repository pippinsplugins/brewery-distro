'use strict';

// Pre-Sale Demand report — per-SKU aggregation of every open (non-cancelled,
// undelivered) pre-sale. Complements the historical Forecast report by
// showing actual future commitments instead of projected demand from past
// sales. Grouped by ProductName + Format so per-format variations report
// separately (same key the Forecast route uses).

const express = require('express');
const { getAllRows } = require('../db');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { location } = req.query;

    const [orders, orderItems, products] = await Promise.all([
      getAllRows('ORDERS'),
      getAllRows('ORDER_ITEMS'),
      getAllRows('PRODUCTS'),
    ]);

    // Location filter applies at the order level (same as Forecast).
    let filteredOrders = orders;
    if (location) filteredOrders = filteredOrders.filter(o => o.Location === location);

    const openPresales = filteredOrders.filter(o =>
      o.Status === 'Pre-Sale' && o.Delivered !== 'true'
    );
    const openIds = new Set(openPresales.map(o => o.ID));
    const orderMap = Object.fromEntries(openPresales.map(o => [o.ID, o]));
    const productNames = new Set(products.map(p => p.Name));

    // Include only line items that link to a real product (skip legacy
    // custom rows we can't classify by SKU).
    const relevantItems = orderItems.filter(i =>
      openIds.has(i.OrderID) && i.ProductName && productNames.has(i.ProductName)
    );

    // Aggregate by ProductName + Format.
    const agg = {};
    const accountsByKey = {};
    for (const item of relevantItems) {
      const key = `${item.ProductName || ''}|||${item.Format || ''}`;
      const qty = parseInt(item.Quantity || 0);
      if (!agg[key]) {
        agg[key] = {
          productName: item.ProductName || '',
          format: item.Format || '',
          totalQty: 0,
          orderIds: new Set(),
          expectedDates: [],
        };
        accountsByKey[key] = new Set();
      }
      agg[key].totalQty += qty;
      agg[key].orderIds.add(item.OrderID);
      const order = orderMap[item.OrderID];
      if (order?.AccountID) accountsByKey[key].add(order.AccountID);
      if (order?.DeliveryDate) agg[key].expectedDates.push(order.DeliveryDate);
    }

    const productAgg = Object.values(agg).map(p => {
      const sorted = p.expectedDates.slice().sort();
      return {
        productName: p.productName,
        format: p.format,
        totalQty: p.totalQty,
        orderCount: p.orderIds.size,
        accountCount: accountsByKey[`${p.productName}|||${p.format}`].size,
        earliestExpected: sorted[0] || '',
        latestExpected:   sorted[sorted.length - 1] || '',
      };
    });

    productAgg.sort((a, b) => b.totalQty - a.totalQty);

    const totalQty = productAgg.reduce((s, p) => s + p.totalQty, 0);
    const distinctOrders = new Set(relevantItems.map(i => i.OrderID)).size;
    const distinctAccounts = new Set(
      openPresales
        .filter(o => o.AccountID)
        .map(o => o.AccountID)
    ).size;

    res.json({
      products: productAgg,
      totals: {
        totalQty,
        productCount: productAgg.length,
        orderCount: distinctOrders,
        accountCount: distinctAccounts,
      },
    });
  } catch (err) {
    console.error(`[presale-demand] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
