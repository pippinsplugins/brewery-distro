'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { addRow, updateRow } = require('../sheets');
const { isEmailConfigured, sendEmail } = require('../email-service');

const router = express.Router();

// ── Helpers ──────────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Create an Outreach log entry for an emailed account and update LastContacted.
 */
async function logOutreach(accountId, accountName, subject) {
  const entry = {
    ID:              uuidv4(),
    AccountID:       accountId,
    AccountName:     accountName || '',
    Date:            today(),
    Method:          'Email',
    Notes:           `Email: ${subject}`,
    FollowUpDate:    '',
    FollowUpStatus:  'None',
    CreatedAt:       new Date().toISOString(),
  };
  await addRow('OUTREACH', entry);

  // Update account's LastContacted (non-fatal if account was deleted)
  try {
    await updateRow('ACCOUNTS', accountId, { LastContacted: entry.Date });
  } catch (_) { /* ignore */ }
}

// ── Routes ───────────────────────────────────────────────────────────────

// GET /api/email/status — Check if email is configured
router.get('/status', (req, res) => {
  res.json({ configured: isEmailConfigured() });
});

// POST /api/email/send — Send individual email to one account
router.post('/send', async (req, res) => {
  try {
    if (!isEmailConfigured()) {
      return res.status(503).json({ error: 'Email is not configured. Google OAuth credentials are missing.' });
    }

    const { to, subject, body, accountId, accountName } = req.body;

    if (!to)      return res.status(400).json({ error: 'Recipient email is required' });
    if (!subject) return res.status(400).json({ error: 'Subject is required' });
    if (!body)    return res.status(400).json({ error: 'Message body is required' });

    const senderName  = req.user.name  || 'Brewery Team';
    const senderEmail = req.user.email || '';

    let status = 'sent';
    let error  = '';

    try {
      await sendEmail({ user: req.user, to, subject, body });
    } catch (err) {
      status = 'failed';
      error  = err.message;
    }

    // Log to EmailLog table
    const logEntry = {
      ID:          uuidv4(),
      SenderName:  senderName,
      SenderEmail: senderEmail,
      Recipients:  to,
      Subject:     subject,
      Body:        body,
      Type:        'individual',
      AccountIDs:  accountId || '',
      Status:      status,
      Error:       error,
      CreatedAt:   new Date().toISOString(),
    };
    await addRow('EMAIL_LOG', logEntry);

    if (status === 'failed') {
      return res.status(500).json({ error: `Failed to send email: ${error}` });
    }

    // Auto-log outreach for the account
    if (accountId) {
      await logOutreach(accountId, accountName, subject);
    }

    res.json({ success: true, messageId: logEntry.ID });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/email/bulk — Send bulk email to multiple accounts via BCC
router.post('/bulk', async (req, res) => {
  try {
    if (!isEmailConfigured()) {
      return res.status(503).json({ error: 'Email is not configured. Google OAuth credentials are missing.' });
    }

    const { recipients, subject, body } = req.body;
    // recipients: [{ email, accountId, accountName }, ...]

    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ error: 'At least one recipient is required' });
    }
    if (!subject) return res.status(400).json({ error: 'Subject is required' });
    if (!body)    return res.status(400).json({ error: 'Message body is required' });

    const bccEmails = recipients.map(r => r.email).filter(Boolean);
    if (bccEmails.length === 0) {
      return res.status(400).json({ error: 'None of the selected accounts have email addresses' });
    }

    const senderName  = req.user.name  || 'Brewery Team';
    const senderEmail = req.user.email || '';

    let status = 'sent';
    let error  = '';

    try {
      await sendEmail({ user: req.user, bcc: bccEmails, subject, body });
    } catch (err) {
      status = 'failed';
      error  = err.message;
    }

    // Log to EmailLog table
    const logEntry = {
      ID:          uuidv4(),
      SenderName:  senderName,
      SenderEmail: senderEmail,
      Recipients:  bccEmails.join(', '),
      Subject:     subject,
      Body:        body,
      Type:        'bulk',
      AccountIDs:  recipients.map(r => r.accountId).join(', '),
      Status:      status,
      Error:       error,
      CreatedAt:   new Date().toISOString(),
    };
    await addRow('EMAIL_LOG', logEntry);

    if (status === 'failed') {
      return res.status(500).json({ error: `Failed to send bulk email: ${error}` });
    }

    // Auto-log outreach for each account
    for (const r of recipients) {
      if (r.accountId) {
        await logOutreach(r.accountId, r.accountName, subject);
      }
    }

    res.json({ success: true, messageId: logEntry.ID, sent: bccEmails.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
