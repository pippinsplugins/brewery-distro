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

    let [orders, orderItems, stockMovements, accounts, inventory, staff, products] = await Promise.all([
      getAllRows('ORDERS'),
      getAllRows('ORDER_ITEMS'),
      getAllRows('STOCK_MOVEMENTS'),
      getAllRows('ACCOUNTS'),
      getAllRows('INVENTORY'),
      getAllRows('STAFF'),
      getAllRows('PRODUCTS'),
    ]);

    // Location filter
    if (location) {
      orders = orders.filter(o => o.Location === location);
      inventory = inventory.filter(i => i.Location === location);
    }

    // Determine granularity based on date range span
    const startDate = new Date(start + 'T00:00:00');
    const endDate = new Date(end + 'T00:00:00');
    const daySpan = Math.round((endDate - startDate) / 86400000) + 1;
    const granularity = daySpan <= 31 ? 'day' : daySpan <= 90 ? 'week' : 'month';

    // Filter orders by date range (exclude Cancelled and Pre-Sale for sales)
    const dateFilteredOrders = orders.filter(o => {
      const d = (o.OrderDate || '').substring(0, 10);
      return d >= start && d <= end;
    });
    const salesOrders = dateFilteredOrders.filter(o => o.Status !== 'Cancelled' && o.Status !== 'Pre-Sale');

    // Build sets for quick lookups
    const salesOrderIds = new Set(salesOrders.map(o => o.ID));
    const dateOrderIds = new Set(dateFilteredOrders.map(o => o.ID));
    const accountMap = Object.fromEntries(accounts.map(a => [a.ID, a]));
    const staffMap = Object.fromEntries(staff.map(s => [s.ID, s]));
    const inventoryMap = Object.fromEntries(inventory.map(i => [i.ID, i]));
    const productMap = Object.fromEntries(products.map(p => [p.ID, p]));

    // ── A. Sales Summary ──────────────────────────────────────────
    const salesBuckets = {};
    let totalOrders = 0, totalAmount = 0, totalTax = 0, totalDeposits = 0;

    for (const o of salesOrders) {
      const key = bucketKey(o.OrderDate, granularity);
      if (!salesBuckets[key]) salesBuckets[key] = { bucket: key, orderCount: 0, orderAmount: 0, taxAmount: 0, depositAmount: 0 };
      const b = salesBuckets[key];
      const amt = parseFloat(o.OrderAmount || 0);
      const tax = parseFloat(o.TaxAmount || 0);
      const dep = parseFloat(o.DepositAmount || 0);
      b.orderCount++;
      b.orderAmount += amt;
      b.taxAmount += tax;
      b.depositAmount += dep;
      totalOrders++;
      totalAmount += amt;
      totalTax += tax;
      totalDeposits += dep;
    }

    const salesSummary = {
      buckets: Object.values(salesBuckets).sort((a, b) => a.bucket.localeCompare(b.bucket)),
      granularity,
      totals: { orderCount: totalOrders, orderAmount: totalAmount, taxAmount: totalTax, depositAmount: totalDeposits },
    };

    // ── B. Top Products ───────────────────────────────────────────
    const productAgg = {};
    const salesItems = orderItems.filter(i => salesOrderIds.has(i.OrderID));

    for (const item of salesItems) {
      const key = `${item.ProductName || ''}|||${item.Format || ''}`;
      if (!productAgg[key]) productAgg[key] = { productName: item.ProductName || '', format: item.Format || '', quantitySold: 0, revenue: 0, orderIds: new Set() };
      const a = productAgg[key];
      a.quantitySold += parseInt(item.Quantity || 0);
      a.revenue += parseFloat(item.LineTotal || 0);
      a.orderIds.add(item.OrderID);
    }

    const topProducts = Object.values(productAgg)
      .map(p => ({
        productName: p.productName,
        format: p.format,
        quantitySold: p.quantitySold,
        revenue: p.revenue,
        avgPrice: p.quantitySold > 0 ? p.revenue / p.quantitySold : 0,
        orderCount: p.orderIds.size,
      }))
      .sort((a, b) => b.quantitySold - a.quantitySold);

    // ── C. Account Activity ───────────────────────────────────────
    const accountAgg = {};

    for (const o of salesOrders) {
      if (!o.AccountID) continue;
      if (!accountAgg[o.AccountID]) {
        const acct = accountMap[o.AccountID] || {};
        accountAgg[o.AccountID] = { accountId: o.AccountID, name: o.AccountName || acct.Name || '', type: acct.Type || '', orderCount: 0, totalSpent: 0, lastOrderDate: '' };
      }
      const a = accountAgg[o.AccountID];
      a.orderCount++;
      a.totalSpent += parseFloat(o.OrderAmount || 0);
      const d = (o.OrderDate || '').substring(0, 10);
      if (d > a.lastOrderDate) a.lastOrderDate = d;
    }

    const accountActivity = Object.values(accountAgg)
      .map(a => ({ ...a, avgOrder: a.orderCount > 0 ? a.totalSpent / a.orderCount : 0 }))
      .sort((a, b) => b.totalSpent - a.totalSpent);

    // ── D. Stock Movements ────────────────────────────────────────
    // Filter movements by date and optionally by location (via inventoryMap)
    const inventoryIds = location ? new Set(inventory.map(i => i.ID)) : null;
    const filteredMovements = stockMovements.filter(m => {
      const d = (m.Date || m.CreatedAt || '').substring(0, 10);
      if (d < start || d > end) return false;
      if (inventoryIds && !inventoryIds.has(m.InventoryID)) return false;
      return true;
    });

    const movBuckets = {};
    const movProducts = {};

    for (const m of filteredMovements) {
      const key = bucketKey(m.Date || m.CreatedAt, granularity);
      if (!movBuckets[key]) movBuckets[key] = { bucket: key, received: 0, sold: 0, writeOff: 0, adjustment: 0 };
      const b = movBuckets[key];
      const qty = Math.abs(parseInt(m.Quantity || 0));
      const type = (m.Type || '').toLowerCase();
      if (type === 'received' || type === 'receive') b.received += qty;
      else if (type === 'sale') b.sold += qty;
      else if (type === 'write-off' || type === 'writeoff' || type === 'write_off') b.writeOff += qty;
      else if (type === 'adjustment') b.adjustment += qty;

      // Per-product aggregation
      const pKey = m.InventoryName || m.InventoryID || '';
      if (!movProducts[pKey]) movProducts[pKey] = { name: pKey, received: 0, sold: 0, writeOff: 0, adjustment: 0 };
      const p = movProducts[pKey];
      if (type === 'received' || type === 'receive') p.received += qty;
      else if (type === 'sale') p.sold += qty;
      else if (type === 'write-off' || type === 'writeoff' || type === 'write_off') p.writeOff += qty;
      else if (type === 'adjustment') {
        const raw = parseInt(m.Quantity || 0);
        p.adjustment += raw;  // Keep sign for net calculation
      }
    }

    const stockMovementsSummary = {
      buckets: Object.values(movBuckets).sort((a, b) => a.bucket.localeCompare(b.bucket)),
      products: Object.values(movProducts)
        .map(p => ({ ...p, netChange: p.received - p.sold - p.writeOff + p.adjustment }))
        .sort((a, b) => b.received - a.received),
      granularity,
    };

    // ── E. Sales by Rep ───────────────────────────────────────────
    const repAgg = {};

    for (const o of salesOrders) {
      const repId = o.StaffID || '_unassigned';
      if (!repAgg[repId]) {
        const s = staffMap[o.StaffID] || {};
        repAgg[repId] = { staffId: repId, name: o.StaffName || s.Name || 'Unassigned', orderCount: 0, totalRevenue: 0, accountIds: new Set() };
      }
      const r = repAgg[repId];
      r.orderCount++;
      r.totalRevenue += parseFloat(o.OrderAmount || 0);
      if (o.AccountID) r.accountIds.add(o.AccountID);
    }

    const salesByRep = Object.values(repAgg)
      .map(r => ({
        staffId: r.staffId,
        name: r.name,
        orderCount: r.orderCount,
        totalRevenue: r.totalRevenue,
        avgOrder: r.orderCount > 0 ? r.totalRevenue / r.orderCount : 0,
        accountsServed: r.accountIds.size,
      }))
      .sort((a, b) => b.totalRevenue - a.totalRevenue);

    res.json({
      salesSummary,
      topProducts,
      accountActivity,
      stockMovements: stockMovementsSummary,
      salesByRep,
      dateRange: { start, end, daySpan, granularity },
    });
  } catch (err) {
    console.error(`[reports] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
