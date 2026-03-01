'use strict';

const express = require('express');
const { getAllRows, addRow, updateRow, deleteRow } = require('../db');

const router = express.Router();

async function getNextAccountId() {
  const accounts = await getAllRows('ACCOUNTS');
  const maxId = Math.max(0, ...accounts.map(a => parseInt(a.ID, 10) || 0));
  return String(maxId + 1);
}

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
    const { Name, Type, Tags, ContactName, Email, AdditionalEmails, Phone, PreferredMethod, Address, City, State, Zip, ABCLicense, Status, Notes, StaffID, StaffName } = req.body;
    if (!Name) return res.status(400).json({ error: 'Account name is required' });

    const account = {
      ID: await getNextAccountId(),
      Name: Name.trim(),
      Type: Type || 'Bar',
      Tags: Tags || '[]',
      ContactName: ContactName || '',
      Email: Email || '',
      AdditionalEmails: AdditionalEmails || '[]',
      Phone: Phone || '',
      PreferredMethod: PreferredMethod || 'Email',
      Address: Address || '',
      City: City || '',
      State: State || '',
      Zip: Zip || '',
      ABCLicense: ABCLicense || '',
      Status: Status || 'Prospect',
      Notes: Notes || '',
      LastContacted: '',
      StaffID: StaffID || '',
      StaffName: StaffName || '',
      CreatedAt: new Date().toISOString(),
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

    // Cascade delete: remove associated keg tracking records
    const kegs = await getAllRows('KEG_TRACKING');
    for (const keg of kegs) {
      if (keg.AccountID === id) {
        await deleteRow('KEG_TRACKING', keg.ID);
      }
    }

    // Cascade delete: remove associated tap handle records
    const tapHandles = await getAllRows('TAP_HANDLES');
    for (const handle of tapHandles) {
      if (handle.AccountID === id) {
        await deleteRow('TAP_HANDLES', handle.ID);
      }
    }

    await deleteRow('ACCOUNTS', id);
    res.json({ success: true });
  } catch (err) {
    res.status(err.message.includes('not found') ? 404 : 500).json({ error: err.message });
  }
});

module.exports = router;
