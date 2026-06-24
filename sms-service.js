'use strict';

const https = require('https');
const { getAllRows } = require('./db');

/**
 * Get a setting value from the SETTINGS table.
 */
function getSetting(key) {
  const rows = getAllRows('SETTINGS');
  const row = rows.find(r => r.Key === key);
  return (row && row.Value) || '';
}

/**
 * Returns true if all three Twilio settings are configured.
 */
function isSmsConfigured() {
  return !!(getSetting('twilioAccountSid') && getSetting('twilioAuthToken') && getSetting('twilioFromNumber'));
}

/**
 * Format a phone number to E.164. Strips non-digits, prepends +1 for 10-digit US numbers.
 */
function formatPhoneE164(phone) {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits[0] === '1') return '+' + digits;
  if (phone.startsWith('+')) return phone;
  return '+' + digits;
}

/**
 * Send an SMS via Twilio REST API (no SDK needed).
 *
 * @param {object} opts
 * @param {string} opts.to   - Recipient phone number
 * @param {string} opts.body - Message text
 * @returns {Promise<{success: boolean, messageSid?: string, error?: string}>}
 */
function sendSms({ to, body }) {
  const accountSid = getSetting('twilioAccountSid');
  const authToken  = getSetting('twilioAuthToken');
  const fromNumber = getSetting('twilioFromNumber');

  if (!accountSid || !authToken || !fromNumber) {
    return Promise.resolve({ success: false, error: 'Twilio is not configured' });
  }

  const toFormatted = formatPhoneE164(to);
  if (!toFormatted) {
    return Promise.resolve({ success: false, error: 'Invalid phone number' });
  }

  const postData = new URLSearchParams({
    To:   toFormatted,
    From: formatPhoneE164(fromNumber),
    Body: body,
  }).toString();

  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

  const options = {
    hostname: 'api.twilio.com',
    path:     `/2010-04-01/Accounts/${accountSid}/Messages.json`,
    method:   'POST',
    headers: {
      'Content-Type':   'application/x-www-form-urlencoded',
      'Content-Length':  Buffer.byteLength(postData),
      'Authorization':  `Basic ${auth}`,
    },
  };

  return new Promise((resolve) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ success: true, messageSid: json.sid });
          } else {
            resolve({ success: false, error: json.message || `Twilio error (${res.statusCode})` });
          }
        } catch (e) {
          resolve({ success: false, error: `Failed to parse Twilio response (${res.statusCode})` });
        }
      });
    });

    req.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });

    req.write(postData);
    req.end();
  });
}

module.exports = { isSmsConfigured, sendSms, formatPhoneE164 };
