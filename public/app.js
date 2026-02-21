'use strict';

// ── State ────────────────────────────────────────────────────────
const state = {
  view: 'dashboard',
  accounts: [],      // cached for select dropdowns
  inventory: [],
  staff: [],         // cached for staff dropdowns
};

// ── Utilities ────────────────────────────────────────────────────

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(d) {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  if (!y || !m || !day) return d;
  return `${m}/${day}/${y}`;
}

function today() {
  return new Date().toISOString().split('T')[0];
}

function daysFromToday(dateStr) {
  if (!dateStr) return null;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + 'T00:00:00');
  return Math.round((d - now) / 86400000);
}

function urgencyBadge(dateStr, completed) {
  if (completed === 'true') return '<span class="badge badge-completed">Done</span>';
  const diff = daysFromToday(dateStr);
  if (diff === null) return '';
  if (diff < 0)  return `<span class="badge badge-overdue">Overdue ${Math.abs(diff)}d</span>`;
  if (diff === 0) return '<span class="badge badge-today">Today</span>';
  if (diff <= 7)  return `<span class="badge badge-upcoming">In ${diff}d</span>`;
  return `<span class="badge badge-future">In ${diff}d</span>`;
}

function methodBadge(method) {
  const map = {
    'Email': 'badge-email',
    'Phone': 'badge-phone',
    'SMS': 'badge-sms',
    'In-Person': 'badge-in-person',
    'Any': 'badge-any',
  };
  const cls = map[method] || 'badge-any';
  return `<span class="badge ${cls}">${esc(method)}</span>`;
}

function statusBadge(status) {
  const map = {
    'Active': 'badge-active',
    'Prospect': 'badge-prospect',
    'Inactive': 'badge-inactive',
  };
  return `<span class="badge ${map[status] || 'badge-inactive'}">${esc(status)}</span>`;
}

function priorityBadge(p) {
  const map = { High: 'badge-high', Medium: 'badge-medium', Low: 'badge-low' };
  return `<span class="badge ${map[p] || 'badge-medium'}">${esc(p)}</span>`;
}

function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type !== 'success' ? type : ''}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function setContent(html) {
  document.getElementById('content-area').innerHTML = html;
}

function showLoading() {
  setContent('<div class="loading-state"><div class="spinner"></div><p>Loading...</p></div>');
}

// ── API ──────────────────────────────────────────────────────────

const api = {
  async req(method, path, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(path, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  },
  get:    (p)    => api.req('GET', p),
  post:   (p, b) => api.req('POST', p, b),
  put:    (p, b) => api.req('PUT', p, b),
  del:    (p)    => api.req('DELETE', p),
};

// ── Modal ────────────────────────────────────────────────────────

const modal = {
  _onSubmit: null,

  open(title, bodyHtml, onSubmit, submitLabel = 'Save') {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = bodyHtml;
    document.getElementById('modal-submit-btn').textContent = submitLabel;
    document.getElementById('modal-overlay').classList.remove('hidden');
    modal._onSubmit = onSubmit;

    // Focus first input
    const first = document.querySelector('#modal-body input, #modal-body select, #modal-body textarea');
    if (first) first.focus();
  },

  close() {
    document.getElementById('modal-overlay').classList.add('hidden');
    modal._onSubmit = null;
  },

  confirm(title, msg, onConfirm) {
    modal.open(
      title,
      `<p class="confirm-body">${esc(msg)}</p>`,
      onConfirm,
      'Confirm'
    );
    document.getElementById('modal-submit-btn').className = 'btn btn-danger';
  },
};

document.getElementById('modal-close-btn').addEventListener('click', modal.close);
document.getElementById('modal-cancel-btn').addEventListener('click', modal.close);
document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-overlay')) modal.close();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !document.getElementById('modal-overlay').classList.contains('hidden')) modal.close();
});
document.getElementById('modal-submit-btn').addEventListener('click', async () => {
  if (modal._onSubmit) {
    document.getElementById('modal-submit-btn').disabled = true;
    try {
      await modal._onSubmit();
    } finally {
      document.getElementById('modal-submit-btn').disabled = false;
    }
  }
});

// ── Form Helpers ─────────────────────────────────────────────────

function val(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : '';
}

function refocusSearch(id) {
  const el = document.getElementById(id);
  if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
}

function accountOptions(selectedId = '') {
  return state.accounts
    .filter(a => a.Status !== 'Inactive')
    .sort((a, b) => a.Name.localeCompare(b.Name))
    .map(a => `<option value="${esc(a.ID)}" ${a.ID === selectedId ? 'selected' : ''}>${esc(a.Name)}</option>`)
    .join('');
}

function staffOptions(selectedId = '') {
  return state.staff
    .filter(s => s.Active !== 'false')
    .sort((a, b) => a.Name.localeCompare(b.Name))
    .map(s => `<option value="${esc(s.ID)}" ${s.ID === selectedId ? 'selected' : ''}>${esc(s.Name)}${s.Role ? ' (' + esc(s.Role) + ')' : ''}</option>`)
    .join('');
}

// ── Inventory View ────────────────────────────────────────────────

const FORMATS = ['1/2 Keg', '1/4 Keg', '1/6 Keg', '12oz Can (case/24)', '16oz Can (case/24)', '22oz Bottle (case/12)', '750ml Bottle (case/12)', 'Other'];
const STYLES  = ['IPA', 'Double IPA', 'Pale Ale', 'Lager', 'Pilsner', 'Wheat', 'Hefeweizen', 'Stout', 'Porter', 'Sour', 'Saison', 'Amber', 'Brown Ale', 'Barleywine', 'Other'];

function inventoryForm(item = {}) {
  return `
    <div class="form-row">
      <div class="form-group">
        <label>Name <span class="required">*</span></label>
        <input class="form-control" id="f-name" value="${esc(item.Name)}" placeholder="e.g. Cascade IPA" />
      </div>
      <div class="form-group">
        <label>Style</label>
        <select class="form-control" id="f-style">
          <option value="">-- Select --</option>
          ${STYLES.map(s => `<option value="${s}" ${item.Style === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>ABV (%)</label>
        <input class="form-control" id="f-abv" type="number" step="0.1" min="0" max="20" value="${esc(item.ABV)}" placeholder="e.g. 6.5" />
      </div>
      <div class="form-group">
        <label>Format / Package</label>
        <select class="form-control" id="f-format">
          <option value="">-- Select --</option>
          ${FORMATS.map(f => `<option value="${f}" ${item.Format === f ? 'selected' : ''}>${f}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Units in Stock <span class="required">*</span></label>
        <input class="form-control" id="f-units" type="number" min="0" value="${esc(item.Units || '0')}" />
      </div>
      <div class="form-group">
        <label>Price per Unit ($)</label>
        <input class="form-control" id="f-price" type="number" step="0.01" min="0" value="${esc(item.PricePerUnit)}" placeholder="0.00" />
      </div>
    </div>
    <div class="form-group">
      <label>Low-Stock Alert Threshold</label>
      <input class="form-control" id="f-threshold" type="number" min="0" value="${esc(item.LowStockThreshold || '5')}" />
    </div>
    <div class="form-group">
      <label>Notes</label>
      <textarea class="form-control" id="f-notes" rows="2">${esc(item.Notes)}</textarea>
    </div>`;
}

async function loadInventory() {
  showLoading();
  const items = await api.get('/api/inventory');
  state.inventory = items;
  renderInventory();
}

let _invSort = { col: 'Name', dir: 'asc' };

function sortInventory(col) {
  if (_invSort.col === col) {
    _invSort.dir = _invSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    _invSort.col = col;
    _invSort.dir = 'asc';
  }
  renderInventory();
}

function renderInventory() {
  const items = state.inventory || [];
  const _focused = document.activeElement?.id;
  const search = (document.getElementById('inv-search') || {}).value || '';

  let filtered = items.filter(i =>
    !search || i.Name.toLowerCase().includes(search.toLowerCase()) || (i.Style || '').toLowerCase().includes(search.toLowerCase())
  );

  // Sort
  const { col, dir } = _invSort;
  filtered = [...filtered].sort((a, b) => {
    let av, bv;
    if (col === 'Name')       { av = (a.Name || '').toLowerCase();           bv = (b.Name || '').toLowerCase(); }
    else if (col === 'Style') { av = (a.Style || '').toLowerCase();          bv = (b.Style || '').toLowerCase(); }
    else if (col === 'ABV')   { av = parseFloat(a.ABV || 0);                 bv = parseFloat(b.ABV || 0); }
    else if (col === 'Format'){ av = (a.Format || '').toLowerCase();         bv = (b.Format || '').toLowerCase(); }
    else if (col === 'Units') { av = parseInt(a.Units || 0);                 bv = parseInt(b.Units || 0); }
    else if (col === 'Price') { av = parseFloat(a.PricePerUnit || 0);        bv = parseFloat(b.PricePerUnit || 0); }
    else if (col === 'Stock') { av = parseInt(a.Units||0) <= parseInt(a.LowStockThreshold||5) ? 0 : 1;
                                bv = parseInt(b.Units||0) <= parseInt(b.LowStockThreshold||5) ? 0 : 1; }
    if (av < bv) return dir === 'asc' ? -1 : 1;
    if (av > bv) return dir === 'asc' ? 1 : -1;
    return 0;
  });

  const th = (label, colKey) => {
    const active = _invSort.col === colKey;
    const arrow = active ? (_invSort.dir === 'asc' ? ' ▲' : ' ▼') : '';
    return `<th class="sortable-th${active ? ' sorted' : ''}" onclick="sortInventory('${colKey}')">${label}${arrow}</th>`;
  };

  setContent(`
    <div class="view-header">
      <div>
        <h2>Inventory</h2>
        <p class="subtitle">${items.length} product${items.length !== 1 ? 's' : ''} tracked</p>
      </div>
      <div class="view-header-actions">
        <button class="btn btn-primary" onclick="openAddInventory()">+ Add Product</button>
      </div>
    </div>
    <div class="filter-bar">
      <input type="search" id="inv-search" placeholder="Search products..." value="${esc(search)}" oninput="renderInventory()" />
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            ${th('Name', 'Name')}${th('Style', 'Style')}${th('ABV', 'ABV')}${th('Format', 'Format')}
            ${th('Units', 'Units')}${th('Price/Unit', 'Price')}${th('Stock', 'Stock')}<th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.length === 0 ? `<tr><td colspan="8" class="empty-state">No products found. Add your first product!</td></tr>` :
            filtered.map(item => {
              const low = parseInt(item.Units || '0') <= parseInt(item.LowStockThreshold || '5');
              return `<tr>
                <td class="fw-600"><span class="td-link" onclick="openEditInventory('${esc(item.ID)}')">${esc(item.Name)}</span></td>
                <td>${esc(item.Style)}</td>
                <td>${item.ABV ? esc(item.ABV) + '%' : '—'}</td>
                <td>${esc(item.Format) || '—'}</td>
                <td>${esc(item.Units)}</td>
                <td>${item.PricePerUnit ? '$' + esc(item.PricePerUnit) : '—'}</td>
                <td><span class="badge ${low ? 'badge-low-stock' : 'badge-ok-stock'}">${low ? 'Low' : 'OK'}</span></td>
                <td class="td-actions">
                  <button class="btn btn-ghost btn-sm" onclick="openEditInventory('${esc(item.ID)}')">Edit</button>
                  <button class="btn btn-ghost btn-sm text-danger" onclick="deleteInventory('${esc(item.ID)}', '${esc(item.Name)}')">Delete</button>
                </td>
              </tr>`;
            }).join('')}
        </tbody>
      </table>
    </div>`);
  if (_focused === 'inv-search') refocusSearch('inv-search');
}

function openAddInventory() {
  modal.open('Add Product', inventoryForm(), async () => {
    const name = val('f-name');
    if (!name) { toast('Name is required', 'error'); return; }
    await api.post('/api/inventory', {
      Name: name, Style: val('f-style'), ABV: val('f-abv'),
      Format: val('f-format'), Units: val('f-units'),
      PricePerUnit: val('f-price'), LowStockThreshold: val('f-threshold'),
      Notes: val('f-notes'),
    });
    modal.close();
    toast('Product added');
    loadInventory();
  });
}

function openEditInventory(id) {
  const item = state.inventory.find(i => i.ID === id);
  if (!item) return;
  modal.open('Edit Product', inventoryForm(item), async () => {
    const name = val('f-name');
    if (!name) { toast('Name is required', 'error'); return; }
    await api.put(`/api/inventory/${id}`, {
      Name: name, Style: val('f-style'), ABV: val('f-abv'),
      Format: val('f-format'), Units: val('f-units'),
      PricePerUnit: val('f-price'), LowStockThreshold: val('f-threshold'),
      Notes: val('f-notes'),
    });
    modal.close();
    toast('Product updated');
    loadInventory();
  });
}

async function deleteInventory(id, name) {
  modal.confirm('Delete Product', `Delete "${name}"? This cannot be undone.`, async () => {
    await api.del(`/api/inventory/${id}`);
    modal.close();
    toast('Product deleted');
    loadInventory();
  });
}

// ── Accounts View ─────────────────────────────────────────────────

const ACCOUNT_TYPES = ['Bar', 'Restaurant', 'Retail Store', 'Grocery Store', 'Hotel', 'Event Venue', 'Other'];
const CONTACT_METHODS = ['Email', 'Phone', 'SMS', 'In-Person', 'Any'];
const ACCOUNT_STATUSES = ['Active', 'Prospect', 'Inactive'];

function accountForm(acct = {}) {
  return `
    ${acct.ID ? `<div class="form-group">
      <label>Account ID</label>
      <input class="form-control" value="${esc(acct.ID)}" readonly style="font-family:monospace;color:var(--text-muted);background:#f5f5f5;cursor:default" />
    </div>` : ''}
    <div class="form-group">
      <label>Account / Business Name <span class="required">*</span></label>
      <input class="form-control" id="f-name" value="${esc(acct.Name)}" placeholder="e.g. The Rusty Tap" />
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Type</label>
        <select class="form-control" id="f-type">
          ${ACCOUNT_TYPES.map(t => `<option value="${t}" ${acct.Type === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Status</label>
        <select class="form-control" id="f-status">
          ${ACCOUNT_STATUSES.map(s => `<option value="${s}" ${acct.Status === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-group">
      <label>Assigned Sales Rep</label>
      <select class="form-control" id="f-staff">
        <option value="">-- Unassigned --</option>
        ${staffOptions(acct.StaffID)}
      </select>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Contact Name</label>
        <input class="form-control" id="f-contact" value="${esc(acct.ContactName)}" placeholder="e.g. Jane Smith" />
      </div>
      <div class="form-group">
        <label>Preferred Contact Method</label>
        <select class="form-control" id="f-method">
          ${CONTACT_METHODS.map(m => `<option value="${m}" ${acct.PreferredMethod === m ? 'selected' : ''}>${m}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Email</label>
        <input class="form-control" id="f-email" type="email" value="${esc(acct.Email)}" placeholder="contact@venue.com" />
      </div>
      <div class="form-group">
        <label>Phone</label>
        <input class="form-control" id="f-phone" type="tel" value="${esc(acct.Phone)}" placeholder="(555) 000-0000" />
      </div>
    </div>
    <hr class="form-divider" />
    <div class="form-section-title">Location</div>
    <div class="form-group">
      <label>Address</label>
      <input class="form-control" id="f-address" value="${esc(acct.Address)}" placeholder="123 Main St" />
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>City</label>
        <input class="form-control" id="f-city" value="${esc(acct.City)}" />
      </div>
      <div class="form-group">
        <label>State</label>
        <input class="form-control" id="f-state" value="${esc(acct.State)}" placeholder="e.g. CA" maxlength="2" />
      </div>
    </div>
    <div class="form-group">
      <label>ABC License #</label>
      <input class="form-control" id="f-abc-license" value="${esc(acct.ABCLicense)}" placeholder="e.g. 47-123456" />
    </div>
    <hr class="form-divider" />
    <div class="form-group">
      <label>Notes</label>
      <textarea class="form-control" id="f-notes" rows="2">${esc(acct.Notes)}</textarea>
    </div>`;
}

async function loadAccounts() {
  showLoading();
  const [accounts, staff] = await Promise.all([api.get('/api/accounts'), api.get('/api/staff')]);
  state.accounts = accounts;
  state.staff = staff;
  renderAccounts();
}

function renderAccounts() {
  const accounts = state.accounts || [];
  const _focused = document.activeElement?.id;
  const nav = state.navFilters || {};
  state.navFilters = {};
  const typeFilter   = (document.getElementById('acct-type')   || {}).value ?? nav.type   ?? '';
  const statusFilter = (document.getElementById('acct-status') || {}).value ?? nav.status ?? '';
  const search       = (document.getElementById('acct-search') || {}).value ?? nav.search ?? '';

  let filtered = accounts;
  if (typeFilter) filtered = filtered.filter(a => a.Type === typeFilter);
  if (statusFilter === 'Inactive') {
    filtered = filtered.filter(a => a.Status === 'Inactive');
  } else if (statusFilter) {
    filtered = filtered.filter(a => a.Status === statusFilter);
  } else {
    filtered = filtered.filter(a => a.Status !== 'Inactive');
  }
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(a =>
      a.Name.toLowerCase().includes(q) ||
      (a.ContactName || '').toLowerCase().includes(q) ||
      (a.City || '').toLowerCase().includes(q)
    );
  }

  setContent(`
    <div class="view-header">
      <div>
        <h2>Accounts</h2>
        <p class="subtitle">${accounts.length} account${accounts.length !== 1 ? 's' : ''} &mdash; ${accounts.filter(a => a.Status === 'Active').length} active</p>
      </div>
      <div class="view-header-actions">
        <button class="btn btn-primary" onclick="openAddAccount()">+ Add Account</button>
      </div>
    </div>
    <div class="filter-bar">
      <input type="search" id="acct-search" placeholder="Search accounts..." value="${esc(search)}" oninput="renderAccounts()" />
      <select id="acct-type" onchange="renderAccounts()">
        <option value="">All Types</option>
        ${ACCOUNT_TYPES.map(t => `<option value="${t}" ${typeFilter === t ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
      <select id="acct-status" onchange="renderAccounts()">
        <option value="">All (excl. Inactive)</option>
        ${ACCOUNT_STATUSES.map(s => `<option value="${s}" ${statusFilter === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Name</th><th>Type</th><th>Contact</th><th>Email / Phone</th>
            <th>Preferred</th><th>Sales Rep</th><th>Status</th><th>Last Contact</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.length === 0 ? `<tr><td colspan="9" class="empty-state">No accounts found.</td></tr>` :
            filtered.map(a => `<tr>
              <td class="fw-600"><span class="td-link" onclick="loadAccountProfile('${esc(a.ID)}')">${esc(a.Name)}</span><br><span class="text-muted text-sm">${esc(a.City)}${a.City && a.State ? ', ' : ''}${esc(a.State)}</span></td>
              <td>${esc(a.Type)}</td>
              <td>${esc(a.ContactName) || '—'}</td>
              <td class="text-sm">${a.Email ? esc(a.Email) + '<br>' : ''}${esc(a.Phone)}</td>
              <td>${methodBadge(a.PreferredMethod)}</td>
              <td class="text-sm">${esc(a.StaffName) || '<span class="text-muted">—</span>'}</td>
              <td>${statusBadge(a.Status)}</td>
              <td class="text-sm text-muted">${formatDate(a.LastContacted)}</td>
              <td class="td-actions">
                <button class="btn btn-ghost btn-sm" onclick="loadAccountProfile('${esc(a.ID)}')">View</button>
                <button class="btn btn-ghost btn-sm" onclick="openLogOutreach('${esc(a.ID)}')">+ Log</button>
                <button class="btn btn-ghost btn-sm" onclick="openEditAccount('${esc(a.ID)}')">Edit</button>
                <button class="btn btn-ghost btn-sm text-danger" onclick="deleteAccount('${esc(a.ID)}', '${esc(a.Name)}')">Del</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`);
  if (_focused === 'acct-search') refocusSearch('acct-search');
}

// ── Account Profile View ──────────────────────────────────────────

async function loadAccountProfile(accountId) {
  state.view = 'account-profile';
  state.accountProfileId = accountId;
  // Keep 'accounts' nav item highlighted
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.view === 'accounts');
  });
  showLoading();

  const [outreach, todos, orders] = await Promise.all([
    api.get('/api/outreach'),
    api.get('/api/reminders?status=all'),
    api.get('/api/orders'),
  ]);
  if (state.accounts.length === 0) state.accounts = await api.get('/api/accounts');

  const acct = state.accounts.find(a => a.ID === accountId);
  if (!acct) { toast('Account not found', 'error'); return; }

  const acctOutreach = outreach
    .filter(o => o.AccountID === accountId)
    .sort((a, b) => (b.Date || '').localeCompare(a.Date || ''));
  const acctTodos = todos
    .filter(t => t.AccountID === accountId)
    .sort((a, b) => (a.DueDate || '').localeCompare(b.DueDate || ''));
  const acctOrders = orders
    .filter(s => s.AccountID === accountId)
    .sort((a, b) => (b.OrderDate || '').localeCompare(a.OrderDate || ''));

  const totalRevenue = acctOrders.reduce((sum, s) => sum + (parseFloat(s.OrderAmount || 0) + parseFloat(s.TaxAmount || 0)), 0);
  const activeTodos  = acctTodos.filter(t => t.Completed !== 'true').length;

  const infoRows = [
    `<div class="profile-info-item"><span class="profile-info-label">Account ID</span><span class="text-muted text-sm" style="font-family:monospace">${esc(acct.ID)}</span></div>`,
    acct.ContactName  ? `<div class="profile-info-item"><span class="profile-info-label">Contact</span><span>${esc(acct.ContactName)}</span></div>` : '',
    acct.Email        ? `<div class="profile-info-item"><span class="profile-info-label">Email</span><span>${esc(acct.Email)}</span></div>` : '',
    acct.Phone        ? `<div class="profile-info-item"><span class="profile-info-label">Phone</span><span>${esc(acct.Phone)}</span></div>` : '',
    acct.PreferredMethod ? `<div class="profile-info-item"><span class="profile-info-label">Preferred</span><span>${methodBadge(acct.PreferredMethod)}</span></div>` : '',
    (acct.Address || acct.City) ? `<div class="profile-info-item"><span class="profile-info-label">Address</span><span>${[acct.Address, acct.City, acct.State].filter(Boolean).map(esc).join(', ')}</span></div>` : '',
    acct.ABCLicense   ? `<div class="profile-info-item"><span class="profile-info-label">ABC License</span><span>${esc(acct.ABCLicense)}</span></div>` : '',
    acct.StaffName    ? `<div class="profile-info-item"><span class="profile-info-label">Sales Rep</span><span>${esc(acct.StaffName)}</span></div>` : '',
    acct.LastContacted ? `<div class="profile-info-item"><span class="profile-info-label">Last Contact</span><span>${formatDate(acct.LastContacted)}</span></div>` : '',
    acct.Notes        ? `<div class="profile-info-item profile-info-full"><span class="profile-info-label">Notes</span><span>${esc(acct.Notes)}</span></div>` : '',
  ].filter(Boolean).join('');

  const outreachRows = acctOutreach.length === 0
    ? `<tr><td colspan="5" class="empty-state">No outreach logged yet.</td></tr>`
    : acctOutreach.map(o => `<tr>
        <td class="text-sm">${formatDate(o.Date)}</td>
        <td>${methodBadge(o.Method)}</td>
        <td class="text-sm" style="max-width:320px;white-space:pre-wrap">${esc(o.Notes) || '—'}</td>
        <td class="text-sm">${o.FollowUpDate ? formatDate(o.FollowUpDate) : '—'}</td>
        <td class="td-actions">
          <button class="btn btn-ghost btn-sm" onclick="profileEditOutreach('${esc(o.ID)}')">Edit</button>
          <button class="btn btn-ghost btn-sm text-danger" onclick="profileDeleteOutreach('${esc(o.ID)}')">Del</button>
        </td>
      </tr>`).join('');

  const todoRows = acctTodos.length === 0
    ? `<tr><td colspan="6" class="empty-state">No todos for this account.</td></tr>`
    : acctTodos.map(t => `<tr class="${t.Completed === 'true' ? 'row-completed' : ''}">
        <td class="fw-600"><span class="td-link" onclick="profileEditTodo('${esc(t.ID)}')">${esc(t.Title)}</span>${t.Recurrence && t.Recurrence !== 'none' ? ' <span class="badge badge-recurrence" title="Recurring">↻</span>' : ''}</td>
        <td>${esc(t.Type) || '—'}</td>
        <td>${urgencyBadge(t.DueDate, t.Completed)}</td>
        <td>${priorityBadge(t.Priority)}</td>
        <td class="text-sm text-muted">${esc(t.Notes) || '—'}</td>
        <td class="td-actions">
          ${t.Completed !== 'true'
            ? `<button class="btn btn-ghost btn-sm" onclick="profileCompleteTodo('${esc(t.ID)}')">Done</button>`
            : `<button class="btn btn-ghost btn-sm" onclick="profileReopenTodo('${esc(t.ID)}')">Reopen</button>`}
          <button class="btn btn-ghost btn-sm" onclick="profileEditTodo('${esc(t.ID)}')">Edit</button>
          <button class="btn btn-ghost btn-sm text-danger" onclick="profileDeleteTodo('${esc(t.ID)}')">Del</button>
        </td>
      </tr>`).join('');

  const orderRows = acctOrders.length === 0
    ? `<tr><td colspan="9" class="empty-state">No orders recorded yet.</td></tr>`
    : acctOrders.map(s => {
        const total = parseFloat(s.OrderAmount || 0) + parseFloat(s.TaxAmount || 0);
        return `<tr>
          <td class="text-sm">${formatDate(s.OrderDate)}</td>
          <td class="text-sm">${esc(s.InvoiceNumber) || '—'}</td>
          <td class="text-sm">${esc(s.StaffName) || '—'}</td>
          <td>${fmtMoney(s.OrderAmount)}</td>
          <td>${s.TaxAmount && parseFloat(s.TaxAmount) > 0 ? fmtMoney(s.TaxAmount) : '—'}</td>
          <td class="fw-600">${fmtMoney(total)}</td>
          <td>${orderStatusBadge(s.Status)}</td>
          <td class="text-center"><input type="checkbox" ${s.Delivered === 'true' ? 'checked' : ''} onchange="profileToggleDelivered('${esc(s.ID)}', ${s.Delivered === 'true'})" /></td>
          <td class="td-actions">
            ${s.Status === 'Pending' ? `<button class="btn btn-ghost btn-sm text-success" onclick="profileMarkOrderPaid('${esc(s.ID)}')">Mark Paid</button>` : ''}
            <button class="btn btn-ghost btn-sm" onclick="profileEditOrder('${esc(s.ID)}')">Edit</button>
            <button class="btn btn-ghost btn-sm text-danger" onclick="profileDeleteOrder('${esc(s.ID)}')">Del</button>
          </td>
        </tr>`;
      }).join('');

  const orderFooter = acctOrders.length > 1
    ? `<tfoot><tr class="table-totals">
        <td colspan="5" class="text-muted text-sm">${acctOrders.length} orders</td>
        <td class="fw-600">${fmtMoney(totalRevenue)}</td>
        <td colspan="3"></td>
      </tr></tfoot>`
    : '';

  setContent(`
    <div class="view-header">
      <div style="display:flex;align-items:center;gap:12px">
        <button class="btn btn-ghost btn-sm" onclick="loadAccounts()">&#8592; Accounts</button>
        <div>
          <h2>${esc(acct.Name)}</h2>
          <p class="subtitle">${esc(acct.Type)} &mdash; ${statusBadge(acct.Status)}</p>
        </div>
      </div>
      <div class="view-header-actions">
        <button class="btn btn-ghost btn-sm" onclick="openLogOutreach('${esc(accountId)}')">+ Log Contact</button>
        <button class="btn btn-ghost btn-sm" onclick="openAddTodo('${esc(accountId)}')">+ Add Todo</button>
        <button class="btn btn-ghost btn-sm" onclick="openAddOrder('${esc(accountId)}')">+ Log Order</button>
        <button class="btn btn-primary btn-sm" onclick="openEditAccount('${esc(accountId)}')">Edit Account</button>
      </div>
    </div>

    <div class="profile-stats">
      <div class="profile-stat"><div class="stat-value">${acctOutreach.length}</div><div class="stat-label">Contacts Logged</div></div>
      <div class="profile-stat"><div class="stat-value">${activeTodos}</div><div class="stat-label">Open Todos</div></div>
      <div class="profile-stat"><div class="stat-value">${acctOrders.length}</div><div class="stat-label">Orders</div></div>
      <div class="profile-stat"><div class="stat-value">${fmtMoney(totalRevenue)}</div><div class="stat-label">Total Revenue</div></div>
    </div>

    <div class="profile-info card" style="margin-bottom:24px">
      ${infoRows || '<span class="text-muted">No additional info on file.</span>'}
    </div>

    <div class="profile-section">
      <div class="profile-section-header">
        <h3>Outreach History <span class="text-muted text-sm">(${acctOutreach.length})</span></h3>
        <button class="btn btn-ghost btn-sm" onclick="openLogOutreach('${esc(accountId)}')">+ Log Contact</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Method</th><th>Notes</th><th>Follow-up</th><th>Actions</th></tr></thead>
          <tbody>${outreachRows}</tbody>
        </table>
      </div>
    </div>

    <div class="profile-section">
      <div class="profile-section-header">
        <h3>Todos <span class="text-muted text-sm">(${activeTodos} open / ${acctTodos.length} total)</span></h3>
        <button class="btn btn-ghost btn-sm" onclick="openAddTodo('${esc(accountId)}')">+ Add Todo</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Title</th><th>Type</th><th>Due</th><th>Priority</th><th>Notes</th><th>Actions</th></tr></thead>
          <tbody>${todoRows}</tbody>
        </table>
      </div>
    </div>

    <div class="profile-section">
      <div class="profile-section-header">
        <h3>Order History <span class="text-muted text-sm">(${acctOrders.length})</span></h3>
        <button class="btn btn-ghost btn-sm" onclick="openAddOrder('${esc(accountId)}')">+ Log Order</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Order Date</th><th>Invoice #</th><th>Sales Rep</th><th>Amount</th><th>Tax</th><th>Total</th><th>Status</th><th>Delivered</th><th>Actions</th></tr></thead>
          <tbody>${orderRows}</tbody>
          ${orderFooter}
        </table>
      </div>
    </div>
  `);
}

// Profile-page action wrappers — reload profile instead of their default views
function profileEditOutreach(id) {
  api.get('/api/outreach').then(items => {
    const entry = items.find(i => i.ID === id);
    if (!entry) return;
    modal.open('Edit Outreach Entry', outreachForm(entry), async () => {
      await api.put(`/api/outreach/${id}`, {
        Date: val('f-date'), Method: val('f-method'), Notes: val('f-notes'),
        FollowUpDate: val('f-followup-date'),
      });
      modal.close();
      toast('Entry updated');
      loadAccountProfile(state.accountProfileId);
    });
  });
}

function profileDeleteOutreach(id) {
  modal.confirm('Delete Entry', 'Delete this outreach log entry?', async () => {
    await api.del(`/api/outreach/${id}`);
    modal.close();
    toast('Entry deleted');
    loadAccountProfile(state.accountProfileId);
  });
}

function profileEditTodo(id) {
  api.get('/api/reminders?status=all').then(items => {
    const todo = items.find(t => t.ID === id);
    if (!todo) return;
    modal.open('Edit Todo', todoForm(todo), async () => {
      const title = val('f-title');
      const dueDate = val('f-due');
      if (!title) { toast('Title is required', 'error'); return; }
      const accountId = val('f-account');
      const accountName = accountId ? (state.accounts.find(a => a.ID === accountId) || {}).Name || '' : '';
      const staffId = val('f-staff');
      const staffName = staffId ? (state.staff.find(s => s.ID === staffId) || {}).Name || '' : '';
      await api.put(`/api/reminders/${id}`, {
        Title: title, DueDate: dueDate, Priority: val('f-priority'),
        Type: val('f-type'), AccountID: accountId, AccountName: accountName,
        StaffID: staffId, StaffName: staffName, Notes: val('f-notes'),
        Recurrence: val('f-recurrence'),
      });
      modal.close();
      toast('Todo updated');
      loadAccountProfile(state.accountProfileId);
    });
  });
}

async function profileCompleteTodo(id) {
  await completeTodo(id);
}

async function profileReopenTodo(id) {
  await api.put(`/api/reminders/${id}`, { Completed: 'false' });
  toast('Todo reopened');
  loadAccountProfile(state.accountProfileId);
}

function profileDeleteTodo(id) {
  modal.confirm('Delete Todo', 'Delete this todo?', async () => {
    await api.del(`/api/reminders/${id}`);
    modal.close();
    toast('Todo deleted');
    loadAccountProfile(state.accountProfileId);
  });
}

function profileEditOrder(id) {
  api.get('/api/orders').then(items => {
    const order = items.find(s => s.ID === id);
    if (!order) return;
    modal.open('Edit Order', orderForm(order), async () => {
      const staffId = val('f-staff');
      const staffName = staffId ? (state.staff.find(s => s.ID === staffId) || {}).Name || '' : '';
      await api.put(`/api/orders/${id}`, {
        StaffID: staffId, StaffName: staffName,
        OrderDate: val('f-order-date'), DeliveryDate: val('f-delivery-date'),
        InvoiceNumber: val('f-invoice'), Status: val('f-status'),
        OrderAmount: val('f-amount'), TaxAmount: val('f-tax'),
        Notes: val('f-notes'),
      });
      modal.close();
      toast('Order updated');
      loadAccountProfile(state.accountProfileId);
    });
  });
}

function profileDeleteOrder(id) {
  modal.confirm('Delete Order', 'Delete this order? This cannot be undone.', async () => {
    await api.del(`/api/orders/${id}`);
    modal.close();
    toast('Order deleted');
    loadAccountProfile(state.accountProfileId);
  });
}

function openAddAccount() {
  modal.open('Add Account', accountForm(), async () => {
    const name = val('f-name');
    if (!name) { toast('Account name is required', 'error'); return; }
    const staffId = val('f-staff');
    const staffName = staffId ? (state.staff.find(s => s.ID === staffId) || {}).Name || '' : '';
    await api.post('/api/accounts', {
      Name: name, Type: val('f-type'), Status: val('f-status'),
      ContactName: val('f-contact'), PreferredMethod: val('f-method'),
      Email: val('f-email'), Phone: val('f-phone'),
      Address: val('f-address'), City: val('f-city'), State: val('f-state'),
      ABCLicense: val('f-abc-license'),
      Notes: val('f-notes'), StaffID: staffId, StaffName: staffName,
    });
    modal.close();
    toast('Account added');
    loadAccounts();
  });
}

function openEditAccount(id) {
  const acct = state.accounts.find(a => a.ID === id);
  if (!acct) return;
  modal.open('Edit Account', accountForm(acct), async () => {
    const name = val('f-name');
    if (!name) { toast('Account name is required', 'error'); return; }
    const staffId = val('f-staff');
    const staffName = staffId ? (state.staff.find(s => s.ID === staffId) || {}).Name || '' : '';
    await api.put(`/api/accounts/${id}`, {
      Name: name, Type: val('f-type'), Status: val('f-status'),
      ContactName: val('f-contact'), PreferredMethod: val('f-method'),
      Email: val('f-email'), Phone: val('f-phone'),
      Address: val('f-address'), City: val('f-city'), State: val('f-state'),
      ABCLicense: val('f-abc-license'),
      Notes: val('f-notes'), StaffID: staffId, StaffName: staffName,
    });
    modal.close();
    toast('Account updated');
    if (state.view === 'account-profile') loadAccountProfile(state.accountProfileId);
    else loadAccounts();
  });
}

async function deleteAccount(id, name) {
  modal.confirm(
    'Delete Account',
    `Delete "${name}"? All associated outreach logs, todos, and orders will also be deleted.`,
    async () => {
      await api.del(`/api/accounts/${id}`);
      modal.close();
      toast('Account deleted');
      loadAccounts();
    }
  );
}

// ── Outreach View ─────────────────────────────────────────────────

const OUTREACH_METHODS = ['Email', 'Phone', 'SMS', 'In-Person'];

function outreachForm(entry = {}, presetAccountId = '') {
  const selId = entry.AccountID || presetAccountId;
  return `
    <div class="form-group">
      <label>Account <span class="required">*</span></label>
      <select class="form-control" id="f-account" ${presetAccountId ? 'disabled' : ''}>
        <option value="">-- Select Account --</option>
        ${accountOptions(selId)}
      </select>
      ${presetAccountId ? `<input type="hidden" id="f-account-hidden" value="${esc(presetAccountId)}" />` : ''}
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Date <span class="required">*</span></label>
        <input class="form-control" id="f-date" type="date" value="${esc(entry.Date || today())}" />
      </div>
      <div class="form-group">
        <label>Method Used</label>
        <select class="form-control" id="f-method">
          ${OUTREACH_METHODS.map(m => `<option value="${m}" ${entry.Method === m ? 'selected' : ''}>${m}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-group">
      <label>Notes / Outcome</label>
      <textarea class="form-control" id="f-notes" rows="3" placeholder="What was discussed? What was the outcome?">${esc(entry.Notes)}</textarea>
    </div>
    <hr class="form-divider" />
    <div class="form-section-title">Follow-up</div>
    <div class="form-group">
      <label>Follow-up Date</label>
      <input class="form-control" id="f-followup-date" type="date" value="${esc(entry.FollowUpDate)}" />
    </div>
    <div class="form-group">
      <label>
        <input type="checkbox" id="f-create-todo" style="margin-right:6px;" />
        Create a todo for this follow-up
      </label>
    </div>`;
}

async function loadOutreach() {
  showLoading();
  const [outreach, accounts] = await Promise.all([api.get('/api/outreach'), api.get('/api/accounts')]);
  state.outreach = outreach;
  state.accounts = accounts;
  renderOutreach();
}

function renderOutreach() {
  const outreach = state.outreach || [];
  const _focused = document.activeElement?.id;
  const accountFilter = (document.getElementById('out-account') || {}).value || '';
  const methodFilter  = (document.getElementById('out-method') || {}).value || '';
  const search        = (document.getElementById('out-search') || {}).value || '';

  let filtered = outreach;
  if (accountFilter) filtered = filtered.filter(o => o.AccountID === accountFilter);
  if (methodFilter)  filtered = filtered.filter(o => o.Method === methodFilter);
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(o =>
      (o.AccountName || '').toLowerCase().includes(q) ||
      (o.Notes || '').toLowerCase().includes(q)
    );
  }

  const acctOpts = `<option value="">All Accounts</option>` +
    [...new Set(outreach.map(o => o.AccountID))]
      .map(id => {
        const o = outreach.find(x => x.AccountID === id);
        return `<option value="${esc(id)}" ${accountFilter === id ? 'selected' : ''}>${esc(o.AccountName)}</option>`;
      }).join('');

  setContent(`
    <div class="view-header">
      <div>
        <h2>Outreach Log</h2>
        <p class="subtitle">${outreach.length} contact${outreach.length !== 1 ? 's' : ''} logged</p>
      </div>
      <div class="view-header-actions">
        <button class="btn btn-primary" onclick="openAddOutreach()">+ Log Contact</button>
      </div>
    </div>
    <div class="filter-bar">
      <input type="search" id="out-search" placeholder="Search..." value="${esc(search)}" oninput="renderOutreach()" />
      <select id="out-account" onchange="renderOutreach()">${acctOpts}</select>
      <select id="out-method" onchange="renderOutreach()">
        <option value="">All Methods</option>
        ${OUTREACH_METHODS.map(m => `<option value="${m}" ${methodFilter === m ? 'selected' : ''}>${m}</option>`).join('')}
      </select>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Account</th><th>Date</th><th>Method</th><th>Notes</th>
            <th>Follow-up</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.length === 0 ? `<tr><td colspan="6" class="empty-state">No outreach logged yet.</td></tr>` :
            filtered.map(o => `<tr>
              <td class="fw-600"><span class="td-link" onclick="loadAccountProfile('${esc(o.AccountID)}')">${esc(o.AccountName)}</span></td>
              <td>${formatDate(o.Date)}</td>
              <td>${methodBadge(o.Method)}</td>
              <td class="text-sm">${esc(o.Notes).substring(0, 80)}${o.Notes && o.Notes.length > 80 ? '…' : ''}</td>
              <td class="text-sm">${o.FollowUpDate ? formatDate(o.FollowUpDate) : '—'}</td>
              <td class="td-actions">
                <button class="btn btn-ghost btn-sm" onclick="openEditOutreach('${esc(o.ID)}')">Edit</button>
                <button class="btn btn-ghost btn-sm text-danger" onclick="deleteOutreach('${esc(o.ID)}')">Del</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`);
  if (_focused === 'out-search') refocusSearch('out-search');
}

let _outreachCache = [];

function openAddOutreach(presetAccountId = '', presetAccountName = '') {
  modal.open('Log Contact', outreachForm({}, presetAccountId), async () => {
    const accountId = presetAccountId
      ? presetAccountId
      : val('f-account');
    if (!accountId) { toast('Please select an account', 'error'); return; }

    const accountName = presetAccountName ||
      (state.accounts.find(a => a.ID === accountId) || {}).Name || '';
    const followUpDate = val('f-followup-date');
    const createTodo = document.getElementById('f-create-todo') && document.getElementById('f-create-todo').checked;

    const entry = await api.post('/api/outreach', {
      AccountID: accountId, AccountName: accountName,
      Date: val('f-date'), Method: val('f-method'),
      Notes: val('f-notes'), FollowUpDate: followUpDate,
    });

    if (createTodo && followUpDate) {
      await api.post('/api/reminders', {
        Type: 'Follow-up', AccountID: accountId, AccountName: accountName,
        Title: `Follow up with ${accountName}`,
        DueDate: followUpDate, Priority: 'Medium',
        Notes: `Re: outreach on ${val('f-date')}`,
      });
    }

    modal.close();
    toast('Contact logged');
    if (state.view === 'account-profile') loadAccountProfile(state.accountProfileId);
    else if (state.view === 'outreach') loadOutreach();
    else if (state.view === 'accounts') loadAccounts();
    else loadDashboard();
  });
}

function openLogOutreach(accountId) {
  const accountName = (state.accounts.find(a => a.ID === accountId) || {}).Name || '';
  openAddOutreach(accountId, accountName);
}

function openEditOutreach(id) {
  api.get('/api/outreach').then(items => {
    const entry = items.find(i => i.ID === id);
    if (!entry) return;
    modal.open('Edit Outreach Entry', outreachForm(entry), async () => {
      await api.put(`/api/outreach/${id}`, {
        Date: val('f-date'), Method: val('f-method'), Notes: val('f-notes'),
        FollowUpDate: val('f-followup-date'),
      });
      modal.close();
      toast('Entry updated');
      loadOutreach();
    });
  });
}

async function deleteOutreach(id) {
  modal.confirm('Delete Entry', 'Delete this outreach log entry?', async () => {
    await api.del(`/api/outreach/${id}`);
    modal.close();
    toast('Entry deleted');
    loadOutreach();
  });
}

// ── Todos View ────────────────────────────────────────────────

const TODO_TYPES = ['Follow-up', 'Delivery', 'Collect Payment', 'Sampling', 'Event', 'Draft Cleaning', 'Pre-Sale'];
const PRIORITIES = ['High', 'Medium', 'Low'];
const RECURRENCE_OPTIONS = [
  { value: 'none',      label: 'None' },
  { value: 'daily',     label: 'Daily' },
  { value: 'weekly',    label: 'Weekly' },
  { value: 'biweekly',  label: 'Every Other Week' },
  { value: 'monthly',   label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly',    label: 'Yearly' },
];

function todoForm(todo = {}) {
  return `
    <div class="form-group">
      <label>Title <span class="required">*</span></label>
      <input class="form-control" id="f-title" value="${esc(todo.Title)}" placeholder="e.g. Call The Rusty Tap about order" />
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Due Date <span class="required">*</span></label>
        <input class="form-control" id="f-due" type="date" value="${esc(todo.DueDate || today())}" />
      </div>
      <div class="form-group">
        <label>Priority</label>
        <select class="form-control" id="f-priority">
          ${PRIORITIES.map(p => `<option value="${p}" ${todo.Priority === p ? 'selected' : ''}>${p}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Type</label>
        <select class="form-control" id="f-type">
          ${TODO_TYPES.map(t => `<option value="${t}" ${todo.Type === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Linked Account (optional)</label>
        <select class="form-control" id="f-account">
          <option value="">-- None --</option>
          ${accountOptions(todo.AccountID)}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Assign To</label>
        <select class="form-control" id="f-staff">
          <option value="">-- Unassigned --</option>
          ${staffOptions(todo.StaffID)}
        </select>
      </div>
      <div class="form-group">
        <label>Recurrence</label>
        <select class="form-control" id="f-recurrence">
          ${RECURRENCE_OPTIONS.map(o => `<option value="${o.value}" ${(todo.Recurrence || 'none') === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-group">
      <label>Notes</label>
      <textarea class="form-control" id="f-notes" rows="2">${esc(todo.Notes)}</textarea>
    </div>`;
}

let _todosCache = [];

async function loadTodos() {
  const statusFilter = (document.getElementById('todo-status') || {}).value || 'active';
  showLoading();

  const [todos, accounts, staff] = await Promise.all([
    api.get(`/api/reminders?status=${statusFilter}`),
    api.get('/api/accounts'),
    api.get('/api/staff'),
  ]);
  state.accounts = accounts;
  state.staff = staff;
  _todosCache = todos;

  renderTodos();
}

function renderTodos() {
  const todos = _todosCache;
  const _focused = document.activeElement?.id;
  const statusFilter = (document.getElementById('todo-status') || {}).value || 'active';
  const search = (document.getElementById('todo-search') || {}).value || '';
  const staffFilter = state.navFilters?.staffId || '';
  const staffFilterName = state.navFilters?.staffName || '';

  let filtered = todos;
  if (staffFilter) filtered = filtered.filter(r => r.StaffID === staffFilter);
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(r =>
      r.Title.toLowerCase().includes(q) ||
      (r.AccountName || '').toLowerCase().includes(q)
    );
  }

  setContent(`
    <div class="view-header">
      <div>
        <h2>Todos${staffFilterName ? ` — ${esc(staffFilterName)}` : ''}</h2>
        <p class="subtitle">${filtered.filter(r => r.Completed !== 'true').length} active todo${filtered.length !== 1 ? 's' : ''}${staffFilterName ? ` assigned to ${esc(staffFilterName)}` : ''}</p>
      </div>
      <div class="view-header-actions">
        ${staffFilter ? `<button class="btn btn-ghost" onclick="state.navFilters={}; renderTodos()">Clear Filter</button>` : ''}
        <button class="btn btn-primary" onclick="openAddTodo()">+ Add Todo</button>
      </div>
    </div>
    <div class="filter-bar">
      <input type="search" id="todo-search" placeholder="Search todos..." value="${esc(search)}" oninput="renderTodos()" />
      <select id="todo-status" onchange="loadTodos()">
        <option value="active" ${statusFilter === 'active' ? 'selected' : ''}>Active</option>
        <option value="completed" ${statusFilter === 'completed' ? 'selected' : ''}>Completed</option>
        <option value="all" ${statusFilter === 'all' ? 'selected' : ''}>All</option>
      </select>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Due</th><th>Status</th><th>Title</th><th>Account</th>
            <th>Type</th><th>Assigned To</th><th>Priority</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.length === 0 ? `<tr><td colspan="8" class="empty-state">No todos found.</td></tr>` :
            filtered.map(r => `<tr>
              <td>${formatDate(r.DueDate)}</td>
              <td>${urgencyBadge(r.DueDate, r.Completed)}</td>
              <td class="fw-600"><span class="td-link" onclick="openEditTodo('${esc(r.ID)}')">${esc(r.Title)}</span>${r.Recurrence && r.Recurrence !== 'none' ? ` <span class="badge badge-recurrence" title="${esc(RECURRENCE_OPTIONS.find(o => o.value === r.Recurrence)?.label || r.Recurrence)}">↻</span>` : ''}</td>
              <td class="text-sm">${r.AccountID ? `<span class="td-link" onclick="loadAccountProfile('${esc(r.AccountID)}')">${esc(r.AccountName)}</span>` : '—'}</td>
              <td class="text-sm">${esc(r.Type)}</td>
              <td class="text-sm">${esc(r.StaffName) || '<span class="text-muted">—</span>'}</td>
              <td>${priorityBadge(r.Priority)}</td>
              <td class="td-actions">
                ${r.Completed !== 'true'
                  ? `<button class="btn btn-ghost btn-sm text-success" onclick="completeTodo('${esc(r.ID)}')">Done</button>`
                  : `<button class="btn btn-ghost btn-sm" onclick="reopenTodo('${esc(r.ID)}')">Reopen</button>`
                }
                <button class="btn btn-ghost btn-sm" onclick="openEditTodo('${esc(r.ID)}')">Edit</button>
                <button class="btn btn-ghost btn-sm text-danger" onclick="deleteTodo('${esc(r.ID)}')">Del</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`);
  if (_focused === 'rem-search') refocusSearch("todo-search");
}

function openAddTodo(presetAccountId = '') {
  // Pre-populate the assigned staff from the account's assigned rep if available
  const presetAcct = presetAccountId ? (state.accounts.find(a => a.ID === presetAccountId) || {}) : {};
  modal.open('Add Todo', todoForm({ AccountID: presetAccountId, StaffID: presetAcct.StaffID, StaffName: presetAcct.StaffName }), async () => {
    const title = val('f-title');
    const dueDate = val('f-due');
    if (!title) { toast('Title is required', 'error'); return; }
    if (!dueDate) { toast('Due date is required', 'error'); return; }
    const accountId = val('f-account');
    const accountName = accountId ? (state.accounts.find(a => a.ID === accountId) || {}).Name || '' : '';
    const staffId = val('f-staff');
    const staffName = staffId ? (state.staff.find(s => s.ID === staffId) || {}).Name || '' : '';
    await api.post('/api/reminders', {
      Title: title, DueDate: dueDate, Priority: val('f-priority'),
      Type: val('f-type'), AccountID: accountId, AccountName: accountName,
      StaffID: staffId, StaffName: staffName, Notes: val('f-notes'),
      Recurrence: val('f-recurrence'),
    });
    modal.close();
    toast('Todo added');
    if (state.view === 'account-profile') loadAccountProfile(state.accountProfileId);
    else loadTodos();
  });
}

function openEditTodo(id) {
  const todo = _todosCache.find(r => r.ID === id);
  if (!todo) return;
  modal.open('Edit Todo', todoForm(todo), async () => {
    const title = val('f-title');
    const dueDate = val('f-due');
    if (!title) { toast('Title is required', 'error'); return; }
    const accountId = val('f-account');
    const accountName = accountId ? (state.accounts.find(a => a.ID === accountId) || {}).Name || '' : '';
    const staffId = val('f-staff');
    const staffName = staffId ? (state.staff.find(s => s.ID === staffId) || {}).Name || '' : '';
    await api.put(`/api/reminders/${id}`, {
      Title: title, DueDate: dueDate, Priority: val('f-priority'),
      Type: val('f-type'), AccountID: accountId, AccountName: accountName,
      StaffID: staffId, StaffName: staffName, Notes: val('f-notes'),
      Recurrence: val('f-recurrence'),
    });
    modal.close();
    toast('Todo updated');
    loadTodos();
  });
}

async function completeTodo(id) {
  // Look up todo data from whichever cache is populated
  const todo = _todosCache.find(r => r.ID === id)
                || (state.dashTodos || []).find(r => r.ID === id);
  const acctId   = todo?.AccountID   || '';
  const acctName = todo?.AccountName || '';
  const title    = todo?.Title       || '';

  const formHtml = `
    <p style="margin:0 0 14px;color:var(--text-secondary);font-size:13px">
      Marking <strong>${esc(title) || 'this todo'}</strong> as done${acctName ? ` for <strong>${esc(acctName)}</strong>` : ''}.
    </p>
    ${acctId ? `
    <div class="form-group">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:600">
        <input type="checkbox" id="f-log-outreach" />
        Also log an outreach contact
      </label>
    </div>
    <div id="outreach-fields" style="display:none;margin-top:10px">
      <div class="form-row">
        <div class="form-group">
          <label>Date</label>
          <input class="form-control" id="f-date" type="date" value="${today()}" />
        </div>
        <div class="form-group">
          <label>Method</label>
          <select class="form-control" id="f-method">
            ${OUTREACH_METHODS.map(m => `<option value="${m}">${m}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>Notes / Outcome</label>
        <textarea class="form-control" id="f-notes" rows="2" placeholder="What was discussed?"></textarea>
      </div>
    </div>` : ''}
  `;

  modal.open('Complete Todo', formHtml, async () => {
    const logOutreach = acctId && document.getElementById('f-log-outreach')?.checked;

    const result = await api.put(`/api/reminders/${id}`, { Completed: 'true' });

    if (logOutreach) {
      await api.post('/api/outreach', {
        AccountID: acctId, AccountName: acctName,
        Date: val('f-date'), Method: val('f-method'),
        Notes: val('f-notes'), FollowUpStatus: 'None',
      });
    }

    modal.close();

    if (result._nextReminder) {
      const label = RECURRENCE_OPTIONS.find(o => o.value === result._nextReminder.Recurrence)?.label || result._nextReminder.Recurrence;
      toast(`Done — next ${label.toLowerCase()} occurrence on ${formatDate(result._nextReminder.DueDate)}`);
    } else {
      toast(logOutreach ? 'Marked done & outreach logged' : 'Marked as done');
    }

    if (state.view === 'account-profile') loadAccountProfile(state.accountProfileId);
    else if (state.view === 'todos') loadTodos();
    else loadDashboard();
  }, 'Mark Done');

  // Wire up toggle after modal renders
  setTimeout(() => {
    const cb     = document.getElementById('f-log-outreach');
    const fields = document.getElementById('outreach-fields');
    if (cb && fields) cb.addEventListener('change', () => { fields.style.display = cb.checked ? '' : 'none'; });
  }, 0);
}

async function reopenTodo(id) {
  await api.put(`/api/reminders/${id}`, { Completed: 'false' });
  toast('Todo reopened');
  loadTodos();
}

async function deleteTodo(id) {
  modal.confirm('Delete Todo', 'Delete this todo?', async () => {
    await api.del(`/api/reminders/${id}`);
    modal.close();
    toast('Todo deleted');
    loadTodos();
  });
}

// ── Dashboard View ────────────────────────────────────────────────

async function loadDashboard() {
  showLoading();
  const [dash, accounts, staff] = await Promise.all([
    api.get('/api/dashboard'),
    api.get('/api/accounts'),
    api.get('/api/staff'),
  ]);
  state.accounts = accounts;
  state.staff = staff;
  state.dashTodos = [...(dash.overdueReminders || []), ...(dash.upcomingReminders || [])];

  // Identify current staff member by matching email
  const currentStaff = staff.find(s => s.Email && s.Email === state.userEmail);
  const currentStaffId = currentStaff ? currentStaff.ID : null;

  // Build "My Todos" — overdue + upcoming assigned to current staff
  const myOverdue = currentStaffId ? (dash.overdueReminders || []).filter(r => r.StaffID === currentStaffId) : [];
  const myUpcoming = currentStaffId ? (dash.upcomingReminders || []).filter(r => r.StaffID === currentStaffId) : [];
  const myTodos = [...myOverdue, ...myUpcoming];

  const lowStockHtml = dash.lowStockItems.length === 0
    ? '<li class="empty-state" style="padding:12px 0">All products are well stocked.</li>'
    : dash.lowStockItems.map(i => `
        <li class="clickable" onclick="navigate('inventory')">
          <span class="dash-label">${esc(i.Name)}</span>
          <span class="dash-meta">${esc(i.Units)} left (${esc(i.Format || 'units')})</span>
          <span class="badge badge-low-stock">Low</span>
        </li>`).join('');

  const upcomingHtml = dash.upcomingReminders.length === 0
    ? '<li class="empty-state" style="padding:12px 0">No upcoming todos in the next 7 days.</li>'
    : dash.upcomingReminders.map(r => `
        <li class="clickable" onclick="navigate('todos')">
          <div>
            ${urgencyBadge(r.DueDate, r.Completed)}
            <span class="dash-label">${esc(r.Title)}</span>
            ${r.AccountName ? `<span class="text-muted text-sm"> &mdash; ${esc(r.AccountName)}</span>` : ''}
          </div>
          <span class="dash-meta">${formatDate(r.DueDate)}</span>
        </li>`).join('');

  const myTodosHtml = !currentStaffId
    ? '<li class="empty-state" style="padding:12px 0">No staff profile linked to your account.</li>'
    : myTodos.length === 0
      ? '<li class="empty-state" style="padding:12px 0">You have no upcoming or overdue todos.</li>'
      : myTodos.map(r => `
          <li class="clickable" onclick="navigate('todos')">
            <div>
              ${urgencyBadge(r.DueDate, r.Completed)}
              <span class="dash-label">${esc(r.Title)}</span>
              ${r.AccountName ? `<span class="text-muted text-sm"> &mdash; ${esc(r.AccountName)}</span>` : ''}
            </div>
            <span class="dash-meta">${formatDate(r.DueDate)}</span>
          </li>`).join('');

  const overdueHtml = dash.overdueReminders.length === 0 ? '' : `
    <div class="card">
      <div class="card-header"><h3 class="text-danger">Overdue (${dash.overdueReminders.length})</h3></div>
      <ul class="dash-list">
        ${dash.overdueReminders.map(r => `
          <li class="clickable" onclick="navigate('todos')">
            ${urgencyBadge(r.DueDate, r.Completed)}
            <span class="dash-label">${esc(r.Title)}</span>
            ${r.AccountName ? `<span class="text-muted text-sm"> &mdash; ${esc(r.AccountName)}</span>` : ''}
            <button class="btn btn-ghost btn-sm text-success" onclick="event.stopPropagation();completeTodo('${esc(r.ID)}')">Done</button>
          </li>`).join('')}
      </ul>
    </div>`;

  const recentHtml = dash.recentOutreach.length === 0
    ? '<li class="empty-state" style="padding:12px 0">No outreach logged yet.</li>'
    : dash.recentOutreach.map(o => `
        <li class="clickable" onclick="navigate('outreach')">
          ${methodBadge(o.Method)}
          <span class="dash-label">${esc(o.AccountName)}</span>
          <span class="dash-meta">${formatDate(o.Date)}</span>
        </li>`).join('');

  setContent(`
    <div class="view-header">
      <div>
        <h2>Dashboard</h2>
        <p class="subtitle">Distribution overview</p>
      </div>
      <div class="view-header-actions">
        <button class="btn btn-secondary" onclick="loadDashboard()">Refresh</button>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card" onclick="navigate('inventory')">
        <div class="stat-value">${dash.totalProducts}</div>
        <div class="stat-label">Products</div>
      </div>
      <div class="stat-card accent" onclick="navigate('accounts', {status: 'Active'})">
        <div class="stat-value">${dash.activeAccounts}</div>
        <div class="stat-label">Active Accounts</div>
      </div>
      <div class="stat-card" onclick="navigate('accounts', {status: 'Prospect'})">
        <div class="stat-value">${dash.prospectAccounts}</div>
        <div class="stat-label">Prospects</div>
      </div>
      <div class="stat-card accent" onclick="navigate('orders')">
        <div class="stat-value">$${parseFloat(dash.monthlyOrdersTotal || 0).toLocaleString('en-US', {minimumFractionDigits: 0, maximumFractionDigits: 0})}</div>
        <div class="stat-label">Orders This Month (${dash.monthlyOrdersCount || 0})</div>
      </div>
      <div class="stat-card ${dash.overdueCount > 0 ? 'danger' : 'warning'}" onclick="navigate('todos')">
        <div class="stat-value">${dash.overdueCount > 0 ? dash.overdueCount : dash.totalActiveReminders}</div>
        <div class="stat-label">${dash.overdueCount > 0 ? 'Overdue' : 'Active Todos'}</div>
      </div>
    </div>

    <div class="dashboard-grid">
      <div class="card">
        <div class="card-header">
          <h3>My Todos${myOverdue.length > 0 ? ` <span class="text-danger">(${myOverdue.length} overdue)</span>` : ''}</h3>
          ${currentStaffId ? `<button class="btn btn-ghost btn-sm" onclick="navigate('todos', {staffId: '${esc(currentStaffId)}', staffName: '${esc(currentStaff.Name)}'})">View all</button>` : ''}
        </div>
        <ul class="dash-list">${myTodosHtml}</ul>
      </div>

      ${overdueHtml}

      <div class="card">
        <div class="card-header">
          <h3>Upcoming (7 days)</h3>
          <button class="btn btn-ghost btn-sm" onclick="navigate('todos')">View all</button>
        </div>
        <ul class="dash-list">${upcomingHtml}</ul>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>Recent Outreach</h3>
          <button class="btn btn-ghost btn-sm" onclick="navigate('outreach')">View all</button>
        </div>
        <ul class="dash-list">${recentHtml}</ul>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>Low Stock Alerts</h3>
          <button class="btn btn-ghost btn-sm" onclick="navigate('inventory')">View all</button>
        </div>
        <ul class="dash-list">${lowStockHtml}</ul>
      </div>
    </div>`);
}

// ── Staff View ────────────────────────────────────────────────────

const STAFF_ROLES = ['Sales Rep', 'Delivery Driver', 'Sales Manager', 'Account Manager', 'Other'];

function staffForm(member = {}) {
  return `
    <div class="form-row">
      <div class="form-group">
        <label>Name <span class="required">*</span></label>
        <input class="form-control" id="f-name" value="${esc(member.Name)}" placeholder="e.g. Alex Johnson" />
      </div>
      <div class="form-group">
        <label>Role</label>
        <select class="form-control" id="f-role">
          <option value="">-- Select --</option>
          ${STAFF_ROLES.map(r => `<option value="${r}" ${member.Role === r ? 'selected' : ''}>${r}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Email</label>
        <input class="form-control" id="f-email" type="email" value="${esc(member.Email)}" placeholder="alex@brewery.com" />
      </div>
      <div class="form-group">
        <label>Phone</label>
        <input class="form-control" id="f-phone" type="tel" value="${esc(member.Phone)}" placeholder="(555) 000-0000" />
      </div>
    </div>
    <div class="form-group">
      <label>Active</label>
      <select class="form-control" id="f-active">
        <option value="true" ${member.Active !== 'false' ? 'selected' : ''}>Active</option>
        <option value="false" ${member.Active === 'false' ? 'selected' : ''}>Inactive</option>
      </select>
    </div>
    <div class="form-group">
      <label>Notes</label>
      <textarea class="form-control" id="f-notes" rows="2">${esc(member.Notes)}</textarea>
    </div>`;
}

let _staffCache = [];

async function loadStaff() {
  showLoading();
  const [staff, accounts] = await Promise.all([api.get('/api/staff'), api.get('/api/accounts')]);
  state.staff = staff;
  state.accounts = accounts;
  _staffCache = staff;
  renderStaff();
}

function renderStaff() {
  const staff = _staffCache;
  const _focused = document.activeElement?.id;
  const accounts = state.accounts || [];

  // Compute account count per staff member
  const acctCounts = {};
  accounts.forEach(a => { if (a.StaffID) acctCounts[a.StaffID] = (acctCounts[a.StaffID] || 0) + 1; });

  const search = (document.getElementById('staff-search') || {}).value || '';
  const filtered = search
    ? staff.filter(s => s.Name.toLowerCase().includes(search.toLowerCase()) || (s.Role || '').toLowerCase().includes(search.toLowerCase()))
    : staff;

  setContent(`
    <div class="view-header">
      <div>
        <h2>Staff Directory</h2>
        <p class="subtitle">${staff.filter(s => s.Active !== 'false').length} active member${staff.length !== 1 ? 's' : ''}</p>
      </div>
      <div class="view-header-actions">
        <button class="btn btn-primary" onclick="openAddStaff()">+ Add Staff Member</button>
      </div>
    </div>
    <div class="filter-bar">
      <input type="search" id="staff-search" placeholder="Search staff..." value="${esc(search)}" oninput="renderStaff()" />
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Name</th><th>Role</th><th>Email</th><th>Phone</th>
            <th>Accounts</th><th>Status</th><th>Notes</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.length === 0 ? `<tr><td colspan="8" class="empty-state">No staff found. Add your first team member!</td></tr>` :
            filtered.map(s => `<tr>
              <td class="fw-600"><span class="td-link" onclick="openEditStaff('${esc(s.ID)}')">${esc(s.Name)}</span></td>
              <td>${esc(s.Role) || '—'}</td>
              <td class="text-sm">${esc(s.Email) || '—'}</td>
              <td class="text-sm">${esc(s.Phone) || '—'}</td>
              <td><span class="badge badge-prospect">${acctCounts[s.ID] || 0} account${(acctCounts[s.ID] || 0) !== 1 ? 's' : ''}</span></td>
              <td><span class="badge ${s.Active !== 'false' ? 'badge-staff-active' : 'badge-staff-inactive'}">${s.Active !== 'false' ? 'Active' : 'Inactive'}</span></td>
              <td class="text-sm text-muted">${esc(s.Notes).substring(0, 50)}${s.Notes && s.Notes.length > 50 ? '…' : ''}</td>
              <td class="td-actions">
                <button class="btn btn-ghost btn-sm" onclick="navigate('todos', { staffId: '${esc(s.ID)}', staffName: '${esc(s.Name)}' })">Todos</button>
                <button class="btn btn-ghost btn-sm" onclick="openEditStaff('${esc(s.ID)}')">Edit</button>
                <button class="btn btn-ghost btn-sm text-danger" onclick="deleteStaff('${esc(s.ID)}', '${esc(s.Name)}')">Delete</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`);
  if (_focused === 'staff-search') refocusSearch('staff-search');
}

function openAddStaff() {
  modal.open('Add Staff Member', staffForm(), async () => {
    const name = val('f-name');
    if (!name) { toast('Name is required', 'error'); return; }
    await api.post('/api/staff', {
      Name: name, Role: val('f-role'), Email: val('f-email'),
      Phone: val('f-phone'), Notes: val('f-notes'),
    });
    modal.close();
    toast('Staff member added');
    loadStaff();
  });
}

function openEditStaff(id) {
  const member = _staffCache.find(s => s.ID === id);
  if (!member) return;
  modal.open('Edit Staff Member', staffForm(member), async () => {
    const name = val('f-name');
    if (!name) { toast('Name is required', 'error'); return; }
    await api.put(`/api/staff/${id}`, {
      Name: name, Role: val('f-role'), Email: val('f-email'),
      Phone: val('f-phone'), Active: val('f-active'), Notes: val('f-notes'),
    });
    modal.close();
    toast('Staff member updated');
    loadStaff();
  });
}

async function deleteStaff(id, name) {
  modal.confirm(
    'Delete Staff Member',
    `Delete "${name}"? They will be unassigned from all accounts.`,
    async () => {
      await api.del(`/api/staff/${id}`);
      modal.close();
      toast('Staff member deleted');
      loadStaff();
    }
  );
}

// ── Orders View ───────────────────────────────────────────────────

const ORDER_STATUSES = ['Pending', 'Paid', 'Cancelled'];

function orderForm(order = {}, presetAccountId = '') {
  const selAcctId = order.AccountID || presetAccountId;
  return `
    <div class="form-row">
      <div class="form-group">
        <label>Account <span class="required">*</span></label>
        <select class="form-control" id="f-account" ${presetAccountId ? 'disabled' : ''}>
          <option value="">-- Select Account --</option>
          ${accountOptions(selAcctId)}
        </select>
        ${presetAccountId ? `<input type="hidden" id="f-account-hidden" value="${esc(presetAccountId)}" />` : ''}
      </div>
      <div class="form-group">
        <label>Sales Rep</label>
        <select class="form-control" id="f-staff">
          <option value="">-- Unassigned --</option>
          ${staffOptions(order.StaffID)}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Order Date <span class="required">*</span></label>
        <input class="form-control" id="f-order-date" type="date" value="${esc(order.OrderDate || today())}" />
      </div>
      <div class="form-group">
        <label>Delivery Date</label>
        <input class="form-control" id="f-delivery-date" type="date" value="${esc(order.DeliveryDate)}" />
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Invoice Number</label>
        <input class="form-control" id="f-invoice" value="${esc(order.InvoiceNumber)}" placeholder="e.g. INV-2024-001" />
      </div>
      <div class="form-group">
        <label>Status</label>
        <select class="form-control" id="f-status">
          ${ORDER_STATUSES.map(s => `<option value="${s}" ${order.Status === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Order Amount ($) <span class="required">*</span></label>
        <input class="form-control" id="f-amount" type="number" step="0.01" min="0" value="${esc(order.OrderAmount || '')}" placeholder="0.00" />
      </div>
      <div class="form-group">
        <label>Tax Amount ($)</label>
        <input class="form-control" id="f-tax" type="number" step="0.01" min="0" value="${esc(order.TaxAmount || '')}" placeholder="0.00" />
      </div>
    </div>
    <div class="form-group">
      <label class="checkbox-label">
        <input type="checkbox" id="f-delivered" ${order.Delivered === 'true' ? 'checked' : ''} />
        Order Delivered
      </label>
    </div>
    <div class="form-group">
      <label>Notes / Reference</label>
      <textarea class="form-control" id="f-notes" rows="2" placeholder="Order details, product breakdown, etc.">${esc(order.Notes)}</textarea>
    </div>`;
}

let _ordersCache = [];

function orderStatusBadge(status) {
  const map = { Pending: 'badge-pending', Paid: 'badge-paid', Cancelled: 'badge-cancelled' };
  return `<span class="badge ${map[status] || 'badge-pending'}">${esc(status || 'Pending')}</span>`;
}

function fmtMoney(val) {
  const n = parseFloat(val || 0);
  return isNaN(n) ? '—' : '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function loadOrders() {
  showLoading();
  const [orders, accounts, staff] = await Promise.all([
    api.get('/api/orders'),
    api.get('/api/accounts'),
    api.get('/api/staff'),
  ]);
  state.accounts = accounts;
  state.staff = staff;
  _ordersCache = orders;
  renderOrders();
}

function renderOrders() {
  const orders = _ordersCache;
  const _focused = document.activeElement?.id;
  const accountFilter = (document.getElementById('orders-account') || {}).value || '';
  const staffFilter   = (document.getElementById('orders-staff') || {}).value || '';
  const statusFilter  = (document.getElementById('orders-status') || {}).value || '';
  const search        = (document.getElementById('orders-search') || {}).value || '';

  let filtered = orders;
  if (accountFilter) filtered = filtered.filter(s => s.AccountID === accountFilter);
  if (staffFilter)   filtered = filtered.filter(s => s.StaffID === staffFilter);
  if (statusFilter)  filtered = filtered.filter(s => s.Status === statusFilter);
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(s =>
      (s.AccountName || '').toLowerCase().includes(q) ||
      (s.InvoiceNumber || '').toLowerCase().includes(q) ||
      (s.Notes || '').toLowerCase().includes(q)
    );
  }

  const totalOrder = filtered.reduce((sum, s) => sum + parseFloat(s.OrderAmount || 0), 0);
  const totalTax   = filtered.reduce((sum, s) => sum + parseFloat(s.TaxAmount   || 0), 0);

  const acctOpts = `<option value="">All Accounts</option>` +
    [...new Map(orders.map(s => [s.AccountID, s.AccountName])).entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([id, name]) => `<option value="${esc(id)}" ${accountFilter === id ? 'selected' : ''}>${esc(name)}</option>`)
      .join('');

  const staffOpts = `<option value="">All Reps</option>` +
    [...new Map(orders.filter(s => s.StaffID).map(s => [s.StaffID, s.StaffName])).entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([id, name]) => `<option value="${esc(id)}" ${staffFilter === id ? 'selected' : ''}>${esc(name)}</option>`)
      .join('');

  setContent(`
    <div class="view-header">
      <div>
        <h2>Orders</h2>
        <p class="subtitle">${orders.length} order${orders.length !== 1 ? 's' : ''} recorded</p>
      </div>
      <div class="view-header-actions">
        <button class="btn btn-primary" onclick="openAddOrder()">+ Log Order</button>
      </div>
    </div>
    <div class="filter-bar">
      <input type="search" id="orders-search" placeholder="Search account, invoice…" value="${esc(search)}" oninput="renderOrders()" />
      <select id="orders-account" onchange="renderOrders()">${acctOpts}</select>
      <select id="orders-staff" onchange="renderOrders()">${staffOpts}</select>
      <select id="orders-status" onchange="renderOrders()">
        <option value="">All Statuses</option>
        ${ORDER_STATUSES.map(s => `<option value="${s}" ${statusFilter === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Order Date</th><th>Account</th><th>Invoice #</th><th>Sales Rep</th>
            <th>Order Amt</th><th>Tax</th><th>Total</th><th>Delivery</th><th>Status</th><th>Delivered</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.length === 0 ? `<tr><td colspan="11" class="empty-state">No orders found.</td></tr>` :
            filtered.map(s => {
              const total = parseFloat(s.OrderAmount || 0) + parseFloat(s.TaxAmount || 0);
              return `<tr>
                <td>${formatDate(s.OrderDate)}</td>
                <td class="fw-600"><span class="td-link" onclick="loadAccountProfile('${esc(s.AccountID)}')">${esc(s.AccountName)}</span></td>
                <td class="text-sm">${esc(s.InvoiceNumber) || '—'}</td>
                <td class="text-sm">${esc(s.StaffName) || '—'}</td>
                <td>${fmtMoney(s.OrderAmount)}</td>
                <td>${s.TaxAmount && parseFloat(s.TaxAmount) > 0 ? fmtMoney(s.TaxAmount) : '—'}</td>
                <td class="fw-600">${fmtMoney(total)}</td>
                <td class="text-sm">${s.DeliveryDate ? formatDate(s.DeliveryDate) : '—'}</td>
                <td>${orderStatusBadge(s.Status)}</td>
                <td class="text-center"><input type="checkbox" ${s.Delivered === 'true' ? 'checked' : ''} onchange="toggleDelivered('${esc(s.ID)}')" /></td>
                <td class="td-actions">
                  ${s.Status === 'Pending' ? `<button class="btn btn-ghost btn-sm text-success" onclick="markOrderPaid('${esc(s.ID)}')">Mark Paid</button>` : ''}
                  <button class="btn btn-ghost btn-sm" onclick="openEditOrder('${esc(s.ID)}')">Edit</button>
                  <button class="btn btn-ghost btn-sm text-danger" onclick="deleteOrder('${esc(s.ID)}')">Del</button>
                </td>
              </tr>`;
            }).join('')}
        </tbody>
        ${filtered.length > 1 ? `
        <tfoot>
          <tr class="table-totals">
            <td colspan="4" class="text-muted text-sm">${filtered.length} records</td>
            <td>${fmtMoney(totalOrder)}</td>
            <td>${fmtMoney(totalTax)}</td>
            <td class="fw-600">${fmtMoney(totalOrder + totalTax)}</td>
            <td colspan="4"></td>
          </tr>
        </tfoot>` : ''}
      </table>
    </div>`);
  if (_focused === 'orders-search') refocusSearch('orders-search');
}

async function openAddOrder(presetAccountId = '') {
  if (state.staff.length === 0) state.staff = await api.get('/api/staff');
  if (state.accounts.length === 0) state.accounts = await api.get('/api/accounts');
  modal.open('Log Order', orderForm({}, presetAccountId), async () => {
    const accountId = presetAccountId || val('f-account');
    if (!accountId) { toast('Please select an account', 'error'); return; }
    const orderDate = val('f-order-date');
    if (!orderDate) { toast('Order date is required', 'error'); return; }
    const accountName = (state.accounts.find(a => a.ID === accountId) || {}).Name || '';
    const staffId = val('f-staff');
    const staffName = staffId ? (state.staff.find(s => s.ID === staffId) || {}).Name || '' : '';
    await api.post('/api/orders', {
      AccountID: accountId, AccountName: accountName,
      StaffID: staffId, StaffName: staffName,
      OrderDate: orderDate, DeliveryDate: val('f-delivery-date'),
      InvoiceNumber: val('f-invoice'), Status: val('f-status'),
      OrderAmount: val('f-amount'), TaxAmount: val('f-tax'),
      Notes: val('f-notes'),
      Delivered: document.getElementById('f-delivered').checked ? 'true' : 'false',
    });
    modal.close();
    toast('Order logged');
    if (state.view === 'account-profile') loadAccountProfile(state.accountProfileId);
    else loadOrders();
  });
}

function openEditOrder(id) {
  const order = _ordersCache.find(s => s.ID === id);
  if (!order) return;
  modal.open('Edit Order', orderForm(order), async () => {
    const staffId = val('f-staff');
    const staffName = staffId ? (state.staff.find(s => s.ID === staffId) || {}).Name || '' : '';
    await api.put(`/api/orders/${id}`, {
      StaffID: staffId, StaffName: staffName,
      OrderDate: val('f-order-date'), DeliveryDate: val('f-delivery-date'),
      InvoiceNumber: val('f-invoice'), Status: val('f-status'),
      OrderAmount: val('f-amount'), TaxAmount: val('f-tax'),
      Notes: val('f-notes'),
      Delivered: document.getElementById('f-delivered').checked ? 'true' : 'false',
    });
    modal.close();
    toast('Order updated');
    loadOrders();
  });
}

async function deleteOrder(id) {
  modal.confirm('Delete Order', 'Delete this order? This cannot be undone.', async () => {
    await api.del(`/api/orders/${id}`);
    modal.close();
    toast('Order deleted');
    loadOrders();
  });
}

async function markOrderPaid(id) {
  await api.put(`/api/orders/${id}`, { Status: 'Paid' });
  toast('Order marked as paid');
  loadOrders();
}

async function toggleDelivered(id) {
  const order = _ordersCache.find(s => s.ID === id);
  if (!order) return;
  const newDelivered = order.Delivered === 'true' ? 'false' : 'true';
  await api.put(`/api/orders/${id}`, { Delivered: newDelivered });
  toast(newDelivered === 'true' ? 'Marked as delivered' : 'Marked as undelivered');
  loadOrders();
}

async function profileMarkOrderPaid(id) {
  await api.put(`/api/orders/${id}`, { Status: 'Paid' });
  toast('Order marked as paid');
  loadAccountProfile(state.accountProfileId);
}

async function profileToggleDelivered(id, isDelivered) {
  const newDelivered = isDelivered ? 'false' : 'true';
  await api.put(`/api/orders/${id}`, { Delivered: newDelivered });
  toast(newDelivered === 'true' ? 'Marked as delivered' : 'Marked as undelivered');
  loadAccountProfile(state.accountProfileId);
}

// ── Navigation ────────────────────────────────────────────────────

const VIEW_LOADERS = {
  dashboard: loadDashboard,
  inventory: loadInventory,
  accounts:  loadAccounts,
  outreach:  loadOutreach,
  todos: loadTodos,
  orders:    loadOrders,
  staff:     loadStaff,
};

function navigate(view, filters = {}) {
  state.view = view;
  state.navFilters = filters;
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.view === view);
  });
  window.location.hash = view;
  const loader = VIEW_LOADERS[view];
  if (loader) loader().catch(err => {
    toast(err.message, 'error');
    setContent(`<div class="empty-state text-danger" style="padding:40px">Error: ${esc(err.message)}</div>`);
  });
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

  // Load view from hash or default to dashboard
  const hash = window.location.hash.replace('#', '');
  navigate(VIEW_LOADERS[hash] ? hash : 'dashboard');
}

document.addEventListener('DOMContentLoaded', init);
