'use strict';

const express = require('express');
const { getAllRows } = require('../db');

const router = express.Router();

// GET /api/notifications — list notifications (scaffold for future in-app notification center)
router.get('/', async (req, res) => {
  try {
    const rows = await getAllRows('NOTIFICATIONS');
    // Sort newest first
    rows.sort((a, b) => (b.CreatedAt || '').localeCompare(a.CreatedAt || ''));
    res.json(rows);
  } catch (err) {
    console.error(`[notifications] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
