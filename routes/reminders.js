'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getAllRows, addRow, updateRow, deleteRow } = require('../db');

const router = express.Router();

const RECURRENCE_VALUES = new Set(['none', 'daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly']);

function nextDueDate(dueDateStr, recurrence) {
  const d = new Date(dueDateStr + 'T00:00:00');
  switch (recurrence) {
    case 'daily':     d.setDate(d.getDate() + 1); break;
    case 'weekly':    d.setDate(d.getDate() + 7); break;
    case 'biweekly':  d.setDate(d.getDate() + 14); break;
    case 'monthly':   d.setMonth(d.getMonth() + 1); break;
    case 'quarterly': d.setMonth(d.getMonth() + 3); break;
    case 'yearly':    d.setFullYear(d.getFullYear() + 1); break;
  }
  return d.toISOString().split('T')[0];
}

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
    const { Type, AccountID, AccountName, Title, DueDate, Priority, Notes, StaffID, StaffName, Recurrence, RecurrenceParentID } = req.body;
    if (!Title) return res.status(400).json({ error: 'Title is required' });
    if (!DueDate) return res.status(400).json({ error: 'DueDate is required' });

    const recurrence = RECURRENCE_VALUES.has(Recurrence) ? Recurrence : 'none';

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
      Recurrence: recurrence,
      RecurrenceParentID: RecurrenceParentID || '',
      CreatedAt: new Date().toISOString(),
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

    // When completing a recurring reminder, spawn the next occurrence
    if (updates.Completed === 'true' && updated.Recurrence && RECURRENCE_VALUES.has(updated.Recurrence) && updated.Recurrence !== 'none') {
      const next = {
        ID: uuidv4(),
        Type: updated.Type || 'Other',
        AccountID: updated.AccountID || '',
        AccountName: updated.AccountName || '',
        Title: updated.Title,
        DueDate: nextDueDate(updated.DueDate, updated.Recurrence),
        Priority: updated.Priority || 'Medium',
        Notes: updated.Notes || '',
        Completed: 'false',
        StaffID: updated.StaffID || '',
        StaffName: updated.StaffName || '',
        Recurrence: updated.Recurrence,
        RecurrenceParentID: updated.RecurrenceParentID || updated.ID,
        CreatedAt: new Date().toISOString(),
      };
      await addRow('REMINDERS', next);
      return res.json({ ...updated, _nextReminder: next });
    }

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
