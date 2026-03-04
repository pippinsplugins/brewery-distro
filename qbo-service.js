'use strict';

const OAuthClient = require('intuit-oauth');
const { v4: uuidv4 } = require('uuid');
const { getAllRows, getRow, addRow, updateRow } = require('./db');
require('dotenv').config();

const QBO_CLIENT_ID     = process.env.QBO_CLIENT_ID     || '';
const QBO_CLIENT_SECRET = process.env.QBO_CLIENT_SECRET || '';
const QBO_ENVIRONMENT   = process.env.QBO_ENVIRONMENT   || 'sandbox';
const QBO_REDIRECT_URI  = process.env.QBO_REDIRECT_URI  || '';

const BASE_URL = QBO_ENVIRONMENT === 'production'
  ? 'https://quickbooks.api.intuit.com'
  : 'https://sandbox-quickbooks.api.intuit.com';

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

async function getValidToken() {
  const tokens = await getStoredTokens();
  if (!tokens || !tokens.accessToken || !tokens.refreshToken) return null;

  // Check if access token is expired (with 5-min buffer)
  const expiresAt = tokens.expiresAt || 0;
  const now = Date.now();
  if (now < expiresAt - 5 * 60 * 1000) {
    return tokens;
  }

  // Refresh the token
  try {
    const oauthClient = getOAuthClient();
    oauthClient.setToken({
      access_token:  tokens.accessToken,
      refresh_token: tokens.refreshToken,
      token_type:    'bearer',
      expires_in:    0,
    });
    const authResponse = await oauthClient.refresh();
    const refreshed = authResponse.getJson();

    const newTokens = {
      accessToken:  refreshed.access_token,
      refreshToken: refreshed.refresh_token,
      realmId:      tokens.realmId,
      expiresAt:    Date.now() + (refreshed.expires_in || 3600) * 1000,
    };
    await storeTokens(newTokens);
    return newTokens;
  } catch (err) {
    console.error('[qbo] Token refresh failed:', err.message);
    return null;
  }
}

// ── QBO API helper ───────────────────────────────────────────────

async function qboApiRequest(method, path, body) {
  const tokens = await getValidToken();
  if (!tokens) throw new Error('Not connected to QuickBooks');

  const url = `${BASE_URL}/v3/company/${tokens.realmId}/${path}`;
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${tokens.accessToken}`,
      'Accept':        'application/json',
      'Content-Type':  'application/json',
    },
  };
  if (body) options.body = JSON.stringify(body);

  const resp = await fetch(url, options);
  const text = await resp.text();

  if (!resp.ok) {
    let detail = text;
    try { detail = JSON.stringify(JSON.parse(text)); } catch { /* keep raw */ }
    throw new Error(`QBO API ${method} ${path} returned ${resp.status}: ${detail}`);
  }

  return text ? JSON.parse(text) : {};
}

// ── Customer management ──────────────────────────────────────────

async function findOrCreateCustomer(account) {
  // If we already have a QBO Customer ID cached, return it
  if (account.QboCustomerId) {
    return account.QboCustomerId;
  }

  // Search QBO by display name
  const displayName = (account.Name || '').replace(/'/g, "\\'");
  const query = `SELECT * FROM Customer WHERE DisplayName = '${displayName}'`;
  const result = await qboApiRequest('GET', `query?query=${encodeURIComponent(query)}`);

  if (result.QueryResponse && result.QueryResponse.Customer && result.QueryResponse.Customer.length > 0) {
    const qboId = String(result.QueryResponse.Customer[0].Id);
    await updateRow('ACCOUNTS', account.ID, { QboCustomerId: qboId });
    return qboId;
  }

  // Create new customer in QBO
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

  const created = await qboApiRequest('POST', 'customer', customerBody);
  const qboCustomerId = String(created.Customer.Id);
  await updateRow('ACCOUNTS', account.ID, { QboCustomerId: qboCustomerId });
  return qboCustomerId;
}

// ── Invoice creation ─────────────────────────────────────────────

async function createInvoice(order, lineItems, account) {
  const customerId = await findOrCreateCustomer(account);

  // Build QBO line items using Description-based lines (no QBO Items needed)
  const lines = lineItems.map((li, idx) => ({
    DetailType:          'SalesItemLineDetail',
    Amount:              parseFloat(li.LineTotal || 0),
    Description:         [li.ProductName, li.Format].filter(Boolean).join(' — '),
    SalesItemLineDetail: {
      UnitPrice: parseFloat(li.UnitPrice || 0),
      Qty:       parseFloat(li.Quantity  || 0),
    },
    LineNum: idx + 1,
  }));

  // Add tax as a separate line if present
  const taxAmount = parseFloat(order.TaxAmount || 0);

  // Add deposit as a separate description line if present
  const depositAmount = parseFloat(order.DepositAmount || 0);
  if (depositAmount > 0) {
    lines.push({
      DetailType:          'SalesItemLineDetail',
      Amount:              depositAmount,
      Description:         'Keg Deposits',
      SalesItemLineDetail: {
        UnitPrice: depositAmount,
        Qty:       1,
      },
      LineNum: lines.length + 1,
    });
  }

  const invoiceBody = {
    CustomerRef: { value: customerId },
    Line:        lines,
    DocNumber:   order.InvoiceNumber || undefined,
    TxnDate:     order.OrderDate ? order.OrderDate.split('T')[0] : undefined,
  };

  // Add tax amount if present
  if (taxAmount > 0) {
    invoiceBody.TxnTaxDetail = {
      TotalTax: taxAmount,
    };
  }

  // Remove undefined values
  Object.keys(invoiceBody).forEach(k => invoiceBody[k] === undefined && delete invoiceBody[k]);

  const result = await qboApiRequest('POST', 'invoice', invoiceBody);
  return result.Invoice;
}

// ── Top-level sync function ──────────────────────────────────────

async function syncOrderToQbo(orderId) {
  try {
    if (!isQboConfigured()) {
      await updateRow('ORDERS', orderId, { QboSyncStatus: 'disabled' });
      return;
    }

    const tokens = await getStoredTokens();
    if (!tokens || !tokens.accessToken) {
      await updateRow('ORDERS', orderId, { QboSyncStatus: 'disabled' });
      return;
    }

    // Check auto-sync setting
    const settings = await getAllRows('SETTINGS');
    const autoSync = settings.find(r => r.Key === 'qboAutoSync');
    if (autoSync && autoSync.Value === 'false') {
      await updateRow('ORDERS', orderId, { QboSyncStatus: 'skipped' });
      return;
    }

    const order = getRow('ORDERS', orderId);
    if (!order) {
      console.error(`[qbo] Order ${orderId} not found`);
      return;
    }

    // Skip if already synced
    if (order.QboSyncStatus === 'synced' && order.QboInvoiceId) return;

    const account = getRow('ACCOUNTS', order.AccountID);
    if (!account) {
      console.error(`[qbo] Account ${order.AccountID} not found for order ${orderId}`);
      await updateRow('ORDERS', orderId, { QboSyncStatus: 'failed' });
      return;
    }

    const allItems = await getAllRows('ORDER_ITEMS');
    const lineItems = allItems.filter(i => i.OrderID === orderId);

    const invoice = await createInvoice(order, lineItems, account);
    await updateRow('ORDERS', orderId, {
      QboInvoiceId:  String(invoice.Id),
      QboSyncStatus: 'synced',
    });

    console.log(`[qbo] Order ${orderId} synced → QBO Invoice ${invoice.Id}`);
  } catch (err) {
    console.error(`[qbo] Sync failed for order ${orderId}:`, err.message);
    try {
      await updateRow('ORDERS', orderId, { QboSyncStatus: 'failed' });
    } catch { /* ignore update error */ }
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
};
