'use strict';

// ── State ────────────────────────────────────────────────────────
let LOCATIONS = [];      // Populated from settings on init
let ACCOUNT_TAGS = [];   // Populated from settings on init

const FORMATS = ['1/6 Keg', '1/4 Keg', '1/2 Keg', '12oz Can (case/24)', '16oz Can (case/24)', '22oz Bottle (case/12)', '750ml Bottle (case/12)', 'Other'];
const STYLES  = ['IPA', 'Double IPA', 'Pale Ale', 'Lager', 'Pilsner', 'Wheat', 'Hefeweizen', 'Stout', 'Porter', 'Sour', 'Saison', 'Amber', 'Brown Ale', 'Barleywine', 'Scottish', 'English Mild', 'Kölsch', 'Golden Ale', 'Other'];

const state = {
  view: 'dashboard',
  location: localStorage.getItem('brewLocation') || LOCATIONS[0],
  accounts: [],      // cached for select dropdowns
  inventory: [],
  staff: [],         // cached for staff dropdowns
  settings: {},
  emailConfigured: false,
  userName: '',
};

// ── Pagination ──────────────────────────────────────────────────
const _pagination = {
  products:  { page: 1, perPage: 25 },
  inventory: { page: 1, perPage: 25 },
  accounts:  { page: 1, perPage: 25 },
  outreach:  { page: 1, perPage: 25 },
  todos:     { page: 1, perPage: 25 },
  staff:     { page: 1, perPage: 25 },
  orders:    { page: 1, perPage: 25 },
  kegs:       { page: 1, perPage: 25 },
  tapHandles: { page: 1, perPage: 25 },
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

function dateOnly(d) {
  return d ? d.substring(0, 10) : '';
}

function formatDate(d) {
  if (!d) return '—';
  const ds = dateOnly(d);
  const [y, m, day] = ds.split('-');
  if (!y || !m || !day) return d;
  return `${m}/${day}/${y}`;
}

function formatPhone(p) {
  if (!p) return '';
  const digits = p.replace(/\D/g, '');
  if (digits.length === 10) return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits[0] === '1') return `(${digits.slice(1,4)}) ${digits.slice(4,7)}-${digits.slice(7)}`;
  return p; // Return as-is if not a standard US number
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

// ── Badges ───────────────────────────────────────────────────────

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

function orderStatusBadge(status) {
  const map = { 'Pre-Sale': 'badge-pre-sale', Pending: 'badge-pending', Paid: 'badge-paid', Cancelled: 'badge-cancelled' };
  return `<span class="badge ${map[status] || 'badge-pending'}">${esc(status || 'Pending')}</span>`;
}

function fmtMoney(val) {
  const n = parseFloat(val || 0);
  return isNaN(n) ? '—' : '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── UI Helpers ───────────────────────────────────────────────────

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
  _trapFocus: null,

  open(title, bodyHtml, onSubmit, submitLabel = 'Save') {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = bodyHtml;
    document.getElementById('modal-submit-btn').textContent = submitLabel;
    document.getElementById('modal-submit-btn').className = 'btn btn-primary';
    document.getElementById('modal-overlay').classList.remove('hidden');
    modal._onSubmit = onSubmit;

    // Trap focus within the modal
    if (modal._trapFocus) document.getElementById('modal-overlay').removeEventListener('keydown', modal._trapFocus);
    modal._trapFocus = function(e) {
      if (e.key !== 'Tab') return;
      const focusable = document.querySelectorAll('#modal-box button, #modal-box input:not([type="hidden"]), #modal-box select, #modal-box textarea');
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last  = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.getElementById('modal-overlay').addEventListener('keydown', modal._trapFocus);

    // Focus first input
    const first = document.querySelector('#modal-body input:not([type="hidden"]), #modal-body select, #modal-body textarea');
    if (first) first.focus();
  },

  close() {
    document.getElementById('modal-overlay').classList.add('hidden');
    modal._onSubmit = null;
    if (modal._trapFocus) {
      document.getElementById('modal-overlay').removeEventListener('keydown', modal._trapFocus);
      modal._trapFocus = null;
    }
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
