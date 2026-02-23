'use strict';

const nodemailer = require('nodemailer');
require('dotenv').config();

const GMAIL_USER         = process.env.GMAIL_USER || '';
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || '';

/**
 * Returns true if the Gmail SMTP credentials are configured.
 */
function isEmailConfigured() {
  return !!(GMAIL_USER && GMAIL_APP_PASSWORD);
}

/**
 * Lazily-initialised reusable transporter (nodemailer recommends reuse).
 */
let _transporter;
function getTransporter() {
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: GMAIL_USER,
        pass: GMAIL_APP_PASSWORD,
      },
    });
  }
  return _transporter;
}

/**
 * Send a single email.
 *
 * @param {object} opts
 * @param {string} opts.senderName   - Display name (staff member's name)
 * @param {string} opts.replyTo      - Staff member's email address
 * @param {string} [opts.to]         - Single recipient (individual send)
 * @param {string[]} [opts.bcc]      - BCC recipients (bulk send)
 * @param {string} opts.subject
 * @param {string} opts.body         - Plain-text body
 * @returns {Promise<object>}        - nodemailer info object
 */
async function sendEmail({ senderName, replyTo, to, bcc, subject, body }) {
  if (!isEmailConfigured()) {
    throw new Error('Email is not configured. Set GMAIL_USER and GMAIL_APP_PASSWORD in .env');
  }

  const transporter = getTransporter();

  const mailOptions = {
    from:    `"${senderName}" <${GMAIL_USER}>`,
    replyTo: replyTo,
    subject: subject,
    text:    body,
  };

  if (to) mailOptions.to = to;

  if (bcc && bcc.length > 0) {
    mailOptions.bcc = bcc.join(', ');
    // For bulk: put the shared Gmail in "to" so the To header isn't empty
    if (!mailOptions.to) mailOptions.to = GMAIL_USER;
  }

  return transporter.sendMail(mailOptions);
}

module.exports = { isEmailConfigured, sendEmail };
