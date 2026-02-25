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
    contactName: '',
    accountMatch: 'none',
    abcLicense: extractABCLicense(text),
    orderAmount: '',
    taxAmount: '',
    lineItems: [],
  };

  // Extract amounts
  const amounts = extractAmounts(text);
  parsed.orderAmount = amounts.subtotal;
  parsed.taxAmount = amounts.tax;

  // Extract candidate account names and match against existing accounts
  // Candidates: [contact name, business name] from the customer section
  const candidates = extractAccountCandidates(text);
  if (candidates.length > 0) {
    // First candidate is always the contact person
    parsed.contactName = candidates[0];
    // Business name is the second candidate (if present), otherwise same as contact
    const businessName = candidates.length > 1 ? candidates[candidates.length - 1] : candidates[0];

    let bestMatch = { accountId: '', accountName: businessName, match: 'none' };
    for (const name of candidates) {
      const match = matchAccount(name, accounts);
      if (match.match === 'exact') { bestMatch = match; break; }
      if (match.match === 'fuzzy' && bestMatch.match === 'none') bestMatch = match;
    }
    parsed.accountId = bestMatch.accountId;
    parsed.accountName = bestMatch.accountName;
    parsed.accountMatch = bestMatch.match;
  }

  // Extract line items
  const rawItems = extractLineItems(lines);
  parsed.lineItems = rawItems.map(item => {
    const fmt = normalizeFormat(item.format || '');
    const match = matchProduct(item.productName, inventory, item.format);
    return {
      productName: item.productName,
      format: fmt,
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
  // Priority 1: "Invoice #001041" — require # or : separator (most reliable)
  const strictPatterns = [
    /\binvoice\s*#\s*:?\s*([A-Z0-9][\w\-]+)/i,
    /\binv[\s.\-]*#\s*:?\s*([A-Z0-9][\w\-]+)/i,
    /\b(?:invoice|inv)\s+(?:number|no|num)[\s.:]+([A-Z0-9][\w\-]+)/i,
  ];
  for (const p of strictPatterns) {
    const m = text.match(p);
    if (m) return m[1];
  }

  // Priority 2: "Invoice: 001041" or "Invoice 001041" (word boundary prevents matching inside "CustomerInvoice")
  const loosePatterns = [
    /\binvoice\s*:?\s+([A-Z0-9][\w\-]+)/i,
    /\binv[\s.\-#]*:?\s*([A-Z0-9][\w\-]+)/i,
    /\b(?:number|no)\s*:?\s*([A-Z0-9][\w\-]+)/i,
  ];
  for (const p of loosePatterns) {
    const m = text.match(p);
    if (m) return m[1];
  }
  return '';
}

function extractDate(text) {
  // Contextual patterns — prioritize "service date", "invoice date", "issue date", etc.
  const contextPatterns = [
    /(?:service|invoice|order|sale|issued?)\s*date\s*:?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    /(?:date|dated)\s*:?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    /(?:service|invoice|order|sale|issued?|created?)\s*date\s*:?\s*(\w+\s+\d{1,2},?\s+\d{4})/i,
    /(?:date|dated)\s*:?\s*(\w+\s+\d{1,2},?\s+\d{4})/i,
    // "PDF created September 23, 2025" or "created September 23, 2025"
    /(?:created?)\s+(\w+\s+\d{1,2},?\s+\d{4})/i,
    // Multi-line: "Issue date\nSep 23, 2025"
    /(?:service|invoice|order|issue)\s*date\s*\n\s*(\w+\s+\d{1,2},?\s+\d{4})/i,
    /(?:service|invoice|order|issue)\s*date\s*\n\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
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

  // Full and abbreviated month name map
  const months = {
    january: '01', jan: '01', february: '02', feb: '02', march: '03', mar: '03',
    april: '04', apr: '04', may: '05', june: '06', jun: '06',
    july: '07', jul: '07', august: '08', aug: '08', september: '09', sep: '09', sept: '09',
    october: '10', oct: '10', november: '11', nov: '11', december: '12', dec: '12',
  };

  const monthName = dateStr.match(/(\w+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (monthName) {
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

function normalizeFormat(rawFormat) {
  if (!rawFormat) return '';
  const s = rawFormat.toLowerCase();
  if (/16\s*oz/.test(s) && /ca(n|se)/.test(s))  return '16oz Case';
  if (/12\s*oz/.test(s) && /ca(n|se)/.test(s))  return '12oz Case';
  if (/1\/6/.test(s) && /ke?g|bbl/.test(s))      return '1/6 Keg';
  if (/1\/2/.test(s) && /ke?g|bbl/.test(s))      return '1/2 Keg';
  if (/1\/4/.test(s) && /ke?g|bbl/.test(s))      return '1/4 Keg';
  return rawFormat; // pass through unrecognized formats
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

function extractABCLicense(text) {
  // Standard: "ABC #18833" or "ABC 01006032201"
  const m = text.match(/\bABC\s*#?\s*:?\s*(\d{5,})/i);
  if (m) return m[1];
  // Split across lines: "..., ABC\n#:01006002507"
  const split = text.match(/\bABC\s*\n\s*#?\s*:?\s*(\d{5,})/i);
  if (split) return split[1];
  return '';
}

/**
 * Extract candidate account names from the invoice text.
 * Returns an array of names in order: [contact name, business name].
 * The caller tries matching each against existing accounts.
 */
function extractAccountCandidates(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  // Strip ABC suffix: handles "- ABC #18833", "- ABC 01006032201", and ", ABC" (trailing, number on next line)
  const cleanABC = s => s.replace(/\s*[-,]\s*ABC\s*#?\s*:?\s*\d*.*$/i, '').trim();

  // Strategy 1: Look for "Bill to:", "Sold to:", "Customer:", "Client:", "Ship to:" with inline value
  const inlinePatterns = [
    /(?:bill\s*to|sold\s*to|client|ship\s*to)\s*:\s*(.+)/i,
  ];
  for (const p of inlinePatterns) {
    const m = text.match(p);
    if (m) {
      const name = cleanABC(m[1].split(/\n/)[0].replace(/\s*(address|phone|email|fax|attn).*$/i, '').trim());
      if (name) return [name];
    }
  }

  // Strategy 2: Line-based — find "Customer" header, collect subsequent name lines.
  // Square invoice pattern: "CustomerInvoice DetailsPayment" → next line is contact name,
  // line after that is business name. Return both so caller can match either.
  for (let i = 0; i < lines.length; i++) {
    if (/^customer/i.test(lines[i])) {
      const candidates = [];
      for (let j = 1; j <= 3 && i + j < lines.length; j++) {
        const line = lines[i + j];
        if (!line) continue;
        if (/@/.test(line)) continue;                   // skip email
        // Skip address lines (start with digit AND contain street keywords) but not business names like "25 Steak and Social"
        if (/^\d/.test(line) && /\b(Ave|St|Blvd|Rd|Dr|Ln|Ct|Way|Hwy|Suite|Street|Avenue|Road|Drive|Lane|Highway|PO\s*Box)\b/i.test(line)) continue;
        // Skip city/state/zip lines like "Hutchinson, KS 67502"
        if (/,\s*[A-Z]{2}\s+\d{5}/.test(line)) continue;
        if (/^(item|product|description|#|page\s|pdf\s|service|due|\$)/i.test(line)) break;
        const cleaned = cleanABC(line);
        if (!cleaned || cleaned.length <= 1) continue;
        // Handle comma-separated "Contact Name, Business Name" on a single line
        if (cleaned.includes(',')) {
          const parts = cleaned.split(',').map(p => p.trim()).filter(p => p.length > 1);
          if (parts.length >= 2) { candidates.push(...parts); continue; }
        }
        candidates.push(cleaned);
      }
      if (candidates.length > 0) return candidates;
      break;
    }
  }

  // Strategy 3: Broader pattern — "customer" followed by anything then newline and name
  const broadMatch = text.match(/customer[^\n]*\n\s*([^\n]+)/i);
  if (broadMatch) {
    const name = cleanABC(broadMatch[1].trim());
    if (name && !/@/.test(name) && name.length > 1) return [name];
  }

  return [];
}

function extractLineItems(lines) {
  const items = [];
  let inItemSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lower = line.toLowerCase();

    if ((/^(item|product|description|qty|quantity|#)\b/i.test(line) &&
        /\b(qty|quantity|price|amount|total|rate)\b/i.test(lower)) ||
        /^items?quantityprice/i.test(lower)) {
      inItemSection = true;
      continue;
    }

    if (inItemSection && /^(sub\s*total|subtotal|total|tax|notes|terms|payment|thank)/i.test(line)) {
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
    if (item) {
      // Peek at the next line — if it's a text-only description (no prices/numbers at end),
      // treat it as the real product name and the parsed name as the format.
      // Common in Square invoices: "16oz Can Case - On-Premises  1  $65.00  $65.00" then "Oktoberfest - Märzen"
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        const isDescriptionLine = nextLine &&
          !/\$/.test(nextLine) &&
          !/^(sub\s*total|subtotal|total|tax|notes|terms|payment|thank|page\s)/i.test(nextLine) &&
          /[a-zA-Z]/.test(nextLine) &&
          !parseItemLine(nextLine);
        if (isDescriptionLine) {
          // Use the description line as product name; keep parsed name as format
          item.format = item.productName;
          // Strip trailing suffixes like " - On-Premises" from format
          item.format = item.format.replace(/\s*-\s*(on-premises|off-premises|retail|wholesale)$/i, '').trim();
          // Extract product name — strip style suffix after " - " (e.g. "Oktoberfest - Märzen" → "Oktoberfest")
          const nameParts = nextLine.split(/\s+-\s+/);
          item.productName = nameParts[0].trim();
          if (nameParts.length > 1) {
            item.style = nameParts.slice(1).join(' - ').trim();
          }
          i++; // Skip the description line
        }
      }
      items.push(item);
    }
  }

  return items;
}

function parseItemLine(line) {
  // Format 1: "Product Name   2   $65.00   $130.00" (spaced columns)
  const match = line.match(/^(.+?)\s{2,}(\d+(?:\.\d+)?)\s+\$?([\d,]+\.?\d*)\s+\$?([\d,]+\.?\d*)\s*$/);
  if (match) {
    return {
      productName: match[1].trim(),
      quantity: match[2],
      unitPrice: match[3].replace(/,/g, ''),
      lineTotal: match[4].replace(/,/g, ''),
    };
  }

  // Format 2: "Product Name   2   $130.00" (spaced, no unit price)
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

  // Format 3: "Product Name   $65.00   2   $130.00" (price before qty)
  const match3 = line.match(/^(.+?)\s+\$?([\d,]+\.?\d*)\s+(\d+(?:\.\d+)?)\s+\$?([\d,]+\.?\d*)\s*$/);
  if (match3 && match3[1].length > 2 && !/^\d/.test(match3[1])) {
    return {
      productName: match3[1].trim(),
      quantity: match3[3],
      unitPrice: match3[2].replace(/,/g, ''),
      lineTotal: match3[4].replace(/,/g, ''),
    };
  }

  // Format 4: PDF concatenated columns — "Product Name1$65.00$65.00" or "16oz Can Case2$65.00$130.00"
  // Quantity is jammed against the name, prices have $ prefix with no spaces
  // Name must contain at least one letter (to avoid matching pure-number lines)
  const match4 = line.match(/^(.+?)(\d+)\$([\d,]+\.?\d*)\$([\d,]+\.?\d*)\s*$/);
  if (match4 && match4[1].length > 2 && /[a-zA-Z]/.test(match4[1])) {
    return {
      productName: match4[1].replace(/[\s-]+$/, '').trim(),
      quantity: match4[2],
      unitPrice: match4[3].replace(/,/g, ''),
      lineTotal: match4[4].replace(/,/g, ''),
    };
  }

  // Format 5: Single price concatenated — "Product Name1$65.00"
  const match5 = line.match(/^(.+?)(\d+)\$([\d,]+\.?\d*)\s*$/);
  if (match5 && match5[1].length > 2 && /[a-zA-Z]/.test(match5[1])) {
    const qty = parseFloat(match5[2]);
    const total = parseFloat(match5[3].replace(/,/g, ''));
    const unitPrice = qty > 0 ? (total / qty).toFixed(2) : '0';
    return {
      productName: match5[1].replace(/[\s-]+$/, '').trim(),
      quantity: match5[2],
      unitPrice,
      lineTotal: match5[3].replace(/,/g, ''),
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

function matchProduct(productName, inventory, format) {
  if (!productName) return { inventoryId: '', match: 'none' };
  const lower = productName.toLowerCase().trim();
  const fmtLower = (format || '').toLowerCase().trim();

  // Priority 1: Exact match on name + format (most specific — avoids matching wrong format when product exists in multiple)
  const fmtNorm = normalizeFormat(format || '').toLowerCase().trim();
  if (fmtNorm) {
    const nameAndFormat = inventory.find(p => {
      const invName = (p.ProductName || p.Name || '').toLowerCase().trim();
      const invFmtNorm = normalizeFormat(p.Format || '').toLowerCase().trim();
      return invName === lower && invFmtNorm && fmtNorm === invFmtNorm;
    });
    if (nameAndFormat) return { inventoryId: nameAndFormat.ID, match: 'exact' };
  }

  // Priority 2: Exact match on product name only (fallback when format unavailable or no format match)
  const exact = inventory.find(p => (p.ProductName || p.Name || '').toLowerCase().trim() === lower);
  if (exact) {
    // If we have format info from the PDF but it doesn't match, treat as no match so user
    // can create the correct format variant (e.g. "Barred Owl" exists as keg but invoice is a case)
    if (fmtNorm) {
      const exactFmtNorm = normalizeFormat(exact.Format || '').toLowerCase().trim();
      if (exactFmtNorm && fmtNorm !== exactFmtNorm) {
        return { inventoryId: '', match: 'none' };
      }
    }
    return { inventoryId: exact.ID, match: 'exact' };
  }

  // Fuzzy: extracted name is contained in inventory name or vice versa
  const fuzzy = inventory.find(p => {
    const name = (p.ProductName || p.Name || '').toLowerCase().trim();
    return name && (lower.includes(name) || name.includes(lower));
  });
  if (fuzzy) return { inventoryId: fuzzy.ID, match: 'fuzzy' };

  // Fuzzy: check if extracted format contains inventory product name
  // (e.g. format "16oz Can Case" won't match, but product name "Oktoberfest" might be in combined text)
  if (fmtLower) {
    const combined = `${lower} ${fmtLower}`;
    const fuzzyFmt = inventory.find(p => {
      const name = (p.ProductName || p.Name || '').toLowerCase().trim();
      return name && combined.includes(name);
    });
    if (fuzzyFmt) return { inventoryId: fuzzyFmt.ID, match: 'fuzzy' };
  }

  return { inventoryId: '', match: 'none' };
}

module.exports = { extractInvoiceData };
