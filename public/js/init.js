'use strict';

const VIEW_LOADERS = {
  dashboard:     loadDashboard,
  products:      loadProducts,
  inventory:     loadInventory,
  accounts:      loadAccounts,
  outreach:      loadOutreach,
  todos:         loadTodos,
  orders:        loadOrders,
  kegs:          loadKegs,
  'tap-handles': loadTapHandles,
  staff:         loadStaff,
  settings:      loadSettings,
  map:           loadMap,
};

// Maps child views to their parent nav-group name
const SUBMENU_VIEWS = {
  inventory: 'inventory',
  products:  'inventory',
  accounts:  'accounts',
  map:       'accounts',
};

function navigate(view, filters = {}) {
  state.view = view;
  state.navFilters = filters;
  // Close notification panel on navigation
  const notifPanel = document.getElementById('notification-panel');
  if (notifPanel) notifPanel.classList.add('hidden');
  // Update top-level nav active states
  const groupName = SUBMENU_VIEWS[view];
  document.querySelectorAll('.nav-item').forEach(el => {
    const isActive = groupName
      ? el.dataset.view === groupName      // highlight parent for submenu views
      : el.dataset.view === view;
    el.classList.toggle('active', isActive);
  });
  // Update submenu active states and expand parent group
  document.querySelectorAll('.nav-subitem').forEach(el => {
    el.classList.toggle('active', el.dataset.view === view);
  });
  document.querySelectorAll('.nav-group').forEach(g => {
    const isParent = g.dataset.group === groupName;
    g.classList.toggle('open', isParent);
  });
  window.location.hash = view;
  const newHash = '#' + view;
  if (window.location.hash !== newHash) window.location.hash = view;
  const loader = VIEW_LOADERS[view];
  if (loader) loader().catch(err => {
    toast(err.message, 'error');
    setContent(`<div class="empty-state text-danger" style="padding:40px">Error: ${esc(err.message)}</div>`);
  });
}

function handleHashChange() {
  const raw = window.location.hash.replace('#', '');
  // Account profile: #account/<id>
  const acctMatch = raw.match(/^account\/(.+)$/);
  if (acctMatch) {
    const id = decodeURIComponent(acctMatch[1]);
    if (state.view === 'account-profile' && state.accountProfileId === id) return;
    loadAccountProfile(id);
    return;
  }
  // Main views
  const view = VIEW_LOADERS[raw] ? raw : 'dashboard';
  if (state.view === view) return;
  navigate(view);
}

// ── Location ──────────────────────────────────────────────────────

function renderLocationSwitcher() {
  const container = document.getElementById('location-switcher');
  if (!container) return;
  container.innerHTML = LOCATIONS.map(loc =>
    `<button class="loc-btn${state.location === loc ? ' active' : ''}" onclick="switchLocation('${esc(loc)}')">${esc(loc)}</button>`
  ).join('');
}

function switchLocation(loc) {
  state.location = loc;
  localStorage.setItem('brewLocation', loc);
  state.inventory = []; // clear cached inventory so next load refetches for new location
  renderLocationSwitcher();
  const loader = VIEW_LOADERS[state.view];
  if (loader) loader().catch(err => toast(err.message, 'error'));
}

function applySettings(settings) {
  if (Array.isArray(settings.locations) && settings.locations.length > 0) {
    LOCATIONS = settings.locations;
  }
  if (!LOCATIONS.includes(state.location)) {
    state.location = LOCATIONS[0];
    localStorage.setItem('brewLocation', state.location);
  }
  if (settings.companyName) {
    const el = document.getElementById('brand-title');
    if (el) el.textContent = settings.companyName;
  }
  renderLocationSwitcher();
}

// ── Init ──────────────────────────────────────────────────────────

async function init() {
  // ── Auth check ──────────────────────────────────────────────────
  // The server already guards this page, but we also populate the
  // sidebar with the signed-in user's name/photo.
  try {
    const { user } = await api.get('/auth/me');
    if (user) {
      state.userEmail = user.email || '';
      state.userName  = user.name  || '';
      const panel = document.getElementById('sidebar-user');
      if (panel) {
        document.getElementById('sidebar-user-name').textContent  = user.name  || '';
        document.getElementById('sidebar-user-email').textContent = user.email || '';
        const photo = document.getElementById('sidebar-user-photo');
        if (user.photo) {
          photo.src = user.photo;
          photo.alt = user.name || 'User';
        } else {
          photo.style.display = 'none';
        }
        panel.style.display = 'flex';
      }
    }
  } catch (e) {
    // Not authenticated – server will have already redirected, but
    // redirect as a fallback in case we are running without the guard.
    window.location.href = '/login';
    return;
  }

  // Load settings (locations, company name) before rendering UI
  try {
    const settings = await api.get('/api/settings');
    state.settings = settings;
    applySettings(settings);
  } catch (e) {
    console.warn('Failed to load settings, using defaults:', e.message);
    renderLocationSwitcher();
  }

  // Check email configuration
  try {
    const emailStatus = await api.get('/api/email/status');
    state.emailConfigured = emailStatus.configured;
  } catch (e) {
    state.emailConfigured = false;
  }

  // Mobile sidebar toggle
  const menuBtn = document.getElementById('mobile-menu-btn');
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');

  function closeSidebar() {
    sidebar.classList.remove('open');
    backdrop.classList.remove('open');
  }

  menuBtn.addEventListener('click', () => {
    const isOpen = sidebar.classList.contains('open');
    sidebar.classList.toggle('open', !isOpen);
    backdrop.classList.toggle('open', !isOpen);
  });

  backdrop.addEventListener('click', closeSidebar);

  // Wire up nav clicks
  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      if (el.classList.contains('has-submenu')) {
        const group = el.closest('.nav-group');
        if (group) group.classList.toggle('open');
        return;                        // toggle only; let subitems handle navigation
      }
      navigate(el.dataset.view);
      closeSidebar();
    });
  });

  // Wire up submenu clicks
  document.querySelectorAll('.nav-subitem').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      navigate(el.dataset.view);
      closeSidebar();
    });
  });

  // Check configuration status
  try {
    const status = await api.get('/api/status');
    if (!status.configured) {
      document.getElementById('setup-banner').classList.remove('hidden');
      document.getElementById('sidebar-status').className = 'status-dot warning';
      document.getElementById('sidebar-status-text').textContent = 'Not configured';
    }
  } catch (e) {
    document.getElementById('sidebar-status').className = 'status-dot error';
    document.getElementById('sidebar-status-text').textContent = 'Offline';
  }

  // Initialize notification system
  try {
    await initNotifications();
  } catch (e) {
    console.warn('Failed to initialize notifications:', e.message);
  }

  // Handle browser back/forward navigation
  window.addEventListener('hashchange', handleHashChange);

  // Load view from hash or default to dashboard
  const hash = window.location.hash.replace('#', '');
  const acctMatch = hash.match(/^account\/(.+)$/);
  if (acctMatch) {
    loadAccountProfile(decodeURIComponent(acctMatch[1]));
  } else {
    navigate(VIEW_LOADERS[hash] ? hash : 'dashboard');
  }
}

document.addEventListener('DOMContentLoaded', init);
