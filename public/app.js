'use strict';

// ── State ────────────────────────────────────────────────────────
let LOCATIONS = ['Hutchinson', 'Mission']; // Defaults; overwritten by settings on init

const state = {
  view: 'dashboard',
  location: localStorage.getItem('brewLocation') || LOCATIONS[0],
  accounts: [],      // cached for select dropdowns
  inventory: [],
  staff: [],         // cached for staff dropdowns
  settings: {},
};

// ── Pagination ──────────────────────────────────────────────────
const _pagination = {
  inventory: { page: 1, perPage: 25 },
  accounts:  { page: 1, perPage: 25 },
  outreach:  { page: 1, perPage: 25 },
  todos:     { page: 1, perPage: 25 },
  staff:     { page: 1, perPage: 25 },
  orders:    { page: 1, perPage: 25 },
  kegs:      { page: 1, perPage: 25 },
};

function paginate(filtered, viewKey) {
  const pg = _pagination[viewKey];
  const total = filtered.length;
  if (pg.perPage === 0) return { rows: filtered, page: 1, total, perPage: 0, totalPages: 1 };
  const totalPages = Math.max(1, Math.ceil(total / pg.perPage));
  if (pg.page > totalPages) pg.page = totalPages;
  if (pg.page < 1) pg.page = 1;
  const start = (pg.page - 1) * pg.perPage;
  return { rows: filtered.slice(start, start + pg.perPage), page: pg.page, total, perPage: pg.perPage, totalPages };
}

function paginationControls(viewKey, pg, renderFnName) {
  const { page, total, perPage, totalPages } = pg;
  const opts = [10, 25, 50, 0];
  const showStart = total === 0 ? 0 : perPage === 0 ? 1 : (page - 1) * perPage + 1;
  const showEnd = total === 0 ? 0 : perPage === 0 ? total : Math.min(page * perPage, total);

  let pageNums = '';
  if (totalPages > 1) {
    const parts = [];
    let s = Math.max(1, page - 2);
    let e = Math.min(totalPages, s + 4);
    s = Math.max(1, e - 4);
    if (s > 1) parts.push(`<button class="btn btn-ghost btn-sm" onclick="_paginationGo('${viewKey}',1,'${renderFnName}')">1</button>`);
    if (s > 2) parts.push('<span class="pagination-ellipsis">\u2026</span>');
    for (let i = s; i <= e; i++) parts.push(`<button class="btn btn-sm ${i === page ? 'btn-primary' : 'btn-ghost'}" onclick="_paginationGo('${viewKey}',${i},'${renderFnName}')">${i}</button>`);
    if (e < totalPages - 1) parts.push('<span class="pagination-ellipsis">\u2026</span>');
    if (e < totalPages) parts.push(`<button class="btn btn-ghost btn-sm" onclick="_paginationGo('${viewKey}',${totalPages},'${renderFnName}')">${totalPages}</button>`);
    pageNums = parts.join('');
  }

  return `
    <div class="pagination-bar">
      <div class="pagination-per-page">
        <label>Show</label>
        <select onchange="_paginationPerPage('${viewKey}',this.value,'${renderFnName}')">
          ${opts.map(n => `<option value="${n}" ${perPage === n ? 'selected' : ''}>${n === 0 ? 'All' : n}</option>`).join('')}
        </select>
        <span class="pagination-info">Showing ${showStart}\u2013${showEnd} of ${total}</span>
      </div>
      <div class="pagination-nav">
        <button class="btn btn-ghost btn-sm" ${page <= 1 ? 'disabled' : ''} onclick="_paginationGo('${viewKey}',${page - 1},'${renderFnName}')">\u2039 Prev</button>
        ${pageNums}
        <button class="btn btn-ghost btn-sm" ${page >= totalPages ? 'disabled' : ''} onclick="_paginationGo('${viewKey}',${page + 1},'${renderFnName}')">Next \u203a</button>
      </div>
    </div>`;
}

function _paginationGo(viewKey, page, renderFnName) {
  _pagination[viewKey].page = page;
  window[renderFnName]();
}

function _paginationPerPage(viewKey, value, renderFnName) {
  _pagination[viewKey].perPage = parseInt(value);
  _pagination[viewKey].page = 1;
  window[renderFnName]();
}

function _paginationReset(viewKey) {
  _pagination[viewKey].page = 1;
}

// ── Utilities ────────────────────────────────────────────────────

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

let _noteIdCounter = 0;
function truncateNote(text, limit = 100) {
  if (!text) return '—';
  const safe = esc(text);
  if (text.length <= limit) return `<span class="note-text">${safe}</span>`;
  const id = '_n' + (++_noteIdCounter);
  return `<span class="note-text"><span id="${id}_short">${esc(text.substring(0, limit))}… <a href="#" class="note-toggle" onclick="event.preventDefault();document.getElementById('${id}_short').style.display='none';document.getElementById('${id}_full').style.display='inline'">more</a></span><span id="${id}_full" style="display:none">${safe} <a href="#" class="note-toggle" onclick="event.preventDefault();document.getElementById('${id}_full').style.display='none';document.getElementById('${id}_short').style.display='inline'">less</a></span></span>`;
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

function dateRange(preset) {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  const fmt = dt => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  const t = fmt(d);
  switch (preset) {
    case 'today': return [t, t];
    case 'yesterday': { const y = new Date(d); y.setDate(y.getDate() - 1); return [fmt(y), fmt(y)]; }
    case 'last7': { const s = new Date(d); s.setDate(s.getDate() - 6); return [fmt(s), t]; }
    case 'last30': { const s = new Date(d); s.setDate(s.getDate() - 29); return [fmt(s), t]; }
    case 'this-month': return [`${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`, t];
    case 'last-month': { const lm = new Date(d.getFullYear(), d.getMonth() - 1, 1); const le = new Date(d.getFullYear(), d.getMonth(), 0); return [fmt(lm), fmt(le)]; }
    case 'this-year': return [`${d.getFullYear()}-01-01`, t];
    case 'last-year': return [`${d.getFullYear() - 1}-01-01`, `${d.getFullYear() - 1}-12-31`];
    default: return ['', ''];
  }
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

function typeBadge(type) {
  if (!type) return '';
  const map = {
    'Follow-up': 'badge-type-followup',
    'Delivery': 'badge-type-delivery',
    'Collect Payment': 'badge-type-payment',
    'Sampling': 'badge-type-sampling',
    'Event': 'badge-type-event',
    'Draft Cleaning': 'badge-type-cleaning',
    'Pre-Sale': 'badge-type-presale',
    'Other': 'badge-type-other',
  };
  return `<span class="badge ${map[type] || 'badge-type-other'}">${esc(type)}</span>`;
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
const STYLES  = ['IPA', 'Double IPA', 'Pale Ale', 'Lager', 'Pilsner', 'Wheat', 'Hefeweizen', 'Stout', 'Porter', 'Sour', 'Saison', 'Amber', 'Brown Ale', 'Barleywine', 'Scottish', 'English Mild', 'Kölsch', 'Golden Ale', 'Other'];

function inventoryForm(item = {}) {
  const isEdit = !!item.ID;
  const unitsField = isEdit
    ? `<input class="form-control" id="f-units" value="${esc(item.Units || '0')}" readonly style="background:#f5f5f5;cursor:default;color:var(--text-muted)" title="Use the Adjust button to change stock levels" />`
    : `<input class="form-control" id="f-units" type="number" min="0" value="0" />`;
  return `
    <div class="form-row">
      <div class="form-group">
        <label>Name <span class="required">*</span></label>
        <input class="form-control" id="f-name" value="${esc(item.Name)}" placeholder="e.g. Cascade IPA" />
      </div>
      <div class="form-group">
        <label>Location <span class="required">*</span></label>
        <select class="form-control" id="f-location">
          ${LOCATIONS.map(l => `<option value="${l}" ${(item.Location || state.location) === l ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
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
        <label>Units in Stock${isEdit ? ' <span class="text-muted text-sm">(adjust via Adjust button)</span>' : ' <span class="required">*</span>'}</label>
        ${unitsField}
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
  _paginationReset('inventory');
  showLoading();
  const locParam = state.location ? `?location=${encodeURIComponent(state.location)}` : '';
  const items = await api.get(`/api/inventory${locParam}`);
  state.inventory = items;
  renderInventory();
}

let _invSort = { col: 'Name', dir: 'asc' };

function sortInventory(col) {
  _paginationReset('inventory');
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

  const pg = paginate(filtered, 'inventory');

  const th = (label, colKey) => {
    const active = _invSort.col === colKey;
    const arrow = active ? (_invSort.dir === 'asc' ? ' ▲' : ' ▼') : '';
    return `<th class="sortable-th${active ? ' sorted' : ''}" onclick="sortInventory('${colKey}')">${label}${arrow}</th>`;
  };

  setContent(`
    <div class="view-header">
      <div>
        <h2>Inventory</h2>
        <p class="subtitle">${items.length} product${items.length !== 1 ? 's' : ''} at ${esc(state.location)}</p>
      </div>
      <div class="view-header-actions">
        <button class="btn btn-primary" onclick="openAddInventory()">+ Add Product</button>
      </div>
    </div>
    <div class="filter-bar">
      <input type="search" id="inv-search" placeholder="Search products..." value="${esc(search)}" oninput="_paginationReset('inventory'); renderInventory()" />
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
          ${pg.total === 0 ? `<tr><td colspan="8" class="empty-state">No products found. Add your first product!</td></tr>` :
            pg.rows.map(item => {
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
                  <button class="btn btn-ghost btn-sm" onclick="openAdjustInventory('${esc(item.ID)}')">Adjust</button>
                  <button class="btn btn-ghost btn-sm" onclick="openInventoryHistory('${esc(item.ID)}')">History</button>
                  <button class="btn btn-ghost btn-sm text-danger" onclick="deleteInventory('${esc(item.ID)}', '${esc(item.Name)}')">Delete</button>
                </td>
              </tr>`;
            }).join('')}
        </tbody>
      </table>
    </div>
    ${pg.total > 0 ? paginationControls('inventory', pg, 'renderInventory') : ''}`);
  if (_focused === 'inv-search') refocusSearch('inv-search');
}

function openAddInventory() {
  modal.open('Add Product', inventoryForm(), async () => {
    const name = val('f-name');
    if (!name) { toast('Name is required', 'error'); return; }
    await api.post('/api/inventory', {
      Name: name, Location: val('f-location'), Style: val('f-style'), ABV: val('f-abv'),
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
      Format: val('f-format'),
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

function openAdjustInventory(id) {
  const item = state.inventory.find(i => i.ID === id);
  if (!item) return;
  const label = item.Format ? `${item.Name} — ${item.Format}` : item.Name;
  modal.open('Adjust Stock', `
    <p class="text-muted text-sm" style="margin-bottom:16px">
      <strong>${esc(label)}</strong> &mdash; current stock: <strong>${esc(item.Units)} units</strong>
    </p>
    <div class="form-group">
      <label>Movement Type <span class="required">*</span></label>
      <select class="form-control" id="f-adj-type">
        <option value="received">Received (add stock)</option>
        <option value="write-off">Write-off (remove stock)</option>
        <option value="adjustment">Adjustment (remove stock)</option>
      </select>
    </div>
    <div class="form-group">
      <label>Quantity <span class="required">*</span></label>
      <input class="form-control" id="f-adj-qty" type="number" min="1" placeholder="e.g. 10" />
    </div>
    <div class="form-group">
      <label>Date</label>
      <input class="form-control" id="f-adj-date" type="date" value="${today()}" />
    </div>
    <div class="form-group">
      <label>Notes</label>
      <textarea class="form-control" id="f-adj-notes" rows="2" placeholder="Reason for adjustment..."></textarea>
    </div>`, async () => {
    const type = val('f-adj-type');
    const qty  = parseInt(val('f-adj-qty'));
    if (!qty || qty <= 0) { toast('Enter a valid quantity', 'error'); return; }
    const result = await api.post('/api/stock-movements', {
      inventoryId: id,
      type,
      quantity: qty,
      notes: val('f-adj-notes'),
      date:  val('f-adj-date'),
    });
    modal.close();
    toast(`Stock adjusted — new total: ${result.newUnits} units`);
    loadInventory();
  });
}

async function openInventoryHistory(id) {
  const item = state.inventory.find(i => i.ID === id);
  if (!item) return;
  const movements = await api.get(`/api/stock-movements?inventoryId=${encodeURIComponent(id)}`);
  const typeLabel = { sale: 'Sale', received: 'Received', 'write-off': 'Write-off', adjustment: 'Adjustment' };
  const rows = movements.length === 0
    ? `<tr><td colspan="5" class="empty-state">No stock movements recorded yet.</td></tr>`
    : movements.map(m => {
        const qty = parseInt(m.Quantity || 0);
        const sign = qty >= 0 ? '+' : '';
        const cls  = qty >= 0 ? 'text-success' : 'text-danger';
        return `<tr>
          <td class="text-sm">${formatDate(m.Date)}</td>
          <td><span class="badge badge-type-other">${typeLabel[m.Type] || esc(m.Type)}</span></td>
          <td class="fw-600 ${cls}">${sign}${qty}</td>
          <td class="text-sm text-muted">${m.OrderID ? 'Order' : '—'}</td>
          <td class="text-sm note-cell">${truncateNote(m.Notes)}</td>
        </tr>`;
      }).join('');
  modal.open(`Stock History — ${esc(item.Name)}`, `
    <p class="text-muted text-sm" style="margin-bottom:16px">Current stock: <strong>${esc(item.Units)} units</strong></p>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Date</th><th>Type</th><th>Qty</th><th>Source</th><th>Notes</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`, () => { modal.close(); }, 'Close');
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
  _paginationReset('accounts');
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

  const pg = paginate(filtered, 'accounts');

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
      <input type="search" id="acct-search" placeholder="Search accounts..." value="${esc(search)}" oninput="_paginationReset('accounts'); renderAccounts()" />
      <select id="acct-type" onchange="_paginationReset('accounts'); renderAccounts()">
        <option value="">All Types</option>
        ${ACCOUNT_TYPES.map(t => `<option value="${t}" ${typeFilter === t ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
      <select id="acct-status" onchange="_paginationReset('accounts'); renderAccounts()">
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
          ${pg.total === 0 ? `<tr><td colspan="9" class="empty-state">No accounts found.</td></tr>` :
            pg.rows.map(a => `<tr>
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
    </div>
    ${pg.total > 0 ? paginationControls('accounts', pg, 'renderAccounts') : ''}`);
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

  const [outreach, todos, orders, kegRecords] = await Promise.all([
    api.get('/api/outreach'),
    api.get('/api/reminders?status=all'),
    api.get('/api/orders'),
    api.get(`/api/keg-tracking?accountId=${accountId}`),
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

  // Keg tracking calculations
  const acctKegs = (kegRecords || []).sort((a, b) => (b.DeliveredDate || '').localeCompare(a.DeliveredDate || ''));
  const outstandingKegs = acctKegs.reduce((sum, k) => {
    const qty = parseInt(k.Quantity) || 0;
    const returned = parseInt(k.ReturnedQuantity) || 0;
    return sum + Math.max(0, qty - returned);
  }, 0);

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
        <td class="text-sm note-cell">${truncateNote(o.Notes)}</td>
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
        <td>${typeBadge(t.Type) || '—'}</td>
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
          <td class="text-center">${s.Delivered === 'true'
            ? '<input type="checkbox" checked disabled />'
            : `<input type="checkbox" onchange="profileToggleDelivered('${esc(s.ID)}')" />`}</td>
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

  const kegRows = acctKegs.length === 0
    ? `<tr><td colspan="7" class="empty-state">No keg deliveries recorded.</td></tr>`
    : acctKegs.map(k => {
        const qty = parseInt(k.Quantity) || 0;
        const returned = parseInt(k.ReturnedQuantity) || 0;
        const outstanding = Math.max(0, qty - returned);
        const fullyReturned = outstanding === 0;
        return `<tr class="${fullyReturned ? 'row-completed' : ''}">
          <td class="text-sm">${formatDate(k.DeliveredDate)}</td>
          <td class="fw-600">${esc(k.ProductName)}</td>
          <td class="text-sm">${esc(k.Format)}</td>
          <td class="text-center">${qty}</td>
          <td class="text-center">${returned}</td>
          <td class="text-center fw-600${outstanding > 0 ? ' text-danger' : ''}">${outstanding}</td>
          <td class="td-actions">
            ${outstanding > 0
              ? `<button class="btn btn-ghost btn-sm" onclick="openReturnKegs('${esc(k.ID)}', '${esc(k.ProductName)}', '${esc(k.Format)}', ${qty}, ${returned})">Return Kegs</button>`
              : '<span class="badge" style="background:#e8f5e9;color:#2e7d32">Returned</span>'}
          </td>
        </tr>`;
      }).join('');

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
      <div class="profile-stat"><div class="stat-value${outstandingKegs > 0 ? ' text-danger' : ''}">${outstandingKegs}</div><div class="stat-label">Kegs Out</div></div>
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

    <div class="profile-section">
      <div class="profile-section-header">
        <h3>Keg Tracking <span class="text-muted text-sm">(${outstandingKegs} outstanding)</span></h3>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Delivered</th><th>Product</th><th>Format</th><th class="text-center">Qty</th><th class="text-center">Returned</th><th class="text-center">Outstanding</th><th>Actions</th></tr></thead>
          <tbody>${kegRows}</tbody>
        </table>
      </div>
    </div>
  `);
}

function openReturnKegs(kegId, productName, format, totalQty, alreadyReturned) {
  const outstanding = totalQty - alreadyReturned;
  const formHtml = `
    <p class="text-muted text-sm" style="margin-bottom:16px">
      <strong>${esc(productName)} — ${esc(format)}</strong><br>
      Delivered: <strong>${totalQty}</strong> &mdash;
      Returned: <strong>${alreadyReturned}</strong> &mdash;
      Outstanding: <strong class="text-danger">${outstanding}</strong>
    </p>
    <div class="form-group">
      <label for="f-return-qty">Kegs Returned Now <span class="required">*</span></label>
      <input class="form-control" type="number" id="f-return-qty" min="1" max="${outstanding}" value="${outstanding}" />
    </div>
    <div class="form-group">
      <label for="f-return-notes">Notes</label>
      <input class="form-control" type="text" id="f-return-notes" placeholder="Optional notes" />
    </div>
  `;
  modal.open('Return Kegs', formHtml, async () => {
    const returnQty = parseInt(val('f-return-qty'));
    if (!returnQty || returnQty < 1 || returnQty > outstanding) {
      toast('Enter a valid return quantity (1–' + outstanding + ')', 'error');
      return;
    }
    const newReturnedTotal = alreadyReturned + returnQty;
    await api.put(`/api/keg-tracking/${kegId}`, {
      ReturnedQuantity: String(newReturnedTotal),
      ReturnedDate: new Date().toISOString().split('T')[0],
      Notes: val('f-return-notes') || '',
    });
    modal.close();
    toast(`${returnQty} keg${returnQty > 1 ? 's' : ''} marked as returned`);
    loadAccountProfile(state.accountProfileId);
  });
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
        <input type="checkbox" id="f-create-todo" style="margin-right:6px;" onchange="document.getElementById('todo-fields').style.display=this.checked?'':'none'" />
        Create a todo for this follow-up
      </label>
    </div>
    <div class="form-row" id="todo-fields" style="display:none">
      <div class="form-group">
        <label>Todo Type</label>
        <select class="form-control" id="f-todo-type">
          ${TODO_TYPES.map(t => `<option value="${t}" ${t === 'Follow-up' ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Assign To</label>
        <select class="form-control" id="f-todo-staff">
          <option value="">-- Unassigned --</option>
          ${staffOptions()}
        </select>
      </div>
    </div>`;
}

async function loadOutreach() {
  _paginationReset('outreach');
  showLoading();
  const [outreach, accounts, staff] = await Promise.all([api.get('/api/outreach'), api.get('/api/accounts'), api.get('/api/staff')]);
  state.outreach = outreach;
  state.accounts = accounts;
  state.staff = staff;
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

  const pg = paginate(filtered, 'outreach');

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
      <input type="search" id="out-search" placeholder="Search..." value="${esc(search)}" oninput="_paginationReset('outreach'); renderOutreach()" />
      <select id="out-account" onchange="_paginationReset('outreach'); renderOutreach()">${acctOpts}</select>
      <select id="out-method" onchange="_paginationReset('outreach'); renderOutreach()">
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
          ${pg.total === 0 ? `<tr><td colspan="6" class="empty-state">No outreach logged yet.</td></tr>` :
            pg.rows.map(o => `<tr>
              <td class="fw-600"><span class="td-link" onclick="loadAccountProfile('${esc(o.AccountID)}')">${esc(o.AccountName)}</span></td>
              <td>${formatDate(o.Date)}</td>
              <td>${methodBadge(o.Method)}</td>
              <td class="text-sm note-cell">${truncateNote(o.Notes)}</td>
              <td class="text-sm">${o.FollowUpDate ? formatDate(o.FollowUpDate) : '—'}</td>
              <td class="td-actions">
                <button class="btn btn-ghost btn-sm" onclick="openEditOutreach('${esc(o.ID)}')">Edit</button>
                <button class="btn btn-ghost btn-sm text-danger" onclick="deleteOutreach('${esc(o.ID)}')">Del</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${pg.total > 0 ? paginationControls('outreach', pg, 'renderOutreach') : ''}`);
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
      const todoType = val('f-todo-type') || 'Follow-up';
      const todoStaffId = val('f-todo-staff');
      const todoStaffName = todoStaffId ? (state.staff.find(s => s.ID === todoStaffId) || {}).Name || '' : '';
      await api.post('/api/reminders', {
        Type: todoType, AccountID: accountId, AccountName: accountName,
        Title: `Follow up with ${accountName}`,
        DueDate: followUpDate, Priority: 'Medium',
        Notes: `Re: outreach on ${val('f-date')}`,
        StaffID: todoStaffId, StaffName: todoStaffName,
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

const TODO_TYPES = ['Follow-up', 'Delivery', 'Collect Payment', 'Sampling', 'Event', 'Draft Cleaning', 'Pre-Sale', 'Other'];
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
let _todoStatusFilter = 'active';

async function loadTodos() {
  _paginationReset('todos');
  _todoStatusFilter = (document.getElementById('todo-status') || {}).value || _todoStatusFilter;
  showLoading();

  const [todos, accounts, staff] = await Promise.all([
    api.get(`/api/reminders?status=${_todoStatusFilter}`),
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
  const statusFilter = _todoStatusFilter;
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

  const pg = paginate(filtered, 'todos');

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
      <input type="search" id="todo-search" placeholder="Search todos..." value="${esc(search)}" oninput="_paginationReset('todos'); renderTodos()" />
      <select id="todo-status" onchange="_paginationReset('todos'); loadTodos()">
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
          ${pg.total === 0 ? `<tr><td colspan="8" class="empty-state">No todos found.</td></tr>` :
            pg.rows.map(r => `<tr>
              <td>${formatDate(r.DueDate)}</td>
              <td>${urgencyBadge(r.DueDate, r.Completed)}</td>
              <td class="fw-600"><span class="td-link" onclick="openEditTodo('${esc(r.ID)}')">${esc(r.Title)}</span>${r.Recurrence && r.Recurrence !== 'none' ? ` <span class="badge badge-recurrence" title="${esc(RECURRENCE_OPTIONS.find(o => o.value === r.Recurrence)?.label || r.Recurrence)}">↻</span>` : ''}</td>
              <td class="text-sm">${r.AccountID ? `<span class="td-link" onclick="loadAccountProfile('${esc(r.AccountID)}')">${esc(r.AccountName)}</span>` : '—'}</td>
              <td class="text-sm">${typeBadge(r.Type)}</td>
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
    </div>
    ${pg.total > 0 ? paginationControls('todos', pg, 'renderTodos') : ''}`);
  if (_focused === 'todo-search') refocusSearch('todo-search');
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
  const locParam = state.location ? `?location=${encodeURIComponent(state.location)}` : '';
  const [dash, accounts, staff, kegSummary, allOrders] = await Promise.all([
    api.get(`/api/dashboard${locParam}`),
    api.get('/api/accounts'),
    api.get('/api/staff'),
    api.get('/api/keg-tracking/summary'),
    api.get('/api/orders'),
  ]);
  state.accounts = accounts;
  state.staff = staff;
  state.dashTodos = [...(dash.overdueReminders || []), ...(dash.upcomingReminders || [])];

  // Pending deliveries: undelivered orders with a delivery date
  const pendingDeliveries = (allOrders || [])
    .filter(o => o.Delivered !== 'true' && o.DeliveryDate)
    .map(o => ({
      _type: 'delivery',
      ID: o.ID,
      Title: `Deliver order${o.InvoiceNumber ? ' #' + o.InvoiceNumber : ''} to ${o.AccountName || 'account'}`,
      DueDate: o.DeliveryDate,
      AccountID: o.AccountID,
      AccountName: o.AccountName,
      StaffID: o.StaffID || '',
      StaffName: o.StaffName || '',
      Completed: 'false',
      Type: 'Delivery',
    }));

  // Identify current staff member by matching email
  const currentStaff = staff.find(s => s.Email && s.Email === state.userEmail);
  const currentStaffId = currentStaff ? currentStaff.ID : null;

  // Split pending deliveries into overdue vs upcoming
  const overdueDeliveries = pendingDeliveries.filter(d => {
    const diff = daysFromToday(d.DueDate);
    return diff !== null && diff < 0;
  });
  const upcomingDeliveries = pendingDeliveries.filter(d => {
    const diff = daysFromToday(d.DueDate);
    return diff !== null && diff >= 0 && diff <= 7;
  });
  const allUpcoming = [...(dash.upcomingReminders || []), ...upcomingDeliveries]
    .sort((a, b) => (a.DueDate || '').localeCompare(b.DueDate || ''));
  const allOverdue = [...(dash.overdueReminders || []), ...overdueDeliveries]
    .sort((a, b) => (a.DueDate || '').localeCompare(b.DueDate || ''));

  // Build "My Todos" — overdue + upcoming assigned to current staff, including pending deliveries
  const myOverdue = currentStaffId ? allOverdue.filter(r => r.StaffID === currentStaffId) : [];
  const myUpcoming = currentStaffId ? allUpcoming.filter(r => r.StaffID === currentStaffId) : [];
  const myTodos = [...myOverdue, ...myUpcoming]
    .sort((a, b) => (a.DueDate || '').localeCompare(b.DueDate || ''));

  const lowStockHtml = dash.lowStockItems.length === 0
    ? '<li class="empty-state" style="padding:12px 0">All products are well stocked.</li>'
    : dash.lowStockItems.map(i => `
        <li class="clickable" onclick="navigate('inventory')">
          <span class="dash-label">${esc(i.Name)}</span>
          <span class="dash-meta">${esc(i.Units)} left (${esc(i.Format || 'units')})</span>
          <span class="badge badge-low-stock">Low</span>
        </li>`).join('');

  const upcomingHtml = allUpcoming.length === 0
    ? '<li class="empty-state" style="padding:12px 0">No upcoming todos or deliveries in the next 7 days.</li>'
    : allUpcoming.map(r => `
        <li class="clickable" onclick="${r.AccountID ? `loadAccountProfile('${esc(r.AccountID)}')` : `navigate('todos')`}">
          <div>
            ${urgencyBadge(r.DueDate, r.Completed)}
            ${typeBadge(r.Type)}
            <span class="dash-label">${esc(r.Title)}</span>
            ${r.AccountName ? `<span class="text-muted text-sm"> &mdash; ${esc(r.AccountName)}</span>` : ''}
          </div>
          <span class="dash-meta">${r.StaffName ? `${esc(r.StaffName)} · ` : ''}${formatDate(r.DueDate)}</span>
        </li>`).join('');

  const myTodosHtml = !currentStaffId
    ? '<li class="empty-state" style="padding:12px 0">No staff profile linked to your account.</li>'
    : myTodos.length === 0
      ? '<li class="empty-state" style="padding:12px 0">You have no upcoming todos or deliveries.</li>'
      : myTodos.map(r => `
          <li class="clickable" onclick="${r.AccountID ? `loadAccountProfile('${esc(r.AccountID)}')` : `navigate('todos')`}">
            <div>
              ${urgencyBadge(r.DueDate, r.Completed)}
              ${typeBadge(r.Type)}
              <span class="dash-label">${esc(r.Title)}</span>
              ${r.AccountName ? `<span class="text-muted text-sm"> &mdash; ${esc(r.AccountName)}</span>` : ''}
            </div>
            <span class="dash-meta">${formatDate(r.DueDate)}</span>
          </li>`).join('');

  const overdueHtml = allOverdue.length === 0 ? '' : `
    <div class="card">
      <div class="card-header"><h3 class="text-danger">Overdue (${allOverdue.length})</h3></div>
      <ul class="dash-list">
        ${allOverdue.map(r => `
          <li class="clickable" onclick="${r.AccountID ? `loadAccountProfile('${esc(r.AccountID)}')` : `navigate('todos')`}">
            ${urgencyBadge(r.DueDate, r.Completed)}
            ${typeBadge(r.Type)}
            <span class="dash-label">${esc(r.Title)}</span>
            ${r.AccountName ? `<span class="text-muted text-sm"> &mdash; ${esc(r.AccountName)}</span>` : ''}
            ${r._type !== 'delivery' ? `<button class="btn btn-ghost btn-sm text-success" onclick="event.stopPropagation();completeTodo('${esc(r.ID)}')">Done</button>` : ''}
          </li>`).join('')}
      </ul>
    </div>`;

  const recentHtml = dash.recentOutreach.length === 0
    ? '<li class="empty-state" style="padding:12px 0">No outreach logged yet.</li>'
    : dash.recentOutreach.map(o => `
        <li class="clickable" onclick="loadAccountProfile('${esc(o.AccountID)}')">
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

      <div class="card">
        <div class="card-header">
          <h3>Kegs Outstanding</h3>
          <button class="btn btn-ghost btn-sm" onclick="navigate('kegs')">View all</button>
        </div>
        <ul class="dash-list">${(kegSummary || []).length === 0
          ? '<li class="empty-state" style="padding:12px 0">No outstanding kegs.</li>'
          : (kegSummary || [])
              .sort((a, b) => b.outstanding - a.outstanding)
              .slice(0, 8)
              .map(k => `
                <li class="clickable" onclick="loadAccountProfile('${esc(k.accountId)}')">
                  <span class="dash-label">${esc(k.accountName)}</span>
                  <span class="badge badge-low-stock">${k.outstanding} keg${k.outstanding !== 1 ? 's' : ''}</span>
                </li>`).join('')}</ul>
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
  _paginationReset('staff');
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

  const pg = paginate(filtered, 'staff');

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
      <input type="search" id="staff-search" placeholder="Search staff..." value="${esc(search)}" oninput="_paginationReset('staff'); renderStaff()" />
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
          ${pg.total === 0 ? `<tr><td colspan="8" class="empty-state">No staff found. Add your first team member!</td></tr>` :
            pg.rows.map(s => `<tr>
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
    </div>
    ${pg.total > 0 ? paginationControls('staff', pg, 'renderStaff') : ''}`);
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
        <label>Location <span class="required">*</span></label>
        <select class="form-control" id="f-location">
          ${LOCATIONS.map(l => `<option value="${l}" ${(order.Location || state.location) === l ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
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
      <label>Notes / Reference</label>
      <textarea class="form-control" id="f-notes" rows="2" placeholder="Order details, product breakdown, etc.">${esc(order.Notes)}</textarea>
    </div>`;
}

let _ordersCache = [];
let _ordersDatePreset = '';
let _ordersDateFrom = '';
let _ordersDateTo = '';

function orderStatusBadge(status) {
  const map = { Pending: 'badge-pending', Paid: 'badge-paid', Cancelled: 'badge-cancelled' };
  return `<span class="badge ${map[status] || 'badge-pending'}">${esc(status || 'Pending')}</span>`;
}

function fmtMoney(val) {
  const n = parseFloat(val || 0);
  return isNaN(n) ? '—' : '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function loadOrders() {
  _paginationReset('orders');
  _ordersDatePreset = '';
  _ordersDateFrom = '';
  _ordersDateTo = '';
  showLoading();
  const locParam = state.location ? `?location=${encodeURIComponent(state.location)}` : '';
  const [orders, accounts, staff] = await Promise.all([
    api.get(`/api/orders${locParam}`),
    api.get('/api/accounts'),
    api.get('/api/staff'),
  ]);
  state.accounts = accounts;
  state.staff = staff;
  _ordersCache = orders;
  renderOrders();
}

function applyOrderDatePreset(preset) {
  _ordersDatePreset = preset;
  if (preset && preset !== 'custom') {
    const [from, to] = dateRange(preset);
    _ordersDateFrom = from;
    _ordersDateTo = to;
  } else if (preset === '') {
    _ordersDateFrom = '';
    _ordersDateTo = '';
  }
  _paginationReset('orders');
  renderOrders();
}

function renderOrders() {
  const orders = _ordersCache;
  const _focused = document.activeElement?.id;
  const accountFilter = (document.getElementById('orders-account') || {}).value || '';
  const staffFilter   = (document.getElementById('orders-staff') || {}).value || '';
  const statusFilter  = (document.getElementById('orders-status') || {}).value || '';
  const search        = (document.getElementById('orders-search') || {}).value || '';

  // Read date filter from DOM or fall back to state
  const datePreset = (document.getElementById('orders-date-preset') || {}).value || _ordersDatePreset;
  const dateFrom = (document.getElementById('orders-date-from') || {}).value || _ordersDateFrom;
  const dateTo = (document.getElementById('orders-date-to') || {}).value || _ordersDateTo;
  _ordersDatePreset = datePreset;
  _ordersDateFrom = dateFrom;
  _ordersDateTo = dateTo;

  let filtered = orders;
  if (accountFilter) filtered = filtered.filter(s => s.AccountID === accountFilter);
  if (staffFilter)   filtered = filtered.filter(s => s.StaffID === staffFilter);
  if (statusFilter)  filtered = filtered.filter(s => s.Status === statusFilter);
  if (dateFrom) filtered = filtered.filter(s => (s.OrderDate || '') >= dateFrom);
  if (dateTo)   filtered = filtered.filter(s => (s.OrderDate || '') <= dateTo);
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
  const pg = paginate(filtered, 'orders');

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
        <p class="subtitle">${orders.length} order${orders.length !== 1 ? 's' : ''} at ${esc(state.location)}</p>
      </div>
      <div class="view-header-actions">
        <button class="btn btn-primary" onclick="openAddOrder()">+ Log Order</button>
      </div>
    </div>
    <div class="filter-bar">
      <input type="search" id="orders-search" placeholder="Search account, invoice…" value="${esc(search)}" oninput="_paginationReset('orders'); renderOrders()" />
      <select id="orders-account" onchange="_paginationReset('orders'); renderOrders()">${acctOpts}</select>
      <select id="orders-staff" onchange="_paginationReset('orders'); renderOrders()">${staffOpts}</select>
      <select id="orders-status" onchange="_paginationReset('orders'); renderOrders()">
        <option value="">All Statuses</option>
        ${ORDER_STATUSES.map(s => `<option value="${s}" ${statusFilter === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
      <select id="orders-date-preset" onchange="applyOrderDatePreset(this.value)">
        <option value="" ${datePreset === '' ? 'selected' : ''}>All Dates</option>
        <option value="today" ${datePreset === 'today' ? 'selected' : ''}>Today</option>
        <option value="yesterday" ${datePreset === 'yesterday' ? 'selected' : ''}>Yesterday</option>
        <option value="last7" ${datePreset === 'last7' ? 'selected' : ''}>Last 7 Days</option>
        <option value="last30" ${datePreset === 'last30' ? 'selected' : ''}>Last 30 Days</option>
        <option value="this-month" ${datePreset === 'this-month' ? 'selected' : ''}>This Month</option>
        <option value="last-month" ${datePreset === 'last-month' ? 'selected' : ''}>Last Month</option>
        <option value="this-year" ${datePreset === 'this-year' ? 'selected' : ''}>This Year</option>
        <option value="last-year" ${datePreset === 'last-year' ? 'selected' : ''}>Last Year</option>
        <option value="custom" ${datePreset === 'custom' ? 'selected' : ''}>Custom Range</option>
      </select>
    </div>
    ${datePreset === 'custom' ? `
    <div class="filter-bar">
      <label class="text-sm text-muted" style="white-space:nowrap">From</label>
      <input type="date" class="form-control" id="orders-date-from" value="${esc(dateFrom)}" onchange="_paginationReset('orders'); renderOrders()" />
      <label class="text-sm text-muted" style="white-space:nowrap">To</label>
      <input type="date" class="form-control" id="orders-date-to" value="${esc(dateTo)}" onchange="_paginationReset('orders'); renderOrders()" />
    </div>` : ''}
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Order Date</th><th>Account</th><th>Invoice #</th><th>Sales Rep</th>
            <th>Order Amt</th><th>Tax</th><th>Total</th><th>Status</th><th>Delivered</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${pg.total === 0 ? `<tr><td colspan="10" class="empty-state">No orders found.</td></tr>` :
            pg.rows.map(s => {
              const total = parseFloat(s.OrderAmount || 0) + parseFloat(s.TaxAmount || 0);
              return `<tr>
                <td>${formatDate(s.OrderDate)}</td>
                <td class="fw-600"><span class="td-link" onclick="loadAccountProfile('${esc(s.AccountID)}')">${esc(s.AccountName)}</span></td>
                <td class="text-sm">${esc(s.InvoiceNumber) || '—'}</td>
                <td class="text-sm">${esc(s.StaffName) || '—'}</td>
                <td>${fmtMoney(s.OrderAmount)}</td>
                <td>${s.TaxAmount && parseFloat(s.TaxAmount) > 0 ? fmtMoney(s.TaxAmount) : '—'}</td>
                <td class="fw-600">${fmtMoney(total)}</td>
                <td>${orderStatusBadge(s.Status)}</td>
                <td class="text-center">${s.Delivered === 'true'
                  ? `<input type="checkbox" checked disabled title="${s.DeliveryDate ? formatDate(s.DeliveryDate) : 'Delivered'}" />`
                  : `<input type="checkbox" onchange="toggleDelivered('${esc(s.ID)}')" />`}</td>
                <td class="td-actions">
                  ${s.Status === 'Pending' ? `<button class="btn btn-ghost btn-sm text-success" onclick="markOrderPaid('${esc(s.ID)}')">Paid</button>` : ''}
                  <button class="btn btn-ghost btn-sm" onclick="openEditOrder('${esc(s.ID)}')">Edit</button>
                  <button class="btn btn-ghost btn-sm text-danger" onclick="deleteOrder('${esc(s.ID)}')">Del</button>
                </td>
              </tr>`;
            }).join('')}
        </tbody>
        ${pg.total > 1 ? `
        <tfoot>
          <tr class="table-totals">
            <td colspan="4" class="text-muted text-sm">${pg.total} records</td>
            <td>${fmtMoney(totalOrder)}</td>
            <td>${fmtMoney(totalTax)}</td>
            <td class="fw-600">${fmtMoney(totalOrder + totalTax)}</td>
            <td colspan="3"></td>
          </tr>
        </tfoot>` : ''}
      </table>
    </div>
    ${pg.total > 0 ? paginationControls('orders', pg, 'renderOrders') : ''}`);
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
      Location: val('f-location') || state.location,
      StaffID: staffId, StaffName: staffName,
      OrderDate: orderDate, DeliveryDate: val('f-delivery-date'),
      InvoiceNumber: val('f-invoice'), Status: val('f-status'),
      OrderAmount: val('f-amount'), TaxAmount: val('f-tax'),
      Notes: val('f-notes'),
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
      Location: val('f-location') || state.location,
      StaffID: staffId, StaffName: staffName,
      OrderDate: val('f-order-date'), DeliveryDate: val('f-delivery-date'),
      InvoiceNumber: val('f-invoice'), Status: val('f-status'),
      OrderAmount: val('f-amount'), TaxAmount: val('f-tax'),
      Notes: val('f-notes'),
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
  await openDeliveryConfirmModal(id, order, loadOrders);
}

async function profileMarkOrderPaid(id) {
  await api.put(`/api/orders/${id}`, { Status: 'Paid' });
  toast('Order marked as paid');
  loadAccountProfile(state.accountProfileId);
}

async function profileToggleDelivered(id) {
  const orders = await api.get(`/api/orders?accountId=${encodeURIComponent(state.accountProfileId)}`);
  const order = orders.find(s => s.ID === id);
  if (!order) return;
  await openDeliveryConfirmModal(id, order, () => loadAccountProfile(state.accountProfileId));
}

async function openDeliveryConfirmModal(orderId, order, onComplete) {
  const locQuery = order.Location ? `?location=${encodeURIComponent(order.Location)}` : '';
  const items = await api.get(`/api/inventory${locQuery}`);
  const acctName = order.AccountName || '';
  const invLabel = order.InvoiceNumber ? ` — Invoice #${esc(order.InvoiceNumber)}` : '';

  if (!items.length) {
    modal.confirm('Confirm Delivery',
      `No inventory products are configured for ${order.Location || 'this location'}. Mark this order as delivered without recording stock movements?`,
      async () => {
        await api.put(`/api/orders/${orderId}`, { Delivered: 'true' });
        modal.close();
        toast('Order marked as delivered');
        onComplete();
      });
    return;
  }

  const inStock = items.filter(i => parseInt(i.Units || '0') > 0);
  const outOfStock = items.filter(i => parseInt(i.Units || '0') <= 0);
  const delivRow = (item, hidden) => `<tr data-stock="${hidden ? 'out' : 'in'}"${hidden ? ' style="display:none"' : ''}>
            <td class="fw-600">${esc(item.Name)}</td>
            <td class="text-sm">${esc(item.Format) || '—'}</td>
            <td class="text-sm">${esc(item.Units)}</td>
            <td><input class="form-control" type="number" min="0" max="${parseInt(item.Units || '0')}" value="0"
                 id="deliv-qty-${item.ID}" style="width:80px" /></td>
          </tr>`;

  modal.open('Confirm Delivery', `
    <p class="text-muted text-sm" style="margin-bottom:16px">
      Confirming delivery for <strong>${esc(acctName)}</strong>${invLabel}.
      Enter the quantity delivered for each product (leave at 0 to skip).
    </p>
    <div class="table-wrap" style="margin-bottom:16px">
      <table>
        <thead><tr><th>Product</th><th>Format</th><th>In Stock</th><th>Qty Delivered</th></tr></thead>
        <tbody>
          ${inStock.map(i => delivRow(i, false)).join('')}
          ${outOfStock.map(i => delivRow(i, true)).join('')}
        </tbody>
      </table>
    </div>
    ${outOfStock.length ? `<div class="form-group">
      <label style="cursor:pointer">
        <input type="checkbox" id="deliv-show-oos" style="margin-right:6px"
          onchange="document.querySelectorAll('#modal-overlay tr[data-stock=out]').forEach(r=>r.style.display=this.checked?'':'none')" />
        Show out-of-stock products (${outOfStock.length})
      </label>
    </div>` : ''}
    <div class="form-group">
      <label>Delivery Notes</label>
      <textarea class="form-control" id="deliv-notes" rows="2" placeholder="Optional notes..."></textarea>
    </div>`, async () => {
    const delivItems = items
      .map(item => ({
        inventoryId: item.ID,
        name: item.Name,
        stock: parseInt(item.Units || '0'),
        quantity: parseInt(document.getElementById(`deliv-qty-${item.ID}`)?.value || '0'),
      }))
      .filter(i => i.quantity > 0);
    const overStock = delivItems.find(i => i.quantity > i.stock);
    if (overStock) { toast(`${overStock.name} only has ${overStock.stock} in stock`, 'error'); return; }
    const notes = (document.getElementById('deliv-notes')?.value || '').trim();
    await api.post('/api/stock-movements/bulk', {
      orderId,
      items: delivItems,
      notes,
      date: today(),
    });
    modal.close();
    toast('Delivery confirmed');
    onComplete();
  }, 'Confirm Delivery');
}

// ── Settings View ─────────────────────────────────────────────────

async function loadSettings() {
  showLoading();
  const settings = await api.get('/api/settings');
  state.settings = settings;
  renderSettings();
}

function renderSettings() {
  const s = state.settings;
  const companyName = s.companyName || '';
  const locations = Array.isArray(s.locations) ? s.locations : [...LOCATIONS];

  setContent(`
    <div class="view-header">
      <div>
        <h2>Settings</h2>
        <p class="subtitle">Manage application configuration</p>
      </div>
    </div>

    <div class="settings-grid">
      <div class="card">
        <div class="card-header"><h3>Company</h3></div>
        <div style="padding:0 18px 18px">
          <div class="form-group">
            <label>Company Name</label>
            <input class="form-control" id="settings-company-name" value="${esc(companyName)}" placeholder="e.g. My Brewery" />
          </div>
          <button class="btn btn-primary" onclick="saveCompanyName()">Save</button>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>Locations</h3>
          <button class="btn btn-ghost btn-sm" onclick="openAddLocation()">+ Add Location</button>
        </div>
        <div style="padding:0 18px 18px">
          <p class="text-sm text-muted" style="margin-bottom:12px">
            Manage warehouse and distribution locations. These appear in the sidebar switcher and in inventory/order forms.
          </p>
          ${locations.length === 0
            ? '<p class="empty-state">No locations configured.</p>'
            : `<ul class="settings-location-list">
                ${locations.map((loc, i) => `
                  <li class="settings-location-item">
                    <span class="settings-location-name">${esc(loc)}</span>
                    <div class="settings-location-actions">
                      <button class="btn btn-ghost btn-sm" onclick="openRenameLocation(${i}, '${esc(loc)}')">Rename</button>
                      <button class="btn btn-ghost btn-sm text-danger" onclick="removeLocation(${i}, '${esc(loc)}')">Remove</button>
                    </div>
                  </li>`).join('')}
              </ul>`
          }
        </div>
      </div>
    </div>`);
}

function saveCompanyName() {
  const name = val('settings-company-name');
  api.put('/api/settings', { companyName: name }).then(updated => {
    state.settings = updated;
    applySettings(updated);
    toast('Company name saved');
  }).catch(err => toast(err.message, 'error'));
}

function openAddLocation() {
  modal.open('Add Location', `
    <div class="form-group">
      <label>Location Name <span class="required">*</span></label>
      <input class="form-control" id="f-location-name" placeholder="e.g. Kansas City" />
    </div>
  `, async () => {
    const name = val('f-location-name');
    if (!name) { toast('Location name is required', 'error'); return; }
    const current = Array.isArray(state.settings.locations) ? [...state.settings.locations] : [...LOCATIONS];
    if (current.includes(name)) { toast('Location already exists', 'error'); return; }
    current.push(name);
    const updated = await api.put('/api/settings', { locations: current });
    state.settings = updated;
    applySettings(updated);
    modal.close();
    toast('Location added');
    renderSettings();
  });
}

function openRenameLocation(index, oldName) {
  modal.open('Rename Location', `
    <div class="form-group">
      <label>New Name <span class="required">*</span></label>
      <input class="form-control" id="f-location-name" value="${esc(oldName)}" />
    </div>
    <p class="text-sm text-muted" style="margin-top:8px">All inventory and order records at this location will be updated.</p>
  `, async () => {
    const newName = val('f-location-name');
    if (!newName) { toast('Location name is required', 'error'); return; }
    const current = Array.isArray(state.settings.locations) ? [...state.settings.locations] : [...LOCATIONS];
    if (current.includes(newName) && newName !== oldName) { toast('Location already exists', 'error'); return; }
    current[index] = newName;
    const updated = await api.put('/api/settings/rename-location', { oldName, newName, locations: current });
    state.settings = updated;
    applySettings(updated);
    if (state.location === oldName) {
      state.location = newName;
      localStorage.setItem('brewLocation', newName);
    }
    state.inventory = []; // clear cached inventory
    modal.close();
    const info = updated._renamed || {};
    toast(`Location renamed — ${info.inventoryUpdated || 0} product(s) and ${info.ordersUpdated || 0} order(s) updated`);
    renderSettings();
  });
}

function removeLocation(index, name) {
  const current = Array.isArray(state.settings.locations) ? [...state.settings.locations] : [...LOCATIONS];
  if (current.length <= 1) { toast('At least one location is required', 'error'); return; }
  modal.confirm('Remove Location', `Remove "${name}"? Existing inventory and orders at this location will not be affected.`, async () => {
    current.splice(index, 1);
    const updated = await api.put('/api/settings', { locations: current });
    state.settings = updated;
    applySettings(updated);
    if (state.location === name && current.length > 0) {
      state.location = current[0];
      localStorage.setItem('brewLocation', current[0]);
    }
    modal.close();
    toast('Location removed');
    renderSettings();
  });
}

// ── Kegs View ─────────────────────────────────────────────────────

let _kegsCache = [];
let _kegsStatusFilter = 'outstanding';

async function loadKegs() {
  _paginationReset('kegs');
  showLoading();
  _kegsCache = await api.get('/api/keg-tracking');
  renderKegs();
}

function renderKegs() {
  const _focused = document.activeElement?.id;
  const search = (document.getElementById('kegs-search') || {}).value || '';
  const statusFilter = _kegsStatusFilter;

  let filtered = _kegsCache;

  // Status filter
  if (statusFilter === 'outstanding') {
    filtered = filtered.filter(k => {
      const qty = parseInt(k.Quantity) || 0;
      const returned = parseInt(k.ReturnedQuantity) || 0;
      return qty - returned > 0;
    });
  }

  // Search filter
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(r =>
      (r.AccountName || '').toLowerCase().includes(q) ||
      (r.ProductName || '').toLowerCase().includes(q) ||
      (r.Format || '').toLowerCase().includes(q)
    );
  }

  // Sort: outstanding first (by delivered date descending)
  filtered.sort((a, b) => {
    const aOut = Math.max(0, (parseInt(a.Quantity) || 0) - (parseInt(a.ReturnedQuantity) || 0));
    const bOut = Math.max(0, (parseInt(b.Quantity) || 0) - (parseInt(b.ReturnedQuantity) || 0));
    if (aOut > 0 && bOut === 0) return -1;
    if (aOut === 0 && bOut > 0) return 1;
    return (b.DeliveredDate || '').localeCompare(a.DeliveredDate || '');
  });

  const totalOutstanding = _kegsCache.reduce((sum, k) => {
    const qty = parseInt(k.Quantity) || 0;
    const returned = parseInt(k.ReturnedQuantity) || 0;
    return sum + Math.max(0, qty - returned);
  }, 0);

  const pg = paginate(filtered, 'kegs');

  const rows = pg.total === 0
    ? `<tr><td colspan="8" class="empty-state">No keg records found.</td></tr>`
    : pg.rows.map(k => {
        const qty = parseInt(k.Quantity) || 0;
        const returned = parseInt(k.ReturnedQuantity) || 0;
        const outstanding = Math.max(0, qty - returned);
        const fullyReturned = outstanding === 0;
        return `<tr class="${fullyReturned ? 'row-completed' : ''}">
          <td class="fw-600"><span class="td-link" onclick="loadAccountProfile('${esc(k.AccountID)}')">${esc(k.AccountName)}</span></td>
          <td>${esc(k.ProductName)}</td>
          <td class="text-sm">${esc(k.Format)}</td>
          <td class="text-sm">${formatDate(k.DeliveredDate)}</td>
          <td class="text-center">${qty}</td>
          <td class="text-center">${returned}</td>
          <td class="text-center fw-600${outstanding > 0 ? ' text-danger' : ''}">${outstanding}</td>
          <td class="td-actions">
            ${outstanding > 0
              ? `<button class="btn btn-ghost btn-sm" onclick="openReturnKegs('${esc(k.ID)}', '${esc(k.ProductName)}', '${esc(k.Format)}', ${qty}, ${returned})">Return</button>`
              : '<span class="badge" style="background:#e8f5e9;color:#2e7d32">Returned</span>'}
          </td>
        </tr>`;
      }).join('');

  setContent(`
    <div class="view-header">
      <div>
        <h2>Keg Tracking</h2>
        <p class="subtitle">${totalOutstanding} outstanding keg${totalOutstanding !== 1 ? 's' : ''} &mdash; ${filtered.length} record${filtered.length !== 1 ? 's' : ''}</p>
      </div>
    </div>

    <div class="filter-bar">
      <input type="search" id="kegs-search" placeholder="Search accounts or products…" value="${esc(search)}"
             oninput="_paginationReset('kegs'); renderKegs()" />
      <select id="kegs-status" onchange="_kegsStatusFilter=this.value; _paginationReset('kegs'); renderKegs()">
        <option value="outstanding"${statusFilter === 'outstanding' ? ' selected' : ''}>Outstanding Only</option>
        <option value="all"${statusFilter === 'all' ? ' selected' : ''}>All Records</option>
      </select>
    </div>

    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Account</th><th>Product</th><th>Format</th><th>Delivered</th>
          <th class="text-center">Qty</th><th class="text-center">Returned</th><th class="text-center">Outstanding</th><th>Actions</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${pg.total > 0 ? paginationControls('kegs', pg, 'renderKegs') : ''}`);

  if (_focused === 'kegs-search') refocusSearch('kegs-search');
}

// ── Navigation ────────────────────────────────────────────────────

const VIEW_LOADERS = {
  dashboard: loadDashboard,
  inventory: loadInventory,
  accounts:  loadAccounts,
  outreach:  loadOutreach,
  todos: loadTodos,
  orders:    loadOrders,
  kegs:      loadKegs,
  staff:     loadStaff,
  settings:  loadSettings,
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
