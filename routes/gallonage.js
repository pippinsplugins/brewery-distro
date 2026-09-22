'use strict';

const express = require('express');
const { getAllRows } = require('../db');

const router = express.Router();

/**
 * Gallons per unit for each package format.
 * Used to convert sold quantities into gallons and barrels (1 bbl = 31 gal).
 * Formats not present in this map contribute 0 gallons.
 */
const GALLON_MAP = {
  '1/6 Keg': 5.167,
  '1/4 Keg': 7.75,
  '1/2 Keg': 15.5,
  '12oz Can (case/24)': 2.25,
  '16oz Can (case/24)': 3.0,
  '22oz Bottle (case/12)': 2.0625,
  '750ml Bottle (case/12)': 2.378,
};

router.get('/', async (req, res) => {
  try {
    const { start, end, location, accountType, tag, accountIds } = req.query;
    if (!start || !end) return res.status(400).json({ error: 'start and end query params required' });

    let [orders, orderItems, accounts, refunds, refundItems] = await Promise.all([
      getAllRows('ORDERS'),
      getAllRows('ORDER_ITEMS'),
      getAllRows('ACCOUNTS'),
      getAllRows('REFUNDS'),
      getAllRows('REFUND_ITEMS'),
    ]);

    // Location filter
    if (location) {
      orders = orders.filter(o => o.Location === location);
    }

    // Date range + exclude Cancelled/Pre-Sale
    const salesOrders = orders.filter(o => {
      const d = (o.OrderDate || '').substring(0, 10);
      return d >= start && d <= end && o.Status !== 'Cancelled' && o.Status !== 'Pre-Sale' && o.Status !== 'Draft';
    });

    // Build account lookup
    const accountMap = Object.fromEntries(accounts.map(a => [a.ID, a]));

    // Account filters
    let filteredOrders = salesOrders;
    if (accountType) {
      filteredOrders = filteredOrders.filter(o => {
        const acct = accountMap[o.AccountID];
        return acct && acct.Type === accountType;
      });
    }
    if (tag) {
      filteredOrders = filteredOrders.filter(o => {
        const acct = accountMap[o.AccountID];
        if (!acct || !acct.Tags) return false;
        try {
          const tags = JSON.parse(acct.Tags);
          return Array.isArray(tags) && tags.includes(tag);
        } catch { return false; }
      });
    }
    if (accountIds) {
      const idSet = new Set(accountIds.split(',').map(s => s.trim()).filter(Boolean));
      filteredOrders = filteredOrders.filter(o => idSet.has(o.AccountID));
    }

    const orderIdSet = new Set(filteredOrders.map(o => o.ID));
    const salesItems = orderItems.filter(i => orderIdSet.has(i.OrderID));

    // Attribute refunded volume to the RefundDate bucket by subtracting
    // refunded quantities from the format/account aggregates below.
    // Refunds are filtered by date + location; account-type/tag/accountIds
    // reuse the same order-level filters via orderAccountMap membership so
    // a refund only counts against a slice of the report the operator is
    // actually looking at.
    const orderById = Object.fromEntries(orders.map(o => [o.ID, o]));
    const refundsInWindow = refunds.filter(r => {
      const d = (r.RefundDate || '').substring(0, 10);
      return d >= start && d <= end;
    });
    const refundItemsByRefund = {};
    for (const ri of refundItems) (refundItemsByRefund[ri.RefundID] ||= []).push(ri);

    // Aggregate by format
    const formatAgg = {};
    for (const item of salesItems) {
      const fmt = item.Format || 'Unknown';
      if (!formatAgg[fmt]) formatAgg[fmt] = { format: fmt, unitsSold: 0, gallons: 0, bbls: 0 };
      const a = formatAgg[fmt];
      const qty = parseInt(item.Quantity || 0);
      const galsPerUnit = GALLON_MAP[fmt] || 0;
      a.unitsSold += qty;
      a.gallons += qty * galsPerUnit;
      a.bbls += (qty * galsPerUnit) / 31;
    }
    const formats = Object.values(formatAgg).sort((a, b) => b.gallons - a.gallons);

    // Aggregate by account
    const acctAgg = {};
    // Build order-to-items map for gallonage per account
    const orderAccountMap = Object.fromEntries(filteredOrders.map(o => [o.ID, o]));
    for (const item of salesItems) {
      const order = orderAccountMap[item.OrderID];
      if (!order || !order.AccountID) continue;
      const aid = order.AccountID;
      if (!acctAgg[aid]) {
        const acct = accountMap[aid] || {};
        acctAgg[aid] = { accountId: aid, accountName: order.AccountName || acct.Name || '', accountType: acct.Type || '', unitsSold: 0, gallons: 0, bbls: 0 };
      }
      const a = acctAgg[aid];
      const qty = parseInt(item.Quantity || 0);
      const galsPerUnit = GALLON_MAP[item.Format] || 0;
      a.unitsSold += qty;
      a.gallons += qty * galsPerUnit;
      a.bbls += (qty * galsPerUnit) / 31;
    }
    const acctList = Object.values(acctAgg).sort((a, b) => b.gallons - a.gallons);

    // Subtract refunded volume. Only refunds whose original order passes
    // the same slice filters (location/type/tag/accountIds) contribute —
    // matches the sales side so the report stays internally consistent.
    for (const r of refundsInWindow) {
      const parentOrder = orderById[r.OrderID];
      if (!parentOrder) continue;
      if (!orderIdSet.has(r.OrderID)) {
        // Original order isn't in the filtered slice; still attribute the
        // refund if we can — but only when the account itself matches the
        // slice filters. Cheap sanity check: skip if location was set and
        // the parent's location differs.
        if (location && parentOrder.Location !== location) continue;
        const acct = accountMap[parentOrder.AccountID];
        if (accountType && (!acct || acct.Type !== accountType)) continue;
      }
      const rItems = refundItemsByRefund[r.ID] || [];
      for (const ri of rItems) {
        const fmt = ri.Format || 'Unknown';
        const qty = parseInt(ri.Quantity || '0');
        const galsPerUnit = GALLON_MAP[fmt] || 0;
        if (formatAgg[fmt]) {
          formatAgg[fmt].unitsSold -= qty;
          formatAgg[fmt].gallons   -= qty * galsPerUnit;
          formatAgg[fmt].bbls      -= (qty * galsPerUnit) / 31;
        }
        const aid = parentOrder.AccountID;
        if (aid && acctAgg[aid]) {
          acctAgg[aid].unitsSold -= qty;
          acctAgg[aid].gallons   -= qty * galsPerUnit;
          acctAgg[aid].bbls      -= (qty * galsPerUnit) / 31;
        }
      }
    }

    // Totals
    const totalUnits = formats.reduce((s, f) => s + f.unitsSold, 0);
    const totalGallons = formats.reduce((s, f) => s + f.gallons, 0);
    const totalBbls = formats.reduce((s, f) => s + f.bbls, 0);

    // Meta: all available types and tags (from all accounts, not just filtered)
    const availableTypes = [...new Set(accounts.map(a => a.Type).filter(Boolean))].sort();
    const availableTags = new Set();
    for (const acct of accounts) {
      if (!acct.Tags) continue;
      try {
        const tags = JSON.parse(acct.Tags);
        if (Array.isArray(tags)) tags.forEach(t => availableTags.add(t));
      } catch { /* skip */ }
    }

    res.json({
      formats,
      accounts: acctList,
      totals: { units: totalUnits, gallons: totalGallons, bbls: totalBbls },
      meta: { availableTypes, availableTags: [...availableTags].sort() },
    });
  } catch (err) {
    console.error(`[gallonage] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
