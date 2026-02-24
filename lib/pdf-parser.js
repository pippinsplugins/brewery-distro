'use strict';

const pdfParse = require('pdf-parse');

/**
 * Extract invoice data from a PDF buffer.
 * @param {Buffer} pdfBuffer
 * @param {Array} accounts - Array of { ID, Name } objects
 * @param {Array} inventory - Array of { ID, Name, Format, PricePerUnit } objects
 * @returns {Object} { parsed, confidence }
 */
async function extractInvoiceData(pdfBuffer, accounts, inventory) {
  const data = await pdfParse(pdfBuffer);
  const text = data.text || '';
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  const parsed = {
    invoiceNumber: extractInvoiceNumber(text),
    orderDate: extractDate(text),
    accountId: '',
    accountName: '',
    accountMatch: 'none',
    orderAmount: '',
    taxAmount: '',
    lineItems: [],
  };

  // Extract amounts
  const amounts = extractAmounts(text);
  parsed.orderAmount = amounts.subtotal;
  parsed.taxAmount = amounts.tax;

  // Extract and match account
  const rawAccount = extractAccountName(text);
  if (rawAccount) {
    const match = matchAccount(rawAccount, accounts);
    parsed.accountId = match.accountId;
    parsed.accountName = match.accountName;
    parsed.accountMatch = match.match;
  }

  // Extract line items
  const rawItems = extractLineItems(lines);
  parsed.lineItems = rawItems.map(item => {
    const match = matchProduct(item.productName, inventory);
    return {
      productName: item.productName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
      inventoryId: match.inventoryId,
      inventoryMatch: match.match,
    };
  });

  // Determine confidence
  let confidence = 'low';
  const hasInvoice = !!parsed.invoiceNumber;
  const hasDate = !!parsed.orderDate;
  const hasAmount = !!parsed.orderAmount;
  const hasItems = parsed.lineItems.length > 0;
  if (hasInvoice && hasDate && hasAmount) confidence = 'high';
  else if ((hasInvoice || hasDate) && (hasAmount || hasItems)) confidence = 'medium';

  return { parsed, confidence };
}

function extractInvoiceNumber(text) {
  const patterns = [
    /invoice\s*#?\s*:?\s*([A-Z0-9][\w\-]+)/i,
    /inv[\s.\-#]*:?\s*([A-Z0-9][\w\-]+)/i,
    /(?:invoice|inv)\s+(?:number|no|num)[\s.:]*([A-Z0-9][\w\-]+)/i,
    /(?:number|no)\s*:?\s*([A-Z0-9][\w\-]+)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1];
  }
  return '';
}

function extractDate(text) {
  const contextPatterns = [
    /(?:invoice|order|sale|issued?)\s*date\s*:?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    /(?:date|dated)\s*:?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    /(?:invoice|order|sale|issued?)\s*date\s*:?\s*(\w+\s+\d{1,2},?\s+\d{4})/i,
    /(?:date|dated)\s*:?\s*(\w+\s+\d{1,2},?\s+\d{4})/i,
  ];
  for (const p of contextPatterns) {
    const m = text.match(p);
    if (m) return normalizeDate(m[1]);
  }

  const datePattern = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/;
  const m = text.match(datePattern);
  if (m) return normalizeDate(m[1]);

  const iso = text.match(/(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];

  return '';
}

function normalizeDate(dateStr) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;

  const monthName = dateStr.match(/(\w+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (monthName) {
    const months = { january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
      july: '07', august: '08', september: '09', october: '10', november: '11', december: '12' };
    const mon = months[monthName[1].toLowerCase()];
    if (mon) return `${monthName[3]}-${mon}-${monthName[2].padStart(2, '0')}`;
  }

  const parts = dateStr.split(/[\/\-]/);
  if (parts.length === 3) {
    let [a, b, c] = parts;
    if (c.length === 2) c = (parseInt(c) > 50 ? '19' : '20') + c;
    if (parseInt(a) > 12) return `${c}-${b.padStart(2, '0')}-${a.padStart(2, '0')}`;
    return `${c}-${a.padStart(2, '0')}-${b.padStart(2, '0')}`;
  }

  return dateStr;
}

function extractAmounts(text) {
  const result = { subtotal: '', tax: '', total: '' };

  const taxPatterns = [
    /(?:sales\s*)?tax\s*:?\s*\$?([\d,]+\.?\d*)/i,
    /tax\s+amount\s*:?\s*\$?([\d,]+\.?\d*)/i,
  ];
  for (const p of taxPatterns) {
    const m = text.match(p);
    if (m) { result.tax = m[1].replace(/,/g, ''); break; }
  }

  const subtotalPatterns = [
    /sub\s*total\s*:?\s*\$?([\d,]+\.?\d*)/i,
    /(?:order|invoice)\s*(?:amount|total)\s*:?\s*\$?([\d,]+\.?\d*)/i,
    /amount\s*(?:due)?\s*:?\s*\$?([\d,]+\.?\d*)/i,
  ];
  for (const p of subtotalPatterns) {
    const m = text.match(p);
    if (m) { result.subtotal = m[1].replace(/,/g, ''); break; }
  }

  const totalPatterns = [
    /(?:grand\s*)?total\s*(?:due|amount)?\s*:?\s*\$?([\d,]+\.?\d*)/i,
    /balance\s*(?:due)?\s*:?\s*\$?([\d,]+\.?\d*)/i,
  ];
  for (const p of totalPatterns) {
    const m = text.match(p);
    if (m) { result.total = m[1].replace(/,/g, ''); break; }
  }

  if (!result.subtotal && result.total && result.tax) {
    const t = parseFloat(result.total);
    const tax = parseFloat(result.tax);
    if (!isNaN(t) && !isNaN(tax)) result.subtotal = (t - tax).toFixed(2);
  }

  if (!result.subtotal && result.total) result.subtotal = result.total;

  return result;
}

function extractAccountName(text) {
  const patterns = [
    /(?:bill\s*to|sold\s*to|customer|client|ship\s*to)\s*:?\s*\n?\s*(.+)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const name = m[1].trim();
      return name.split(/\n/)[0].replace(/\s*(address|phone|email|fax|attn).*$/i, '').trim();
    }
  }
  return '';
}

function extractLineItems(lines) {
  const items = [];
  let inItemSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lower = line.toLowerCase();

    if (/^(item|product|description|qty|quantity|#)\b/i.test(line) &&
        /\b(qty|quantity|price|amount|total|rate)\b/i.test(lower)) {
      inItemSection = true;
      continue;
    }

    if (inItemSection && /^(sub\s*total|total|tax|notes|terms|payment|thank)/i.test(line)) {
      break;
    }

    if (!inItemSection) {
      const itemMatch = parseItemLine(line);
      if (itemMatch && items.length > 0) {
        items.push(itemMatch);
      } else if (itemMatch && i > 3) {
        items.push(itemMatch);
      }
      continue;
    }

    const item = parseItemLine(line);
    if (item) items.push(item);
  }

  return items;
}

function parseItemLine(line) {
  const match = line.match(/^(.+?)\s{2,}(\d+(?:\.\d+)?)\s+\$?([\d,]+\.?\d*)\s+\$?([\d,]+\.?\d*)\s*$/);
  if (match) {
    return {
      productName: match[1].trim(),
      quantity: match[2],
      unitPrice: match[3].replace(/,/g, ''),
      lineTotal: match[4].replace(/,/g, ''),
    };
  }

  const match2 = line.match(/^(.+?)\s{2,}(\d+(?:\.\d+)?)\s+\$?([\d,]+\.?\d*)\s*$/);
  if (match2) {
    const qty = parseFloat(match2[2]);
    const total = parseFloat(match2[3].replace(/,/g, ''));
    const unitPrice = qty > 0 ? (total / qty).toFixed(2) : '0';
    return {
      productName: match2[1].trim(),
      quantity: match2[2],
      unitPrice,
      lineTotal: match2[3].replace(/,/g, ''),
    };
  }

  const match3 = line.match(/^(.+?)\s+\$?([\d,]+\.?\d*)\s+(\d+(?:\.\d+)?)\s+\$?([\d,]+\.?\d*)\s*$/);
  if (match3 && match3[1].length > 2 && !/^\d/.test(match3[1])) {
    return {
      productName: match3[1].trim(),
      quantity: match3[3],
      unitPrice: match3[2].replace(/,/g, ''),
      lineTotal: match3[4].replace(/,/g, ''),
    };
  }

  return null;
}

function matchAccount(extractedName, accounts) {
  if (!extractedName) return { accountId: '', accountName: extractedName, match: 'none' };
  const lower = extractedName.toLowerCase().trim();

  const exact = accounts.find(a => a.Name.toLowerCase().trim() === lower);
  if (exact) return { accountId: exact.ID, accountName: exact.Name, match: 'exact' };

  const fuzzy = accounts.find(a =>
    lower.includes(a.Name.toLowerCase().trim()) ||
    a.Name.toLowerCase().trim().includes(lower)
  );
  if (fuzzy) return { accountId: fuzzy.ID, accountName: fuzzy.Name, match: 'fuzzy' };

  return { accountId: '', accountName: extractedName, match: 'none' };
}

function matchProduct(productName, inventory) {
  if (!productName) return { inventoryId: '', match: 'none' };
  const lower = productName.toLowerCase().trim();

  const exact = inventory.find(p => (p.ProductName || p.Name || '').toLowerCase().trim() === lower);
  if (exact) return { inventoryId: exact.ID, match: 'exact' };

  const fuzzy = inventory.find(p => {
    const name = (p.ProductName || p.Name || '').toLowerCase().trim();
    return lower.includes(name) || name.includes(lower);
  });
  if (fuzzy) return { inventoryId: fuzzy.ID, match: 'fuzzy' };

  return { inventoryId: '', match: 'none' };
}

module.exports = { extractInvoiceData };
