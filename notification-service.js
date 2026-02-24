'use strict';

const crypto = require('crypto');
const { getAllRows, addRow, updateRow, deleteRow } = require('./sheets');
const { isEmailConfigured, sendEmail } = require('./email-service');

// ── Helpers ──────────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().split('T')[0];
}

function hoursAgo(isoStr, hours) {
  if (!isoStr) return true;
  const then = new Date(isoStr).getTime();
  return Date.now() - then > hours * 60 * 60 * 1000;
}

// ── Core: create a notification with dedup ───────────────────────────────

function createNotification({ type, title, body, severity, staffId, referenceType, referenceId, dedupKey }) {
  const existing = getAllRows('NOTIFICATIONS');
  const duplicate = existing.find(n => n.DedupKey === dedupKey);
  if (duplicate) return null; // already has a notification for this condition

  const notification = {
    ID:            crypto.randomUUID(),
    Type:          type,
    Title:         title,
    Body:          body || '',
    Severity:      severity || 'info',
    StaffID:       staffId || '',
    ReferenceType: referenceType || '',
    ReferenceID:   referenceId || '',
    ReadAt:        '',
    EmailSent:     'false',
    DedupKey:      dedupKey,
    CreatedAt:     new Date().toISOString(),
  };
  addRow('NOTIFICATIONS', notification);
  return notification;
}

// ── Detection: low / out of stock ────────────────────────────────────────

function checkLowStock() {
  const inventory = getAllRows('INVENTORY');
  const products  = getAllRows('PRODUCTS');
  const productMap = Object.fromEntries(products.map(p => [p.ID, p]));

  for (const inv of inventory) {
    const units     = parseInt(inv.Units || '0', 10);
    const threshold = parseInt(inv.LowStockThreshold || '5', 10);
    if (units > threshold) continue;

    const product = productMap[inv.ProductID] || {};
    const name    = inv.ProductName || product.Name || inv.Name || 'Unknown';
    const format  = product.Format || inv.Format || '';
    const label   = [name, format].filter(Boolean).join(' — ');
    const location = inv.Location || '';

    const isOut   = units === 0;
    const type    = isOut ? 'out_of_stock' : 'low_stock';
    const severity = isOut ? 'critical' : 'warning';

    createNotification({
      type,
      title:         isOut ? `Out of stock: ${label}` : `Low stock: ${label}`,
      body:          `${units} units remaining${threshold ? ` (threshold: ${threshold})` : ''}${location ? ` at ${location}` : ''}`,
      severity,
      staffId:       '', // broadcast to all staff
      referenceType: 'inventory',
      referenceId:   inv.ID,
      dedupKey:      `${type}:${inv.ID}`,
    });
  }
}

// ── Detection: missed delivery dates ─────────────────────────────────────

function checkMissedDeliveries() {
  const orders = getAllRows('ORDERS');
  const t = today();

  for (const order of orders) {
    if (order.Delivered === 'true') continue;
    if (order.Status === 'Cancelled' || order.Status === 'Pre-Sale') continue;
    if (!order.DeliveryDate || order.DeliveryDate >= t) continue;

    const daysLate = Math.floor((Date.now() - new Date(order.DeliveryDate + 'T00:00:00').getTime()) / (24 * 60 * 60 * 1000));
    const severity = daysLate >= 3 ? 'critical' : 'warning';

    createNotification({
      type:          'delivery_missed',
      title:         `Delivery missed: ${order.AccountName || 'Unknown'}`,
      body:          `Order ${order.InvoiceNumber || order.ID.slice(0, 8)} was due ${order.DeliveryDate} (${daysLate}d late)`,
      severity,
      staffId:       order.StaffID || '',
      referenceType: 'order',
      referenceId:   order.ID,
      dedupKey:      `delivery_missed:${order.ID}`,
    });
  }
}

// ── Detection: past due todos ────────────────────────────────────────────

function checkPastDueTodos() {
  const reminders = getAllRows('REMINDERS');
  const t = today();

  for (const r of reminders) {
    if (r.Completed === 'true') continue;
    if (!r.DueDate || r.DueDate >= t) continue;

    createNotification({
      type:          'todo_past_due',
      title:         `Todo past due: ${r.Title}`,
      body:          `Due ${r.DueDate}${r.AccountName ? ` — ${r.AccountName}` : ''}`,
      severity:      'warning',
      staffId:       r.StaffID || '',
      referenceType: 'reminder',
      referenceId:   r.ID,
      dedupKey:      `todo_past_due:${r.ID}`,
    });
  }
}

// ── Event-driven: todo assigned ──────────────────────────────────────────

function notifyTodoAssigned(reminder) {
  if (!reminder.StaffID) return null;

  return createNotification({
    type:          'todo_assigned',
    title:         `Todo assigned: ${reminder.Title}`,
    body:          `Due ${reminder.DueDate || 'N/A'}${reminder.AccountName ? ` — ${reminder.AccountName}` : ''}`,
    severity:      'info',
    staffId:       reminder.StaffID,
    referenceType: 'reminder',
    referenceId:   reminder.ID,
    dedupKey:      `todo_assigned:${reminder.ID}:${reminder.StaffID}`,
  });
}

// ── Auto-expire resolved notifications ───────────────────────────────────

function expireResolvedNotifications() {
  const notifications = getAllRows('NOTIFICATIONS');
  if (notifications.length === 0) return;

  // Gather source data
  const inventory = getAllRows('INVENTORY');
  const orders    = getAllRows('ORDERS');
  const reminders = getAllRows('REMINDERS');

  const invMap  = Object.fromEntries(inventory.map(i => [i.ID, i]));
  const ordMap  = Object.fromEntries(orders.map(o => [o.ID, o]));
  const remMap  = Object.fromEntries(reminders.map(r => [r.ID, r]));

  for (const n of notifications) {
    let resolved = false;

    if ((n.Type === 'low_stock' || n.Type === 'out_of_stock') && n.ReferenceType === 'inventory') {
      const inv = invMap[n.ReferenceID];
      if (inv) {
        const units     = parseInt(inv.Units || '0', 10);
        const threshold = parseInt(inv.LowStockThreshold || '5', 10);
        if (units > threshold) resolved = true;
      } else {
        resolved = true; // inventory item deleted
      }
    }

    if (n.Type === 'delivery_missed' && n.ReferenceType === 'order') {
      const ord = ordMap[n.ReferenceID];
      if (!ord || ord.Delivered === 'true' || ord.Status === 'Cancelled') resolved = true;
    }

    if (n.Type === 'todo_past_due' && n.ReferenceType === 'reminder') {
      const rem = remMap[n.ReferenceID];
      if (!rem || rem.Completed === 'true') resolved = true;
    }

    if (n.Type === 'todo_assigned' && n.ReferenceType === 'reminder') {
      const rem = remMap[n.ReferenceID];
      if (!rem || rem.Completed === 'true') resolved = true;
    }

    // Delete resolved notifications so they don't block dedup if the condition recurs
    if (resolved) {
      deleteRow('NOTIFICATIONS', n.ID);
    }
  }
}

// ── Run all checks ───────────────────────────────────────────────────────

function runAllChecks() {
  checkLowStock();
  checkMissedDeliveries();
  checkPastDueTodos();
  expireResolvedNotifications();
}

// ── Email delivery ───────────────────────────────────────────────────────

async function sendPendingEmails(user) {
  if (!isEmailConfigured() || !user || !user.accessToken) return;

  const notifications = getAllRows('NOTIFICATIONS');
  const pending = notifications.filter(n =>
    n.EmailSent === 'false' && !n.ReadAt && !hoursAgo(n.CreatedAt, -24)
  );
  if (pending.length === 0) return;

  // Only email notifications created in the last 24 hours
  const recent = pending.filter(n => !hoursAgo(n.CreatedAt, 24));
  if (recent.length === 0) {
    // Mark stale ones as email-sent so we don't keep checking
    for (const n of pending) {
      if (hoursAgo(n.CreatedAt, 24)) {
        updateRow('NOTIFICATIONS', n.ID, { EmailSent: 'skipped' });
      }
    }
    return;
  }

  const staff = getAllRows('STAFF');
  const staffMap = Object.fromEntries(staff.map(s => [s.ID, s]));

  // Group notifications by staff member for digest
  const byStaff = {};
  for (const n of recent) {
    const key = n.StaffID || '_broadcast';
    if (!byStaff[key]) byStaff[key] = [];
    byStaff[key].push(n);
  }

  for (const [staffKey, items] of Object.entries(byStaff)) {
    let recipients = [];

    if (staffKey === '_broadcast') {
      // Broadcast: email all active staff
      recipients = staff
        .filter(s => s.Active !== 'false' && s.Email)
        .map(s => s.Email.split(',').map(e => e.trim()).filter(Boolean))
        .flat();
    } else {
      const member = staffMap[staffKey];
      if (member && member.Email) {
        recipients = member.Email.split(',').map(e => e.trim()).filter(Boolean);
      }
    }

    if (recipients.length === 0) {
      // No email target — mark as sent to avoid retrying
      for (const n of items) {
        updateRow('NOTIFICATIONS', n.ID, { EmailSent: 'skipped' });
      }
      continue;
    }

    // Build digest email
    const lines = items.map(n => {
      const icon = n.Severity === 'critical' ? '🔴' : n.Severity === 'warning' ? '🟡' : 'ℹ️';
      return `${icon} ${n.Title}\n   ${n.Body}`;
    });

    const subject = items.length === 1
      ? items[0].Title
      : `${items.length} notifications need your attention`;

    const body = [
      'You have new notifications:\n',
      ...lines,
      '',
      '—',
      'Brewery Distribution Manager',
    ].join('\n');

    try {
      await sendEmail({
        user,
        to: recipients[0],
        bcc: recipients.length > 1 ? recipients.slice(1) : undefined,
        subject,
        body,
      });
      for (const n of items) {
        updateRow('NOTIFICATIONS', n.ID, { EmailSent: 'true' });
      }
    } catch (err) {
      console.error('Failed to send notification email:', err.message);
      // Leave EmailSent as 'false' to retry on next check
    }
  }
}

// ── Exports ──────────────────────────────────────────────────────────────

module.exports = {
  createNotification,
  notifyTodoAssigned,
  runAllChecks,
  sendPendingEmails,
};
