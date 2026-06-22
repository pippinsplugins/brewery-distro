'use strict';

const { google } = require('googleapis');
const { getRow } = require('./db');
require('dotenv').config();

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID     || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';

/**
 * Returns true if OAuth credentials are configured (email feature available).
 */
function isEmailConfigured() {
  return !!(CLIENT_ID && CLIENT_SECRET);
}

/**
 * Look up the stored Google refresh token for a user from the Settings table.
 */
function getRefreshToken(userId) {
  if (!userId) return '';
  const row = getRow('SETTINGS', `google_refresh_token:${userId}`);
  return (row && row.Value) || '';
}

/**
 * Strip CR/LF from a header value to prevent email header injection.
 */
function sanitizeHeader(value) {
  return String(value).replace(/[\r\n]/g, '');
}

// RFC 2047 encoded-word for filenames containing non-ASCII characters.
// Gmail accepts UTF-8 in raw form for most filenames, but encoded-word is the
// portable choice for cross-client display.
function encodeMimeFilename(name) {
  if (/^[\x20-\x7e]+$/.test(name)) return name;
  return `=?UTF-8?B?${Buffer.from(name, 'utf8').toString('base64')}?=`;
}

// Wrap base64 content at 76 chars per line per RFC 5322 / 2045.
function wrapBase64(b64) {
  return b64.replace(/.{1,76}/g, '$&\r\n').trimEnd();
}

/**
 * Build a base64url-encoded RFC 2822 email message. When `attachments` is
 * provided (array of { filename, content: Buffer, mimeType }), the message is
 * built as multipart/mixed with a text/plain body part followed by one
 * base64-encoded part per attachment. Without attachments, the message keeps
 * the historical single-part text/plain shape (no behavior change).
 */
function buildRawMessage({ from, to, cc, bcc, replyTo, subject, body, attachments }) {
  const headers = [
    `From: ${sanitizeHeader(from)}`,
    `To: ${sanitizeHeader(to)}`,
  ];
  if (cc) headers.push(`Cc: ${sanitizeHeader(cc)}`);
  if (bcc) headers.push(`Bcc: ${sanitizeHeader(bcc)}`);
  if (replyTo) headers.push(`Reply-To: ${sanitizeHeader(replyTo)}`);
  headers.push(`Subject: ${sanitizeHeader(subject)}`);
  headers.push('MIME-Version: 1.0');

  const hasAttachments = Array.isArray(attachments) && attachments.length > 0;

  let message;
  if (!hasAttachments) {
    message = [
      ...headers,
      'Content-Type: text/plain; charset=UTF-8',
      '',
      body,
    ].join('\r\n');
  } else {
    const boundary = `=_shbdist_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const parts = [
      `Content-Type: text/plain; charset=UTF-8`,
      `Content-Transfer-Encoding: 7bit`,
      '',
      body,
    ].join('\r\n');

    const attachmentParts = attachments.map(att => {
      const safeName = encodeMimeFilename(att.filename || 'attachment');
      const mime = att.mimeType || 'application/octet-stream';
      const b64 = wrapBase64(Buffer.from(att.content).toString('base64'));
      return [
        `Content-Type: ${mime}; name="${safeName}"`,
        `Content-Disposition: attachment; filename="${safeName}"`,
        `Content-Transfer-Encoding: base64`,
        '',
        b64,
      ].join('\r\n');
    });

    message = [
      ...headers,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      parts,
      ...attachmentParts.flatMap(p => [`--${boundary}`, p]),
      `--${boundary}--`,
      '',
    ].join('\r\n');
  }
  return Buffer.from(message).toString('base64url');
}

/**
 * Send a single email using the authenticated user's Gmail via the Gmail API.
 *
 * @param {object} opts
 * @param {object} opts.user         - req.user (must include id, email)
 * @param {string} [opts.to]         - Single recipient (individual send)
 * @param {string[]} [opts.bcc]      - BCC recipients (bulk send)
 * @param {string} opts.subject
 * @param {string} opts.body         - Plain-text body
 * @returns {Promise<object>}        - Gmail API response
 */
async function sendEmail({ user, to, cc, bcc, replyTo, subject, body, fromEmail, attachments }) {
  if (!isEmailConfigured()) {
    throw new Error('Email is not configured. Google OAuth credentials are missing.');
  }
  if (!user || !user.id) {
    throw new Error('No authenticated user. Please log out and log back in.');
  }

  const refreshToken = getRefreshToken(user.id);
  if (!refreshToken) {
    throw new Error('No OAuth refresh token found. Please log out and log back in with Google.');
  }

  const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  const toAddress = to || user.email;
  const ccAddress = cc && cc.length > 0 ? cc.join(', ') : undefined;
  const bccAddress = bcc && bcc.length > 0 ? bcc.join(', ') : undefined;

  const raw = buildRawMessage({
    from:    fromEmail || user.email,
    to:      toAddress,
    cc:      ccAddress,
    bcc:     bccAddress,
    replyTo,
    subject,
    body,
    attachments,
  });

  const result = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw },
  });

  return result.data;
}

module.exports = { isEmailConfigured, getRefreshToken, sendEmail };
