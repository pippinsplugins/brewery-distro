'use strict';

const nodemailer = require('nodemailer');
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
 * Send a single email using the authenticated user's Gmail via OAuth2.
 *
 * @param {object} opts
 * @param {object} opts.user         - req.user (must include email, accessToken, refreshToken)
 * @param {string} [opts.to]         - Single recipient (individual send)
 * @param {string[]} [opts.bcc]      - BCC recipients (bulk send)
 * @param {string} opts.subject
 * @param {string} opts.body         - Plain-text body
 * @returns {Promise<object>}        - nodemailer info object
 */
async function sendEmail({ user, to, bcc, subject, body }) {
  if (!isEmailConfigured()) {
    throw new Error('Email is not configured. Google OAuth credentials are missing.');
  }
  if (!user || !user.accessToken) {
    throw new Error('No OAuth tokens available. Please log out and log back in.');
  }

  // Create a per-send transporter with the user's OAuth2 tokens.
  // Nodemailer handles token refresh automatically via the refresh token.
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      type:         'OAuth2',
      user:         user.email,
      clientId:     CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      refreshToken: user.refreshToken,
      accessToken:  user.accessToken,
    },
  });

  const mailOptions = {
    from:    user.email,
    subject: subject,
    text:    body,
  };

  if (to) mailOptions.to = to;

  if (bcc && bcc.length > 0) {
    mailOptions.bcc = bcc.join(', ');
    // For bulk: put the sender in "to" so the To header isn't empty
    if (!mailOptions.to) mailOptions.to = user.email;
  }

  return transporter.sendMail(mailOptions);
}

module.exports = { isEmailConfigured, sendEmail };
