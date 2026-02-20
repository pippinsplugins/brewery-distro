'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getAllRows, addRow, updateRow, deleteRow } = require('../sheets');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { status } = req.query; // 'active', 'completed', 'all'
    let items = await getAllRows('REMINDERS');

    if (!status || status === 'active') {
      items = items.filter(r => r.Completed !== 'true');
    } else if (status === 'completed') {
      items = items.filter(r => r.Completed === 'true');
    }

    // Sort by due date ascending
    items.sort((a, b) => (a.DueDate || '').localeCompare(b.DueDate || ''));
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { Type, AccountID, AccountName, Title, DueDate, Priority, Notes, StaffID, StaffName } = req.body;
    if (!Title) return res.status(400).json({ error: 'Title is required' });
    if (!DueDate) return res.status(400).json({ error: 'DueDate is required' });

    const reminder = {
      ID: uuidv4(),
      Type: Type || 'Other',
      AccountID: AccountID || '',
      AccountName: AccountName || '',
      Title: Title.trim(),
      DueDate,
      Priority: Priority || 'Medium',
      Notes: Notes || '',
      Completed: 'false',
      StaffID: StaffID || '',
      StaffName: StaffName || '',
      CreatedAt: new Date().toISOString().split('T')[0],
    };

    await addRow('REMINDERS', reminder);
    res.status(201).json(reminder);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const updates = { ...req.body };
    delete updates.ID;
    delete updates.CreatedAt;
    const updated = await updateRow('REMINDERS', req.params.id, updates);
    res.json(updated);
  } catch (err) {
    res.status(err.message.includes('not found') ? 404 : 500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await deleteRow('REMINDERS', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(err.message.includes('not found') ? 404 : 500).json({ error: err.message });
  }
});

module.exports = router;
