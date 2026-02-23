'use strict';

/**
 * Zapier Webhook — Order Creation
 *
 * Endpoint:  POST /webhooks/zapier/order
 * Auth:      Authorization: Bearer <WEBHOOK_SECRET>
 *
 * Zapier setup:
 *   Action:  Webhooks by Zapier → POST
 *   URL:     https://<your-domain>/webhooks/zapier/order
 *   Headers: Authorization: Bearer <your WEBHOOK_SECRET value>
 *   Payload format: JSON (data below)
 *
 * Accepted fields (all optional except at least one of account_name / AccountName / AccountID):
 *
 *   invoice_number  | InvoiceNumber  | invoiceNumber   → InvoiceNumber
 *   order_date      | OrderDate      | sale_date
 *                   | SaleDate       | invoice_date    → OrderDate       (defaults to today)
 *   delivery_date   | DeliveryDate                    → DeliveryDate
 *   amount          | order_amount   | OrderAmount
 *                   | sale_amount    | SaleAmount      → OrderAmount     (pre-tax total)
 *   tax             | tax_amount     | TaxAmount       → TaxAmount
 *   status          | Status                          → Status          (Pending/Paid/Cancelled)
 *   notes           | Notes          | memo            → Notes
 *   account_id      | AccountID                       → AccountID       (our internal ID)
 *   account_name    | AccountName    | customer_name
 *                   | client_name                     → account name lookup
 *
 * Responses:
 *   201  { order }               — created successfully
 *   400  { error, details }      — missing/invalid fields
 *   401  { error }               — bad or missing token
 *   404  { error }               — account name not found
 *   503  { error }               — WEBHOOK_SECRET not configured on server
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getAllRows, addRow } = require('../sheets');

const router = express.Router();

// ── Auth middleware ──────────────────────────────────────────────

function requireWebhookSecret(req, res, next) {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) {
    return res.status(503).json({ error: 'Webhook not configured: WEBHOOK_SECRET is not set on this server.' });
  }

  const authHeader = req.headers['authorization'] || '';
  const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (!provided || provided !== secret) {
    return res.status(401).json({ error: 'Unauthorized: invalid or missing Bearer token.' });
  }

  next();
}

// ── Field normalisation ──────────────────────────────────────────

// Pick the first key in `body` that matches any of the given candidates.
function pick(body, ...keys) {
  for (const k of keys) {
    if (body[k] !== undefined && body[k] !== null && body[k] !== '') return String(body[k]).trim();
  }
  return '';
}

function normalise(body) {
  return {
    accountId:     pick(body, 'AccountID',     'account_id'),
    accountName:   pick(body, 'AccountName',   'account_name', 'customer_name', 'client_name'),
    invoiceNumber: pick(body, 'InvoiceNumber', 'invoice_number', 'invoiceNumber'),
    orderDate:     pick(body, 'OrderDate',     'order_date',    'SaleDate', 'sale_date', 'invoice_date', 'date'),
    deliveryDate:  pick(body, 'DeliveryDate',  'delivery_date'),
    orderAmount:   pick(body, 'OrderAmount',   'order_amount',  'SaleAmount', 'sale_amount', 'amount', 'subtotal'),
    taxAmount:     pick(body, 'TaxAmount',     'tax_amount',    'tax'),
    status:        pick(body, 'Status',        'status'),
    notes:         pick(body, 'Notes',         'notes',         'memo'),
  };
}

const VALID_STATUSES = new Set(['Pending', 'Paid', 'Cancelled']);

// ── POST /webhooks/zapier/order ───────────────────────────────────

router.post('/zapier/order', requireWebhookSecret, async (req, res) => {
  try {
    const f = normalise(req.body);

    // Require at least an account identifier
    if (!f.accountId && !f.accountName) {
      return res.status(400).json({
        error: 'Missing required field: provide AccountID or AccountName (or account_name / customer_name).',
      });
    }

    // Resolve account
    let resolvedAccountId   = f.accountId;
    let resolvedAccountName = f.accountName;

    if (!resolvedAccountId && resolvedAccountName) {
      const accounts = await getAllRows('ACCOUNTS');
      const match = accounts.find(
        a => a.Name && a.Name.toLowerCase() === resolvedAccountName.toLowerCase()
      );
      if (!match) {
        return res.status(404).json({
          error: `Account not found: no account named "${resolvedAccountName}". ` +
                 'Check the spelling or use AccountID instead.',
        });
      }
      resolvedAccountId   = match.ID;
      resolvedAccountName = match.Name;
    }

    // Date defaults — include timestamp so same-day orders sort by creation time
    const now       = new Date().toISOString();
    const today     = now.split('T')[0];
    const rawDate   = f.orderDate || today;
    const orderDate = rawDate.includes('T') ? rawDate : rawDate + 'T' + now.split('T')[1];

    // Status validation
    let status = f.status || 'Pending';
    // Capitalise first letter to match our enum
    status = status.charAt(0).toUpperCase() + status.slice(1);
    if (!VALID_STATUSES.has(status)) status = 'Pending';

    const order = {
      ID:            uuidv4(),
      AccountID:     resolvedAccountId,
      AccountName:   resolvedAccountName,
      StaffID:       '',
      StaffName:     '',
      OrderDate:     orderDate,
      DeliveryDate:  f.deliveryDate || '',
      InvoiceNumber: f.invoiceNumber || '',
      OrderAmount:   f.orderAmount  || '0',
      TaxAmount:     f.taxAmount    || '0',
      Notes:         f.notes        || '',
      Status:        status,
      CreatedAt:     today,
    };

    await addRow('ORDERS', order);

    res.status(201).json({ order });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
