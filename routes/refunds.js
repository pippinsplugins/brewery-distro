'use strict';

// Refunds — per-order financial refund records with per-line detail.
// See issue #462. This slice ships the create endpoint alongside the
// read endpoints; restock, QBO sync, and store-credit interaction
// follow in later PRs. For now the endpoint only records the refund
// event — no inventory or QBO side effects.

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getAllRows, getRow, addRow, updateRow } = require('../db');
const requireRefundPermission = require('../middleware/requireRefundPermission');
const { syncRefundToQbo } = require('../qbo-service');

const router = express.Router();

const VALID_METHODS = new Set(['Credit Card', 'ACH', 'Cash', 'Check', 'Store Credit', 'Other']);
const VALID_REASONS = new Set(['Damaged', 'Wrong Product', 'Customer Request', 'Overpayment', 'Excess Inventory', 'Other']);

// GET /api/refunds?orderId=<id>|accountId=<id>
// Returns refund rows with their line items nested. Callers always render
// the two together, so the single trip removes an N+1 fetch pattern.
router.get('/', async (req, res) => {
  try {
    const { orderId, accountId } = req.query;
    if (!orderId && !accountId) {
      return res.status(400).json({ error: 'orderId or accountId is required' });
    }
    let rows = await getAllRows('REFUNDS');
    if (orderId)   rows = rows.filter(r => r.OrderID   === orderId);
    if (accountId) rows = rows.filter(r => r.AccountID === accountId);
    const allItems = await getAllRows('REFUND_ITEMS');
    const itemsByRefund = {};
    for (const it of allItems) (itemsByRefund[it.RefundID] ||= []).push(it);
    rows.sort((a, b) => (b.RefundDate || b.CreatedAt || '').localeCompare(a.RefundDate || a.CreatedAt || ''));
    res.json(rows.map(r => ({ ...r, items: itemsByRefund[r.ID] || [] })));
  } catch (err) {
    console.error(`[refunds] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/refunds/:id — single refund with its line items.
router.get('/:id', async (req, res) => {
  try {
    const refund = await getRow('REFUNDS', req.params.id);
    if (!refund) return res.status(404).json({ error: 'Refund not found' });
    const allItems = await getAllRows('REFUND_ITEMS');
    const items = allItems.filter(i => i.RefundID === req.params.id);
    res.json({ ...refund, items });
  } catch (err) {
    console.error(`[refunds] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/refunds — create a refund. Role-gated to Account Manager.
// This slice records the event only: no stock movements, no QBO sync,
// no ACCOUNT_CREDITS interaction. Those wire in later PRs.
router.post('/', requireRefundPermission, async (req, res) => {
  try {
    const {
      orderId, refundDate, method, reference = '', reason,
      notes = '', restockInventory = false, items = [],
      amount, taxAmount = 0, depositAmount = 0,
      qboDepositAccountId = '',
    } = req.body || {};

    if (!orderId) return res.status(400).json({ error: 'orderId is required' });
    if (!method || !VALID_METHODS.has(method)) {
      return res.status(400).json({ error: `method must be one of: ${[...VALID_METHODS].join(', ')}` });
    }
    if (!reason || !VALID_REASONS.has(reason)) {
      return res.status(400).json({ error: `reason must be one of: ${[...VALID_REASONS].join(', ')}` });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'At least one line item is required' });
    }

    const order = await getRow('ORDERS', orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // Validate item quantities don't exceed what's still refundable per line.
    const orderItems = await getAllRows('ORDER_ITEMS');
    const orderItemMap = Object.fromEntries(
      orderItems.filter(i => i.OrderID === orderId).map(i => [i.ID, i])
    );
    const priorRefunds = (await getAllRows('REFUND_ITEMS'))
      .filter(ri => {
        const r = orderItemMap[ri.OrderItemID];
        return !!r; // implicitly limits to this order's items
      });
    const alreadyByItem = {};
    for (const ri of priorRefunds) {
      alreadyByItem[ri.OrderItemID] = (alreadyByItem[ri.OrderItemID] || 0) + parseInt(ri.Quantity || '0');
    }

    for (const it of items) {
      if (!it.orderItemId) return res.status(400).json({ error: 'items[].orderItemId is required' });
      const src = orderItemMap[it.orderItemId];
      if (!src) return res.status(400).json({ error: `Order item ${it.orderItemId} not on this order` });
      const q = parseInt(it.quantity || '0');
      if (!q || q <= 0) return res.status(400).json({ error: 'items[].quantity must be a positive integer' });
      const remaining = parseInt(src.Quantity || '0') - (alreadyByItem[it.orderItemId] || 0);
      if (q > remaining) {
        return res.status(400).json({
          error: `Quantity ${q} exceeds refundable remaining (${remaining}) for ${src.ProductName || 'item'}`,
        });
      }
    }

    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) return res.status(400).json({ error: 'amount must be a positive number' });
    const tax = parseFloat(taxAmount) || 0;
    const dep = parseFloat(depositAmount) || 0;

    const now = new Date().toISOString();
    const refundId = uuidv4();
    // Look up the acting staff row from the same email-based match the
    // permission middleware uses, so refund history records who did what.
    const email = ((req.user && req.user.email) || '').toLowerCase();
    const staffRow = email ? (await getAllRows('STAFF')).find(s =>
      (s.Email || '').split(',').map(e => e.trim().toLowerCase()).includes(email)
    ) : null;

    const refund = {
      ID: refundId,
      OrderID: orderId,
      AccountID: order.AccountID || '',
      AccountName: order.AccountName || '',
      RefundDate: (refundDate || now.substring(0, 10)),
      Amount: String(amt.toFixed(2)),
      TaxAmount: String(tax.toFixed(2)),
      DepositAmount: String(dep.toFixed(2)),
      TotalAmount: String((amt + tax + dep).toFixed(2)),
      Method: method,
      Reference: reference,
      Reason: reason,
      Notes: notes,
      RestockInventory: restockInventory ? 'true' : 'false',
      Status: 'Completed',
      QboRefundId: '',
      QboRefundType: '',
      QboSyncStatus: '',
      QboSyncError: '',
      QboDepositAccountId: qboDepositAccountId ? String(qboDepositAccountId) : '',
      StaffID: staffRow ? staffRow.ID : '',
      StaffName: staffRow ? staffRow.Name : ((req.user && req.user.name) || ''),
      CreditID: '',
      CreatedAt: now,
    };
    await addRow('REFUNDS', refund);

    // Restock is a per-line opt-in that only makes sense for orders that
    // were actually delivered (i.e. previously produced a 'sale' stock
    // movement). For undelivered orders we silently skip — nothing to
    // return to inventory — and mark the refund's RestockInventory flag
    // false so history stays honest.
    const canRestock = order.Delivered === 'true';
    const inventoryRows = canRestock ? await getAllRows('INVENTORY') : [];
    const inventoryById = Object.fromEntries(inventoryRows.map(i => [i.ID, i]));

    for (const it of items) {
      const src = orderItemMap[it.orderItemId];
      const qty = parseInt(it.quantity);
      const unitPrice = parseFloat(it.unitPrice ?? src.UnitPrice ?? 0);
      const wantsRestock = !!it.restock && canRestock && !!src.InventoryID && inventoryById[src.InventoryID];
      let restockedFlag = 'false';

      if (wantsRestock) {
        const inv = inventoryById[src.InventoryID];
        const invName = inv.ProductName || inv.Name || src.ProductName || '';
        const invFormat = inv.Format || src.Format || '';
        await addRow('STOCK_MOVEMENTS', {
          ID: uuidv4(),
          InventoryID: src.InventoryID,
          InventoryName: [invName, invFormat].filter(Boolean).join(' — '),
          OrderID: orderId,
          Type: 'refund-restock',
          Quantity: String(qty),
          Notes: `Refund ${refundId}${reason ? ' — ' + reason : ''}`,
          Date: refund.RefundDate,
          CreatedAt: now,
        });
        await updateRow('INVENTORY', src.InventoryID, {
          Units: String(parseInt(inv.Units || '0') + qty),
          LastUpdated: refund.RefundDate,
        });
        restockedFlag = 'true';
      }

      await addRow('REFUND_ITEMS', {
        ID: uuidv4(),
        RefundID: refundId,
        OrderItemID: it.orderItemId,
        InventoryID: src.InventoryID || '',
        ProductName: src.ProductName || '',
        Format: src.Format || '',
        Quantity: String(qty),
        UnitPrice: String(unitPrice.toFixed(2)),
        LineTotal: String((qty * unitPrice).toFixed(2)),
        Taxable: src.Taxable || 'false',
        Restocked: restockedFlag,
        CreatedAt: now,
      });
    }

    // Store Credit method: issue a matching ACCOUNT_CREDITS 'credit' row so
    // the account's credit balance widget and the existing apply-credit
    // flow pick it up automatically. Stash the ID on REFUNDS.CreditID so
    // a future void can reverse it cleanly.
    if (method === 'Store Credit') {
      const total = amt + tax + dep;
      const credit = {
        ID: uuidv4(),
        AccountID: order.AccountID || '',
        AccountName: order.AccountName || '',
        Type: 'credit',
        Amount: String(total.toFixed(2)),
        OrderID: orderId,
        Reason: `Refund on order ${order.InvoiceNumber || orderId.slice(0, 8)}`,
        Notes: notes || '',
        CreatedAt: now,
      };
      await addRow('ACCOUNT_CREDITS', credit);
      await updateRow('REFUNDS', refundId, { CreditID: credit.ID });
      refund.CreditID = credit.ID;
    }

    const savedItems = (await getAllRows('REFUND_ITEMS')).filter(ri => ri.RefundID === refundId);

    // Fire QBO sync asynchronously — the local refund already happened
    // and returning early keeps the UI responsive. Result surfaces via
    // REFUNDS.QboSyncStatus, which the refund list badge reads.
    syncRefundToQbo(refundId).catch(err => console.error('[refunds] sync:', err.message));

    res.status(201).json({ ...refund, items: savedItems });
  } catch (err) {
    console.error(`[refunds] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/refunds/:id/sync — manual retry of QBO sync for a refund whose
// initial push failed. Same role gate as create. Fires sync synchronously
// so the response reflects the outcome and the UI can toast accordingly.
router.post('/:id/sync', requireRefundPermission, async (req, res) => {
  try {
    const refund = await getRow('REFUNDS', req.params.id);
    if (!refund) return res.status(404).json({ error: 'Refund not found' });
    await syncRefundToQbo(req.params.id);
    const updated = await getRow('REFUNDS', req.params.id);
    res.json(updated);
  } catch (err) {
    console.error(`[refunds] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
