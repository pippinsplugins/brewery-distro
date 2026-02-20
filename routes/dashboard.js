'use strict';

const express = require('express');
const { getAllRows } = require('../sheets');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const [inventory, accounts, outreach, reminders] = await Promise.all([
      getAllRows('INVENTORY'),
      getAllRows('ACCOUNTS'),
      getAllRows('OUTREACH'),
      getAllRows('REMINDERS'),
    ]);

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
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
