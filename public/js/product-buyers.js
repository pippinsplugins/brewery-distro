'use strict';

// ── Product Buyers Report ─────────────────────────────────────────
// Shows accounts that purchased one or more selected products in a
// date range, optionally narrowed by format and location. Pre-sales
// and cancelled orders are excluded on the server (matches other
// reports). Lets the operator get a clean contact list for anything
// from recall notifications to targeted marketing follow-ups.

let _pbData = null;
let _pbProductOptions = [];      // All products available in picker (loaded once per view).
let _pbSelectedProducts = new Set();
let _pbSelectedFormats = new Set();
let _pbPreset = 'last-month';
let _pbStart = '';
let _pbEnd = '';
let _pbSearch = '';
let _pbSort = { col: 'totalUnits', dir: 'desc' };

async function loadProductBuyers() {
  showLoading();

  // Load product list once per session so the picker has options.
  if (_pbProductOptions.length === 0) {
    try {
      const products = await api.get('/api/products');
      _pbProductOptions = products
        .map(p => p.Name)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
    } catch (err) {
      setContent(`<div class="empty-state text-danger" style="padding:40px">Error loading products: ${esc(err.message)}</div>`);
      return;
    }
  }

  // Compute date range from preset.
  if (_pbPreset !== 'custom') {
    const [s, e] = dateRange(_pbPreset);
    _pbStart = s;
    _pbEnd = e;
  }
  if (!_pbStart || !_pbEnd) {
    const [s, e] = dateRange('last-month');
    _pbStart = s;
    _pbEnd = e;
  }

  // Nothing to query without product selection — render the picker UI
  // and wait for the operator to pick products + hit Run.
  if (_pbSelectedProducts.size === 0) {
    _pbData = null;
    renderProductBuyers();
    return;
  }

  try {
    const params = new URLSearchParams({
      productNames: [..._pbSelectedProducts].join(','),
      start: _pbStart,
      end: _pbEnd,
    });
    if (_pbSelectedFormats.size > 0) params.set('formats', [..._pbSelectedFormats].join(','));
    if (state.location) params.set('location', state.location);
    _pbData = await api.get('/api/product-buyers?' + params.toString());
    _paginationReset('productBuyers');
    renderProductBuyers();
  } catch (err) {
    setContent(`<div class="empty-state text-danger" style="padding:40px">Error loading report: ${esc(err.message)}</div>`);
  }
}

function renderProductBuyers() {
  const liveSearch = document.getElementById('pb-search');
  if (liveSearch) _pbSearch = liveSearch.value;

  const presetOptions = [
    ['last7', 'Last 7 Days'],
    ['last30', 'Last 30 Days'],
    ['this-month', 'This Month'],
    ['last-month', 'Last Month'],
    ['this-year', 'This Year'],
    ['last-year', 'Last Year'],
    ['custom', 'Custom Range'],
  ];

  const customInputs = _pbPreset === 'custom'
    ? ` <input type="date" id="pb-start" value="${esc(_pbStart)}" onchange="_pbCustomDate()">
       <input type="date" id="pb-end" value="${esc(_pbEnd)}" onchange="_pbCustomDate()">`
    : '';

  const selectedProductLabel = _pbSelectedProducts.size === 0
    ? 'Select products…'
    : _pbSelectedProducts.size === 1
      ? [..._pbSelectedProducts][0]
      : `${_pbSelectedProducts.size} products selected`;
  const selectedFormatLabel = _pbSelectedFormats.size === 0
    ? 'All formats'
    : _pbSelectedFormats.size === 1
      ? [..._pbSelectedFormats][0]
      : `${_pbSelectedFormats.size} formats`;

  const header = `
    <div class="view-header">
      <div>
        <h2>Product Buyers</h2>
        <div class="subtitle">Accounts that purchased selected products${state.location ? ' — ' + esc(state.location) : ''}</div>
      </div>
      <div class="view-header-actions">
        <button class="btn btn-secondary" onclick="_pbExportCsv()"${!_pbData || _pbData.buyers.length === 0 ? ' disabled' : ''}>Export CSV</button>
      </div>
    </div>

    <div class="filter-bar">
      <div class="dropdown-multi" id="pb-product-picker" style="flex:1 1 240px;min-width:0">
        <button type="button" class="btn btn-secondary" onclick="_pbToggleDropdown('pb-product-menu')">${esc(selectedProductLabel)} &#9662;</button>
        <div class="dropdown-multi-menu" id="pb-product-menu" style="display:none;max-height:360px;overflow-y:auto;min-width:260px">
          <div style="padding:4px 10px"><input type="search" class="form-control form-control-sm" placeholder="Search products…" oninput="_pbFilterProductMenu(this.value)" /></div>
          <label class="dropdown-multi-item"><input type="checkbox" onchange="_pbSelectAllProducts(this.checked)" ${_pbSelectedProducts.size === _pbProductOptions.length && _pbProductOptions.length > 0 ? 'checked' : ''} /> <strong>Select all</strong></label>
          <div id="pb-product-menu-items">
            ${_pbProductOptions.map(name => `<label class="dropdown-multi-item pb-product-item" data-name="${esc(name).toLowerCase()}"><input type="checkbox" value="${esc(name)}" ${_pbSelectedProducts.has(name) ? 'checked' : ''} onchange="_pbToggleProduct('${esc(name).replace(/'/g, "\\'")}', this.checked)" /> ${esc(name)}</label>`).join('')}
          </div>
        </div>
      </div>
      <div class="dropdown-multi" id="pb-format-picker" style="flex:1 1 180px;min-width:0">
        <button type="button" class="btn btn-secondary" onclick="_pbToggleDropdown('pb-format-menu')">${esc(selectedFormatLabel)} &#9662;</button>
        <div class="dropdown-multi-menu" id="pb-format-menu" style="display:none">
          ${FORMATS.map(f => `<label class="dropdown-multi-item"><input type="checkbox" value="${esc(f)}" ${_pbSelectedFormats.has(f) ? 'checked' : ''} onchange="_pbToggleFormat('${esc(f).replace(/'/g, "\\'")}', this.checked)" /> ${esc(f)}</label>`).join('')}
        </div>
      </div>
      <select id="pb-preset" onchange="_pbPresetChange(this.value)">
        ${presetOptions.map(([v, l]) => `<option value="${v}" ${v === _pbPreset ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      ${customInputs}
      <button class="btn btn-primary" onclick="loadProductBuyers()"${_pbSelectedProducts.size === 0 ? ' disabled' : ''}>Run</button>
    </div>
  `;

  if (!_pbData) {
    setContent(header + `
      <div class="empty-state" style="padding:40px">
        ${_pbSelectedProducts.size === 0
          ? 'Select one or more products above, then click <strong>Run</strong>.'
          : 'Click <strong>Run</strong> to see which accounts purchased these products.'}
      </div>
    `);
    _pbInstallOutsideClickOnce();
    return;
  }

  const data = _pbData;
  let filtered = data.buyers;
  if (_pbSearch) {
    const q = _pbSearch.toLowerCase();
    filtered = filtered.filter(b =>
      (b.accountName || '').toLowerCase().includes(q) ||
      (b.contactName || '').toLowerCase().includes(q) ||
      (b.email || '').toLowerCase().includes(q)
    );
  }
  filtered = _pbSortBuyers(filtered);

  const pg = paginate(filtered, 'productBuyers');
  const sortIcon = (col) => {
    if (_pbSort.col !== col) return '';
    return _pbSort.dir === 'asc' ? ' &#9650;' : ' &#9660;';
  };

  const t = data.totals;

  setContent(header + `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${t.accountCount}</div>
        <div class="stat-label">Accounts</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${t.orderCount}</div>
        <div class="stat-label">Orders</div>
      </div>
      <div class="stat-card accent">
        <div class="stat-value">${t.totalUnits}</div>
        <div class="stat-label">Total Units</div>
      </div>
    </div>

    <div class="filter-bar" style="margin-top:12px">
      <input type="search" id="pb-search" placeholder="Search accounts…" value="${esc(_pbSearch)}" oninput="renderProductBuyers()" />
    </div>

    <div class="card full-width">
      <div class="card-header"><h3>Buyers</h3><span class="text-muted text-sm">${filtered.length} account${filtered.length !== 1 ? 's' : ''}</span></div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="sortable" onclick="_pbSortBy('accountName')" style="cursor:pointer">Account${sortIcon('accountName')}</th>
              <th class="mobile-hide">Contact</th>
              <th class="mobile-hide">Products Purchased</th>
              <th class="sortable" onclick="_pbSortBy('totalUnits')" style="cursor:pointer">Units${sortIcon('totalUnits')}</th>
              <th class="sortable mobile-hide" onclick="_pbSortBy('orderCount')" style="cursor:pointer">Orders${sortIcon('orderCount')}</th>
              <th class="sortable mobile-hide" onclick="_pbSortBy('firstPurchase')" style="cursor:pointer">First${sortIcon('firstPurchase')}</th>
              <th class="sortable" onclick="_pbSortBy('lastPurchase')" style="cursor:pointer">Last${sortIcon('lastPurchase')}</th>
            </tr>
          </thead>
          <tbody>
            ${pg.rows.length === 0
              ? '<tr><td colspan="7" class="empty-state">No matching purchases in this date range.</td></tr>'
              : pg.rows.map(b => `<tr>
                <td class="fw-600"><span class="td-link" onclick="loadAccountProfile('${esc(b.accountId)}')">${esc(b.accountName)}</span></td>
                <td class="mobile-hide text-sm">${esc(b.contactName) || '<span class="text-muted">—</span>'}${b.phone ? `<br><span class="text-muted">${esc(b.phone)}</span>` : ''}${(b.email || b.billingEmail) ? `<br><a href="mailto:${esc(b.billingEmail || b.email)}" class="text-sm">${esc(b.billingEmail || b.email)}</a>` : ''}</td>
                <td class="mobile-hide text-sm">${b.products.map(p => `${esc(p.productName)}${p.format ? ' (' + esc(p.format) + ')' : ''}: <strong>${p.qty}</strong>`).join('<br>')}</td>
                <td class="fw-600">${b.totalUnits}</td>
                <td class="mobile-hide">${b.orderCount}</td>
                <td class="mobile-hide text-sm">${b.firstPurchase ? formatDate(b.firstPurchase) : '—'}</td>
                <td class="text-sm">${b.lastPurchase ? formatDate(b.lastPurchase) : '—'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${paginationControls('productBuyers', pg, 'renderProductBuyers')}
    </div>
  `);
  _pbInstallOutsideClickOnce();
  refocusSearch('pb-search');
}

// ── Dropdown + filter interactions ─────────────────────────────────

function _pbToggleDropdown(id) {
  const menu = document.getElementById(id);
  if (!menu) return;
  const isOpen = menu.style.display !== 'none';
  // Close all our dropdowns, then re-open the clicked one.
  document.querySelectorAll('#pb-product-menu, #pb-format-menu').forEach(m => m.style.display = 'none');
  menu.style.display = isOpen ? 'none' : 'block';
}

let _pbOutsideClickInstalled = false;
function _pbInstallOutsideClickOnce() {
  if (_pbOutsideClickInstalled) return;
  document.addEventListener('click', _pbCloseDropdownsOnOutside);
  _pbOutsideClickInstalled = true;
}

function _pbCloseDropdownsOnOutside(e) {
  const picker1 = document.getElementById('pb-product-picker');
  const picker2 = document.getElementById('pb-format-picker');
  if (picker1 && !picker1.contains(e.target)) {
    const m = document.getElementById('pb-product-menu');
    if (m) m.style.display = 'none';
  }
  if (picker2 && !picker2.contains(e.target)) {
    const m = document.getElementById('pb-format-menu');
    if (m) m.style.display = 'none';
  }
}

function _pbFilterProductMenu(q) {
  const needle = (q || '').toLowerCase();
  document.querySelectorAll('#pb-product-menu-items .pb-product-item').forEach(el => {
    const name = el.dataset.name || '';
    el.style.display = (!needle || name.includes(needle)) ? '' : 'none';
  });
}

function _pbToggleProduct(name, checked) {
  if (checked) _pbSelectedProducts.add(name);
  else _pbSelectedProducts.delete(name);
  // Update trigger label without re-rendering (would close the dropdown).
  const trigger = document.querySelector('#pb-product-picker .btn');
  if (trigger) {
    const label = _pbSelectedProducts.size === 0 ? 'Select products…'
      : _pbSelectedProducts.size === 1 ? [..._pbSelectedProducts][0]
      : `${_pbSelectedProducts.size} products selected`;
    trigger.innerHTML = `${esc(label)} &#9662;`;
  }
}

function _pbSelectAllProducts(checked) {
  if (checked) _pbProductOptions.forEach(n => _pbSelectedProducts.add(n));
  else _pbSelectedProducts.clear();
  renderProductBuyers();
}

function _pbToggleFormat(fmt, checked) {
  if (checked) _pbSelectedFormats.add(fmt);
  else _pbSelectedFormats.delete(fmt);
  const trigger = document.querySelector('#pb-format-picker .btn');
  if (trigger) {
    const label = _pbSelectedFormats.size === 0 ? 'All formats'
      : _pbSelectedFormats.size === 1 ? [..._pbSelectedFormats][0]
      : `${_pbSelectedFormats.size} formats`;
    trigger.innerHTML = `${esc(label)} &#9662;`;
  }
}

function _pbPresetChange(preset) {
  _pbPreset = preset;
  if (preset !== 'custom') {
    const [s, e] = dateRange(preset);
    _pbStart = s;
    _pbEnd = e;
  }
  renderProductBuyers();
}

function _pbCustomDate() {
  const s = val('pb-start');
  const e = val('pb-end');
  if (s && e && s <= e) {
    _pbStart = s;
    _pbEnd = e;
  }
}

// ── Sorting ────────────────────────────────────────────────────────

function _pbSortBuyers(buyers) {
  const { col, dir } = _pbSort;
  const mult = dir === 'asc' ? 1 : -1;
  return [...buyers].sort((a, b) => {
    const av = a[col], bv = b[col];
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'string') return mult * av.localeCompare(bv);
    return mult * (av - bv);
  });
}

function _pbSortBy(col) {
  if (_pbSort.col === col) {
    _pbSort.dir = _pbSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    _pbSort.col = col;
    _pbSort.dir = (col === 'accountName' || col === 'firstPurchase' || col === 'lastPurchase') ? 'asc' : 'desc';
  }
  renderProductBuyers();
}

// ── CSV Export ─────────────────────────────────────────────────────

function _pbExportCsv() {
  if (!_pbData || _pbData.buyers.length === 0) return;
  const lines = ['Account,Contact,Phone,Email,Billing Email,Products,Units,Orders,First Purchase,Last Purchase'];
  for (const b of _pbData.buyers) {
    const products = b.products.map(p => `${p.productName}${p.format ? ' (' + p.format + ')' : ''}: ${p.qty}`).join('; ');
    lines.push([
      `"${b.accountName.replace(/"/g, '""')}"`,
      `"${(b.contactName || '').replace(/"/g, '""')}"`,
      `"${(b.phone || '').replace(/"/g, '""')}"`,
      `"${(b.email || '').replace(/"/g, '""')}"`,
      `"${(b.billingEmail || '').replace(/"/g, '""')}"`,
      `"${products.replace(/"/g, '""')}"`,
      b.totalUnits,
      b.orderCount,
      b.firstPurchase || '',
      b.lastPurchase || '',
    ].join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `product-buyers_${_pbStart}_${_pbEnd}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
