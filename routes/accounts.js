'use strict';

const express = require('express');
const { getAllRows, addRow, updateRow, deleteRow } = require('../db');

const router = express.Router();

async function getNextAccountId() {
  const accounts = await getAllRows('ACCOUNTS');
  const maxId = Math.max(0, ...accounts.map(a => parseInt(a.ID, 10) || 0));
  return String(maxId + 1);
}

router.get('/', async (req, res) => {
  try {
    const accounts = await getAllRows('ACCOUNTS');
    res.json(accounts);
  } catch (err) {
    console.error(`[accounts] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { Name, Type, Tags, ContactName, Email, AdditionalEmails, Phone, PreferredMethod, BillingContactName, BillingEmail, BillingPhone, Address, City, State, Zip, ABCLicense, Status, Notes, StaffID, StaffName } = req.body;
    if (!Name) return res.status(400).json({ error: 'Account name is required' });

    const account = {
      ID: await getNextAccountId(),
      Name: Name.trim(),
      Type: Type || 'Bar',
      Tags: Tags || '[]',
      ContactName: ContactName || '',
      Email: Email || '',
      AdditionalEmails: AdditionalEmails || '[]',
      Phone: Phone || '',
      PreferredMethod: PreferredMethod || 'Email',
      BillingContactName: BillingContactName || '',
      BillingEmail: BillingEmail || '',
      BillingPhone: BillingPhone || '',
      Address: Address || '',
      City: City || '',
      State: State || '',
      Zip: Zip || '',
      ABCLicense: ABCLicense || '',
      Status: Status || 'Prospect',
      Notes: Notes || '',
      LastContacted: '',
      StaffID: StaffID || '',
      StaffName: StaffName || '',
      CreatedAt: new Date().toISOString(),
    };

    await addRow('ACCOUNTS', account);
    res.status(201).json(account);
  } catch (err) {
    console.error(`[accounts] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const updates = { ...req.body };
    delete updates.ID;
    delete updates.CreatedAt;
    const updated = await updateRow('ACCOUNTS', req.params.id, updates);
    res.json(updated);
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 500;
    console.error(`[accounts] ${err.message}`);
    res.status(status).json({ error: status === 404 ? 'Not found' : 'Internal server error' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = req.params.id;

    // Cascade delete: remove associated outreach entries
    const outreachItems = await getAllRows('OUTREACH');
    for (const item of outreachItems) {
      if (item.AccountID === id) {
        await deleteRow('OUTREACH', item.ID);
      }
    }

    // Cascade delete: remove associated reminders
    const reminders = await getAllRows('REMINDERS');
    for (const reminder of reminders) {
      if (reminder.AccountID === id) {
        await deleteRow('REMINDERS', reminder.ID);
      }
    }

    // Cascade delete: remove associated orders
    const orders = await getAllRows('ORDERS');
    for (const order of orders) {
      if (order.AccountID === id) {
        await deleteRow('ORDERS', order.ID);
      }
    }

    // Cascade delete: remove associated keg tracking records
    const kegs = await getAllRows('KEG_TRACKING');
    for (const keg of kegs) {
      if (keg.AccountID === id) {
        await deleteRow('KEG_TRACKING', keg.ID);
      }
    }

    // Cascade delete: remove associated tap handle records
    const tapHandles = await getAllRows('TAP_HANDLES');
    for (const handle of tapHandles) {
      if (handle.AccountID === id) {
        await deleteRow('TAP_HANDLES', handle.ID);
      }
    }

    await deleteRow('ACCOUNTS', id);
    res.json({ success: true });
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 500;
    console.error(`[accounts] ${err.message}`);
    res.status(status).json({ error: status === 404 ? 'Not found' : 'Internal server error' });
  }
});

// ── Merge ─────────────────────────────────────────────────────────

router.get('/:id/merge-preview', async (req, res) => {
  try {
    const sourceId = req.query.sourceId;
    if (!sourceId) return res.status(400).json({ error: 'sourceId is required' });

    const [outreach, reminders, orders, kegs, tapHandles, emailLog] = await Promise.all([
      getAllRows('OUTREACH'),
      getAllRows('REMINDERS'),
      getAllRows('ORDERS'),
      getAllRows('KEG_TRACKING'),
      getAllRows('TAP_HANDLES'),
      getAllRows('EMAIL_LOG'),
    ]);

    res.json({
      outreach:   outreach.filter(r => r.AccountID === sourceId).length,
      reminders:  reminders.filter(r => r.AccountID === sourceId).length,
      orders:     orders.filter(r => r.AccountID === sourceId).length,
      kegs:       kegs.filter(r => r.AccountID === sourceId).length,
      tapHandles: tapHandles.filter(r => r.AccountID === sourceId).length,
      emails:     emailLog.filter(r => (r.AccountIDs || '').split(',').map(s => s.trim()).includes(sourceId)).length,
    });
  } catch (err) {
    console.error(`[accounts] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:id/merge', async (req, res) => {
  try {
    const targetId = req.params.id;
    const { sourceAccountId } = req.body;
    if (!sourceAccountId) return res.status(400).json({ error: 'sourceAccountId is required' });

    const accounts = await getAllRows('ACCOUNTS');
    const target = accounts.find(a => a.ID === targetId);
    const source = accounts.find(a => a.ID === sourceAccountId);
    if (!target) return res.status(404).json({ error: 'Target account not found' });
    if (!source) return res.status(404).json({ error: 'Source account not found' });

    const counts = { outreach: 0, reminders: 0, orders: 0, kegs: 0, tapHandles: 0, emails: 0 };

    // Reassign OUTREACH
    const outreach = await getAllRows('OUTREACH');
    for (const r of outreach) {
      if (r.AccountID === sourceAccountId) {
        await updateRow('OUTREACH', r.ID, { AccountID: targetId, AccountName: target.Name });
        counts.outreach++;
      }
    }

    // Reassign REMINDERS
    const reminders = await getAllRows('REMINDERS');
    for (const r of reminders) {
      if (r.AccountID === sourceAccountId) {
        await updateRow('REMINDERS', r.ID, { AccountID: targetId, AccountName: target.Name });
        counts.reminders++;
      }
    }

    // Reassign ORDERS
    const orders = await getAllRows('ORDERS');
    for (const r of orders) {
      if (r.AccountID === sourceAccountId) {
        await updateRow('ORDERS', r.ID, { AccountID: targetId, AccountName: target.Name });
        counts.orders++;
      }
    }

    // Reassign KEG_TRACKING
    const kegs = await getAllRows('KEG_TRACKING');
    for (const r of kegs) {
      if (r.AccountID === sourceAccountId) {
        await updateRow('KEG_TRACKING', r.ID, { AccountID: targetId, AccountName: target.Name });
        counts.kegs++;
      }
    }

    // Reassign TAP_HANDLES
    const tapHandles = await getAllRows('TAP_HANDLES');
    for (const r of tapHandles) {
      if (r.AccountID === sourceAccountId) {
        await updateRow('TAP_HANDLES', r.ID, { AccountID: targetId, AccountName: target.Name });
        counts.tapHandles++;
      }
    }

    // Reassign EMAIL_LOG — replace sourceId with targetId in comma-separated AccountIDs
    const emailLog = await getAllRows('EMAIL_LOG');
    for (const r of emailLog) {
      const ids = (r.AccountIDs || '').split(',').map(s => s.trim()).filter(Boolean);
      if (ids.includes(sourceAccountId)) {
        const updated = [...new Set(ids.map(id => id === sourceAccountId ? targetId : id))];
        await updateRow('EMAIL_LOG', r.ID, { AccountIDs: updated.join(', ') });
        counts.emails++;
      }
    }

    // Merge account metadata onto target (fill empty fields only)
    const updates = {};

    const fillFields = ['ContactName', 'Email', 'Phone', 'BillingContactName', 'BillingEmail', 'BillingPhone', 'Address', 'City', 'State', 'Zip', 'ABCLicense'];
    for (const field of fillFields) {
      if (!target[field] && source[field]) {
        updates[field] = source[field];
      }
    }

    // Tags — union
    let targetTags = []; try { targetTags = JSON.parse(target.Tags || '[]'); } catch (e) { /* ignore */ }
    let sourceTags = []; try { sourceTags = JSON.parse(source.Tags || '[]'); } catch (e) { /* ignore */ }
    const mergedTags = [...new Set([...targetTags, ...sourceTags])];
    updates.Tags = JSON.stringify(mergedTags);

    // AdditionalEmails — union; include source's primary Email if different from target's
    let targetExtra = []; try { targetExtra = JSON.parse(target.AdditionalEmails || '[]'); } catch (e) { /* ignore */ }
    let sourceExtra = []; try { sourceExtra = JSON.parse(source.AdditionalEmails || '[]'); } catch (e) { /* ignore */ }
    const allExtra = [...targetExtra, ...sourceExtra];
    if (source.Email && source.Email !== target.Email) allExtra.push(source.Email);
    updates.AdditionalEmails = JSON.stringify([...new Set(allExtra.filter(Boolean))]);

    // Notes — append
    if (source.Notes) {
      const sep = target.Notes ? '\n---\nMerged from ' + source.Name + ':\n' : '';
      updates.Notes = (target.Notes || '') + sep + source.Notes;
    }

    // LastContacted — use more recent
    if (source.LastContacted && (!target.LastContacted || source.LastContacted > target.LastContacted)) {
      updates.LastContacted = source.LastContacted;
    }

    await updateRow('ACCOUNTS', targetId, updates);

    // Delete source account
    await deleteRow('ACCOUNTS', sourceAccountId);

    res.json({ success: true, merged: counts });
  } catch (err) {
    console.error(`[accounts] ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
