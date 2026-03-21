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
    throw new Error(`QuickBooks token refresh failed — try reconnecting in Settings. (${err.message})`);
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

// ── Product item management ──────────────────────────────────────

// Cache the QBO Item ID for the generic product so we only look it up once per process
let _qboProductItemId = null;

async function getOrCreateProductItem() {
  if (_qboProductItemId) return _qboProductItemId;

  // Look for an existing NonInventory item named "Product Sale"
  const query = `SELECT * FROM Item WHERE Name = 'Product Sale' AND Type = 'NonInventory'`;
  const result = await qboApiRequest('GET', `query?query=${encodeURIComponent(query)}`);
  if (result.QueryResponse && result.QueryResponse.Item && result.QueryResponse.Item.length > 0) {
    _qboProductItemId = String(result.QueryResponse.Item[0].Id);
    return _qboProductItemId;
  }

  // Look for an existing item named "Product Sale" of any type
  const query2 = `SELECT * FROM Item WHERE Name = 'Product Sale'`;
  const result2 = await qboApiRequest('GET', `query?query=${encodeURIComponent(query2)}`);
  if (result2.QueryResponse && result2.QueryResponse.Item && result2.QueryResponse.Item.length > 0) {
    _qboProductItemId = String(result2.QueryResponse.Item[0].Id);
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

// ── Payment / Invoice lookup ─────────────────────────────────────

async function getPayment(paymentId) {
  const result = await qboApiRequest('GET', `payment/${paymentId}`);
  return result.Payment;
}

async function getInvoice(invoiceId) {
  const result = await qboApiRequest('GET', `invoice/${invoiceId}`);
  return result.Invoice;
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
      await updateRow('ORDERS', order.ID, { Status: 'Paid' });
      console.log(`[qbo-webhook] Order ${order.ID} marked as Paid (Invoice ${invoice.Id} fully paid)`);
    }
  }
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

async function createInvoice(order, lineItems, account) {
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
      Description:         [li.ProductName, li.Format].filter(Boolean).join(' — '),
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

  // Add deposit as a separate line if present (non-taxable)
  const depositAmount = parseFloat(order.DepositAmount || 0);
  if (depositAmount > 0) {
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

  // Determine bill email: prefer BillingEmail, fall back to account Email
  const billEmail = account.BillingEmail || account.Email;

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

  const invoiceBody = {
    CustomerRef:  { value: customerId },
    Line:         lines,
    DocNumber:    order.InvoiceNumber || await getNextInvoiceNumber(),
    TxnDate:      order.OrderDate ? order.OrderDate.split('T')[0] : undefined,
    DueDate:      order.DeliveryDate ? order.DeliveryDate.split('T')[0] : undefined,
    BillEmail:     billEmail ? { Address: billEmail } : undefined,
    EmailStatus:   billEmail ? 'NeedToSend' : undefined,
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

    const order = getRow('ORDERS', orderId);
    if (!order) {
      console.error(`[qbo] Order ${orderId} not found`);
      return;
    }

    // Skip if already synced or explicitly opted out
    if (order.QboSyncStatus === 'synced' && order.QboInvoiceId) return;
    if (order.QboSyncStatus === 'skipped') return;

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
    };
    // Store the QBO invoice number on the order
    if (invoice.DocNumber) {
      updates.InvoiceNumber = invoice.DocNumber;
    }
    await updateRow('ORDERS', orderId, updates);

    // Verify the update persisted
    const saved = getRow('ORDERS', orderId);
    if (!saved || saved.QboInvoiceId !== qboInvoiceId) {
      console.error(`[qbo] QboInvoiceId failed to persist for order ${orderId}: expected "${qboInvoiceId}", got "${saved?.QboInvoiceId}"`);
    }

    console.log(`[qbo] Order ${orderId} synced → QBO Invoice ${qboInvoiceId}`);

    // Note if no email — invoice won't be sent by QBO
    const billEmail = account.BillingEmail || account.Email;
    if (!billEmail) {
      try {
        const cur = getRow('ORDERS', orderId);
        const notes = cur?.Notes || '';
        const sendNote = `Invoice ${invoice.DocNumber || qboInvoiceId} was not sent: no email address on account`;
        await updateRow('ORDERS', orderId, {
          Notes: notes ? `${notes}\n${sendNote}` : sendNote,
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
  } catch (err) {
    console.error(`[qbo] Sync failed for order ${orderId}:`, err.message);
    try {
      await updateRow('ORDERS', orderId, { QboSyncStatus: 'failed', QboSyncError: err.message });
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
  fetchTaxCodes,
  clearTaxInfoCache,
  getPayment,
  getInvoice,
  voidInvoice,
  processQboPaymentWebhook,
  QBO_APP_URL,
};
