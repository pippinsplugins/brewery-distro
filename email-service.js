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

/**
 * Build a base64url-encoded RFC 2822 email message.
 */
function buildRawMessage({ from, to, cc, bcc, replyTo, subject, body }) {
  const lines = [
    `From: ${sanitizeHeader(from)}`,
    `To: ${sanitizeHeader(to)}`,
  ];
  if (cc) lines.push(`Cc: ${sanitizeHeader(cc)}`);
  if (bcc) lines.push(`Bcc: ${sanitizeHeader(bcc)}`);
  if (replyTo) lines.push(`Reply-To: ${sanitizeHeader(replyTo)}`);
  lines.push(
    `Subject: ${sanitizeHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    body,
  );
  const message = lines.join('\r\n');
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
async function sendEmail({ user, to, cc, bcc, replyTo, subject, body, fromEmail }) {
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
  });

  const result = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw },
  });

  return result.data;
}

module.exports = { isEmailConfigured, getRefreshToken, sendEmail };
