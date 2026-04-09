'use strict';

const { v4: uuidv4 } = require('uuid');
const { getAllRows, addRow } = require('../db');
const { isEmailConfigured, getRefreshToken, sendEmail } = require('../email-service');

/**
 * Extract @mentions from text, matching against a list of staff members.
 * Sorts staff names by length descending to avoid partial matches
 * (e.g. "John Smith Jr" before "John Smith").
 *
 * @param {string} text - The text to search for @mentions
 * @param {Array} staffList - Array of staff objects with ID, Name, Email
 * @returns {Array} Array of { staffId, staffName, staffEmail }
 */
function extractMentions(text, staffList) {
  if (!text || !staffList || staffList.length === 0) return [];

  // Sort by name length descending to match longer names first
  const sorted = [...staffList].sort((a, b) => (b.Name || '').length - (a.Name || '').length);

  const found = [];
  const seenIds = new Set();
  let remaining = text;

  for (const staff of sorted) {
    if (!staff.Name) continue;
    // Escape special regex characters in the name
    const escaped = staff.Name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp('@' + escaped + '(?!\\w)', 'g');
    if (regex.test(remaining) && !seenIds.has(staff.ID)) {
      seenIds.add(staff.ID);
      found.push({
        staffId: staff.ID,
        staffName: staff.Name,
        staffEmail: staff.Email || '',
      });
    }
  }

  return found;
}

/**
 * Process @mentions in text: detect new mentions (vs old text), send email
 * notifications, and log to NOTIFICATIONS table. Fire-and-forget.
 *
 * @param {object} opts
 * @param {string} opts.newText - Current notes text
 * @param {string} opts.oldText - Previous notes text (empty for new records)
 * @param {string} opts.entityType - e.g. 'todo', 'outreach', 'order', 'account', 'keg', 'tap-handle'
 * @param {string} opts.entityName - Display name of the entity
 * @param {string} opts.entityId - ID of the entity
 * @param {string} opts.accountId - Account ID (for deep-linking to account profile)
 * @param {object} opts.user - req.user (for sending email)
 * @param {string} opts.mentionerName - Display name of the person who mentioned
 * @param {string} opts.baseUrl - App base URL (e.g. https://app.example.com)
 */
async function processMentions({ newText, oldText, entityType, entityName, entityId, accountId, user, mentionerName, baseUrl }) {
  if (!newText) return;

  const staff = await getAllRows('STAFF');
  const activeStaff = staff.filter(s => s.Active !== 'false');

  const newMentions = extractMentions(newText, activeStaff);
  const oldMentions = extractMentions(oldText || '', activeStaff);
  const oldIds = new Set(oldMentions.map(m => m.staffId));

  // Only notify newly-added mentions
  const freshMentions = newMentions.filter(m => !oldIds.has(m.staffId));
  if (freshMentions.length === 0) return;

  const emailReady = isEmailConfigured() && user && user.id && !!getRefreshToken(user.id);

  for (const mention of freshMentions) {
    const notification = {
      ID: uuidv4(),
      Type: 'mention',
      Channel: 'email',
      RecipientStaffID: mention.staffId,
      RecipientName: mention.staffName,
      RecipientEmail: mention.staffEmail,
      SenderName: mentionerName || '',
      SenderEmail: user ? user.email || '' : '',
      EntityType: entityType,
      EntityID: entityId || '',
      EntityName: entityName || '',
      Message: newText,
      Status: 'pending',
      Error: '',
      CreatedAt: new Date().toISOString(),
    };

    // Skip if no email address
    if (!mention.staffEmail) {
      notification.Status = 'skipped';
      notification.Error = 'No email address';
      addRow('NOTIFICATIONS', notification);
      continue;
    }

    if (!emailReady) {
      notification.Status = 'skipped';
      notification.Error = 'Email not configured';
      addRow('NOTIFICATIONS', notification);
      continue;
    }

    try {
      const subject = `${mentionerName} mentioned you in a ${entityType}`;

      // Build a direct link to view the mention in context
      const viewMap = { todo: 'todos', outreach: 'outreach', order: 'orders', account: 'accounts', keg: 'kegs', 'tap-handle': 'tap-handles' };
      let link = '';
      if (baseUrl) {
        const hash = accountId && entityType !== 'account'
          ? `#account/${accountId}`
          : `#${viewMap[entityType] || 'dashboard'}`;
        link = `${baseUrl}/${hash}`;
      }

      const body = [
        `Hi ${mention.staffName},`,
        '',
        `${mentionerName} mentioned you in ${entityType}: "${entityName}"`,
        '',
        `"${newText}"`,
        '',
        ...(link ? [`View it here: ${link}`, ''] : []),
        '\u2014',
        'Brewery Distribution Manager',
      ].join('\n');

      await sendEmail({ user, to: mention.staffEmail, subject, body });
      notification.Status = 'sent';
    } catch (err) {
      notification.Status = 'failed';
      notification.Error = err.message;
    }

    addRow('NOTIFICATIONS', notification);
  }
}

/**
 * Process staff assignment changes: if the assigned staff member changed,
 * send an email notification to the newly-assigned person. Fire-and-forget.
 *
 * @param {object} opts
 * @param {string} opts.newStaffId - Newly assigned staff ID
 * @param {string} opts.oldStaffId - Previously assigned staff ID (empty for new records)
 * @param {string} opts.entityType - e.g. 'order', 'todo', 'account'
 * @param {string} opts.entityName - Display name of the entity
 * @param {string} opts.entityId - ID of the entity
 * @param {string} opts.accountId - Account ID (for deep-linking)
 * @param {object} opts.user - req.user (for sending email)
 * @param {string} opts.assignerName - Display name of the person who made the assignment
 * @param {string} opts.baseUrl - App base URL
 */
async function processAssignment({ newStaffId, oldStaffId, entityType, entityName, entityId, accountId, user, assignerName, baseUrl }) {
  if (!newStaffId || newStaffId === oldStaffId) return;

  const staffList = await getAllRows('STAFF');
  const staffMember = staffList.find(s => s.ID === newStaffId);
  if (!staffMember) return;

  // Don't notify if you assigned yourself
  const userEmail = user && user.email ? user.email.toLowerCase() : '';
  if (userEmail && staffMember.Email && staffMember.Email.toLowerCase() === userEmail) return;

  const staffName = staffMember.Name || '';
  const staffEmail = staffMember.Email || '';

  const notification = {
    ID: uuidv4(),
    Type: 'assignment',
    Channel: 'email',
    RecipientStaffID: newStaffId,
    RecipientName: staffName,
    RecipientEmail: staffEmail,
    SenderName: assignerName || '',
    SenderEmail: user ? user.email || '' : '',
    EntityType: entityType,
    EntityID: entityId || '',
    EntityName: entityName || '',
    Message: `${assignerName} assigned you to ${entityType}: "${entityName}"`,
    Status: 'pending',
    Error: '',
    CreatedAt: new Date().toISOString(),
  };

  if (!staffEmail) {
    notification.Status = 'skipped';
    notification.Error = 'No email address';
    addRow('NOTIFICATIONS', notification);
    return;
  }

  const emailReady = isEmailConfigured() && user && user.id && !!getRefreshToken(user.id);
  if (!emailReady) {
    notification.Status = 'skipped';
    notification.Error = 'Email not configured';
    addRow('NOTIFICATIONS', notification);
    return;
  }

  try {
    const subject = `${assignerName} assigned you to a ${entityType}`;

    const viewMap = { todo: 'todos', outreach: 'outreach', order: 'orders', account: 'accounts', keg: 'kegs', 'tap-handle': 'tap-handles' };
    let link = '';
    if (baseUrl) {
      const hash = accountId && entityType !== 'account'
        ? `#account/${accountId}`
        : `#${viewMap[entityType] || 'dashboard'}`;
      link = `${baseUrl}/${hash}`;
    }

    const body = [
      `Hi ${staffName},`,
      '',
      `${assignerName} assigned you to ${entityType}: "${entityName}"`,
      '',
      ...(link ? [`View it here: ${link}`, ''] : []),
      '\u2014',
      'Brewery Distribution Manager',
    ].join('\n');

    await sendEmail({ user, to: staffEmail, subject, body });
    notification.Status = 'sent';
  } catch (err) {
    notification.Status = 'failed';
    notification.Error = err.message;
  }

  addRow('NOTIFICATIONS', notification);
}

module.exports = { extractMentions, processMentions, processAssignment };
