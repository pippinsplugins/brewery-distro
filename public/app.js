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

function renderInventory() {
  const items = state.inventory || [];
  const search = (document.getElementById('inv-search') || {}).value || '';
  const filtered = items.filter(i =>
    !search || i.Name.toLowerCase().includes(search.toLowerCase()) || (i.Style || '').toLowerCase().includes(search.toLowerCase())
  );

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
            <th>Name</th><th>Style</th><th>ABV</th><th>Format</th>
            <th>Units</th><th>Price/Unit</th><th>Stock</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.length === 0 ? `<tr><td colspan="8" class="empty-state">No products found. Add your first product!</td></tr>` :
            filtered.map(item => {
              const low = parseInt(item.Units || '0') <= parseInt(item.LowStockThreshold || '5');
              return `<tr>
                <td class="fw-600">${esc(item.Name)}</td>
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

const ACCOUNT_TYPES = ['Bar', 'Restaurant', 'Bottle Shop', 'Grocery Store', 'Hotel', 'Event Venue', 'Other'];
const CONTACT_METHODS = ['Email', 'Phone', 'SMS', 'In-Person', 'Any'];
const ACCOUNT_STATUSES = ['Active', 'Prospect', 'Inactive'];

function accountForm(acct = {}) {
  return `
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
  const nav = state.navFilters || {};
  state.navFilters = {};
  const typeFilter   = (document.getElementById('acct-type')   || {}).value ?? nav.type   ?? '';
  const statusFilter = (document.getElementById('acct-status') || {}).value ?? nav.status ?? '';
  const search       = (document.getElementById('acct-search') || {}).value ?? nav.search ?? '';

  let filtered = accounts;
  if (typeFilter)   filtered = filtered.filter(a => a.Type === typeFilter);
  if (statusFilter) filtered = filtered.filter(a => a.Status === statusFilter);
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
        <option value="">All Statuses</option>
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
              <td class="fw-600">${esc(a.Name)}<br><span class="text-muted text-sm">${esc(a.City)}${a.City && a.State ? ', ' : ''}${esc(a.State)}</span></td>
              <td>${esc(a.Type)}</td>
              <td>${esc(a.ContactName) || '—'}</td>
              <td class="text-sm">${a.Email ? esc(a.Email) + '<br>' : ''}${esc(a.Phone)}</td>
              <td>${methodBadge(a.PreferredMethod)}</td>
              <td class="text-sm">${esc(a.StaffName) || '<span class="text-muted">—</span>'}</td>
              <td>${statusBadge(a.Status)}</td>
              <td class="text-sm text-muted">${formatDate(a.LastContacted)}</td>
              <td class="td-actions">
                <button class="btn btn-ghost btn-sm" onclick="openLogOutreach('${esc(a.ID)}', '${esc(a.Name)}')">+ Log</button>
                <button class="btn btn-ghost btn-sm" onclick="openEditAccount('${esc(a.ID)}')">Edit</button>
                <button class="btn btn-ghost btn-sm text-danger" onclick="deleteAccount('${esc(a.ID)}', '${esc(a.Name)}')">Del</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`);
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
      Notes: val('f-notes'), StaffID: staffId, StaffName: staffName,
    });
    modal.close();
    toast('Account updated');
    loadAccounts();
  });
}

async function deleteAccount(id, name) {
  modal.confirm(
    'Delete Account',
    `Delete "${name}"? All associated outreach logs, reminders, and sales will also be deleted.`,
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
const FOLLOWUP_STATUSES = ['None', 'Pending', 'Completed'];

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
    <div class="form-row">
      <div class="form-group">
        <label>Follow-up Date</label>
        <input class="form-control" id="f-followup-date" type="date" value="${esc(entry.FollowUpDate)}" />
      </div>
      <div class="form-group">
        <label>Follow-up Status</label>
        <select class="form-control" id="f-followup-status">
          ${FOLLOWUP_STATUSES.map(s => `<option value="${s}" ${entry.FollowUpStatus === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-group">
      <label>
        <input type="checkbox" id="f-create-reminder" style="margin-right:6px;" />
        Create a reminder for this follow-up
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
            <th>Follow-up</th><th>Status</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.length === 0 ? `<tr><td colspan="7" class="empty-state">No outreach logged yet.</td></tr>` :
            filtered.map(o => `<tr>
              <td class="fw-600">${esc(o.AccountName)}</td>
              <td>${formatDate(o.Date)}</td>
              <td>${methodBadge(o.Method)}</td>
              <td class="text-sm">${esc(o.Notes).substring(0, 80)}${o.Notes && o.Notes.length > 80 ? '…' : ''}</td>
              <td class="text-sm">${o.FollowUpDate ? formatDate(o.FollowUpDate) : '—'}</td>
              <td><span class="badge badge-${(o.FollowUpStatus || 'none').toLowerCase()}">${esc(o.FollowUpStatus || '—')}</span></td>
              <td class="td-actions">
                <button class="btn btn-ghost btn-sm" onclick="openEditOutreach('${esc(o.ID)}')">Edit</button>
                <button class="btn btn-ghost btn-sm text-danger" onclick="deleteOutreach('${esc(o.ID)}')">Del</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`);
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
    const followUpStatus = val('f-followup-status');
    const createReminder = document.getElementById('f-create-reminder') && document.getElementById('f-create-reminder').checked;

    const entry = await api.post('/api/outreach', {
      AccountID: accountId, AccountName: accountName,
      Date: val('f-date'), Method: val('f-method'),
      Notes: val('f-notes'), FollowUpDate: followUpDate,
      FollowUpStatus: followUpDate ? (followUpStatus || 'Pending') : 'None',
    });

    if (createReminder && followUpDate) {
      await api.post('/api/reminders', {
        Type: 'Follow-up', AccountID: accountId, AccountName: accountName,
        Title: `Follow up with ${accountName}`,
        DueDate: followUpDate, Priority: 'Medium',
        Notes: `Re: outreach on ${val('f-date')}`,
      });
    }

    modal.close();
    toast('Contact logged');
    if (state.view === 'outreach') loadOutreach();
    else if (state.view === 'accounts') loadAccounts();
    else loadDashboard();
  });
}

function openLogOutreach(accountId, accountName) {
  openAddOutreach(accountId, accountName);
}

function openEditOutreach(id) {
  api.get('/api/outreach').then(items => {
    const entry = items.find(i => i.ID === id);
    if (!entry) return;
    modal.open('Edit Outreach Entry', outreachForm(entry), async () => {
      const followUpDate = val('f-followup-date');
      await api.put(`/api/outreach/${id}`, {
        Date: val('f-date'), Method: val('f-method'), Notes: val('f-notes'),
        FollowUpDate: followUpDate,
        FollowUpStatus: followUpDate ? val('f-followup-status') : 'None',
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

// ── Reminders View ────────────────────────────────────────────────

const REMINDER_TYPES = ['Follow-up', 'Delivery', 'Payment', 'Order', 'Tasting', 'Event', 'Other'];
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

function reminderForm(reminder = {}) {
  return `
    <div class="form-group">
      <label>Title <span class="required">*</span></label>
      <input class="form-control" id="f-title" value="${esc(reminder.Title)}" placeholder="e.g. Call The Rusty Tap about order" />
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Due Date <span class="required">*</span></label>
        <input class="form-control" id="f-due" type="date" value="${esc(reminder.DueDate || today())}" />
      </div>
      <div class="form-group">
        <label>Priority</label>
        <select class="form-control" id="f-priority">
          ${PRIORITIES.map(p => `<option value="${p}" ${reminder.Priority === p ? 'selected' : ''}>${p}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Type</label>
        <select class="form-control" id="f-type">
          ${REMINDER_TYPES.map(t => `<option value="${t}" ${reminder.Type === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Linked Account (optional)</label>
        <select class="form-control" id="f-account">
          <option value="">-- None --</option>
          ${accountOptions(reminder.AccountID)}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Assign To</label>
        <select class="form-control" id="f-staff">
          <option value="">-- Unassigned --</option>
          ${staffOptions(reminder.StaffID)}
        </select>
      </div>
      <div class="form-group">
        <label>Recurrence</label>
        <select class="form-control" id="f-recurrence">
          ${RECURRENCE_OPTIONS.map(o => `<option value="${o.value}" ${(reminder.Recurrence || 'none') === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-group">
      <label>Notes</label>
      <textarea class="form-control" id="f-notes" rows="2">${esc(reminder.Notes)}</textarea>
    </div>`;
}

let _remindersCache = [];

async function loadReminders() {
  const statusFilter = (document.getElementById('rem-status') || {}).value || 'active';
  showLoading();

  const [reminders, accounts, staff] = await Promise.all([
    api.get(`/api/reminders?status=${statusFilter}`),
    api.get('/api/accounts'),
    api.get('/api/staff'),
  ]);
  state.accounts = accounts;
  state.staff = staff;
  _remindersCache = reminders;

  renderReminders();
}

function renderReminders() {
  const reminders = _remindersCache;
  const statusFilter = (document.getElementById('rem-status') || {}).value || 'active';
  const search = (document.getElementById('rem-search') || {}).value || '';

  let filtered = reminders;
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
        <h2>Reminders</h2>
        <p class="subtitle">${reminders.filter(r => r.Completed !== 'true').length} active reminder${reminders.length !== 1 ? 's' : ''}</p>
      </div>
      <div class="view-header-actions">
        <button class="btn btn-primary" onclick="openAddReminder()">+ Add Reminder</button>
      </div>
    </div>
    <div class="filter-bar">
      <input type="search" id="rem-search" placeholder="Search reminders..." value="${esc(search)}" oninput="renderReminders()" />
      <select id="rem-status" onchange="loadReminders()">
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
          ${filtered.length === 0 ? `<tr><td colspan="8" class="empty-state">No reminders found.</td></tr>` :
            filtered.map(r => `<tr>
              <td>${formatDate(r.DueDate)}</td>
              <td>${urgencyBadge(r.DueDate, r.Completed)}</td>
              <td class="fw-600">${esc(r.Title)}${r.Recurrence && r.Recurrence !== 'none' ? ` <span class="badge badge-recurrence" title="${esc(RECURRENCE_OPTIONS.find(o => o.value === r.Recurrence)?.label || r.Recurrence)}">↻</span>` : ''}</td>
              <td class="text-sm">${esc(r.AccountName) || '—'}</td>
              <td class="text-sm">${esc(r.Type)}</td>
              <td class="text-sm">${esc(r.StaffName) || '<span class="text-muted">—</span>'}</td>
              <td>${priorityBadge(r.Priority)}</td>
              <td class="td-actions">
                ${r.Completed !== 'true'
                  ? `<button class="btn btn-ghost btn-sm text-success" onclick="completeReminder('${esc(r.ID)}')">Done</button>`
                  : `<button class="btn btn-ghost btn-sm" onclick="reopenReminder('${esc(r.ID)}')">Reopen</button>`
                }
                <button class="btn btn-ghost btn-sm" onclick="openEditReminder('${esc(r.ID)}')">Edit</button>
                <button class="btn btn-ghost btn-sm text-danger" onclick="deleteReminder('${esc(r.ID)}')">Del</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`);
}

function openAddReminder(presetAccountId = '') {
  // Pre-populate the assigned staff from the account's assigned rep if available
  const presetAcct = presetAccountId ? (state.accounts.find(a => a.ID === presetAccountId) || {}) : {};
  modal.open('Add Reminder', reminderForm({ AccountID: presetAccountId, StaffID: presetAcct.StaffID, StaffName: presetAcct.StaffName }), async () => {
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
    toast('Reminder added');
    loadReminders();
  });
}

function openEditReminder(id) {
  const reminder = _remindersCache.find(r => r.ID === id);
  if (!reminder) return;
  modal.open('Edit Reminder', reminderForm(reminder), async () => {
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
    toast('Reminder updated');
    loadReminders();
  });
}

async function completeReminder(id) {
  // Look up reminder data from whichever cache is populated
  const reminder = _remindersCache.find(r => r.ID === id)
                || (state.dashReminders || []).find(r => r.ID === id);
  const acctId   = reminder?.AccountID   || '';
  const acctName = reminder?.AccountName || '';
  const title    = reminder?.Title       || '';

  const formHtml = `
    <p style="margin:0 0 14px;color:var(--text-secondary);font-size:13px">
      Marking <strong>${esc(title) || 'this reminder'}</strong> as done${acctName ? ` for <strong>${esc(acctName)}</strong>` : ''}.
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

  modal.open('Complete Reminder', formHtml, async () => {
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

    if (state.view === 'reminders') loadReminders();
    else loadDashboard();
  }, 'Mark Done');

  // Wire up toggle after modal renders
  setTimeout(() => {
    const cb     = document.getElementById('f-log-outreach');
    const fields = document.getElementById('outreach-fields');
    if (cb && fields) cb.addEventListener('change', () => { fields.style.display = cb.checked ? '' : 'none'; });
  }, 0);
}

async function reopenReminder(id) {
  await api.put(`/api/reminders/${id}`, { Completed: 'false' });
  toast('Reminder reopened');
  loadReminders();
}

async function deleteReminder(id) {
  modal.confirm('Delete Reminder', 'Delete this reminder?', async () => {
    await api.del(`/api/reminders/${id}`);
    modal.close();
    toast('Reminder deleted');
    loadReminders();
  });
}

// ── Dashboard View ────────────────────────────────────────────────

async function loadDashboard() {
  showLoading();
  const [dash, accounts] = await Promise.all([
    api.get('/api/dashboard'),
    api.get('/api/accounts'),
  ]);
  state.accounts = accounts;
  state.dashReminders = [...(dash.overdueReminders || []), ...(dash.upcomingReminders || [])];

  const lowStockHtml = dash.lowStockItems.length === 0
    ? '<li class="empty-state" style="padding:12px 0">All products are well stocked.</li>'
    : dash.lowStockItems.map(i => `
        <li class="clickable" onclick="navigate('inventory')">
          <span class="dash-label">${esc(i.Name)}</span>
          <span class="dash-meta">${esc(i.Units)} left (${esc(i.Format || 'units')})</span>
          <span class="badge badge-low-stock">Low</span>
        </li>`).join('');

  const upcomingHtml = dash.upcomingReminders.length === 0
    ? '<li class="empty-state" style="padding:12px 0">No upcoming reminders in the next 7 days.</li>'
    : dash.upcomingReminders.map(r => `
        <li class="clickable" onclick="navigate('reminders')">
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
          <li class="clickable" onclick="navigate('reminders')">
            ${urgencyBadge(r.DueDate, r.Completed)}
            <span class="dash-label">${esc(r.Title)}</span>
            ${r.AccountName ? `<span class="text-muted text-sm"> &mdash; ${esc(r.AccountName)}</span>` : ''}
            <button class="btn btn-ghost btn-sm text-success" onclick="event.stopPropagation();completeReminder('${esc(r.ID)}')">Done</button>
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
      <div class="stat-card accent" onclick="navigate('sales')">
        <div class="stat-value">$${parseFloat(dash.monthlySalesTotal || 0).toLocaleString('en-US', {minimumFractionDigits: 0, maximumFractionDigits: 0})}</div>
        <div class="stat-label">Sales This Month (${dash.monthlySalesCount || 0})</div>
      </div>
      <div class="stat-card ${dash.overdueCount > 0 ? 'danger' : 'warning'}" onclick="navigate('reminders')">
        <div class="stat-value">${dash.overdueCount > 0 ? dash.overdueCount : dash.totalActiveReminders}</div>
        <div class="stat-label">${dash.overdueCount > 0 ? 'Overdue' : 'Active Reminders'}</div>
      </div>
    </div>

    <div class="dashboard-grid">
      ${overdueHtml}

      <div class="card">
        <div class="card-header">
          <h3>Upcoming (7 days)</h3>
          <button class="btn btn-ghost btn-sm" onclick="navigate('reminders')">View all</button>
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
              <td class="fw-600">${esc(s.Name)}</td>
              <td>${esc(s.Role) || '—'}</td>
              <td class="text-sm">${esc(s.Email) || '—'}</td>
              <td class="text-sm">${esc(s.Phone) || '—'}</td>
              <td><span class="badge badge-prospect">${acctCounts[s.ID] || 0} account${(acctCounts[s.ID] || 0) !== 1 ? 's' : ''}</span></td>
              <td><span class="badge ${s.Active !== 'false' ? 'badge-staff-active' : 'badge-staff-inactive'}">${s.Active !== 'false' ? 'Active' : 'Inactive'}</span></td>
              <td class="text-sm text-muted">${esc(s.Notes).substring(0, 50)}${s.Notes && s.Notes.length > 50 ? '…' : ''}</td>
              <td class="td-actions">
                <button class="btn btn-ghost btn-sm" onclick="openEditStaff('${esc(s.ID)}')">Edit</button>
                <button class="btn btn-ghost btn-sm text-danger" onclick="deleteStaff('${esc(s.ID)}', '${esc(s.Name)}')">Delete</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`);
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

// ── Sales View ────────────────────────────────────────────────────

const SALE_STATUSES = ['Pending', 'Delivered', 'Paid', 'Cancelled'];

function salesForm(sale = {}, presetAccountId = '') {
  const selAcctId = sale.AccountID || presetAccountId;
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
          ${staffOptions(sale.StaffID)}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Sale Date <span class="required">*</span></label>
        <input class="form-control" id="f-sale-date" type="date" value="${esc(sale.SaleDate || today())}" />
      </div>
      <div class="form-group">
        <label>Delivery Date</label>
        <input class="form-control" id="f-delivery-date" type="date" value="${esc(sale.DeliveryDate)}" />
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Invoice Number</label>
        <input class="form-control" id="f-invoice" value="${esc(sale.InvoiceNumber)}" placeholder="e.g. INV-2024-001" />
      </div>
      <div class="form-group">
        <label>Status</label>
        <select class="form-control" id="f-status">
          ${SALE_STATUSES.map(s => `<option value="${s}" ${sale.Status === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Sale Amount ($) <span class="required">*</span></label>
        <input class="form-control" id="f-amount" type="number" step="0.01" min="0" value="${esc(sale.SaleAmount || '')}" placeholder="0.00" />
      </div>
      <div class="form-group">
        <label>Tax Amount ($)</label>
        <input class="form-control" id="f-tax" type="number" step="0.01" min="0" value="${esc(sale.TaxAmount || '')}" placeholder="0.00" />
      </div>
    </div>
    <div class="form-group">
      <label>Notes / Reference</label>
      <textarea class="form-control" id="f-notes" rows="2" placeholder="Order details, product breakdown, etc.">${esc(sale.Notes)}</textarea>
    </div>`;
}

let _salesCache = [];

function salesStatusBadge(status) {
  const map = { Pending: 'badge-pending', Delivered: 'badge-delivered', Paid: 'badge-paid', Cancelled: 'badge-cancelled' };
  return `<span class="badge ${map[status] || 'badge-pending'}">${esc(status || 'Pending')}</span>`;
}

function fmtMoney(val) {
  const n = parseFloat(val || 0);
  return isNaN(n) ? '—' : '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function loadSales() {
  showLoading();
  const [sales, accounts, staff] = await Promise.all([
    api.get('/api/sales'),
    api.get('/api/accounts'),
    api.get('/api/staff'),
  ]);
  state.accounts = accounts;
  state.staff = staff;
  _salesCache = sales;
  renderSales();
}

function renderSales() {
  const sales = _salesCache;
  const accountFilter = (document.getElementById('sales-account') || {}).value || '';
  const staffFilter   = (document.getElementById('sales-staff') || {}).value || '';
  const statusFilter  = (document.getElementById('sales-status') || {}).value || '';
  const search        = (document.getElementById('sales-search') || {}).value || '';

  let filtered = sales;
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

  const totalSale = filtered.reduce((sum, s) => sum + parseFloat(s.SaleAmount || 0), 0);
  const totalTax  = filtered.reduce((sum, s) => sum + parseFloat(s.TaxAmount  || 0), 0);

  const acctOpts = `<option value="">All Accounts</option>` +
    [...new Map(sales.map(s => [s.AccountID, s.AccountName])).entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([id, name]) => `<option value="${esc(id)}" ${accountFilter === id ? 'selected' : ''}>${esc(name)}</option>`)
      .join('');

  const staffOpts = `<option value="">All Reps</option>` +
    [...new Map(sales.filter(s => s.StaffID).map(s => [s.StaffID, s.StaffName])).entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([id, name]) => `<option value="${esc(id)}" ${staffFilter === id ? 'selected' : ''}>${esc(name)}</option>`)
      .join('');

  setContent(`
    <div class="view-header">
      <div>
        <h2>Sales Log</h2>
        <p class="subtitle">${sales.length} sale${sales.length !== 1 ? 's' : ''} recorded</p>
      </div>
      <div class="view-header-actions">
        <button class="btn btn-primary" onclick="openAddSale()">+ Log Sale</button>
      </div>
    </div>
    <div class="filter-bar">
      <input type="search" id="sales-search" placeholder="Search account, invoice…" value="${esc(search)}" oninput="renderSales()" />
      <select id="sales-account" onchange="renderSales()">${acctOpts}</select>
      <select id="sales-staff" onchange="renderSales()">${staffOpts}</select>
      <select id="sales-status" onchange="renderSales()">
        <option value="">All Statuses</option>
        ${SALE_STATUSES.map(s => `<option value="${s}" ${statusFilter === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Sale Date</th><th>Account</th><th>Invoice #</th><th>Sales Rep</th>
            <th>Sale Amt</th><th>Tax</th><th>Total</th><th>Delivery</th><th>Status</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.length === 0 ? `<tr><td colspan="10" class="empty-state">No sales found.</td></tr>` :
            filtered.map(s => {
              const total = parseFloat(s.SaleAmount || 0) + parseFloat(s.TaxAmount || 0);
              return `<tr>
                <td>${formatDate(s.SaleDate)}</td>
                <td class="fw-600">${esc(s.AccountName)}</td>
                <td class="text-sm">${esc(s.InvoiceNumber) || '—'}</td>
                <td class="text-sm">${esc(s.StaffName) || '—'}</td>
                <td>${fmtMoney(s.SaleAmount)}</td>
                <td>${s.TaxAmount && parseFloat(s.TaxAmount) > 0 ? fmtMoney(s.TaxAmount) : '—'}</td>
                <td class="fw-600">${fmtMoney(total)}</td>
                <td class="text-sm">${s.DeliveryDate ? formatDate(s.DeliveryDate) : '—'}</td>
                <td>${salesStatusBadge(s.Status)}</td>
                <td class="td-actions">
                  <button class="btn btn-ghost btn-sm" onclick="openEditSale('${esc(s.ID)}')">Edit</button>
                  <button class="btn btn-ghost btn-sm text-danger" onclick="deleteSale('${esc(s.ID)}')">Del</button>
                </td>
              </tr>`;
            }).join('')}
        </tbody>
        ${filtered.length > 1 ? `
        <tfoot>
          <tr class="table-totals">
            <td colspan="4" class="text-muted text-sm">${filtered.length} records</td>
            <td>${fmtMoney(totalSale)}</td>
            <td>${fmtMoney(totalTax)}</td>
            <td class="fw-600">${fmtMoney(totalSale + totalTax)}</td>
            <td colspan="3"></td>
          </tr>
        </tfoot>` : ''}
      </table>
    </div>`);
}

async function openAddSale(presetAccountId = '') {
  if (state.staff.length === 0) state.staff = await api.get('/api/staff');
  if (state.accounts.length === 0) state.accounts = await api.get('/api/accounts');
  modal.open('Log Sale', salesForm({}, presetAccountId), async () => {
    const accountId = presetAccountId || val('f-account');
    if (!accountId) { toast('Please select an account', 'error'); return; }
    const saleDate = val('f-sale-date');
    if (!saleDate) { toast('Sale date is required', 'error'); return; }
    const accountName = (state.accounts.find(a => a.ID === accountId) || {}).Name || '';
    const staffId = val('f-staff');
    const staffName = staffId ? (state.staff.find(s => s.ID === staffId) || {}).Name || '' : '';
    await api.post('/api/sales', {
      AccountID: accountId, AccountName: accountName,
      StaffID: staffId, StaffName: staffName,
      SaleDate: saleDate, DeliveryDate: val('f-delivery-date'),
      InvoiceNumber: val('f-invoice'), Status: val('f-status'),
      SaleAmount: val('f-amount'), TaxAmount: val('f-tax'),
      Notes: val('f-notes'),
    });
    modal.close();
    toast('Sale logged');
    loadSales();
  });
}

function openEditSale(id) {
  const sale = _salesCache.find(s => s.ID === id);
  if (!sale) return;
  modal.open('Edit Sale', salesForm(sale), async () => {
    const staffId = val('f-staff');
    const staffName = staffId ? (state.staff.find(s => s.ID === staffId) || {}).Name || '' : '';
    await api.put(`/api/sales/${id}`, {
      StaffID: staffId, StaffName: staffName,
      SaleDate: val('f-sale-date'), DeliveryDate: val('f-delivery-date'),
      InvoiceNumber: val('f-invoice'), Status: val('f-status'),
      SaleAmount: val('f-amount'), TaxAmount: val('f-tax'),
      Notes: val('f-notes'),
    });
    modal.close();
    toast('Sale updated');
    loadSales();
  });
}

async function deleteSale(id) {
  modal.confirm('Delete Sale', 'Delete this sale record? This cannot be undone.', async () => {
    await api.del(`/api/sales/${id}`);
    modal.close();
    toast('Sale deleted');
    loadSales();
  });
}

// ── Navigation ────────────────────────────────────────────────────

const VIEW_LOADERS = {
  dashboard: loadDashboard,
  inventory: loadInventory,
  accounts:  loadAccounts,
  outreach:  loadOutreach,
  reminders: loadReminders,
  sales:     loadSales,
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
  // Wire up nav clicks
  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      navigate(el.dataset.view);
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
