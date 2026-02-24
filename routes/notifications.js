'use strict';

const express = require('express');
const { getAllRows, updateRow } = require('../sheets');
const {
  runAllChecks,
  sendPendingEmails,
  sendPendingWebhooks,
} = require('../notification-service');
const { isEmailConfigured } = require('../email-service');

const router = express.Router();

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Find the current user's Staff record by matching their session email.
 */
function findCurrentStaff(userEmail) {
  if (!userEmail) return null;
  const staff = getAllRows('STAFF');
  const email = userEmail.toLowerCase();
  return staff.find(s =>
    s.Email && s.Email.split(',').map(e => e.trim().toLowerCase()).includes(email)
  ) || null;
}

/**
 * Return notifications relevant to a staff member:
 *  - targeted to their StaffID, or
 *  - broadcast (empty StaffID)
 * Excludes already-read notifications by default.
 */
function getNotificationsForStaff(staffId, includeRead = false) {
  const all = getAllRows('NOTIFICATIONS');
  return all
    .filter(n => {
      if (!includeRead && n.ReadAt) return false;
      return n.StaffID === '' || n.StaffID === staffId;
    })
    .sort((a, b) => (b.CreatedAt || '').localeCompare(a.CreatedAt || ''));
}

// ── GET /api/notifications ───────────────────────────────────────────────

router.get('/', (req, res) => {
  try {
    const staff = findCurrentStaff(req.user && req.user.email);
    const staffId = staff ? staff.ID : '__none__';
    const includeRead = req.query.includeRead === 'true';
    const notifications = getNotificationsForStaff(staffId, includeRead);
    res.json(notifications);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/notifications/unread-count ──────────────────────────────────

router.get('/unread-count', (req, res) => {
  try {
    const staff = findCurrentStaff(req.user && req.user.email);
    const staffId = staff ? staff.ID : '__none__';
    const notifications = getNotificationsForStaff(staffId, false);
    res.json({ count: notifications.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/notifications/:id/read ──────────────────────────────────────

router.put('/:id/read', (req, res) => {
  try {
    const updated = updateRow('NOTIFICATIONS', req.params.id, {
      ReadAt: new Date().toISOString(),
    });
    res.json(updated);
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// ── PUT /api/notifications/read-all ──────────────────────────────────────

router.put('/read-all', (req, res) => {
  try {
    const staff = findCurrentStaff(req.user && req.user.email);
    const staffId = staff ? staff.ID : '__none__';
    const unread = getNotificationsForStaff(staffId, false);
    const now = new Date().toISOString();
    for (const n of unread) {
      updateRow('NOTIFICATIONS', n.ID, { ReadAt: now });
    }
    res.json({ updated: unread.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/notifications/check ────────────────────────────────────────

router.post('/check', async (req, res) => {
  try {
    // Generate new notifications from current data
    runAllChecks();

    // Send webhooks (no session dependency)
    try {
      await sendPendingWebhooks();
    } catch (err) {
      console.error('Webhook delivery error:', err.message);
    }

    // Send emails (requires user session with OAuth tokens)
    if (isEmailConfigured() && req.user && req.user.accessToken) {
      try {
        await sendPendingEmails(req.user);
      } catch (err) {
        console.error('Email delivery error:', err.message);
      }
    }

    // Return the updated unread count
    const staff = findCurrentStaff(req.user && req.user.email);
    const staffId = staff ? staff.ID : '__none__';
    const unread = getNotificationsForStaff(staffId, false);
    res.json({ checked: true, unreadCount: unread.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
