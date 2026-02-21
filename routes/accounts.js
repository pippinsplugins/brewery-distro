'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getAllRows, addRow, updateRow, deleteRow } = require('../sheets');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const accounts = await getAllRows('ACCOUNTS');
    res.json(accounts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { Name, Type, ContactName, Email, Phone, PreferredMethod, Address, City, State, ABCLicense, Status, Notes, StaffID, StaffName } = req.body;
    if (!Name) return res.status(400).json({ error: 'Account name is required' });

    const account = {
      ID: uuidv4(),
      Name: Name.trim(),
      Type: Type || 'Bar',
      ContactName: ContactName || '',
      Email: Email || '',
      Phone: Phone || '',
      PreferredMethod: PreferredMethod || 'Email',
      Address: Address || '',
      City: City || '',
      State: State || '',
      ABCLicense: ABCLicense || '',
      Status: Status || 'Prospect',
      Notes: Notes || '',
      LastContacted: '',
      StaffID: StaffID || '',
      StaffName: StaffName || '',
      CreatedAt: new Date().toISOString().split('T')[0],
    };

    await addRow('ACCOUNTS', account);
    res.status(201).json(account);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const updates = { ...req.body };
    delete updates.ID;
    delete updates.CreatedAt;
    const updated = await updateRow('ACCOUNTS', req.params.id, updates);
    res.json(updated);
  } catch (err) {
    res.status(err.message.includes('not found') ? 404 : 500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = req.params.id;

    // Cascade delete: remove associated outreach entries
    const outreachItems = await getAllRows('OUTREACH');
    for (const item of outreachItems) {
      if (item.AccountID === id) {
        await deleteRow('OUTREACH', item.ID);
      }
    }

    // Cascade delete: remove associated reminders
    const reminders = await getAllRows('REMINDERS');
    for (const reminder of reminders) {
      if (reminder.AccountID === id) {
        await deleteRow('REMINDERS', reminder.ID);
      }
    }

    // Cascade delete: remove associated orders
    const orders = await getAllRows('ORDERS');
    for (const order of orders) {
      if (order.AccountID === id) {
        await deleteRow('ORDERS', order.ID);
      }
    }

    await deleteRow('ACCOUNTS', id);
    res.json({ success: true });
  } catch (err) {
    res.status(err.message.includes('not found') ? 404 : 500).json({ error: err.message });
  }
});

module.exports = router;
