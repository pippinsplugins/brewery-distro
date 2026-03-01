'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getAllRows, addRow, updateRow, deleteRow } = require('../db');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const staff = await getAllRows('STAFF');
    res.json(staff);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { Name, Email, Phone, Role, Notes } = req.body;
    if (!Name) return res.status(400).json({ error: 'Name is required' });

    const member = {
      ID: uuidv4(),
      Name: Name.trim(),
      Email: Email || '',
      Phone: Phone || '',
      Role: Role || '',
      Active: 'true',
      Notes: Notes || '',
      CreatedAt: new Date().toISOString(),
    };

    await addRow('STAFF', member);
    res.status(201).json(member);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const updates = { ...req.body };
    delete updates.ID;
    delete updates.CreatedAt;
    const updated = await updateRow('STAFF', req.params.id, updates);
    res.json(updated);
  } catch (err) {
    res.status(err.message.includes('not found') ? 404 : 500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = req.params.id;

    // Unassign this staff member from any accounts they own
    const accounts = await getAllRows('ACCOUNTS');
    for (const acct of accounts) {
      if (acct.StaffID === id) {
        await updateRow('ACCOUNTS', acct.ID, { StaffID: '', StaffName: '' });
      }
    }

    await deleteRow('STAFF', id);
    res.json({ success: true });
  } catch (err) {
    res.status(err.message.includes('not found') ? 404 : 500).json({ error: err.message });
  }
});

module.exports = router;
