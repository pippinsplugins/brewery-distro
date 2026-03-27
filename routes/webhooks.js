'use strict';

const crypto = require('crypto');

const express = require('express');
const { processQboPaymentWebhook, getStoredTokens } = require('../qbo-service');

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

module.exports = router;
