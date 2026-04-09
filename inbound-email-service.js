'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { v4: uuidv4 } = require('uuid');
const { getAllRows, getRow, addRow, updateRow } = require('./db');
require('dotenv').config();

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

  const today = new Date().toISOString().split('T')[0];
  const currentYear = new Date().getFullYear();

  const prompt = `You are an order-parsing assistant for a brewery distribution company. Extract order details from the email below.

Today's date is ${today}.

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
- For dates, assume the current year (${currentYear}) unless a different year is explicitly stated.
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

// ── Helpers ─────────────────────────────────────────────────────────

function buildEmailOrderNotes(parsedData, emailRow) {
  const parts = ['[Email Order]'];
  if (parsedData.notes) parts.push(parsedData.notes);
  if (emailRow) {
    parts.push('');
    parts.push('--- Original Email ---');
    parts.push(`From: ${emailRow.FromName || emailRow.From || ''}`);
    parts.push(`Subject: ${emailRow.Subject || ''}`);
    parts.push(`Date: ${emailRow.ReceivedAt ? new Date(emailRow.ReceivedAt).toLocaleString() : ''}`);
    parts.push('');
    // Include body, truncated to avoid bloating the notes field
    const body = (emailRow.Body || '').trim();
    parts.push(body.length > 1000 ? body.substring(0, 1000) + '...' : body);
  }
  return parts.join('\n').trim();
}

function extractEmailAddress(from) {
  if (!from) return '';
  // Extract email from "Name <email@example.com>" or plain "email@example.com"
  const match = from.match(/<([^>]+)>/);
  return match ? match[1].trim().toLowerCase() : from.trim().toLowerCase();
}

// ── Account & Product matching ──────────────────────────────────────

function matchAccountByEmail(senderEmail, accounts) {
  if (!senderEmail) return null;
  const lower = senderEmail.toLowerCase().trim();

  for (const a of accounts) {
    // Check primary Email field
    if (a.Email && a.Email.toLowerCase().trim() === lower) return a;

    // Check AdditionalEmails (stored as JSON array)
    if (a.AdditionalEmails) {
      let extras = [];
      try { extras = JSON.parse(a.AdditionalEmails); } catch { extras = []; }
      if (Array.isArray(extras) && extras.some(e => e && e.toLowerCase().trim() === lower)) return a;
    }
  }

  return null;
}

function matchAccount(name, accounts, senderEmail) {
  // Primary: match by sender email address
  if (senderEmail) {
    const byEmail = matchAccountByEmail(senderEmail, accounts);
    if (byEmail) return byEmail;
  }

  // Fallback: match by account name from parsed data
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

async function createDraftOrder(parsedData, inboundEmailId, senderEmail, emailRow) {
  const accounts = getAllRows('ACCOUNTS');
  const inventory = getAllRows('INVENTORY');

  // Match account — by sender email first, then by name
  const account = matchAccount(parsedData.accountName, accounts, senderEmail);
  const accountId = account ? account.ID : '';
  const accountName = account ? account.Name : (parsedData.accountName || 'Unknown');
  const location = account ? (account.ServicedBy || '') : '';

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
    Location: location,
    StaffID: '',
    StaffName: '',
    OrderDate: new Date().toISOString().split('T')[0],
    DeliveryDate: parsedData.deliveryDate || '',
    InvoiceNumber: '',
    OrderAmount: orderAmount.toFixed(2),
    TaxAmount: '',
    DepositAmount: '',
    Notes: buildEmailOrderNotes(parsedData, emailRow),
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

// ── Process a single inbound email (webhook entry point) ────────────

async function processInboundEmail(emailRow) {
  const geminiKey = getSetting('geminiApiKey');
  if (!geminiKey) {
    console.warn('[inbound-email] Gemini API key not configured — email stored but not parsed');
    return { status: 'pending', reason: 'gemini_key_missing' };
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

  try {
    const parsed = await parseEmailWithGemini(emailRow.Body, emailRow.Subject, accounts, productList);

    // Extract sender email from From field (e.g. "Name <email@example.com>")
    const senderEmail = extractEmailAddress(emailRow.From);

    // Fill in blanks from email metadata + account match
    const accountMatch = matchAccount(parsed.accountName, accounts, senderEmail);
    if (accountMatch) {
      if (!parsed.accountName) parsed.accountName = accountMatch.Name;
    }
    if (!parsed.contactName && emailRow.FromName) {
      parsed.contactName = emailRow.FromName;
    }

    updateRow('INBOUND_EMAILS', emailRow.ID, {
      Status: 'parsed',
      ParsedData: JSON.stringify(parsed),
      Error: '',
    });

    console.log(`[inbound-email] Parsed email ${emailRow.ID}: confidence=${parsed.confidence}, items=${(parsed.items || []).length}, account=${parsed.accountName || '?'}`);

    if (parsed.confidence === 'low') {
      updateRow('INBOUND_EMAILS', emailRow.ID, { Status: 'skipped' });
      console.log(`[inbound-email] Skipped email ${emailRow.ID} (low confidence)`);
      return { status: 'skipped', reason: 'low_confidence' };
    } else if (!parsed.items || parsed.items.length === 0) {
      console.log(`[inbound-email] No order created for email ${emailRow.ID} (no items parsed)`);
      return { status: 'parsed', reason: 'no_items' };
    } else if (accountMatch) {
      await createDraftOrder(parsed, emailRow.ID, senderEmail, emailRow);
      console.log(`[inbound-email] Draft order created for email ${emailRow.ID} (account: ${accountMatch.Name})`);
      return { status: 'order_created' };
    } else {
      // Leave as "parsed" for manual review
      console.log(`[inbound-email] Account not matched (name="${parsed.accountName || '?'}", email="${senderEmail || '?'}") — email ${emailRow.ID} left for manual review`);
      return { status: 'parsed', reason: 'account_not_matched' };
    }
  } catch (err) {
    console.error(`[inbound-email] Error parsing email ${emailRow.ID}:`, err.message);
    updateRow('INBOUND_EMAILS', emailRow.ID, {
      Status: 'error',
      Error: err.message,
    });
    return { status: 'error', error: err.message };
  }
}

// ── Startup fix: backfill Location on email orders ──────────────────

function fixEmailOrderLocations() {
  try {
    const orders = getAllRows('ORDERS');
    const accounts = getAllRows('ACCOUNTS');
    let fixed = 0;
    for (const order of orders) {
      if (!order.Location && (order.Notes || '').includes('[Email Order]') && order.AccountID) {
        const account = accounts.find(a => a.ID === order.AccountID);
        if (account && account.ServicedBy) {
          updateRow('ORDERS', order.ID, { Location: account.ServicedBy });
          fixed++;
        }
      }
    }
    if (fixed > 0) console.log(`[inbound-email] Fixed Location on ${fixed} email order(s)`);
  } catch (err) {
    console.error('[inbound-email] fixEmailOrderLocations error:', err.message);
  }
}

module.exports = {
  processInboundEmail,
  fixEmailOrderLocations,
  createDraftOrder,
  parseEmailWithGemini,
  matchAccount,
  matchAccountByEmail,
  extractEmailAddress,
  matchInventoryItem,
  buildEmailOrderNotes,
  getSetting,
  setSetting,
};
