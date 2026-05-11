'use strict';

const OAuthClient = require('intuit-oauth');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const { getAllRows, getRow, addRow, updateRow } = require('./db');
require('dotenv').config();

const QBO_CLIENT_ID     = process.env.QBO_CLIENT_ID     || '';
const QBO_CLIENT_SECRET = process.env.QBO_CLIENT_SECRET || '';
const QBO_ENVIRONMENT   = process.env.QBO_ENVIRONMENT   || 'sandbox';
const QBO_REDIRECT_URI  = process.env.QBO_REDIRECT_URI  || '';

const BASE_URL = QBO_ENVIRONMENT === 'production'
  ? 'https://quickbooks.api.intuit.com'
  : 'https://sandbox-quickbooks.api.intuit.com';

const QBO_APP_URL = QBO_ENVIRONMENT === 'production'
  ? 'https://app.qbo.intuit.com'
  : 'https://app.sandbox.qbo.intuit.com';

// ── Configuration check ──────────────────────────────────────────

function isQboConfigured() {
  return !!(QBO_CLIENT_ID && QBO_CLIENT_SECRET);
}

// ── OAuth client ─────────────────────────────────────────────────

function getOAuthClient(redirectUri) {
  return new OAuthClient({
    clientId:     QBO_CLIENT_ID,
    clientSecret: QBO_CLIENT_SECRET,
    environment:  QBO_ENVIRONMENT,
    redirectUri:  redirectUri || QBO_REDIRECT_URI,
  });
}

// ── Token storage (SETTINGS table) ──────────────────────────────

async function getStoredTokens() {
  const rows = await getAllRows('SETTINGS');
  const row = rows.find(r => r.Key === 'qboTokens');
  if (!row || !row.Value) return null;
  try {
    return JSON.parse(row.Value);
  } catch {
    return null;
  }
}

async function storeTokens(tokenData) {
  const rows = await getAllRows('SETTINGS');
  const existing = rows.find(r => r.Key === 'qboTokens');
  const value = JSON.stringify(tokenData);
  const now = new Date().toISOString().split('T')[0];
  if (existing) {
    await updateRow('SETTINGS', existing.ID, { Value: value, UpdatedAt: now });
  } else {
    await addRow('SETTINGS', { ID: uuidv4(), Key: 'qboTokens', Value: value, UpdatedAt: now });
  }
}

async function clearTokens() {
  const rows = await getAllRows('SETTINGS');
  const existing = rows.find(r => r.Key === 'qboTokens');
  if (existing) {
    await updateRow('SETTINGS', existing.ID, { Value: '', UpdatedAt: new Date().toISOString().split('T')[0] });
  }
}

// ── Token refresh ────────────────────────────────────────────────

// Deduplication: prevent concurrent refresh calls from racing and
// invalidating each other's refresh tokens.
let _refreshPromise = null;

async function getValidToken(forceRefresh = false) {
  const tokens = await getStoredTokens();
  if (!tokens || !tokens.accessToken || !tokens.refreshToken) return null;

  // Check if access token is expired (with 5-min buffer)
  const expiresAt = tokens.expiresAt || 0;
  const now = Date.now();
  if (!forceRefresh && now < expiresAt - 5 * 60 * 1000) {
    return tokens;
  }

  // If a refresh is already in progress, wait for it instead of starting another
  if (_refreshPromise) {
    return _refreshPromise;
  }

  _refreshPromise = _doRefresh(tokens);
  try {
    return await _refreshPromise;
  } finally {
    _refreshPromise = null;
  }
}

async function _doRefresh(tokens) {
  const TOKEN_ENDPOINT = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
  const credentials = Buffer.from(`${QBO_CLIENT_ID}:${QBO_CLIENT_SECRET}`).toString('base64');
  const tail = (s) => s ? s.slice(-4) : '????';

  for (let attempt = 0; attempt < 2; attempt++) {
    // On retry, re-read tokens from DB — another concurrent request may have
    // already refreshed successfully, giving us a new valid refresh token.
    let currentTokens = tokens;
    if (attempt > 0) {
      const stored = await getStoredTokens();
      if (stored && stored.refreshToken) {
        // If the stored tokens are already valid (not expired), just use them
        if (stored.expiresAt && Date.now() < stored.expiresAt - 60 * 1000) {
          console.log(`[qbo-refresh] Attempt ${attempt}: stored tokens are already valid (expires ${new Date(stored.expiresAt).toISOString()}), using them`);
          return stored;
        }
        currentTokens = stored;
        console.log(`[qbo-refresh] Attempt ${attempt}: re-read tokens from DB (refresh …${tail(currentTokens.refreshToken)})`);
      }
    }

    console.log(`[qbo-refresh] Attempt ${attempt}: refreshing with token …${tail(currentTokens.refreshToken)}`);

    try {
      const resp = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type':  'application/x-www-form-urlencoded',
          'Accept':        'application/json',
        },
        body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(currentTokens.refreshToken)}`,
      });

      const body = await resp.text();
      console.log(`[qbo-refresh] Attempt ${attempt}: Intuit responded ${resp.status}`);

      if (!resp.ok) {
        const isInvalidGrant = /invalid_grant/i.test(body);
        if (isInvalidGrant) {
          // On first attempt, don't clear yet — check if DB has newer tokens
          if (attempt === 0) {
            console.warn(`[qbo-refresh] Got invalid_grant on attempt 0, will retry with fresh DB tokens`);
            await new Promise(r => setTimeout(r, 500));
            continue;
          }
          console.error(`[qbo-refresh] Refresh token is invalid (invalid_grant) — clearing stored tokens`);
          await clearTokens();
          throw new Error('QuickBooks refresh token expired — please reconnect in Settings.');
        }

        // Transient error (5xx, network issue, etc.)
        if (attempt === 0) {
          console.warn(`[qbo-refresh] Transient error ${resp.status}, will retry: ${body.slice(0, 200)}`);
          await new Promise(r => setTimeout(r, 1000));
          continue;
        }

        throw new Error(`QuickBooks token refresh failed (${resp.status}) — try again shortly.`);
      }

      const refreshed = JSON.parse(body);
      const newTokens = {
        accessToken:  refreshed.access_token,
        refreshToken: refreshed.refresh_token,
        realmId:      currentTokens.realmId,
        expiresAt:    Date.now() + (refreshed.expires_in || 3600) * 1000,
      };
      await storeTokens(newTokens);
      console.log(`[qbo-refresh] Success — new access token stored, refresh …${tail(newTokens.refreshToken)}, expires ${new Date(newTokens.expiresAt).toISOString()}`);
      return newTokens;
    } catch (err) {
      // Re-throw our own errors (from the block above)
      if (err.message.includes('QuickBooks')) throw err;

      // Network-level failures (DNS, TLS, timeout, etc.)
      if (attempt === 0) {
        console.warn(`[qbo-refresh] Network error on attempt 0 (will retry): ${err.message}`);
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      console.error(`[qbo-refresh] Token refresh failed after retry:`, err.message);
      throw new Error(`QuickBooks token refresh failed — try again shortly. (${err.message})`);
    }
  }
}

// ── QBO API helper ───────────────────────────────────────────────

async function qboApiRequest(method, path, body) {
  let tokens = await getValidToken();
  if (!tokens) throw new Error('Not connected to QuickBooks');

  for (let attempt = 0; attempt < 2; attempt++) {
    const url = `${BASE_URL}/v3/company/${tokens.realmId}/${path}`;
    const isSendOp = /\/(send|void)/.test(path) && !body;
    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${tokens.accessToken}`,
        'Accept':        'application/json',
        'Content-Type':  isSendOp ? 'application/octet-stream' : 'application/json',
      },
    };
    if (body) options.body = JSON.stringify(body);

    const resp = await fetch(url, options);
    const text = await resp.text();

    if (resp.status === 401 && attempt === 0) {
      console.log(`[qbo] Got 401 on ${method} ${path}, force-refreshing token and retrying…`);
      tokens = await getValidToken(true);
      if (!tokens) throw new Error('Not connected to QuickBooks');
      continue;
    }

    if (!resp.ok) {
      let detail = text;
      try { detail = JSON.stringify(JSON.parse(text)); } catch { /* keep raw */ }
      throw new Error(`QBO API ${method} ${path} returned ${resp.status}: ${detail}`);
    }

    return text ? JSON.parse(text) : {};
  }
}

// ── Customer management ──────────────────────────────────────────

async function findOrCreateCustomer(account) {
  // If we already have a QBO Customer ID cached, return it
  if (account.QboCustomerId) {
    return account.QboCustomerId;
  }

  // Helper: cache QBO customer ID and ensure email is set
  const cacheAndReturn = async (existing) => {
    const qboId = String(existing.Id);
    // Reactivate if the customer was made inactive in QBO
    if (existing.Active === false) {
      console.log(`[qbo] Reactivating inactive customer "${existing.DisplayName}" (ID ${qboId})…`);
      try {
        await qboApiRequest('POST', 'customer', {
          Id: existing.Id,
          SyncToken: existing.SyncToken,
          sparse: true,
          Active: true,
        });
      } catch (reactivateErr) {
        console.error(`[qbo] Failed to reactivate customer:`, reactivateErr.message);
      }
    }
    await updateRow('ACCOUNTS', account.ID, { QboCustomerId: qboId });
    const email = account.BillingEmail || account.Email;
    if (email && !existing.PrimaryEmailAddr?.Address) {
      try {
        await qboApiRequest('POST', 'customer', {
          Id:               existing.Id,
          SyncToken:        existing.SyncToken,
          sparse:           true,
          PrimaryEmailAddr: { Address: email },
        });
      } catch (err) {
        console.error(`[qbo] Failed to update customer email:`, err.message);
      }
    }
    return qboId;
  };

  // Search QBO by email first — more reliable than name matching
  const email = account.BillingEmail || account.Email;
  if (email) {
    const emailEsc = email.replace(/'/g, "\\'");
    const emailQuery = `SELECT * FROM Customer WHERE PrimaryEmailAddr = '${emailEsc}'`;
    const emailResult = await qboApiRequest('GET', `query?query=${encodeURIComponent(emailQuery)}`);
    if (emailResult.QueryResponse?.Customer?.length > 0) {
      return cacheAndReturn(emailResult.QueryResponse.Customer[0]);
    }
  }

  // Fall back to display name search (LIKE is case-insensitive in QBO)
  const displayName = (account.Name || '').replace(/'/g, "\\'");
  const query = `SELECT * FROM Customer WHERE DisplayName LIKE '${displayName}'`;
  const result = await qboApiRequest('GET', `query?query=${encodeURIComponent(query)}`);

  if (result.QueryResponse?.Customer?.length > 0) {
    return cacheAndReturn(result.QueryResponse.Customer[0]);
  }

  // Also check inactive customers — QBO enforces name uniqueness across all customers
  const inactiveQuery = `SELECT * FROM Customer WHERE Active IN (true, false) AND DisplayName LIKE '${displayName}'`;
  const inactiveResult = await qboApiRequest('GET', `query?query=${encodeURIComponent(inactiveQuery)}`);
  if (inactiveResult.QueryResponse?.Customer?.length > 0) {
    return cacheAndReturn(inactiveResult.QueryResponse.Customer[0]);
  }

  // Build customer body for creation
  const customerBody = {
    DisplayName:    account.Name || '',
    PrimaryEmailAddr: (account.BillingEmail || account.Email)
      ? { Address: account.BillingEmail || account.Email }
      : undefined,
    PrimaryPhone: account.Phone
      ? { FreeFormNumber: account.Phone }
      : undefined,
  };

  // Add billing address if available
  if (account.Address || account.City || account.State || account.Zip) {
    customerBody.BillAddr = {};
    if (account.Address) customerBody.BillAddr.Line1 = account.Address;
    if (account.City)    customerBody.BillAddr.City  = account.City;
    if (account.State)   customerBody.BillAddr.CountrySubDivisionCode = account.State;
    if (account.Zip)     customerBody.BillAddr.PostalCode = account.Zip;
  }

  // Remove undefined values
  Object.keys(customerBody).forEach(k => customerBody[k] === undefined && delete customerBody[k]);

  try {
    const created = await qboApiRequest('POST', 'customer', customerBody);
    const qboCustomerId = String(created.Customer.Id);
    await updateRow('ACCOUNTS', account.ID, { QboCustomerId: qboCustomerId });
    return qboCustomerId;
  } catch (err) {
    // Handle "Duplicate Name Exists Error" (code 6240) — customer exists but
    // the queries above missed it (encoding, sub-customers, CompanyName match, etc.)
    if (err.message.includes('6240') || err.message.includes('Duplicate Name')) {
      console.log(`[qbo] Customer "${account.Name}" already exists in QBO (6240), broadening search…`);

      // Broad fuzzy search including inactive customers
      const fuzzyQuery = `SELECT * FROM Customer WHERE Active IN (true, false) AND DisplayName LIKE '%${displayName}%'`;
      const retry = await qboApiRequest('GET', `query?query=${encodeURIComponent(fuzzyQuery)}`);
      if (retry.QueryResponse?.Customer?.length > 0) {
        return cacheAndReturn(retry.QueryResponse.Customer[0]);
      }

      // Try by CompanyName — QBO also enforces uniqueness across this field
      const companyQuery = `SELECT * FROM Customer WHERE Active IN (true, false) AND CompanyName LIKE '${displayName}'`;
      const companyResult = await qboApiRequest('GET', `query?query=${encodeURIComponent(companyQuery)}`);
      if (companyResult.QueryResponse?.Customer?.length > 0) {
        return cacheAndReturn(companyResult.QueryResponse.Customer[0]);
      }

      // Try email as another fallback
      if (email) {
        const emailEsc = email.replace(/'/g, "\\'");
        const emailRetry = await qboApiRequest('GET', `query?query=${encodeURIComponent(`SELECT * FROM Customer WHERE PrimaryEmailAddr = '${emailEsc}'`)}`);
        if (emailRetry.QueryResponse?.Customer?.length > 0) {
          return cacheAndReturn(emailRetry.QueryResponse.Customer[0]);
        }
      }

      // Last resort: create with a unique suffix so the sync doesn't fail
      console.warn(`[qbo] Could not find existing customer "${account.Name}" despite 6240 — creating with unique suffix`);
      customerBody.DisplayName = `${account.Name || ''} (${account.ID.slice(0, 6)})`;
      const fallback = await qboApiRequest('POST', 'customer', customerBody);
      const fallbackId = String(fallback.Customer.Id);
      await updateRow('ACCOUNTS', account.ID, { QboCustomerId: fallbackId });
      return fallbackId;
    }
    throw err;
  }
}

// ── Product item management ──────────────────────────────────────

// Cache the QBO Item ID for the generic product so we only look it up once per process
let _qboProductItemId = null;

async function getOrCreateProductItem() {
  if (_qboProductItemId) return _qboProductItemId;

  // Look for an existing item named "Product Sale" (including inactive)
  const query = `SELECT * FROM Item WHERE Name = 'Product Sale' AND Active IN (true, false)`;
  const result = await qboApiRequest('GET', `query?query=${encodeURIComponent(query)}`);
  if (result.QueryResponse?.Item?.length > 0) {
    const item = result.QueryResponse.Item[0];
    // Reactivate if the item was made inactive in QBO
    if (item.Active === false) {
      console.log(`[qbo] Reactivating inactive "Product Sale" item (ID ${item.Id})…`);
      await qboApiRequest('POST', 'item', {
        Id: item.Id,
        SyncToken: item.SyncToken,
        sparse: true,
        Active: true,
      });
    }
    _qboProductItemId = String(item.Id);
    return _qboProductItemId;
  }

  // Create a generic NonInventory item
  // First we need an income account — find one of type "Income"
  const acctQuery = `SELECT * FROM Account WHERE AccountType = 'Income' MAXRESULTS 1`;
  const acctResult = await qboApiRequest('GET', `query?query=${encodeURIComponent(acctQuery)}`);
  const incomeAccount = acctResult.QueryResponse?.Account?.[0];
  if (!incomeAccount) throw new Error('No income account found in QBO — cannot create product item');

  const item = await qboApiRequest('POST', 'item', {
    Name:            'Product Sale',
    Type:            'NonInventory',
    IncomeAccountRef: { value: String(incomeAccount.Id) },
  });
  _qboProductItemId = String(item.Item.Id);
  return _qboProductItemId;
}

// ── Tax code / rate lookup ────────────────────────────────────────

async function fetchTaxCodes() {
  const codeResult = await qboApiRequest('GET',
    `query?query=${encodeURIComponent("SELECT * FROM TaxCode WHERE Active = true MAXRESULTS 50")}`);
  const taxCodes = (codeResult.QueryResponse?.TaxCode || [])
    .filter(c => c.Name !== 'NON');

  // Enrich each code with its combined rate percentage (sum of all components)
  const enriched = [];
  for (const code of taxCodes) {
    const rateDetails = code.SalesTaxRateList?.TaxRateDetail || [];
    let totalPercent = 0;
    for (const detail of rateDetails) {
      const ref = detail?.TaxRateRef;
      if (!ref) continue;
      try {
        const rateResult = await qboApiRequest('GET',
          `query?query=${encodeURIComponent(`SELECT * FROM TaxRate WHERE Id = '${ref.value}'`)}`);
        totalPercent += parseFloat(rateResult.QueryResponse?.TaxRate?.[0]?.RateValue || 0);
      } catch { /* ignore */ }
    }
    enriched.push({
      id:   String(code.Id),
      name: code.Name || '',
      rate: Math.round(totalPercent * 100) / 100,
    });
  }
  return enriched;
}

let _qboTaxInfo = null;

async function getTaxInfo() {
  if (_qboTaxInfo) return _qboTaxInfo;

  // Use the user-selected tax code from settings, or fall back to first available
  const settings = await getAllRows('SETTINGS');
  const savedCodeId = settings.find(r => r.Key === 'qboTaxCodeId')?.Value || '';

  const codeResult = await qboApiRequest('GET',
    `query?query=${encodeURIComponent("SELECT * FROM TaxCode WHERE Active = true MAXRESULTS 50")}`);
  const taxCodes = (codeResult.QueryResponse?.TaxCode || [])
    .filter(c => c.Name !== 'NON');

  // Pick the saved code, or fall back to the first taxable one
  const taxableCode = savedCodeId
    ? taxCodes.find(c => String(c.Id) === savedCodeId) || taxCodes[0]
    : taxCodes[0];
  if (!taxableCode) return null;

  // Extract the tax rate ID from the code's sales rate detail
  const rateList = taxableCode.SalesTaxRateList?.TaxRateDetail || [];
  const rateRef = rateList[0]?.TaxRateRef;
  if (!rateRef) return null;

  // Look up the actual rate to get the percentage
  const rateResult = await qboApiRequest('GET',
    `query?query=${encodeURIComponent(`SELECT * FROM TaxRate WHERE Id = '${rateRef.value}'`)}`);
  const rate = rateResult.QueryResponse?.TaxRate?.[0];

  _qboTaxInfo = {
    taxCodeId:  String(taxableCode.Id),
    taxRateId:  String(rateRef.value),
    taxPercent: rate ? parseFloat(rate.RateValue || 0) : 0,
  };
  return _qboTaxInfo;
}

// Clear cached tax info when user changes the setting
function clearTaxInfoCache() {
  _qboTaxInfo = null;
}

// ── Department lookup (for Location → QBO Department mapping) ────

let _qboDepartments = null;

async function getDepartmentMap() {
  if (_qboDepartments) return _qboDepartments;

  const query = "SELECT * FROM Department WHERE Active = true MAXRESULTS 100";
  const result = await qboApiRequest('GET', `query?query=${encodeURIComponent(query)}`);
  const departments = result.QueryResponse?.Department || [];

  _qboDepartments = {};
  for (const dept of departments) {
    if (dept.Name) {
      _qboDepartments[dept.Name.toLowerCase()] = String(dept.Id);
    }
  }
  return _qboDepartments;
}

// ── Payment method lookup (for PaymentMethodRef on payments) ─────

let _qboPaymentMethods = null;

async function getPaymentMethodMap() {
  if (_qboPaymentMethods) return _qboPaymentMethods;

  const query = "SELECT * FROM PaymentMethod WHERE Active = true MAXRESULTS 100";
  const result = await qboApiRequest('GET', `query?query=${encodeURIComponent(query)}`);
  const methods = result.QueryResponse?.PaymentMethod || [];

  _qboPaymentMethods = {};
  for (const m of methods) {
    if (m.Name) {
      _qboPaymentMethods[m.Name.toLowerCase()] = String(m.Id);
    }
  }
  return _qboPaymentMethods;
}

// ── Clear all in-memory caches (used on 610 retry) ──────────────

function clearAllCaches() {
  _qboProductItemId = null;
  _qboTaxInfo = null;
  _qboDepartments = null;
  _qboPaymentMethods = null;
}

/**
 * Collect additional invoice email recipients (CC) for an account, excluding
 * the address already used as the primary BillEmail. Pulls from the regular
 * Email field (when BillingEmail is the primary) plus the AdditionalEmails
 * JSON array. Dedupes case-insensitively.
 *
 * @param {object} account - ACCOUNTS row
 * @param {string} primaryEmail - the address used as BillEmail on the invoice
 * @returns {string[]} unique CC email addresses (may be empty)
 */
function collectInvoiceCcs(account, primaryEmail) {
  const ccs = [];
  const seen = new Set();
  if (primaryEmail) seen.add(primaryEmail.toLowerCase().trim());
  const add = (e) => {
    if (!e) return;
    const norm = String(e).trim();
    if (!norm) return;
    const key = norm.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    ccs.push(norm);
  };
  // If BillingEmail was used as the primary, include Email as a CC.
  if (account.BillingEmail && account.Email) add(account.Email);
  // Append AdditionalEmails (stored as a JSON array of strings).
  if (account.AdditionalEmails) {
    try {
      const extras = JSON.parse(account.AdditionalEmails);
      if (Array.isArray(extras)) extras.forEach(add);
    } catch { /* ignore malformed JSON */ }
  }
  return ccs;
}

// ── Payment / Invoice lookup ─────────────────────────────────────

async function getPayment(paymentId) {
  const result = await qboApiRequest('GET', `payment/${paymentId}`);
  return result.Payment;
}

async function getInvoice(invoiceId) {
  const result = await qboApiRequest('GET', `invoice/${invoiceId}`);
  return result.Invoice;
}

async function downloadInvoicePdf(invoiceId) {
  let tokens = await getValidToken();
  if (!tokens) throw new Error('Not connected to QuickBooks');

  for (let attempt = 0; attempt < 2; attempt++) {
    const url = `${BASE_URL}/v3/company/${tokens.realmId}/invoice/${invoiceId}/pdf`;
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${tokens.accessToken}`,
        'Accept':        'application/pdf',
      },
    });

    if (resp.status === 401 && attempt === 0) {
      console.log(`[qbo] Got 401 on PDF download for invoice ${invoiceId}, force-refreshing token and retrying…`);
      tokens = await getValidToken(true);
      if (!tokens) throw new Error('Not connected to QuickBooks');
      continue;
    }

    if (!resp.ok) {
      throw new Error(`QBO API GET invoice/${invoiceId}/pdf returned ${resp.status}`);
    }

    const arrayBuffer = await resp.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}

async function voidInvoice(invoiceId) {
  const invoice = await getInvoice(invoiceId);
  if (!invoice) throw new Error(`Invoice ${invoiceId} not found in QBO`);

  await qboApiRequest('POST', 'invoice?operation=void', {
    Id:        invoice.Id,
    SyncToken: invoice.SyncToken,
  });
  console.log(`[qbo] Invoice ${invoiceId} voided`);
}

async function processQboPaymentWebhook(paymentId) {
  const payment = await getPayment(paymentId);
  if (!payment || !payment.Line) return;

  // Extract linked invoice IDs from the payment
  const invoiceIds = [];
  for (const line of payment.Line) {
    for (const txn of (line.LinkedTxn || [])) {
      if (txn.TxnType === 'Invoice') {
        invoiceIds.push(txn.TxnId);
      }
    }
  }

  if (invoiceIds.length === 0) return;

  // Check each linked invoice and update matching orders
  const orders = await getAllRows('ORDERS');

  for (const invoiceId of invoiceIds) {
    const invoice = await getInvoice(invoiceId);
    if (!invoice || invoice.Balance !== 0) continue; // Only mark fully paid invoices

    const matchingOrders = orders.filter(o => o.QboInvoiceId === String(invoice.Id));
    for (const order of matchingOrders) {
      if (order.Status === 'Paid' || order.Status === 'Cancelled') continue;
      const paymentUpdates = { Status: 'Paid' };
      // Store payment metadata from QBO
      if (payment.TxnDate) paymentUpdates.PaymentDate = payment.TxnDate;
      if (payment.Id) paymentUpdates.QboPaymentId = String(payment.Id);

      // Payment method: try PaymentMethodRef, then detect from credit card info
      let method = payment.PaymentMethodRef?.name || '';
      if (!method && payment.CreditCardPayment?.CreditChargeInfo) {
        method = 'Credit Card';
      }
      // Normalise common QBO names to the app's PAYMENT_METHODS values
      if (/credit\s*card/i.test(method)) method = 'Credit Card';
      else if (/ach|bank/i.test(method)) method = 'ACH';
      else if (/check/i.test(method)) method = 'Check';
      else if (/cash/i.test(method)) method = 'Cash';
      if (method) paymentUpdates.PaymentMethod = method;

      // Payment reference: check number, CC transaction ID, or QBO payment ID
      const ref = payment.PaymentRefNum
        || payment.CreditCardPayment?.CreditChargeResponse?.CCTransId
        || (payment.Id ? `QBO-${payment.Id}` : '');
      if (ref) paymentUpdates.PaymentReference = ref;
      await updateRow('ORDERS', order.ID, paymentUpdates);
      console.log(`[qbo-webhook] Order ${order.ID} marked as Paid (Invoice ${invoice.Id} fully paid)`);
    }
  }
}

async function createPayment(order, account) {
  const customerId = await findOrCreateCustomer(account);
  const totalAmt = parseFloat(order.OrderAmount || 0) + parseFloat(order.TaxAmount || 0) + parseFloat(order.DepositAmount || 0);

  const paymentBody = {
    CustomerRef: { value: customerId },
    TotalAmt: totalAmt,
    TxnDate: order.PaymentDate || order.OrderDate || new Date().toISOString().split('T')[0],
    Line: [{
      Amount: totalAmt,
      LinkedTxn: [{
        TxnId: order.QboInvoiceId,
        TxnType: 'Invoice',
      }],
    }],
  };

  if (order.PaymentMethod) {
    try {
      const methodMap = await getPaymentMethodMap();
      const methodId = methodMap[order.PaymentMethod.toLowerCase()];
      if (methodId) {
        paymentBody.PaymentMethodRef = { value: methodId };
      }
    } catch (err) {
      console.error('Could not look up QBO payment method:', err.message);
    }
  }

  const noteParts = [];
  if (order.PaymentMethod) noteParts.push(`Method: ${order.PaymentMethod}`);
  if (order.PaymentReference) noteParts.push(`Ref: ${order.PaymentReference}`);
  if (noteParts.length > 0) paymentBody.PrivateNote = noteParts.join(' | ');

  const result = await qboApiRequest('POST', 'payment', paymentBody);
  return result.Payment;
}

// ── Invoice number generation ────────────────────────────────────

async function getNextInvoiceNumber() {
  // Fetch recent invoices and find the highest numeric DocNumber
  const query = "SELECT DocNumber FROM Invoice ORDER BY MetaData.CreateTime DESC MAXRESULTS 100";
  const result = await qboApiRequest('GET', `query?query=${encodeURIComponent(query)}`);
  const invoices = result.QueryResponse?.Invoice || [];

  let maxNum = 0;
  let bestPrefix = '';
  let bestPadding = 0;

  for (const inv of invoices) {
    if (!inv.DocNumber) continue;
    const match = inv.DocNumber.match(/^(.*?)(\d+)$/);
    if (match) {
      const num = parseInt(match[2], 10);
      if (num > maxNum) {
        maxNum = num;
        bestPrefix = match[1];
        bestPadding = match[2].length;
      }
    }
  }

  const nextNum = maxNum > 0 ? maxNum + 1 : 1001;
  return bestPrefix + String(nextNum).padStart(bestPadding, '0');
}

// ── Invoice creation ─────────────────────────────────────────────

/**
 * Build the QBO Invoice request body for an order, sharing the layout logic
 * between createInvoice (initial POST) and updateInvoice (sparse update of
 * an existing invoice). Honors deposits per keg format, tax via TxnTaxDetail,
 * and BillEmail/BillEmailCc from the account's email fields.
 *
 * @param {object} order - ORDERS row
 * @param {Array<object>} lineItems - ORDER_ITEMS rows
 * @param {object} account - ACCOUNTS row
 * @returns {Promise<object>} invoice body suitable for POST /invoice or
 *   (with Id/SyncToken/sparse merged in by the caller) POST /invoice?operation=update
 */
async function _buildInvoiceBody(order, lineItems, account) {
  const customerId = await findOrCreateCustomer(account);
  const productItemId = await getOrCreateProductItem();
  const taxInfo = await getTaxInfo();

  const taxAmount = parseFloat(order.TaxAmount || 0);
  const hasTax = taxAmount > 0 && taxInfo;

  // Build QBO line items referencing the generic product item
  const lines = lineItems.map((li, idx) => {
    const line = {
      DetailType:          'SalesItemLineDetail',
      Amount:              parseFloat(li.LineTotal || 0),
      Description:         [li.ProductName, li.Format, li.PriceTier ? `(${li.PriceTier})` : ''].filter(Boolean).join(' — '),
      SalesItemLineDetail: {
        ItemRef:   { value: productItemId },
        UnitPrice: parseFloat(li.UnitPrice || 0),
        Qty:       parseFloat(li.Quantity  || 0),
      },
      LineNum: idx + 1,
    };
    // Mark product lines as taxable when tax applies
    if (hasTax) {
      line.SalesItemLineDetail.TaxCodeRef = { value: 'TAX' };
    }
    return line;
  });

  // Add deposit lines per keg format if present (non-taxable)
  const depositAmount = parseFloat(order.DepositAmount || 0);
  if (depositAmount > 0) {
    // Look up per-format keg deposit rates from settings
    const settingsRows = await getAllRows('SETTINGS');
    const depRow = settingsRows.find(r => r.Key === 'kegDeposits');
    let kegDeposits = {};
    if (depRow) {
      try { kegDeposits = JSON.parse(depRow.Value); } catch (e) { /* ignore */ }
    }

    // Count kegs per format from line items
    const kegsByFormat = {};
    for (const li of lineItems) {
      const fmt = li.Format || '';
      if (fmt.toLowerCase().includes('keg')) {
        const qty = parseFloat(li.Quantity || 0);
        if (qty > 0) {
          kegsByFormat[fmt] = (kegsByFormat[fmt] || 0) + qty;
        }
      }
    }

    // Build one deposit line per keg format with a matching rate
    let depositLinesAdded = false;
    for (const [fmt, qty] of Object.entries(kegsByFormat)) {
      const rate = parseFloat(kegDeposits[fmt]) || 0;
      if (rate > 0) {
        lines.push({
          DetailType:          'SalesItemLineDetail',
          Amount:              parseFloat((rate * qty).toFixed(2)),
          Description:         `Keg Deposit — ${fmt}`,
          SalesItemLineDetail: {
            ItemRef:   { value: productItemId },
            UnitPrice: rate,
            Qty:       qty,
            TaxCodeRef: { value: 'NON' },
          },
          LineNum: lines.length + 1,
        });
        depositLinesAdded = true;
      }
    }

    // Fallback: if no per-format rates matched, use single line with total
    if (!depositLinesAdded) {
      lines.push({
        DetailType:          'SalesItemLineDetail',
        Amount:              depositAmount,
        Description:         'Keg Deposits',
        SalesItemLineDetail: {
          ItemRef:   { value: productItemId },
          UnitPrice: depositAmount,
          Qty:       1,
          TaxCodeRef: { value: 'NON' },
        },
        LineNum: lines.length + 1,
      });
    }
  }

  // Determine bill email: prefer BillingEmail, fall back to account Email.
  // Additional recipients (the regular Email if BillingEmail was used, plus
  // anything in AdditionalEmails) become CC addresses on the QBO invoice so
  // they're included both on the initial send and any future re-sends.
  const billEmail = account.BillingEmail || account.Email;
  const ccEmails = collectInvoiceCcs(account, billEmail);

  // Look up QBO Department from order Location
  let departmentRef;
  if (order.Location) {
    try {
      const deptMap = await getDepartmentMap();
      const deptId = deptMap[order.Location.toLowerCase()];
      if (deptId) departmentRef = { value: deptId };
    } catch (err) {
      console.error('[qbo] Department lookup failed:', err.message);
    }
  }

  const docNumber = order.InvoiceNumber || await getNextInvoiceNumber();
  const invoiceBody = {
    CustomerRef:  { value: customerId },
    Line:         lines,
    DocNumber:    docNumber,
    TxnDate:      order.OrderDate ? order.OrderDate.split('T')[0] : undefined,
    DueDate:      order.DeliveryDate ? order.DeliveryDate.split('T')[0] : undefined,
    BillEmail:     billEmail ? { Address: billEmail } : undefined,
    BillEmailCc:   ccEmails.length > 0 ? { Address: ccEmails.join(', ') } : undefined,
    DepartmentRef: departmentRef,
  };

  // Apply native QBO tax
  if (hasTax) {
    const netTaxable = lines
      .filter(l => l.SalesItemLineDetail?.TaxCodeRef?.value === 'TAX')
      .reduce((sum, l) => sum + (l.Amount || 0), 0);

    invoiceBody.TxnTaxDetail = {
      TxnTaxCodeRef: { value: taxInfo.taxCodeId },
      TotalTax:       taxAmount,
      TaxLine: [{
        Amount:     taxAmount,
        DetailType: 'TaxLineDetail',
        TaxLineDetail: {
          TaxRateRef:       { value: taxInfo.taxRateId },
          PercentBased:     true,
          TaxPercent:       taxInfo.taxPercent,
          NetAmountTaxable: netTaxable,
        },
      }],
    };
  }

  // Remove undefined values
  Object.keys(invoiceBody).forEach(k => invoiceBody[k] === undefined && delete invoiceBody[k]);

  return invoiceBody;
}

async function createInvoice(order, lineItems, account, _isRetry) {
  const invoiceBody = await _buildInvoiceBody(order, lineItems, account);

  let result;
  try {
    result = await qboApiRequest('POST', 'invoice', invoiceBody);
  } catch (err) {
    // 610 = "Object Not Found" — a referenced entity (customer, item, department,
    // tax code) was deactivated in QBO.  Clear caches and retry once so the
    // lookup functions fetch/reactivate the entities afresh.
    if (!_isRetry && (err.message.includes('"code":"610"') || /made inactive/i.test(err.message))) {
      console.warn(`[qbo] Invoice creation got 610 (inactive entity), clearing caches and retrying…`);
      clearAllCaches();
      if (account.QboCustomerId) {
        try { await updateRow('ACCOUNTS', account.ID, { QboCustomerId: '' }); } catch (e) { /* ignore */ }
        account.QboCustomerId = '';
      }
      return createInvoice(order, lineItems, account, true);
    }
    throw err;
  }

  const invoice = result.Invoice;
  // Ensure DocNumber is always set — QBO may not echo it back in some configurations
  if (invoice && !invoice.DocNumber) invoice.DocNumber = invoiceBody.DocNumber;
  return invoice;
}

/**
 * Sparse-update an existing QBO invoice with the order's current line items,
 * amounts, and recipients. Fetches the invoice first to read its SyncToken
 * (QBO requires it on every update).
 *
 * @param {string} invoiceId - QBO invoice Id
 * @param {object} order - ORDERS row
 * @param {Array<object>} lineItems - ORDER_ITEMS rows
 * @param {object} account - ACCOUNTS row
 * @param {boolean} [_isRetry] - internal; retries on 610 cache-miss errors
 * @returns {Promise<object>} updated invoice
 */
async function updateInvoice(invoiceId, order, lineItems, account, _isRetry) {
  const existing = await getInvoice(invoiceId);
  if (!existing) throw new Error(`Invoice ${invoiceId} not found in QBO`);

  const body = await _buildInvoiceBody(order, lineItems, account);
  body.Id        = String(existing.Id);
  body.SyncToken = existing.SyncToken;
  body.sparse    = true;
  // Preserve the original DocNumber when possible — we don't want to renumber
  // an invoice that customers have already seen.
  if (existing.DocNumber) body.DocNumber = existing.DocNumber;

  let result;
  try {
    result = await qboApiRequest('POST', 'invoice?operation=update', body);
  } catch (err) {
    if (!_isRetry && (err.message.includes('"code":"610"') || /made inactive/i.test(err.message))) {
      console.warn(`[qbo] Invoice update got 610 (inactive entity), clearing caches and retrying…`);
      clearAllCaches();
      if (account.QboCustomerId) {
        try { await updateRow('ACCOUNTS', account.ID, { QboCustomerId: '' }); } catch (e) { /* ignore */ }
        account.QboCustomerId = '';
      }
      return updateInvoice(invoiceId, order, lineItems, account, true);
    }
    throw err;
  }

  return result.Invoice;
}

// ── Top-level sync function ──────────────────────────────────────

async function syncOrderToQbo(orderId) {
  try {
    if (!isQboConfigured()) {
      await updateRow('ORDERS', orderId, { QboSyncStatus: 'disabled' });
      return;
    }

    const tokens = await getValidToken();
    if (!tokens) {
      await updateRow('ORDERS', orderId, {
        QboSyncStatus: 'failed',
        QboSyncError:  'Not connected to QuickBooks — reconnect in Settings',
      });
      return;
    }

    const order = getRow('ORDERS', orderId);
    if (!order) {
      console.error(`[qbo] Order ${orderId} not found`);
      return;
    }

    // Skip if already synced or explicitly opted out
    if (order.QboSyncStatus === 'synced' && order.QboInvoiceId) return;
    // If explicitly called on a skipped order, allow it to proceed

    const account = getRow('ACCOUNTS', order.AccountID);
    if (!account) {
      const msg = `Account ${order.AccountID} not found`;
      console.error(`[qbo] ${msg}`);
      await updateRow('ORDERS', orderId, { QboSyncStatus: 'failed', QboSyncError: msg });
      return;
    }

    const allItems = await getAllRows('ORDER_ITEMS');
    const lineItems = allItems.filter(i => i.OrderID === orderId);

    const invoice = await createInvoice(order, lineItems, account);
    if (!invoice || !invoice.Id) {
      throw new Error('QBO returned an invoice without an Id');
    }

    const qboInvoiceId = String(invoice.Id);
    const updates = {
      QboInvoiceId:  qboInvoiceId,
      QboSyncStatus: 'synced',
      QboSyncError:  '',
      InvoiceNumber: invoice.DocNumber,
    };
    await updateRow('ORDERS', orderId, updates);

    // Verify the update persisted
    const saved = getRow('ORDERS', orderId);
    if (!saved || saved.QboInvoiceId !== qboInvoiceId) {
      console.error(`[qbo] QboInvoiceId failed to persist for order ${orderId}: expected "${qboInvoiceId}", got "${saved?.QboInvoiceId}"`);
    }

    console.log(`[qbo] Order ${orderId} synced → QBO Invoice ${qboInvoiceId}`);

    // Send the invoice via email. QBO sends to the BillEmail on the invoice
    // plus any BillEmailCc / BillEmailBcc addresses we set when creating it,
    // so additional recipients automatically receive the message.
    let invoiceSendNote = '';
    const billEmail = account.BillingEmail || account.Email;
    if (billEmail) {
      try {
        await qboApiRequest('POST', `invoice/${qboInvoiceId}/send`);
        const ccs = collectInvoiceCcs(account, billEmail);
        const recipientList = ccs.length > 0 ? `${billEmail} (cc: ${ccs.join(', ')})` : billEmail;
        console.log(`[qbo] Invoice ${qboInvoiceId} sent to ${recipientList}`);
      } catch (sendErr) {
        console.error(`[qbo] Invoice ${qboInvoiceId} created but send failed:`, sendErr.message);
        invoiceSendNote = `Invoice ${invoice.DocNumber || qboInvoiceId} was not sent: ${sendErr.message}`;
      }
    } else {
      invoiceSendNote = `Invoice ${invoice.DocNumber || qboInvoiceId} was not sent: no email address on account`;
    }

    if (invoiceSendNote) {
      try {
        const cur = getRow('ORDERS', orderId);
        const notes = cur?.Notes || '';
        await updateRow('ORDERS', orderId, {
          Notes: notes ? `${notes}\n${invoiceSendNote}` : invoiceSendNote,
        });
      } catch (noteErr) {
        console.error(`[qbo] Failed to save send note for order ${orderId}:`, noteErr.message);
      }
    }

    // Append invoice link to order Notes
    try {
      let invoiceUrl;
      const freshInvoice = await getInvoice(qboInvoiceId);
      if (freshInvoice && freshInvoice.InvoiceLink) {
        invoiceUrl = freshInvoice.InvoiceLink;
      } else {
        invoiceUrl = `${QBO_APP_URL}/app/invoice?txnId=${qboInvoiceId}`;
      }
      const currentOrder = getRow('ORDERS', orderId);
      const currentNotes = currentOrder?.Notes || '';
      const updatedNotes = currentNotes
        ? `${currentNotes}\nInvoice: ${invoiceUrl}`
        : `Invoice: ${invoiceUrl}`;
      await updateRow('ORDERS', orderId, { Notes: updatedNotes });
    } catch (linkErr) {
      console.error(`[qbo] Failed to append invoice link for order ${orderId}:`, linkErr.message);
    }

    // Download and save invoice PDF locally
    try {
      const pdfBuffer = await downloadInvoicePdf(qboInvoiceId);
      const pdfDir = path.join(__dirname, 'data', 'invoices');
      fs.mkdirSync(pdfDir, { recursive: true });
      const pdfFilename = `${orderId}.pdf`;
      fs.writeFileSync(path.join(pdfDir, pdfFilename), pdfBuffer);
      await updateRow('ORDERS', orderId, { InvoicePdf: pdfFilename });
      console.log(`[qbo] Invoice PDF saved for order ${orderId}`);
    } catch (pdfErr) {
      console.error(`[qbo] Failed to download invoice PDF for order ${orderId}:`, pdfErr.message);
    }
  } catch (err) {
    console.error(`[qbo] Sync failed for order ${orderId}:`, err.message);
    try {
      await updateRow('ORDERS', orderId, { QboSyncStatus: 'failed', QboSyncError: err.message || String(err) || 'An unexpected error occurred' });
    } catch { /* ignore update error */ }
  }
}

/**
 * Push edits to an already-synced order back to its QBO invoice and re-send.
 * Used after the order header or its line items change locally.
 *
 * Guard rails:
 *   - QBO must be configured and connected
 *   - The order must have a QboInvoiceId and QboSyncStatus='synced'
 *   - The order must not be paid in QBO (QboPaymentId unset)
 *   - The order must not be Cancelled
 *
 * On any failure, sets QboSyncStatus='failed' with the error message so the
 * order form's QBO section surfaces a Retry button. Does not throw.
 *
 * @param {string} orderId
 * @returns {Promise<{ status: string, error?: string, recipients?: string }>}
 */
async function resyncOrderToQbo(orderId) {
  try {
    if (!isQboConfigured()) return { status: 'disabled' };
    const tokens = await getValidToken();
    if (!tokens) {
      await updateRow('ORDERS', orderId, {
        QboSyncStatus: 'failed',
        QboSyncError:  'Not connected to QuickBooks — reconnect in Settings',
      });
      return { status: 'failed', error: 'not connected' };
    }

    const order = getRow('ORDERS', orderId);
    if (!order) return { status: 'skipped', error: 'order not found' };
    if (!order.QboInvoiceId || order.QboSyncStatus !== 'synced') {
      return { status: 'skipped', error: 'order is not synced to QBO' };
    }
    if (order.QboPaymentId) {
      return { status: 'skipped', error: 'invoice already paid in QBO' };
    }
    if (order.Status === 'Cancelled') {
      return { status: 'skipped', error: 'order is cancelled' };
    }

    const account = getRow('ACCOUNTS', order.AccountID);
    if (!account) {
      const msg = `Account ${order.AccountID} not found`;
      await updateRow('ORDERS', orderId, { QboSyncStatus: 'failed', QboSyncError: msg });
      return { status: 'failed', error: msg };
    }

    const allItems = await getAllRows('ORDER_ITEMS');
    const lineItems = allItems.filter(i => i.OrderID === orderId);

    const updated = await updateInvoice(order.QboInvoiceId, order, lineItems, account);
    if (!updated || !updated.Id) throw new Error('QBO returned no invoice on update');

    // Make sure local QboSyncStatus is back to synced (clears any prior failure).
    await updateRow('ORDERS', orderId, { QboSyncStatus: 'synced', QboSyncError: '' });

    // Re-send to BillEmail + BillEmailCc — same shape as the initial sync.
    const billEmail = account.BillingEmail || account.Email;
    if (billEmail) {
      try {
        await qboApiRequest('POST', `invoice/${order.QboInvoiceId}/send`);
        const ccs = collectInvoiceCcs(account, billEmail);
        const recipientList = ccs.length > 0 ? `${billEmail} (cc: ${ccs.join(', ')})` : billEmail;
        console.log(`[qbo] Invoice ${order.QboInvoiceId} re-sent to ${recipientList}`);
        return { status: 'sent', recipients: recipientList };
      } catch (sendErr) {
        console.error(`[qbo] Invoice ${order.QboInvoiceId} updated but re-send failed:`, sendErr.message);
        return { status: 'updated', error: sendErr.message };
      }
    }
    return { status: 'updated', error: 'no email address on account' };
  } catch (err) {
    console.error(`[qbo] Resync failed for order ${orderId}:`, err.message);
    try {
      await updateRow('ORDERS', orderId, { QboSyncStatus: 'failed', QboSyncError: err.message || 'Resync failed' });
    } catch { /* ignore */ }
    return { status: 'failed', error: err.message };
  }
}

module.exports = {
  isQboConfigured,
  getOAuthClient,
  getStoredTokens,
  storeTokens,
  clearTokens,
  getValidToken,
  syncOrderToQbo,
  resyncOrderToQbo,
  fetchTaxCodes,
  clearTaxInfoCache,
  getPayment,
  getInvoice,
  downloadInvoicePdf,
  voidInvoice,
  processQboPaymentWebhook,
  createPayment,
  QBO_APP_URL,
};
