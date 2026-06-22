'use strict';

const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { addRow, updateRow, getAllRows } = require('../db');
const { isEmailConfigured, sendEmail } = require('../email-service');

const router = express.Router();

// Gmail's per-message hard limit is 25 MB. Cap each file at 20 MB and the
// whole request at 25 MB to leave headroom for base64 inflation (~33%) and
// MIME overhead. Files live in memory; nothing is persisted to disk.
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_REQUEST_BYTES = 25 * 1024 * 1024;
const emailUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 10, fieldSize: 1024 * 1024 },
}).array('attachments', 10);

// Wrap multer in a middleware that surfaces friendly errors and rejects
// total payloads exceeding MAX_REQUEST_BYTES (multer's `fileSize` is per
// file; we want a combined cap so a user can't attach 5×20MB).
function uploadAttachments(req, res, next) {
  emailUpload(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? 'Attachment exceeds 20 MB limit'
        : err.code === 'LIMIT_FILE_COUNT'
        ? 'Too many attachments (max 10)'
        : err.message;
      return res.status(400).json({ error: msg });
    }
    const totalBytes = (req.files || []).reduce((s, f) => s + f.size, 0);
    if (totalBytes > MAX_REQUEST_BYTES) {
      return res.status(400).json({ error: 'Attachments exceed 25 MB total' });
    }
    next();
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().split('T')[0];
}

function getReplyToAddress(user) {
  const rows = getAllRows('SETTINGS');
  const row = rows.find(r => r.Key === 'inboundEmail');
  return (row && row.Value) ? row.Value : (user.email || '');
}

/**
 * Validate that a requested fromEmail belongs to the user's STAFF record.
 * Falls back to the OAuth email if missing or invalid.
 */
function validateFromEmail(oauthEmail, fromEmail) {
  if (!fromEmail) return oauthEmail;
  const requested = fromEmail.trim().toLowerCase();
  if (requested === oauthEmail.toLowerCase()) return fromEmail.trim();

  const staffRows = getAllRows('STAFF');
  const oauthLower = oauthEmail.toLowerCase();
  for (const s of staffRows) {
    if (!s.Email) continue;
    const emails = s.Email.split(',').map(e => e.trim()).filter(Boolean);
    if (emails.some(e => e.toLowerCase() === oauthLower) &&
        emails.some(e => e.toLowerCase() === requested)) {
      return fromEmail.trim();
    }
  }
  return oauthEmail;
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

// Decode an array field that may arrive as either a JSON string (multipart
// form-data) or an already-parsed array (legacy application/json caller).
function parseMaybeJsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch { return []; }
}

// Convert Multer file rows into the shape sendEmail expects.
function mapAttachments(files) {
  return (files || []).map(f => ({
    filename: f.originalname,
    mimeType: f.mimetype,
    content:  f.buffer,
  }));
}

// POST /api/email/send — Send individual email to one account.
// Accepts multipart/form-data for attachments; legacy JSON callers without
// files still work because multer just leaves req.body as the form fields.
router.post('/send', uploadAttachments, async (req, res) => {
  try {
    if (!isEmailConfigured()) {
      return res.status(503).json({ error: 'Email is not configured. Google OAuth credentials are missing.' });
    }

    const { to, cc, subject, body, accountId, accountName, fromEmail } = req.body;

    if (!to)      return res.status(400).json({ error: 'Recipient email is required' });
    if (!subject) return res.status(400).json({ error: 'Subject is required' });
    if (!body)    return res.status(400).json({ error: 'Message body is required' });

    // Validate fromEmail belongs to this user's staff record
    const validatedFrom = validateFromEmail(req.user.email, fromEmail);
    const senderName  = req.user.name  || 'Brewery Team';
    const senderEmail = validatedFrom;
    const ccEmails = parseMaybeJsonArray(cc);
    const attachments = mapAttachments(req.files);

    let status = 'sent';
    let error  = '';

    try {
      await sendEmail({ user: req.user, to, cc: ccEmails.length > 0 ? ccEmails : undefined, replyTo: getReplyToAddress(req.user), subject, body, fromEmail: validatedFrom, attachments });
    } catch (err) {
      status = 'failed';
      error  = err.message;
    }

    // Log to EmailLog table
    const allRecipients = [to, ...ccEmails].filter(Boolean).join(', ');
    const logEntry = {
      ID:          uuidv4(),
      SenderName:  senderName,
      SenderEmail: senderEmail,
      Recipients:  allRecipients,
      Subject:     subject,
      Body:        body,
      Type:        'individual',
      AccountIDs:  accountId || '',
      Attachments: attachments.map(a => a.filename).join(', '),
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
    console.error(`[email] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/email/bulk — Send bulk email to multiple accounts via BCC.
// Accepts multipart/form-data; `recipients` is sent as a JSON string field.
router.post('/bulk', uploadAttachments, async (req, res) => {
  try {
    if (!isEmailConfigured()) {
      return res.status(503).json({ error: 'Email is not configured. Google OAuth credentials are missing.' });
    }

    const { subject, body, fromEmail } = req.body;
    const recipients = parseMaybeJsonArray(req.body.recipients);
    // recipients: [{ email, additionalEmails, accountId, accountName }, ...]

    if (!recipients || recipients.length === 0) {
      return res.status(400).json({ error: 'At least one recipient is required' });
    }
    if (!subject) return res.status(400).json({ error: 'Subject is required' });
    if (!body)    return res.status(400).json({ error: 'Message body is required' });

    // Validate fromEmail belongs to this user's staff record
    const validatedFrom = validateFromEmail(req.user.email, fromEmail);

    const bccEmails = [];
    for (const r of recipients) {
      if (r.email) bccEmails.push(r.email);
      if (Array.isArray(r.additionalEmails)) {
        for (const ae of r.additionalEmails) {
          if (ae) bccEmails.push(ae);
        }
      }
    }
    if (bccEmails.length === 0) {
      return res.status(400).json({ error: 'None of the selected accounts have email addresses' });
    }

    const senderName  = req.user.name  || 'Brewery Team';
    const senderEmail = validatedFrom;
    const attachments = mapAttachments(req.files);

    let status = 'sent';
    let error  = '';

    try {
      await sendEmail({ user: req.user, bcc: bccEmails, replyTo: getReplyToAddress(req.user), subject, body, fromEmail: validatedFrom, attachments });
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
      Attachments: attachments.map(a => a.filename).join(', '),
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
    console.error(`[email] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
