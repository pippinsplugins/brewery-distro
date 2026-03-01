'use strict';

const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { getAllRows, addRow, updateRow, deleteRow } = require('../db');
const { extractInvoiceData } = require('../lib/pdf-parser');

// Multer setup: memory storage, PDF only, 10MB limit, max 50 files
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are accepted'));
  },
});

const router = express.Router();

// Append current time to a date-only string so same-day orders sort by creation time.
// "2026-02-23" → "2026-02-23T14:30:05.123Z"; already-timestamped values pass through.
function withTimestamp(dateStr) {
  if (!dateStr) return dateStr;
  if (dateStr.includes('T')) return dateStr; // already has time
  return dateStr + 'T' + new Date().toISOString().split('T')[1];
}

router.get('/', async (req, res) => {
  try {
    const { accountId, staffId, location } = req.query;
    let orders = await getAllRows('ORDERS');
    if (accountId) orders = orders.filter(s => s.AccountID === accountId);
    if (staffId)   orders = orders.filter(s => s.StaffID === staffId);
    if (location)  orders = orders.filter(s => s.Location === location);
    // Sort newest first
    orders.sort((a, b) => (b.OrderDate || '').localeCompare(a.OrderDate || ''));
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const {
      AccountID, AccountName, Location, StaffID, StaffName,
      OrderDate, DeliveryDate, InvoiceNumber,
      OrderAmount, TaxAmount, DepositAmount, Notes, RequestedProducts, Status, Delivered,
    } = req.body;

    if (!AccountID) return res.status(400).json({ error: 'AccountID is required' });
    if (!OrderDate)  return res.status(400).json({ error: 'OrderDate is required' });

    const order = {
      ID: uuidv4(),
      AccountID,
      AccountName: AccountName || '',
      Location:    Location || '',
      StaffID:     StaffID || '',
      StaffName:   StaffName || '',
      OrderDate: withTimestamp(OrderDate),
      DeliveryDate: DeliveryDate || '',
      InvoiceNumber: InvoiceNumber || '',
      OrderAmount: OrderAmount || '0',
      TaxAmount:  TaxAmount  || '0',
      DepositAmount: DepositAmount || '0',
      Notes:     Notes     || '',
      RequestedProducts: RequestedProducts || '',
      Status:    Status    || 'Pending',
      Delivered: Delivered || 'false',
      CreatedAt: new Date().toISOString(),
    };

    await addRow('ORDERS', order);
    res.status(201).json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    // Prevent un-delivering an already-delivered order
    if (req.body.Delivered === 'false') {
      const orders = await getAllRows('ORDERS');
      const existing = orders.find(o => o.ID === req.params.id);
      if (existing && existing.Delivered === 'true') {
        return res.status(400).json({ error: 'Delivered orders cannot be un-delivered' });
      }
    }
    const updates = { ...req.body };
    delete updates.ID;
    delete updates.CreatedAt;
    if (updates.OrderDate) updates.OrderDate = withTimestamp(updates.OrderDate);
    const updated = await updateRow('ORDERS', req.params.id, updates);
    res.json(updated);
  } catch (err) {
    res.status(err.message.includes('not found') ? 404 : 500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await deleteRow('ORDERS', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(err.message.includes('not found') ? 404 : 500).json({ error: err.message });
  }
});

// ── Import endpoints ────────────────────────────────────────────────

// POST /import — upload PDF(s), extract + parse, return preview data
router.post('/import', upload.array('invoices', 50), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No PDF files uploaded' });
    }

    const [accounts, inventory, existingOrders] = await Promise.all([
      getAllRows('ACCOUNTS'),
      getAllRows('INVENTORY'),
      getAllRows('ORDERS'),
    ]);

    const existingInvoiceNums = new Set(
      existingOrders.filter(o => o.InvoiceNumber).map(o => o.InvoiceNumber.toLowerCase().trim())
    );

    const results = [];
    for (const file of req.files) {
      try {
        const { parsed, confidence } = await extractInvoiceData(file.buffer, accounts, inventory);
        const duplicate = parsed.invoiceNumber
          ? existingInvoiceNums.has(parsed.invoiceNumber.toLowerCase().trim())
          : false;
        const duplicateOrderId = duplicate
          ? (existingOrders.find(o => o.InvoiceNumber && o.InvoiceNumber.toLowerCase().trim() === parsed.invoiceNumber.toLowerCase().trim()) || {}).ID || ''
          : '';

        results.push({
          filename: file.originalname,
          parsed,
          confidence,
          duplicate,
          duplicateOrderId,
        });
      } catch (parseErr) {
        results.push({
          filename: file.originalname,
          parsed: {
            invoiceNumber: '', orderDate: '', accountId: '', accountName: '',
            accountMatch: 'none', orderAmount: '', taxAmount: '', lineItems: [],
          },
          confidence: 'error',
          error: parseErr.message,
          duplicate: false,
          duplicateOrderId: '',
          abcLicense: '',
        });
      }
    }

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /import/confirm — bulk create orders + line items + optional new inventory
router.post('/import/confirm', async (req, res) => {
  try {
    const { orders: orderDefs } = req.body;
    if (!Array.isArray(orderDefs) || orderDefs.length === 0) {
      return res.status(400).json({ error: 'orders array is required' });
    }

    const created = [];
    const errors = [];
    let newProductsCreated = 0;
    let newAccountsCreated = 0;
    const createdAccountsByName = {}; // track new accounts within this batch to avoid duplicates

    for (const def of orderDefs) {
      try {
        // 0. Create a new account if requested (or reuse one already created in this batch)
        if (!def.AccountID && def.newAccountName) {
          const nameKey = def.newAccountName.toLowerCase().trim();
          if (createdAccountsByName[nameKey]) {
            // Reuse account created earlier in this batch
            def.AccountID = createdAccountsByName[nameKey].ID;
            def.AccountName = createdAccountsByName[nameKey].Name;
          } else {
            const account = {
              ID: uuidv4(),
              Name: def.newAccountName,
              Type: 'Bar',
              Tags: '[]',
              ContactName: def.contactName || '',
              Email: def.email || '',
              AdditionalEmails: '[]',
              Phone: def.phone || '',
              PreferredMethod: 'Email',
              Address: '',
              City: '',
              State: '',
              Zip: '',
              ABCLicense: def.abcLicense || '',
              Status: 'Active',
              Notes: 'Created from invoice import',
              LastContacted: '',
              StaffID: '',
              StaffName: '',
              CreatedAt: new Date().toISOString(),
            };
            await addRow('ACCOUNTS', account);
            createdAccountsByName[nameKey] = account;
            def.AccountID = account.ID;
            def.AccountName = account.Name;
            newAccountsCreated++;
          }
        }

        // 0b. Update existing account with extracted fields if they're currently empty
        if (def.AccountID && (def.abcLicense || def.contactName || def.phone || def.email)) {
          const allAccounts = await getAllRows('ACCOUNTS');
          const acct = allAccounts.find(a => a.ID === def.AccountID);
          if (acct) {
            const updates = {};
            if (def.abcLicense && !acct.ABCLicense) updates.ABCLicense = def.abcLicense;
            if (def.contactName && !acct.ContactName) updates.ContactName = def.contactName;
            if (def.phone && !acct.Phone) updates.Phone = def.phone;
            if (def.email && !acct.Email) updates.Email = def.email;
            if (Object.keys(updates).length > 0) {
              await updateRow('ACCOUNTS', def.AccountID, updates);
            }
          }
        }

        // 1. Create any new inventory items for unmatched products
        const productIdMap = {}; // maps temp key → new inventory ID
        if (Array.isArray(def.newProducts)) {
          for (const np of def.newProducts) {
            const invItem = {
              ID: uuidv4(),
              Name: np.productName || '',
              Location: def.Location || '',
              Style: '',
              ABV: '',
              Format: np.format || '',
              Units: '0',
              PricePerUnit: np.unitPrice || '0',
              LowStockThreshold: '',
              Notes: 'Created from invoice import',
              LastUpdated: new Date().toISOString(),
              ProductID: '',
              ProductName: np.productName || '',
            };
            await addRow('INVENTORY', invItem);
            productIdMap[np.productName] = invItem.ID;
            newProductsCreated++;
          }
        }

        // 2. Create the order
        const order = {
          ID: uuidv4(),
          AccountID: def.AccountID || '',
          AccountName: def.AccountName || '',
          Location: def.Location || '',
          StaffID: def.StaffID || '',
          StaffName: def.StaffName || '',
          OrderDate: withTimestamp(def.OrderDate || new Date().toISOString().split('T')[0]),
          DeliveryDate: def.DeliveryDate || '',
          InvoiceNumber: def.InvoiceNumber || '',
          OrderAmount: def.OrderAmount || '0',
          TaxAmount: def.TaxAmount || '0',
          Notes: def.Notes || 'Imported from invoice',
          RequestedProducts: '',
          Status: def.Status || 'Paid',
          Delivered: def.Delivered || 'true',
          CreatedAt: new Date().toISOString(),
        };
        await addRow('ORDERS', order);

        // 3. Create order items (line items)
        if (Array.isArray(def.lineItems)) {
          for (const li of def.lineItems) {
            // Resolve inventory ID — could be from existing match or newly created
            let inventoryId = li.inventoryId || '';
            if (!inventoryId && productIdMap[li.productName]) {
              inventoryId = productIdMap[li.productName];
            }
            const item = {
              ID: uuidv4(),
              OrderID: order.ID,
              InventoryID: inventoryId,
              ProductName: li.productName || '',
              Format: li.format || '',
              Quantity: String(li.quantity || '0'),
              UnitPrice: String(li.unitPrice || '0'),
              LineTotal: String(li.lineTotal || '0'),
              CreatedAt: new Date().toISOString(),
            };
            await addRow('ORDER_ITEMS', item);
          }

          // Build RequestedProducts string from line items (include format for correct matching)
          const rpParts = def.lineItems
            .filter(li => li.productName && li.quantity)
            .map(li => {
              const label = li.format ? `${li.productName} (${li.format})` : li.productName;
              return `${li.quantity}x ${label}`;
            });
          if (rpParts.length) {
            await updateRow('ORDERS', order.ID, { RequestedProducts: rpParts.join(', ') });
            order.RequestedProducts = rpParts.join(', ');
          }
        }

        created.push(order);
      } catch (orderErr) {
        errors.push({ filename: def.filename || 'unknown', error: orderErr.message });
      }
    }

    res.json({ created, errors, newProductsCreated, newAccountsCreated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
