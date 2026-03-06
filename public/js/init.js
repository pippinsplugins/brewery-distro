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
  reports:       loadReports,
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

function navigate(view, filters = {}, preservePage = false) {
  state.view = view;
  state.navFilters = filters;
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
  // Build hash — include pagination params if preserving page
  let newHash = '#' + view;
  if (preservePage) {
    const pgParams = _paginationReadHash();
    if (pgParams) {
      const params = new URLSearchParams();
      if (pgParams.page > 1) params.set('page', pgParams.page);
      if (pgParams.perPage !== 25) params.set('perPage', pgParams.perPage);
      const qs = params.toString();
      if (qs) newHash += '?' + qs;
    }
  }
  if (window.location.hash !== newHash) window.location.hash = newHash;
  // Restore pagination state from hash if preserving
  if (preservePage) {
    const pgParams = _paginationReadHash();
    // Map view name to pagination key
    const pgKey = view === 'tap-handles' ? 'tapHandles' : view;
    if (pgParams && _pagination[pgKey]) {
      _pagination[pgKey].page = pgParams.page;
      _pagination[pgKey].perPage = pgParams.perPage;
    }
  }
  const loader = VIEW_LOADERS[view];
  if (loader) loader(preservePage).catch(err => {
    toast(err.message, 'error');
    setContent(`<div class="empty-state text-danger" style="padding:40px">Error: ${esc(err.message)}</div>`);
  });
}

function handleHashChange() {
  // Don't navigate while a modal is open — preserve the return-to state
  // so save handlers branch correctly (list vs. profile reload).
  if (!document.getElementById('modal-overlay').classList.contains('hidden')) return;
  const raw = window.location.hash.replace('#', '');
  const base = raw.replace(/\?.*$/, '');
  // Account profile: #account/<id>
  const acctMatch = base.match(/^account\/(.+)$/);
  if (acctMatch) {
    const id = decodeURIComponent(acctMatch[1]);
    if (state.view === 'account-profile' && state.accountProfileId === id) return;
    loadAccountProfile(id);
    return;
  }
  // Main views — back/forward restores pagination
  const view = VIEW_LOADERS[base] ? base : 'dashboard';
  if (state.view === view) return;
  const hasPagination = !!_paginationReadHash();
  navigate(view, {}, hasPagination);
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
  if (Array.isArray(settings.accountTags) && settings.accountTags.length > 0) {
    ACCOUNT_TAGS = settings.accountTags;
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
        if (group) group.classList.add('open');
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

  // Handle browser back/forward navigation
  window.addEventListener('hashchange', handleHashChange);

  // Load view from hash or default to dashboard
  const hash = window.location.hash.replace('#', '');
  const hashBase = hash.replace(/\?.*$/, '');
  const acctMatch = hashBase.match(/^account\/(.+)$/);
  if (acctMatch) {
    loadAccountProfile(decodeURIComponent(acctMatch[1]));
  } else {
    const hasPagination = !!_paginationReadHash();
    navigate(VIEW_LOADERS[hashBase] ? hashBase : 'dashboard', {}, hasPagination);
  }
}

document.addEventListener('DOMContentLoaded', init);
