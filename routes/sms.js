'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { addRow, updateRow } = require('../db');
const { isSmsConfigured, sendSms, formatPhoneE164 } = require('../sms-service');

const router = express.Router();

function today() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Create an Outreach log entry for a texted account and update LastContacted.
 */
async function logOutreach(accountId, accountName, bodyPreview) {
  const preview = (bodyPreview || '').substring(0, 80);
  const entry = {
    ID:              uuidv4(),
    AccountID:       accountId,
    AccountName:     accountName || '',
    Date:            today(),
    Method:          'SMS',
    Notes:           `SMS: ${preview}${bodyPreview && bodyPreview.length > 80 ? '...' : ''}`,
    FollowUpDate:    '',
    FollowUpStatus:  'None',
    CreatedAt:       new Date().toISOString(),
  };
  await addRow('OUTREACH', entry);

  try {
    await updateRow('ACCOUNTS', accountId, { LastContacted: entry.Date });
  } catch (_) { /* ignore */ }
}

// GET /api/sms/status — Check if SMS is configured
router.get('/status', (req, res) => {
  res.json({ configured: isSmsConfigured() });
});

// POST /api/sms/send — Send individual SMS to one account
router.post('/send', async (req, res) => {
  try {
    if (!isSmsConfigured()) {
      return res.status(503).json({ error: 'SMS is not configured. Add Twilio credentials in Settings.' });
    }

    const { to, body, accountId, accountName } = req.body;

    if (!to)   return res.status(400).json({ error: 'Recipient phone number is required' });
    if (!body) return res.status(400).json({ error: 'Message body is required' });

    const senderName  = req.user.name  || 'Brewery Team';
    const senderEmail = req.user.email || '';

    const result = await sendSms({ to, body });

    // Log to SmsLog table
    const logEntry = {
      ID:          uuidv4(),
      SenderName:  senderName,
      SenderEmail: senderEmail,
      Recipient:   formatPhoneE164(to),
      Body:        body,
      Type:        'individual',
      AccountID:   accountId || '',
      AccountName: accountName || '',
      TwilioSid:   result.messageSid || '',
      Status:      result.success ? 'sent' : 'failed',
      Error:       result.error || '',
      CreatedAt:   new Date().toISOString(),
    };
    await addRow('SMS_LOG', logEntry);

    if (!result.success) {
      return res.status(500).json({ error: `Failed to send SMS: ${result.error}` });
    }

    // Auto-log outreach
    if (accountId) {
      await logOutreach(accountId, accountName, body);
    }

    res.json({ success: true, messageSid: result.messageSid });
  } catch (err) {
    console.error(`[sms] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/sms/bulk — Send bulk SMS to multiple accounts
router.post('/bulk', async (req, res) => {
  try {
    if (!isSmsConfigured()) {
      return res.status(503).json({ error: 'SMS is not configured. Add Twilio credentials in Settings.' });
    }

    const { recipients, body } = req.body;

    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ error: 'At least one recipient is required' });
    }
    if (!body) return res.status(400).json({ error: 'Message body is required' });

    const senderName  = req.user.name  || 'Brewery Team';
    const senderEmail = req.user.email || '';

    let sent = 0;
    let failed = 0;

    for (const r of recipients) {
      if (!r.phone) { failed++; continue; }

      const result = await sendSms({ to: r.phone, body });

      // Log each send
      const logEntry = {
        ID:          uuidv4(),
        SenderName:  senderName,
        SenderEmail: senderEmail,
        Recipient:   formatPhoneE164(r.phone),
        Body:        body,
        Type:        'bulk',
        AccountID:   r.accountId || '',
        AccountName: r.accountName || '',
        TwilioSid:   result.messageSid || '',
        Status:      result.success ? 'sent' : 'failed',
        Error:       result.error || '',
        CreatedAt:   new Date().toISOString(),
      };
      await addRow('SMS_LOG', logEntry);

      if (result.success) {
        sent++;
        if (r.accountId) {
          await logOutreach(r.accountId, r.accountName, body);
        }
      } else {
        failed++;
      }
    }

    res.json({ success: true, sent, failed });
  } catch (err) {
    console.error(`[sms] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
