'use strict';

const crypto = require('crypto');

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { processQboPaymentWebhook, getStoredTokens } = require('../qbo-service');
const { getAllRows, addRow } = require('../db');
const inboundEmailService = require('../inbound-email-service');

const router = express.Router();

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

// ── Inbound Email Webhook — Apps Script posts email data here ─────

router.post('/inbound-email', async (req, res) => {
  // Authenticate via Bearer token
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const expectedToken = inboundEmailService.getSetting('inboundEmailWebhookToken');

  if (!expectedToken || !token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Constant-time comparison
  const tokenBuf = Buffer.from(token);
  const expectedBuf = Buffer.from(expectedToken);
  if (tokenBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(tokenBuf, expectedBuf)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { messageId, from, to, subject, body, receivedAt } = req.body;
  if (!messageId) {
    return res.status(400).json({ error: 'messageId is required' });
  }

  // Deduplicate by GmailMessageId
  const existing = getAllRows('INBOUND_EMAILS');
  if (existing.some(e => e.GmailMessageId === messageId)) {
    return res.json({ skipped: true, reason: 'duplicate' });
  }

  // Extract FromName from "Name <email>" format
  const fromName = (from || '').replace(/<[^>]+>/, '').trim().replace(/^"(.*)"$/, '$1');

  const emailRow = {
    ID: uuidv4(),
    GmailMessageId: messageId,
    GmailThreadId: '',
    From: from || '',
    FromName: fromName,
    To: to || '',
    Subject: subject || '',
    Body: body || '',
    ReceivedAt: receivedAt ? new Date(receivedAt).toISOString() : new Date().toISOString(),
    Status: 'pending',
    ParsedData: '',
    OrderID: '',
    Error: '',
    CreatedAt: new Date().toISOString(),
  };

  addRow('INBOUND_EMAILS', emailRow);

  // Process asynchronously — parse with Gemini and create draft order
  const result = await inboundEmailService.processInboundEmail(emailRow);

  // Re-read to get the latest status after processing
  const updated = getAllRows('INBOUND_EMAILS').find(e => e.ID === emailRow.ID);
  res.json({
    success: true,
    emailId: emailRow.ID,
    status: updated ? updated.Status : result.status,
  });
});

module.exports = router;
