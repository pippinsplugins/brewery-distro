'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getAllRows, getRow, addRow, updateRow, deleteRow } = require('../db');
const { processMentions, processAssignment } = require('../lib/notifications');

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

    // Sort: open todos first, then by due date ascending
    items.sort((a, b) => {
      const aDone = a.Completed === 'true' ? 1 : 0;
      const bDone = b.Completed === 'true' ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;
      return (a.DueDate || '').localeCompare(b.DueDate || '');
    });
    res.json(items);
  } catch (err) {
    console.error(`[reminders] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
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
    const baseUrl = req.protocol + '://' + req.get('host');
    processMentions({ newText: reminder.Notes, oldText: '', entityType: 'todo', entityName: reminder.Title, entityId: reminder.ID, accountId: reminder.AccountID, user: req.user, mentionerName: req.user.name, baseUrl }).catch(err => console.error('[notifications]', err));
    processAssignment({ newStaffId: reminder.StaffID, oldStaffId: '', entityType: 'todo', entityName: reminder.Title, entityId: reminder.ID, accountId: reminder.AccountID, user: req.user, assignerName: req.user.name, baseUrl }).catch(err => console.error('[notifications]', err));
    res.status(201).json(reminder);
  } catch (err) {
    console.error(`[reminders] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const existing = getRow('REMINDERS', req.params.id);
    const oldNotes = existing?.Notes || '';
    const oldStaffId = existing?.StaffID || '';
    const updates = { ...req.body };
    delete updates.ID;
    delete updates.CreatedAt;
    const updated = await updateRow('REMINDERS', req.params.id, updates);
    const baseUrl = req.protocol + '://' + req.get('host');
    processMentions({ newText: updated.Notes, oldText: oldNotes, entityType: 'todo', entityName: updated.Title, entityId: updated.ID, accountId: updated.AccountID, user: req.user, mentionerName: req.user.name, baseUrl }).catch(err => console.error('[notifications]', err));
    processAssignment({ newStaffId: updated.StaffID, oldStaffId, entityType: 'todo', entityName: updated.Title, entityId: updated.ID, accountId: updated.AccountID, user: req.user, assignerName: req.user.name, baseUrl }).catch(err => console.error('[notifications]', err));

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
    const status = err.message.includes('not found') ? 404 : 500;
    console.error(`[reminders] ${err.message}`);
    res.status(status).json({ error: status === 404 ? 'Not found' : 'Internal server error' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await deleteRow('REMINDERS', req.params.id);
    res.json({ success: true });
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 500;
    console.error(`[reminders] ${err.message}`);
    res.status(status).json({ error: status === 404 ? 'Not found' : 'Internal server error' });
  }
});

module.exports = router;
