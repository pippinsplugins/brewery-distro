'use strict';

const express = require('express');
const { getAllRows } = require('../db');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { location } = req.query;
    let [inventory, accounts, outreach, reminders, orders, products, staff] = await Promise.all([
      getAllRows('INVENTORY'),
      getAllRows('ACCOUNTS'),
      getAllRows('OUTREACH'),
      getAllRows('REMINDERS'),
      getAllRows('ORDERS'),
      getAllRows('PRODUCTS'),
      getAllRows('STAFF'),
    ]);
    if (location) {
      inventory = inventory.filter(i => i.Location === location);
      orders    = orders.filter(o => o.Location === location);

      // Build set of staff IDs assigned to this location
      const locationStaffIds = new Set();
      for (const s of staff) {
        try {
          const locs = JSON.parse(s.Locations || '[]');
          if (Array.isArray(locs) && locs.includes(location)) locationStaffIds.add(s.ID);
        } catch { /* ignore bad JSON */ }
      }

      // Filter reminders: keep if unassigned or assigned to staff at this location
      reminders = reminders.filter(r => !r.StaffID || locationStaffIds.has(r.StaffID));
    }

    // Enrich inventory with product data for display
    const productMap = Object.fromEntries(products.map(p => [p.ID, p]));
    inventory = inventory.map(inv => {
      const product = productMap[inv.ProductID] || {};
      return {
        ...inv,
        Name: inv.ProductName || product.Name || inv.Name || '',
        Format: inv.Format || product.Format || '',
      };
    });

    const today = new Date().toISOString().split('T')[0];
    const in7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const activeAccounts = accounts.filter(a => a.Status === 'Active');
    const prospectAccounts = accounts.filter(a => a.Status === 'Prospect');

    const activeReminders = reminders.filter(r => r.Completed !== 'true');
    const overdueReminders = activeReminders.filter(r => r.DueDate && r.DueDate < today);
    const upcomingReminders = activeReminders
      .filter(r => r.DueDate && r.DueDate >= today && r.DueDate <= in7Days)
      .sort((a, b) => a.DueDate.localeCompare(b.DueDate))
      .slice(0, 8);

    const lowStockItems = inventory.filter(item => {
      const units = parseInt(item.Units || '0', 10);
      const threshold = parseInt(item.LowStockThreshold || '5', 10);
      return units <= threshold;
    });

    const recentOutreach = [...outreach]
      .sort((a, b) => (b.Date || '').localeCompare(a.Date || ''))
      .slice(0, 8);

    const currentMonth = today.substring(0, 7); // 'YYYY-MM'
    const monthlyOrders = orders.filter(s => (s.OrderDate || '').startsWith(currentMonth) && s.Status !== 'Pre-Sale');
    const monthlyOrdersTotal = monthlyOrders.reduce((sum, s) => sum + parseFloat(s.OrderAmount || 0), 0);
    const pendingDeliveries = orders.filter(s => s.Delivered !== 'true' && s.Status !== 'Cancelled' && s.Status !== 'Pre-Sale').length;

    res.json({
      totalProducts: inventory.length,
      totalAccounts: accounts.length,
      activeAccounts: activeAccounts.length,
      prospectAccounts: prospectAccounts.length,
      totalActiveReminders: activeReminders.length,
      overdueCount: overdueReminders.length,
      upcomingReminders,
      overdueReminders: overdueReminders.sort((a, b) => a.DueDate.localeCompare(b.DueDate)),
      lowStockItems,
      recentOutreach,
      monthlyOrdersTotal: monthlyOrdersTotal.toFixed(2),
      monthlyOrdersCount: monthlyOrders.length,
      pendingDeliveries,
    });
  } catch (err) {
    console.error(`[dashboard] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
