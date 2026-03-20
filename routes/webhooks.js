'use strict';

const crypto = require('crypto');

/**
 * Webhook — Order Creation
 *
 * Endpoint:  POST /webhooks/order
 * Auth:      Authorization: Bearer <WEBHOOK_SECRET>
 *
 * Send a JSON POST request with the WEBHOOK_SECRET as a Bearer token
 * in the Authorization header. Works with any HTTP client, automation
 * platform (Zapier, Make, n8n, etc.), or custom script.
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
 *   status          | Status                          → Status          (Pending/Paid/Cancelled/Pre-Sale)
 *   notes           | Notes          | memo            → Notes
 *   location        | Location                        → Location        (warehouse / taproom name)
 *   staff_id        | StaffID                         → StaffID         (our internal staff ID)
 *   staff_name      | StaffName      | rep
 *                   | sales_rep                       → staff name lookup
 *   requested_products | RequestedProducts             → RequestedProducts (free-text product list)
 *   delivered        | Delivered                       → Delivered       (true/false, default false)
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
const { getAllRows, addRow } = require('../db');
const { processQboPaymentWebhook, getStoredTokens } = require('../qbo-service');

const router = express.Router();

// ── Auth middleware ──────────────────────────────────────────────

function requireWebhookSecret(req, res, next) {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) {
    return res.status(503).json({ error: 'Webhook not configured: WEBHOOK_SECRET is not set on this server.' });
  }

  const authHeader = req.headers['authorization'] || '';
  const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (!provided || provided.length !== secret.length ||
      !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(secret))) {
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
    location:      pick(body, 'Location',      'location'),
    staffId:       pick(body, 'StaffID',       'staff_id'),
    staffName:     pick(body, 'StaffName',     'staff_name',    'rep', 'sales_rep'),
    requestedProducts: pick(body, 'RequestedProducts', 'requested_products', 'products'),
    delivered:     pick(body, 'Delivered',      'delivered'),
  };
}

const VALID_STATUSES = new Set(['Pending', 'Paid', 'Cancelled', 'Pre-Sale']);

// Append current time to a date-only string so same-day orders sort by creation time.
function withTimestamp(dateStr) {
  if (!dateStr) return dateStr;
  if (dateStr.includes('T')) return dateStr;
  return dateStr + 'T' + new Date().toISOString().split('T')[1];
}

// ── POST /webhooks/order ──────────────────────────────────────────

router.post('/order', requireWebhookSecret, async (req, res) => {
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

    // Resolve staff (by ID or name lookup)
    let resolvedStaffId   = f.staffId;
    let resolvedStaffName = f.staffName;

    if (!resolvedStaffId && resolvedStaffName) {
      const staff = await getAllRows('STAFF');
      const match = staff.find(
        s => s.Name && s.Name.toLowerCase() === resolvedStaffName.toLowerCase()
      );
      if (match) {
        resolvedStaffId   = match.ID;
        resolvedStaffName = match.Name;
      }
    } else if (resolvedStaffId && !resolvedStaffName) {
      const staff = await getAllRows('STAFF');
      const match = staff.find(s => s.ID === resolvedStaffId);
      if (match) resolvedStaffName = match.Name;
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
      Location:      f.location || '',
      StaffID:       resolvedStaffId || '',
      StaffName:     resolvedStaffName || '',
      OrderDate:     orderDate,
      DeliveryDate:  f.deliveryDate || '',
      InvoiceNumber: f.invoiceNumber || '',
      OrderAmount:   f.orderAmount  || '0',
      TaxAmount:     f.taxAmount    || '0',
      Notes:         f.notes        || '',
      RequestedProducts: f.requestedProducts || '',
      Status:        status,
      Delivered:     f.delivered === 'true' ? 'true' : 'false',
      CreatedAt:     new Date().toISOString(),
    };

    await addRow('ORDERS', order);

    res.status(201).json({ order });
  } catch (err) {
    console.error(`[webhooks] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── QBO Webhook — Payment notifications ─────────────────────────

function verifyQboSignature(req, res, next) {
  const verifierToken = process.env.QBO_WEBHOOK_VERIFIER_TOKEN;
  if (!verifierToken) {
    return res.status(503).json({ error: 'QBO webhook not configured: QBO_WEBHOOK_VERIFIER_TOKEN is not set.' });
  }

  const signature = req.headers['intuit-signature'];
  if (!signature) {
    return res.status(401).json({ error: 'Missing intuit-signature header.' });
  }

  const hash = crypto
    .createHmac('sha256', verifierToken)
    .update(req.rawBody)
    .digest('base64');

  const hashBuf = Buffer.from(hash);
  const sigBuf  = Buffer.from(signature);

  if (hashBuf.length !== sigBuf.length || !crypto.timingSafeEqual(hashBuf, sigBuf)) {
    return res.status(401).json({ error: 'Invalid signature.' });
  }

  next();
}

router.post('/qbo', verifyQboSignature, (req, res) => {
  // Respond immediately — QBO requires a 200 within 10 seconds
  res.status(200).end();

  // Process payment notifications asynchronously
  (async () => {
    const tokens = await getStoredTokens();
    const ourRealmId = tokens?.realmId || null;
    const notifications = req.body.eventNotifications || [];
    let hasForeignNotifications = false;

    for (const notification of notifications) {
      // Skip notifications for a different QBO company
      if (ourRealmId && notification.realmId && notification.realmId !== ourRealmId) {
        hasForeignNotifications = true;
        continue;
      }

      const entities = notification.dataChangeEvent?.entities || [];
      for (const entity of entities) {
        if (entity.name === 'Payment' && entity.operation === 'Create') {
          processQboPaymentWebhook(entity.id).catch(err => {
            console.error(`[qbo-webhook] Error processing payment ${entity.id}:`, err.message);
          });
        }
      }
    }

    // Forward to another instance if there are notifications we didn't handle
    const forwardUrl = process.env.QBO_WEBHOOK_FORWARD_URL;
    if (hasForeignNotifications && forwardUrl) {
      try {
        await fetch(forwardUrl, {
          method: 'POST',
          headers: {
            'Content-Type':    'application/json',
            'intuit-signature': req.headers['intuit-signature'],
          },
          body: req.rawBody,
        });
      } catch (err) {
        console.error(`[qbo-webhook] Forward to ${forwardUrl} failed:`, err.message);
      }
    }
  })();
});

module.exports = router;
