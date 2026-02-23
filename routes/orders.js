'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getAllRows, addRow, updateRow, deleteRow } = require('../sheets');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { accountId, staffId, location } = req.query;
    let orders = await getAllRows('ORDERS');
    if (accountId) orders = orders.filter(s => s.AccountID === accountId);
    if (staffId)   orders = orders.filter(s => s.StaffID === staffId);
    if (location)  orders = orders.filter(s => s.Location === location);
    // Sort newest first
    orders.sort((a, b) => (b.OrderDate || '').localeCompare(a.OrderDate || ''));
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const {
      AccountID, AccountName, Location, StaffID, StaffName,
      OrderDate, DeliveryDate, InvoiceNumber,
      OrderAmount, TaxAmount, Notes, RequestedProducts, Status, Delivered,
    } = req.body;

    if (!AccountID) return res.status(400).json({ error: 'AccountID is required' });
    if (!OrderDate)  return res.status(400).json({ error: 'OrderDate is required' });

    const order = {
      ID: uuidv4(),
      AccountID,
      AccountName: AccountName || '',
      Location:    Location || '',
      StaffID:     StaffID || '',
      StaffName:   StaffName || '',
      OrderDate,
      DeliveryDate: DeliveryDate || '',
      InvoiceNumber: InvoiceNumber || '',
      OrderAmount: OrderAmount || '0',
      TaxAmount:  TaxAmount  || '0',
      Notes:     Notes     || '',
      RequestedProducts: RequestedProducts || '',
      Status:    Status    || 'Pending',
      Delivered: Delivered || 'false',
      CreatedAt: new Date().toISOString(),
    };

    await addRow('ORDERS', order);
    res.status(201).json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    // Prevent un-delivering an already-delivered order
    if (req.body.Delivered === 'false') {
      const orders = await getAllRows('ORDERS');
      const existing = orders.find(o => o.ID === req.params.id);
      if (existing && existing.Delivered === 'true') {
        return res.status(400).json({ error: 'Delivered orders cannot be un-delivered' });
      }
    }
    const updates = { ...req.body };
    delete updates.ID;
    delete updates.CreatedAt;
    const updated = await updateRow('ORDERS', req.params.id, updates);
    res.json(updated);
  } catch (err) {
    res.status(err.message.includes('not found') ? 404 : 500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await deleteRow('ORDERS', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(err.message.includes('not found') ? 404 : 500).json({ error: err.message });
  }
});

module.exports = router;
