'use strict';

// ── Sales Export Module ────────────────────────────────────────────

let _sePreset = 'this-month';
let _seStart = '';
let _seEnd = '';
let _seData = null;
let _seSort = { col: 'orderDate', dir: 'asc' };
let _seExcludeTypes = [];

async function loadSalesExport() {
  if (_sePreset !== 'custom') {
    const [s, e] = dateRange(_sePreset);
    _seStart = s;
    _seEnd = e;
  }
  if (!_seStart || !_seEnd) {
    const [s, e] = dateRange('this-month');
    _seStart = s;
    _seEnd = e;
  }

  const params = new URLSearchParams({ start: _seStart, end: _seEnd });
  if (state.location) params.set('location', state.location);
  if (_seExcludeTypes.length) params.set('excludeTypes', _seExcludeTypes.join(','));

  showLoading();

  try {
    _seData = await api.get('/api/sales-export?' + params.toString());
    _paginationReset('salesExport');
    renderSalesExport();
  } catch (err) {
    setContent(`<div class="empty-state text-danger" style="padding:40px">Error loading sales export: ${esc(err.message)}</div>`);
  }
}

function renderSalesExport() {
  const data = _seData;
  if (!data) return;

  const presetOptions = [
    ['this-month', 'This Month'],
    ['last-month', 'Last Month'],
    ['last7', 'Last 7 Days'],
    ['last30', 'Last 30 Days'],
    ['this-year', 'This Year'],
    ['last-year', 'Last Year'],
    ['custom', 'Custom Range'],
  ];

  const customInputs = _sePreset === 'custom'
    ? ` <input type="date" id="se-start" value="${esc(_seStart)}" onchange="_seCustomDate()">
       <input type="date" id="se-end" value="${esc(_seEnd)}" onchange="_seCustomDate()">`
    : '';

  const t = data.totals;

  // Sort orders
  const sorted = _seSortOrders(data.orders);

  // Paginate
  const pg = paginate(sorted, 'salesExport');

  const sortIcon = (col) => {
    if (_seSort.col !== col) return '';
    return _seSort.dir === 'asc' ? ' &#9650;' : ' &#9660;';
  };

  const fmtMoney = (v) => '$' + v.toFixed(2);

  setContent(`
    <div class="view-header">
      <div>
        <h2>Sales Export (ABC-73)</h2>
        <div class="subtitle">${esc(formatDate(_seStart))} — ${esc(formatDate(_seEnd))}</div>
      </div>
      <div class="view-header-actions">
        <button class="btn btn-secondary" onclick="_seExportCsv()">Export CSV</button>
      </div>
    </div>

    <div class="filter-bar">
      <select id="se-preset" onchange="_sePresetChange(this.value)">
        ${presetOptions.map(([v, l]) => `<option value="${v}" ${v === _sePreset ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      ${customInputs}
      <div class="dropdown-multi" id="se-type-filter">
        <button class="btn btn-secondary btn-sm" onclick="_seToggleTypeDropdown()" type="button">
          Account Types${_seExcludeTypes.length ? ` (${_seExcludeTypes.length} excluded)` : ''}
        </button>
        <div class="dropdown-multi-menu" id="se-type-menu" style="display:none">
          ${(data.meta && data.meta.availableTypes || []).map(t => `<label class="dropdown-multi-item">
            <input type="checkbox" value="${esc(t)}" ${_seExcludeTypes.includes(t) ? 'checked' : ''} onchange="_seToggleExcludeType(this.value, this.checked)">
            <span>Exclude ${esc(t)}</span>
          </label>`).join('')}
        </div>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${data.count}</div>
        <div class="stat-label">Total Orders</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${fmtMoney(t.subtotal)}</div>
        <div class="stat-label">Subtotal</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${fmtMoney(t.tax)}</div>
        <div class="stat-label">Tax</div>
      </div>
      <div class="stat-card accent">
        <div class="stat-value">${fmtMoney(t.total)}</div>
        <div class="stat-label">Total</div>
      </div>
    </div>

    <div class="card full-width" style="margin-top:var(--space-4)">
      <div class="card-header"><h3>Orders</h3><span class="text-muted text-sm">${data.count} orders</span></div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="sortable" onclick="_seSortBy('orderDate')" style="cursor:pointer">Date${sortIcon('orderDate')}</th>
              <th class="sortable" onclick="_seSortBy('invoiceNumber')" style="cursor:pointer">Invoice #${sortIcon('invoiceNumber')}</th>
              <th class="sortable" onclick="_seSortBy('accountName')" style="cursor:pointer">Customer${sortIcon('accountName')}</th>
              <th>ABC License</th>
              <th>Address</th>
              <th class="sortable" onclick="_seSortBy('subtotal')" style="cursor:pointer">Subtotal${sortIcon('subtotal')}</th>
              <th class="sortable" onclick="_seSortBy('tax')" style="cursor:pointer">Tax${sortIcon('tax')}</th>
              <th class="sortable" onclick="_seSortBy('total')" style="cursor:pointer">Total${sortIcon('total')}</th>
            </tr>
          </thead>
          <tbody>
            ${pg.rows.length === 0
              ? '<tr><td colspan="8" class="empty-state">No orders found</td></tr>'
              : pg.rows.map(o => `<tr>
                <td>${esc(formatDate(o.orderDate))}</td>
                <td>${esc(o.invoiceNumber)}</td>
                <td>${esc(o.accountName)}</td>
                <td>${esc(o.abcLicense)}</td>
                <td>${esc([o.address, o.city, o.state, o.zip].filter(Boolean).join(', '))}</td>
                <td>${fmtMoney(o.subtotal)}</td>
                <td>${fmtMoney(o.tax)}</td>
                <td>${fmtMoney(o.total)}</td>
              </tr>`).join('')}
          </tbody>
          ${pg.rows.length > 0 ? `<tfoot>
            <tr style="font-weight:bold">
              <td colspan="5">Totals</td>
              <td>${fmtMoney(t.subtotal)}</td>
              <td>${fmtMoney(t.tax)}</td>
              <td>${fmtMoney(t.total)}</td>
            </tr>
          </tfoot>` : ''}
        </table>
      </div>
      ${paginationControls('salesExport', pg, 'renderSalesExport')}
    </div>
  `);

  // Close dropdown on outside click
  document.addEventListener('click', _seCloseDropdown);
}

function _seCloseDropdown(e) {
  const filter = document.getElementById('se-type-filter');
  const menu = document.getElementById('se-type-menu');
  if (menu && filter && !filter.contains(e.target)) {
    menu.style.display = 'none';
  }
}

// ── Sorting ──────────────────────────────────────────────────────

function _seSortOrders(orders) {
  const { col, dir } = _seSort;
  const mult = dir === 'asc' ? 1 : -1;
  return [...orders].sort((a, b) => {
    const av = a[col], bv = b[col];
    if (typeof av === 'string') return mult * av.localeCompare(bv);
    return mult * (av - bv);
  });
}

function _seSortBy(col) {
  if (_seSort.col === col) {
    _seSort.dir = _seSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    _seSort.col = col;
    _seSort.dir = (col === 'accountName' || col === 'invoiceNumber') ? 'asc' : 'desc';
  }
  renderSalesExport();
}

// ── Date controls ────────────────────────────────────────────────

function _sePresetChange(preset) {
  _sePreset = preset;
  if (preset !== 'custom') {
    loadSalesExport();
  } else {
    renderSalesExport();
  }
}

function _seCustomDate() {
  const s = val('se-start');
  const e = val('se-end');
  if (s && e && s <= e) {
    _seStart = s;
    _seEnd = e;
    loadSalesExport();
  }
}

// ── Account type filter ──────────────────────────────────────────

function _seToggleTypeDropdown() {
  const menu = document.getElementById('se-type-menu');
  if (menu) menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
}

function _seToggleExcludeType(type, checked) {
  if (checked && !_seExcludeTypes.includes(type)) {
    _seExcludeTypes.push(type);
  } else if (!checked) {
    _seExcludeTypes = _seExcludeTypes.filter(t => t !== type);
  }
  loadSalesExport();
}

// ── CSV Export ────────────────────────────────────────────────────

function _seExportCsv() {
  if (!_seData) return;
  const d = _seData;
  const lines = [];

  lines.push('Invoice Date,Invoice ID,Customer Name,ABC License #,Address,Subtotal,Tax,Total');
  for (const o of d.orders) {
    const addr = [o.address, o.city, o.state, o.zip].filter(Boolean).join(', ');
    lines.push([
      o.orderDate,
      `"${o.invoiceNumber}"`,
      `"${o.accountName}"`,
      `"${o.abcLicense}"`,
      `"${addr}"`,
      o.subtotal.toFixed(2),
      o.tax.toFixed(2),
      o.total.toFixed(2),
    ].join(','));
  }
  lines.push(`,,,,,${d.totals.subtotal.toFixed(2)},${d.totals.tax.toFixed(2)},${d.totals.total.toFixed(2)}`);

  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `abc73_sales_export_${_seStart}_${_seEnd}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
