'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getAllRows, addRow, updateRow, deleteRow } = require('../sheets');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { accountId, staffId } = req.query;
    let sales = await getAllRows('SALES');
    if (accountId) sales = sales.filter(s => s.AccountID === accountId);
    if (staffId)   sales = sales.filter(s => s.StaffID === staffId);
    // Sort newest first
    sales.sort((a, b) => (b.SaleDate || '').localeCompare(a.SaleDate || ''));
    res.json(sales);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const {
      AccountID, AccountName, StaffID, StaffName,
      SaleDate, DeliveryDate, InvoiceNumber,
      SaleAmount, TaxAmount, Notes, Status,
    } = req.body;

    if (!AccountID) return res.status(400).json({ error: 'AccountID is required' });
    if (!SaleDate)  return res.status(400).json({ error: 'SaleDate is required' });

    const sale = {
      ID: uuidv4(),
      AccountID,
      AccountName: AccountName || '',
      StaffID:     StaffID || '',
      StaffName:   StaffName || '',
      SaleDate,
      DeliveryDate: DeliveryDate || '',
      InvoiceNumber: InvoiceNumber || '',
      SaleAmount: SaleAmount || '0',
      TaxAmount:  TaxAmount  || '0',
      Notes:  Notes  || '',
      Status: Status || 'Pending',
      CreatedAt: new Date().toISOString().split('T')[0],
    };

    await addRow('SALES', sale);
    res.status(201).json(sale);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const updates = { ...req.body };
    delete updates.ID;
    delete updates.CreatedAt;
    const updated = await updateRow('SALES', req.params.id, updates);
    res.json(updated);
  } catch (err) {
    res.status(err.message.includes('not found') ? 404 : 500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await deleteRow('SALES', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(err.message.includes('not found') ? 404 : 500).json({ error: err.message });
  }
});

module.exports = router;
