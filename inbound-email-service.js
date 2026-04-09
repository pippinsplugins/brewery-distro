'use strict';

const { google } = require('googleapis');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { v4: uuidv4 } = require('uuid');
const { getAllRows, getRow, addRow, updateRow } = require('./db');
require('dotenv').config();

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID     || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';

let _pollTimer = null;
let _isPolling = false;

// ── Settings helpers ────────────────────────────────────────────────

function getSetting(key) {
  const rows = getAllRows('SETTINGS');
  const row = rows.find(r => r.Key === key);
  return row ? row.Value : '';
}

function setSetting(key, value) {
  const rows = getAllRows('SETTINGS');
  const row = rows.find(r => r.Key === key);
  const now = new Date().toISOString();
  if (row) {
    updateRow('SETTINGS', row.ID, { Value: String(value), UpdatedAt: now });
  } else {
    addRow('SETTINGS', { ID: uuidv4(), Key: key, Value: String(value), UpdatedAt: now });
  }
}

// ── Google Auth ─────────────────────────────────────────────────────

function getStoredGoogleTokens() {
  const rows = getAllRows('SETTINGS');
  const tokenRow = rows.find(r => r.Key && r.Key.startsWith('google_refresh_token:'));
  if (!tokenRow || !tokenRow.Value) return null;
  return { refreshToken: tokenRow.Value };
}

function createGmailClient(userTokens) {
  if (!CLIENT_ID || !CLIENT_SECRET) return null;

  // Prefer explicit user tokens (from a logged-in session) over stored refresh token.
  // Session tokens always reflect the latest granted scopes.
  const tokens = userTokens || getStoredGoogleTokens();
  if (!tokens || (!tokens.refreshToken && !tokens.accessToken)) return null;

  const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
  const creds = {};
  if (tokens.accessToken)  creds.access_token  = tokens.accessToken;
  if (tokens.refreshToken) creds.refresh_token = tokens.refreshToken;
  oauth2Client.setCredentials(creds);
  return google.gmail({ version: 'v1', auth: oauth2Client });
}

// ── Email fetching ──────────────────────────────────────────────────

function extractPlainText(payload) {
  if (!payload) return '';

  // Single-part message
  if (payload.mimeType === 'text/plain' && payload.body && payload.body.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf-8');
  }

  // Multipart — walk recursively
  if (payload.parts) {
    // Prefer text/plain
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body && part.body.data) {
        return Buffer.from(part.body.data, 'base64').toString('utf-8');
      }
    }
    // Recurse into nested parts
    for (const part of payload.parts) {
      const text = extractPlainText(part);
      if (text) return text;
    }
    // Fall back to HTML with tag stripping
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body && part.body.data) {
        const html = Buffer.from(part.body.data, 'base64').toString('utf-8');
        return html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                   .replace(/<[^>]+>/g, ' ')
                   .replace(/&nbsp;/g, ' ')
                   .replace(/&amp;/g, '&')
                   .replace(/&lt;/g, '<')
                   .replace(/&gt;/g, '>')
                   .replace(/&#\d+;/g, '')
                   .replace(/\s+/g, ' ')
                   .trim();
      }
    }
  }

  // Single-part HTML fallback
  if (payload.mimeType === 'text/html' && payload.body && payload.body.data) {
    const html = Buffer.from(payload.body.data, 'base64').toString('utf-8');
    return html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
               .replace(/<[^>]+>/g, ' ')
               .replace(/&nbsp;/g, ' ')
               .replace(/\s+/g, ' ')
               .trim();
  }

  return '';
}

function getHeader(headers, name) {
  const h = (headers || []).find(h => h.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

async function fetchNewEmails(gmail, targetAddress) {
  // Use a fixed 7-day lookback window. Deduplication by GmailMessageId
  // ensures already-processed emails are never imported twice.
  const afterEpoch = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);

  const query = `to:${targetAddress} after:${afterEpoch}`;
  console.log(`[inbound-email] Gmail query: "${query}"`);
  const listRes = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: 50 });
  const messages = listRes.data.messages || [];
  console.log(`[inbound-email] Gmail returned ${messages.length} message(s)`);
  if (messages.length === 0) return [];

  // Deduplicate against already-processed emails
  const existing = getAllRows('INBOUND_EMAILS');
  const existingIds = new Set(existing.map(e => e.GmailMessageId));

  const newEmails = [];
  for (const msg of messages) {
    if (existingIds.has(msg.id)) continue;

    const full = await gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'full' });
    const payload = full.data.payload || {};
    const headers = payload.headers || [];

    const from = getHeader(headers, 'From');
    const fromName = from.replace(/<[^>]+>/, '').trim().replace(/^"(.*)"$/, '$1');
    const to = getHeader(headers, 'To');
    const subject = getHeader(headers, 'Subject');
    const date = getHeader(headers, 'Date');
    const body = extractPlainText(payload);

    const emailRow = {
      ID: uuidv4(),
      GmailMessageId: msg.id,
      GmailThreadId: msg.threadId || '',
      From: from,
      FromName: fromName,
      To: to,
      Subject: subject,
      Body: body,
      ReceivedAt: date ? new Date(date).toISOString() : new Date().toISOString(),
      Status: 'pending',
      ParsedData: '',
      OrderID: '',
      Error: '',
      CreatedAt: new Date().toISOString(),
    };

    addRow('INBOUND_EMAILS', emailRow);
    newEmails.push(emailRow);
  }

  return newEmails;
}

// ── Gemini parsing ──────────────────────────────────────────────────

async function parseEmailWithGemini(emailBody, subject, accounts, products) {
  const apiKey = getSetting('geminiApiKey');
  if (!apiKey) throw new Error('Gemini API key not configured');

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const accountNames = accounts.map(a => a.Name).filter(Boolean).join(', ');
  const productList = products.map(p => {
    const formats = (p.formats || []).join(', ');
    return `${p.Name}${formats ? ` (${formats})` : ''}`;
  }).join('; ');

  const prompt = `You are an order-parsing assistant for a brewery distribution company. Extract order details from the email below.

Known accounts: ${accountNames || '(none)'}
Known products: ${productList || '(none)'}

Email subject: ${subject}
Email body:
${emailBody}

Return ONLY valid JSON (no markdown, no code fences) with this structure:
{
  "accountName": "matched account name or the name from the email",
  "contactName": "person who sent the order",
  "deliveryDate": "YYYY-MM-DD or empty string",
  "notes": "any special instructions or notes",
  "items": [
    { "productName": "product name", "format": "format like 1/6 Keg, 16oz Can (case/24)", "quantity": 1 }
  ],
  "confidence": "high" | "medium" | "low"
}

Rules:
- Match account and product names to the known lists when possible (case-insensitive, fuzzy OK).
- If the email is clearly NOT an order (e.g. newsletter, auto-reply, internal), set confidence to "low" and items to [].
- Use "high" confidence when account and products are clearly identified.
- Use "medium" when some items or the account are ambiguous.
- Use "low" when the email doesn't appear to be an order at all.
- For quantities, default to 1 if not specified.
- Respond with ONLY the JSON object.`;

  const result = await model.generateContent(prompt);
  const text = result.response.text().trim();

  // Strip code fences if present
  const cleaned = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Failed to parse Gemini response: ${e.message}`);
  }
}

// ── Account & Product matching ──────────────────────────────────────

function matchAccount(name, accounts) {
  if (!name) return null;
  const lower = name.toLowerCase().trim();
  const normalize = s => s.toLowerCase().replace(/[''`.,\-!?&]/g, '').replace(/\s+/g, ' ').trim();
  const norm = normalize(name);

  // Exact match
  const exact = accounts.find(a => a.Name.toLowerCase().trim() === lower);
  if (exact) return exact;

  // Normalized match
  const normalized = accounts.find(a => normalize(a.Name) === norm);
  if (normalized) return normalized;

  // Substring
  const fuzzy = accounts.find(a =>
    lower.includes(a.Name.toLowerCase().trim()) ||
    a.Name.toLowerCase().trim().includes(lower)
  );
  if (fuzzy) return fuzzy;

  return null;
}

function matchInventoryItem(productName, format, inventory) {
  if (!productName) return null;
  const lower = productName.toLowerCase().trim();
  const fmtLower = (format || '').toLowerCase().trim();

  // Exact name + format
  if (fmtLower) {
    const exact = inventory.find(p => {
      const invName = (p.ProductName || p.Name || '').toLowerCase().trim();
      const invFmt = (p.Format || '').toLowerCase().trim();
      return invName === lower && invFmt && fmtLower.includes(invFmt);
    });
    if (exact) return exact;
  }

  // Exact name
  const byName = inventory.find(p => (p.ProductName || p.Name || '').toLowerCase().trim() === lower);
  if (byName) return byName;

  // Fuzzy name
  const fuzzy = inventory.find(p => {
    const n = (p.ProductName || p.Name || '').toLowerCase().trim();
    return n && (lower.includes(n) || n.includes(lower));
  });
  if (fuzzy) return fuzzy;

  return null;
}

// ── Draft order creation ────────────────────────────────────────────

async function createDraftOrder(parsedData, inboundEmailId) {
  const accounts = getAllRows('ACCOUNTS');
  const inventory = getAllRows('INVENTORY');

  // Match account
  const account = matchAccount(parsedData.accountName, accounts);
  const accountId = account ? account.ID : '';
  const accountName = account ? account.Name : (parsedData.accountName || 'Unknown');

  // Build order items
  const orderItems = [];
  for (const item of (parsedData.items || [])) {
    const inv = matchInventoryItem(item.productName, item.format, inventory);
    orderItems.push({
      ID: uuidv4(),
      InventoryID: inv ? inv.ID : '',
      ProductName: inv ? (inv.ProductName || inv.Name) : item.productName,
      Format: inv ? inv.Format : (item.format || ''),
      Quantity: String(item.quantity || 1),
      UnitPrice: inv ? (inv.PricePerUnit || '') : '',
      LineTotal: '',
      CreatedAt: new Date().toISOString(),
    });
  }

  // Calculate order amount
  let orderAmount = 0;
  for (const oi of orderItems) {
    const qty = parseFloat(oi.Quantity) || 0;
    const price = parseFloat(oi.UnitPrice) || 0;
    oi.LineTotal = (qty * price).toFixed(2);
    orderAmount += qty * price;
  }

  // Create order
  const orderId = uuidv4();
  const order = {
    ID: orderId,
    AccountID: accountId,
    AccountName: accountName,
    Location: '',
    StaffID: '',
    StaffName: '',
    OrderDate: new Date().toISOString().split('T')[0],
    DeliveryDate: parsedData.deliveryDate || '',
    InvoiceNumber: '',
    OrderAmount: orderAmount.toFixed(2),
    TaxAmount: '',
    DepositAmount: '',
    Notes: `[Email Order] ${parsedData.notes || ''}`.trim(),
    RequestedProducts: '',
    Status: 'Draft',
    Delivered: '',
    PaymentMethod: '',
    PaymentReference: '',
    PaymentDate: '',
    QboPaymentId: '',
    QboInvoiceId: '',
    QboSyncStatus: '',
    QboSyncError: '',
    InvoicePdf: '',
    CreatedAt: new Date().toISOString(),
  };

  addRow('ORDERS', order);

  // Create order items
  for (const oi of orderItems) {
    oi.OrderID = orderId;
    addRow('ORDER_ITEMS', oi);
  }

  // Update inbound email
  updateRow('INBOUND_EMAILS', inboundEmailId, {
    Status: 'order_created',
    OrderID: orderId,
  });

  return { orderId, order, orderItems };
}

// ── Email parsing pipeline ──────────────────────────────────────────

async function parseEmails(emails) {
  let ordersCreated = 0;
  let errors = 0;

  const geminiKey = getSetting('geminiApiKey');
  if (!geminiKey) {
    console.warn('[inbound-email] Gemini API key not configured — emails stored but not parsed');
    return { ordersCreated: 0, errors: 0 };
  }

  const accounts = getAllRows('ACCOUNTS');
  const products = getAllRows('PRODUCTS');
  const inventoryRows = getAllRows('INVENTORY');
  const productList = products.map(p => {
    const formats = inventoryRows
      .filter(i => i.ProductID === p.ID && i.Format)
      .map(i => i.Format);
    return { Name: p.Name, formats: [...new Set(formats)] };
  });

  for (const email of emails) {
    try {
      const parsed = await parseEmailWithGemini(email.Body, email.Subject, accounts, productList);
      updateRow('INBOUND_EMAILS', email.ID, {
        Status: 'parsed',
        ParsedData: JSON.stringify(parsed),
        Error: '',
      });

      // Auto-create draft if confidence is not low and has items
      if (parsed.confidence !== 'low' && parsed.items && parsed.items.length > 0) {
        await createDraftOrder(parsed, email.ID);
        ordersCreated++;
      } else if (parsed.confidence === 'low') {
        updateRow('INBOUND_EMAILS', email.ID, { Status: 'skipped' });
      }
    } catch (err) {
      console.error(`[inbound-email] Error parsing email ${email.ID}:`, err.message);
      updateRow('INBOUND_EMAILS', email.ID, {
        Status: 'error',
        Error: err.message,
      });
      errors++;
    }
  }

  return { ordersCreated, errors };
}

// ── Poll orchestrator ───────────────────────────────────────────────

async function pollOnce(userTokens) {
  const enabled = getSetting('inboundEmailEnabled');
  if (enabled !== 'true') return { skipped: true, reason: 'disabled' };

  const targetAddress = getSetting('inboundEmail');
  if (!targetAddress) return { skipped: true, reason: 'no target address' };

  const gmail = createGmailClient(userTokens);
  if (!gmail) return { skipped: true, reason: 'no Google OAuth tokens — log in to grant access' };

  try {
    setSetting('inboundEmailLastPoll', new Date().toISOString());

    // Fetch new emails (7-day lookback, deduped by GmailMessageId)
    const newEmails = await fetchNewEmails(gmail, targetAddress);
    console.log(`[inbound-email] Fetched ${newEmails.length} new email(s)`);

    // Collect emails that need parsing: newly fetched + any pending/error in the queue
    const queued = getAllRows('INBOUND_EMAILS')
      .filter(e => e.Status === 'pending' || e.Status === 'error');
    const emailsToParse = [...newEmails, ...queued.filter(q => !newEmails.some(n => n.ID === q.ID))];

    const { ordersCreated, errors } = await parseEmails(emailsToParse);

    setSetting('inboundEmailLastError', '');
    return { fetched: newEmails.length, ordersCreated, errors };
  } catch (err) {
    const msg = err.message || String(err);
    // Surface a helpful message for scope/permission errors
    const userMsg = /insufficient permission/i.test(msg)
      ? 'Insufficient Permission — click "Re-authorize Google" in Settings to grant inbox read access, then try again.'
      : msg;
    console.error('[inbound-email] Poll error:', msg);
    setSetting('inboundEmailLastError', userMsg);
    throw new Error(userMsg);
  }
}

function startPolling() {
  if (_pollTimer) return;
  const enabled = getSetting('inboundEmailEnabled');
  if (enabled !== 'true') return;

  const intervalSec = parseInt(getSetting('inboundEmailInterval')) || 300;
  console.log(`[inbound-email] Starting polling every ${intervalSec}s`);

  _pollTimer = setInterval(async () => {
    if (_isPolling) return;
    _isPolling = true;
    try {
      await pollOnce();
    } catch (e) {
      // already logged in pollOnce
    } finally {
      _isPolling = false;
    }
  }, intervalSec * 1000);
}

function stopPolling() {
  if (_pollTimer) {
    clearInterval(_pollTimer);
    _pollTimer = null;
    console.log('[inbound-email] Polling stopped');
  }
}

function isRunning() {
  return !!_pollTimer;
}

module.exports = {
  pollOnce,
  startPolling,
  stopPolling,
  isRunning,
  createDraftOrder,
  parseEmailWithGemini,
  getSetting,
};
