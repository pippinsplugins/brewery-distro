'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getAllRows, addRow, updateRow, deleteRow } = require('../db');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { accountId } = req.query;
    let items = await getAllRows('OUTREACH');
    if (accountId) {
      items = items.filter(i => i.AccountID === accountId);
    }
    // Sort by date descending
    items.sort((a, b) => (b.Date || '').localeCompare(a.Date || ''));
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { AccountID, AccountName, Date: date, Method, Notes, FollowUpDate, FollowUpStatus } = req.body;
    if (!AccountID) return res.status(400).json({ error: 'AccountID is required' });

    const entry = {
      ID: uuidv4(),
      AccountID,
      AccountName: AccountName || '',
      Date: date || new Date().toISOString().split('T')[0],
      Method: Method || 'Email',
      Notes: Notes || '',
      FollowUpDate: FollowUpDate || '',
      FollowUpStatus: FollowUpStatus || (FollowUpDate ? 'Pending' : 'None'),
      CreatedAt: new Date().toISOString(),
    };

    await addRow('OUTREACH', entry);

    // Update the account's LastContacted field
    try {
      await updateRow('ACCOUNTS', AccountID, { LastContacted: entry.Date });
    } catch (_) {
      // Non-fatal: account may have been deleted
    }

    res.status(201).json(entry);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const updates = { ...req.body };
    delete updates.ID;
    delete updates.CreatedAt;
    const updated = await updateRow('OUTREACH', req.params.id, updates);
    res.json(updated);
  } catch (err) {
    res.status(err.message.includes('not found') ? 404 : 500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await deleteRow('OUTREACH', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(err.message.includes('not found') ? 404 : 500).json({ error: err.message });
  }
});

module.exports = router;
