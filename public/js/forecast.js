'use strict';

// ── Forecast Module ─────────────────────────────────────────────

let _fcPreset = 'last-year';
let _fcStart = '';
let _fcEnd = '';
let _fcData = null;
let _fcCharts = {};
let _fcSort = { col: 'totalQty', dir: 'desc' };
let _fcSearch = '';

function _destroyFcCharts() {
  for (const key of Object.keys(_fcCharts)) {
    if (_fcCharts[key]) { _fcCharts[key].destroy(); delete _fcCharts[key]; }
  }
}

async function loadForecast() {
  // Compute date range from preset
  if (_fcPreset !== 'custom') {
    const [s, e] = dateRange(_fcPreset);
    _fcStart = s;
    _fcEnd = e;
  }
  if (!_fcStart || !_fcEnd) {
    const [s, e] = dateRange('last-year');
    _fcStart = s;
    _fcEnd = e;
  }

  // Capture search before showLoading destroys DOM
  const searchEl = document.getElementById('fc-search');
  if (searchEl) _fcSearch = searchEl.value;

  const params = new URLSearchParams({ start: _fcStart, end: _fcEnd });
  if (state.location) params.set('location', state.location);

  showLoading();

  try {
    _fcData = await api.get('/api/forecast?' + params.toString());
    _paginationReset('forecast');
    renderForecast();
  } catch (err) {
    setContent(`<div class="empty-state text-danger" style="padding:40px">Error loading forecast: ${esc(err.message)}</div>`);
  }
}

function renderForecast() {
  _destroyFcCharts();
  const data = _fcData;
  if (!data) return;

  const presetOptions = [
    ['last-year', 'Last Year'],
    ['this-year', 'This Year'],
    ['last-month', 'Last Month'],
    ['this-month', 'This Month'],
    ['last30', 'Last 30 Days'],
    ['last7', 'Last 7 Days'],
    ['custom', 'Custom Range'],
  ];

  const customInputs = _fcPreset === 'custom'
    ? ` <input type="date" id="fc-start" value="${esc(_fcStart)}" onchange="_fcCustomDate()">
       <input type="date" id="fc-end" value="${esc(_fcEnd)}" onchange="_fcCustomDate()">`
    : '';

  // Sync search from DOM if still present
  const liveSearch = document.getElementById('fc-search');
  if (liveSearch) _fcSearch = liveSearch.value;

  const t = data.totals;

  // Filter products by search
  let filtered = data.products;
  if (_fcSearch) {
    const q = _fcSearch.toLowerCase();
    filtered = filtered.filter(p => p.productName.toLowerCase().includes(q));
  }

  // Sort
  filtered = _fcSortProducts(filtered);

  // Paginate
  const pg = paginate(filtered, 'forecast');

  const sortIcon = (col) => {
    if (_fcSort.col !== col) return '';
    return _fcSort.dir === 'asc' ? ' &#9650;' : ' &#9660;';
  };

  setContent(`
    <div class="view-header">
      <div>
        <h2>Forecast</h2>
        <div class="subtitle">${esc(formatDate(_fcStart))} — ${esc(formatDate(_fcEnd))}</div>
      </div>
      <div class="view-header-actions">
        <button class="btn btn-secondary" onclick="_fcExportCsv()">Export CSV</button>
      </div>
    </div>

    <div class="filter-bar">
      <select id="fc-preset" onchange="_fcPresetChange(this.value)">
        ${presetOptions.map(([v, l]) => `<option value="${v}" ${v === _fcPreset ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      ${customInputs}
      <input type="text" id="fc-search" placeholder="Search products..." value="${esc(_fcSearch)}" oninput="renderForecast()">
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${t.totalQty}</div>
        <div class="stat-label">Total Units</div>
      </div>
      <div class="stat-card accent">
        <div class="stat-value">${t.avgPerWeek}</div>
        <div class="stat-label">Avg / Week</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${t.avgPerMonth}</div>
        <div class="stat-label">Avg / Month</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${data.products.length}</div>
        <div class="stat-label">Products</div>
      </div>
    </div>

    <div class="reports-grid">
      <div class="card" style="grid-column: 1 / -1">
        <div class="card-header"><h3>Top Products by Volume</h3></div>
        <canvas id="chart-fc-products" height="300"></canvas>
      </div>
    </div>

    <div class="card full-width" style="margin-top:var(--space-4)">
      <div class="card-header"><h3>Product Breakdown</h3><span class="text-muted text-sm">${filtered.length} products</span></div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="sortable" onclick="_fcSortBy('productName')" style="cursor:pointer">Product${sortIcon('productName')}</th>
              <th class="sortable mobile-hide" onclick="_fcSortBy('format')" style="cursor:pointer">Format${sortIcon('format')}</th>
              <th class="sortable" onclick="_fcSortBy('totalQty')" style="cursor:pointer">Total Units${sortIcon('totalQty')}</th>
              <th class="sortable mobile-hide" onclick="_fcSortBy('avgPerWeek')" style="cursor:pointer">Avg / Week${sortIcon('avgPerWeek')}</th>
              <th class="sortable" onclick="_fcSortBy('avgPerMonth')" style="cursor:pointer">Avg / Month${sortIcon('avgPerMonth')}</th>
            </tr>
          </thead>
          <tbody>
            ${pg.rows.length === 0
              ? '<tr><td colspan="5" class="empty-state">No products found</td></tr>'
              : pg.rows.map(p => `<tr>
                <td>${esc(p.productName)}</td>
                <td class="mobile-hide">${esc(p.format)}</td>
                <td>${p.totalQty}</td>
                <td class="mobile-hide">${p.avgPerWeek}</td>
                <td>${p.avgPerMonth}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${paginationControls('forecast', pg, 'renderForecast')}
    </div>
  `);

  // Build chart after DOM
  requestAnimationFrame(() => {
    _buildFcProductChart(data);
  });

  // Restore search focus
  refocusSearch('fc-search');
}

// ── Sorting ──────────────────────────────────────────────────────

function _fcSortProducts(products) {
  const { col, dir } = _fcSort;
  const mult = dir === 'asc' ? 1 : -1;
  return [...products].sort((a, b) => {
    const av = a[col], bv = b[col];
    if (typeof av === 'string') return mult * av.localeCompare(bv);
    return mult * (av - bv);
  });
}

function _fcSortBy(col) {
  if (_fcSort.col === col) {
    _fcSort.dir = _fcSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    _fcSort.col = col;
    _fcSort.dir = col === 'productName' || col === 'format' ? 'asc' : 'desc';
  }
  renderForecast();
}

// ── Date controls ────────────────────────────────────────────────

function _fcPresetChange(preset) {
  _fcPreset = preset;
  if (preset !== 'custom') {
    loadForecast();
  } else {
    renderForecast();
  }
}

function _fcCustomDate() {
  const s = val('fc-start');
  const e = val('fc-end');
  if (s && e && s <= e) {
    _fcStart = s;
    _fcEnd = e;
    loadForecast();
  }
}

// ── Chart ────────────────────────────────────────────────────────

function _buildFcProductChart(data) {
  const top = data.products.slice(0, 10);
  if (!top.length) return;
  const ctx = document.getElementById('chart-fc-products');
  if (!ctx) return;
  _fcCharts.products = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: top.map(p => p.productName + (p.format ? ' (' + p.format + ')' : '')),
      datasets: [{ label: 'Total Units', data: top.map(p => p.totalQty), backgroundColor: '#1565c0' }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      plugins: { legend: { display: false } },
    },
  });
}

// ── CSV Export ────────────────────────────────────────────────────

function _fcExportCsv() {
  if (!_fcData) return;
  const lines = [];
  lines.push('Product,Format,Total Units,Avg Per Week,Avg Per Month');
  for (const p of _fcData.products) {
    lines.push(`"${p.productName}","${p.format}",${p.totalQty},${p.avgPerWeek},${p.avgPerMonth}`);
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `forecast_${_fcStart}_${_fcEnd}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
