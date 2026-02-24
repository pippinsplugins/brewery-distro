'use strict';

/* ── Notification System ─────────────────────────────────────────────────
 *  Bell icon + slide-out panel in the sidebar.
 *  Checks for new notifications on init and polls every 60s.
 * ─────────────────────────────────────────────────────────────────────── */

let _notifPollInterval = null;

// ── Icons per notification type ──────────────────────────────────────────

const NOTIF_ICONS = {
  low_stock:        '📦',
  out_of_stock:     '🚫',
  delivery_missed:  '🚚',
  todo_assigned:    '📋',
  todo_past_due:    '⏰',
};

const NOTIF_NAV = {
  low_stock:        'inventory',
  out_of_stock:     'inventory',
  delivery_missed:  'orders',
  todo_assigned:    'todos',
  todo_past_due:    'todos',
};

// ── Init ─────────────────────────────────────────────────────────────────

async function initNotifications() {
  // Trigger a check on the server (generates new notifications, sends email/webhook)
  try {
    const result = await api.post('/api/notifications/check', {});
    updateNotificationBadge(result.unreadCount || 0);
  } catch (e) {
    console.warn('Notification check failed:', e.message);
  }

  // Poll for unread count every 60s
  if (_notifPollInterval) clearInterval(_notifPollInterval);
  _notifPollInterval = setInterval(fetchNotificationCount, 60000);

  // Close panel on outside click
  document.addEventListener('click', function(e) {
    const panel = document.getElementById('notification-panel');
    const bell  = document.getElementById('notification-bell');
    if (panel && !panel.classList.contains('hidden') &&
        !panel.contains(e.target) && !bell.contains(e.target)) {
      panel.classList.add('hidden');
    }
  });
}

// ── Badge ────────────────────────────────────────────────────────────────

async function fetchNotificationCount() {
  try {
    const { count } = await api.get('/api/notifications/unread-count');
    updateNotificationBadge(count);
  } catch (e) {
    // Silently fail — don't interrupt user
  }
}

function updateNotificationBadge(count) {
  const badge = document.getElementById('notification-badge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

// ── Panel ────────────────────────────────────────────────────────────────

function toggleNotificationPanel() {
  const panel = document.getElementById('notification-panel');
  if (!panel) return;
  const isHidden = panel.classList.contains('hidden');
  if (isHidden) {
    panel.classList.remove('hidden');
    fetchNotifications();
  } else {
    panel.classList.add('hidden');
  }
}

async function fetchNotifications() {
  const list = document.getElementById('notification-list');
  if (!list) return;
  list.innerHTML = '<div class="notification-loading">Loading...</div>';

  try {
    const notifications = await api.get('/api/notifications');
    renderNotifications(notifications);
  } catch (e) {
    list.innerHTML = '<div class="notification-empty">Failed to load notifications.</div>';
  }
}

function renderNotifications(notifications) {
  const list = document.getElementById('notification-list');
  if (!list) return;

  if (!notifications || notifications.length === 0) {
    list.innerHTML = '<div class="notification-empty">No new notifications</div>';
    const markAllBtn = document.getElementById('mark-all-read-btn');
    if (markAllBtn) markAllBtn.classList.add('hidden');
    return;
  }

  const markAllBtn = document.getElementById('mark-all-read-btn');
  if (markAllBtn) markAllBtn.classList.remove('hidden');

  list.innerHTML = notifications.map(n => {
    const icon = NOTIF_ICONS[n.Type] || 'ℹ️';
    const time = relativeTime(n.CreatedAt);
    const unread = !n.ReadAt ? ' unread' : '';
    const severityClass = n.Severity ? ` severity-${n.Severity}` : '';

    return `<div class="notification-item${unread}${severityClass}" data-id="${esc(n.ID)}" data-type="${esc(n.Type)}" onclick="handleNotificationClick('${esc(n.ID)}', '${esc(n.Type)}')">
      <div class="notification-item-row">
        <span class="notification-item-icon">${icon}</span>
        <div class="notification-item-content">
          <div class="notification-item-title">${esc(n.Title)}</div>
          ${n.Body ? `<div class="notification-item-body">${esc(n.Body)}</div>` : ''}
          <div class="notification-item-time">${esc(time)}</div>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ── Actions ──────────────────────────────────────────────────────────────

async function handleNotificationClick(id, type) {
  // Mark as read
  try {
    await api.put(`/api/notifications/${id}/read`, {});
  } catch (e) {
    // Continue navigation even if marking fails
  }

  // Close panel
  const panel = document.getElementById('notification-panel');
  if (panel) panel.classList.add('hidden');

  // Navigate to relevant view
  const view = NOTIF_NAV[type];
  if (view) navigate(view);

  // Refresh badge
  fetchNotificationCount();
}

async function markAllNotificationsRead() {
  try {
    await api.put('/api/notifications/read-all', {});
    updateNotificationBadge(0);
    // Re-render the list with everything marked as read
    fetchNotifications();
  } catch (e) {
    toast('Failed to mark notifications as read', 'error');
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function relativeTime(isoStr) {
  if (!isoStr) return '';
  const now = Date.now();
  const then = new Date(isoStr).getTime();
  const diff = Math.floor((now - then) / 1000);

  if (diff < 60)    return 'Just now';
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 172800) return 'Yesterday';
  return `${Math.floor(diff / 86400)}d ago`;
}
