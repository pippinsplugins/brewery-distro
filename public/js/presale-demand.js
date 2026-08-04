'use strict';

// ── Pre-Sale Demand Report ─────────────────────────────────────────
// Per-SKU aggregation of open pre-sales. Sibling to the Forecast report:
// Forecast shows historical velocity, this shows actual future commitments.

let _pdData = null;
let _pdSearch = '';
let _pdSort = { col: 'totalQty', dir: 'desc' };
let _pdCharts = {};

function _destroyPdCharts() {
  for (const key of Object.keys(_pdCharts)) {
    if (_pdCharts[key]) { _pdCharts[key].destroy(); delete _pdCharts[key]; }
  }
}

async function loadPresaleDemand() {
  const searchEl = document.getElementById('pd-search');
  if (searchEl) _pdSearch = searchEl.value;

  const params = new URLSearchParams();
  if (state.location) params.set('location', state.location);

  showLoading();
  try {
    _pdData = await api.get('/api/presale-demand' + (params.toString() ? '?' + params.toString() : ''));
    _paginationReset('presaleDemand');
    renderPresaleDemand();
  } catch (err) {
    setContent(`<div class="empty-state text-danger" style="padding:40px">Error loading pre-sale demand: ${esc(err.message)}</div>`);
  }
}

function renderPresaleDemand() {
  _destroyPdCharts();
  const data = _pdData;
  if (!data) return;

  const liveSearch = document.getElementById('pd-search');
  if (liveSearch) _pdSearch = liveSearch.value;

  let filtered = data.products;
  if (_pdSearch) {
    const q = _pdSearch.toLowerCase();
    filtered = filtered.filter(p =>
      (p.productName || '').toLowerCase().includes(q) ||
      (p.format || '').toLowerCase().includes(q)
    );
  }
  filtered = _pdSortProducts(filtered);

  const pg = paginate(filtered, 'presaleDemand');

  const t = data.totals;

  const sortIcon = (col) => {
    if (_pdSort.col !== col) return '';
    return _pdSort.dir === 'asc' ? ' &#9650;' : ' &#9660;';
  };

  const fmtRange = (p) => {
    if (!p.earliestExpected && !p.latestExpected) return '<span class="text-muted">—</span>';
    if (p.earliestExpected === p.latestExpected) return formatDate(p.earliestExpected);
    return `${formatDate(p.earliestExpected)} – ${formatDate(p.latestExpected)}`;
  };

  setContent(`
    <div class="view-header">
      <div>
        <h2>Pre-Sales</h2>
        <div class="subtitle">Open pre-sale demand by product${state.location ? ' — ' + esc(state.location) : ''}</div>
      </div>
      <div class="view-header-actions">
        <button class="btn btn-secondary" onclick="_pdExportCsv()">Export CSV</button>
      </div>
    </div>

    <div class="filter-bar">
      <input type="text" id="pd-search" placeholder="Search products..." value="${esc(_pdSearch)}" oninput="renderPresaleDemand()" />
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${t.totalQty}</div>
        <div class="stat-label">Total Units Pre-Sold</div>
      </div>
      <div class="stat-card accent">
        <div class="stat-value">${t.productCount}</div>
        <div class="stat-label">Products</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${t.orderCount}</div>
        <div class="stat-label">Open Pre-Sales</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${t.accountCount}</div>
        <div class="stat-label">Accounts</div>
      </div>
    </div>

    <div class="reports-grid">
      <div class="card" style="grid-column: 1 / -1">
        <div class="card-header"><h3>Top Products by Pre-Sold Units</h3></div>
        <canvas id="chart-pd-products" height="300"></canvas>
      </div>
    </div>

    <div class="card full-width" style="margin-top:var(--space-4)">
      <div class="card-header"><h3>Product Breakdown</h3><span class="text-muted text-sm">${filtered.length} products</span></div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="sortable" onclick="_pdSortBy('productName')" style="cursor:pointer">Product${sortIcon('productName')}</th>
              <th class="sortable mobile-hide" onclick="_pdSortBy('format')" style="cursor:pointer">Format${sortIcon('format')}</th>
              <th class="sortable" onclick="_pdSortBy('totalQty')" style="cursor:pointer">Units${sortIcon('totalQty')}</th>
              <th class="sortable mobile-hide" onclick="_pdSortBy('orderCount')" style="cursor:pointer">Pre-Sales${sortIcon('orderCount')}</th>
              <th class="sortable mobile-hide" onclick="_pdSortBy('accountCount')" style="cursor:pointer">Accounts${sortIcon('accountCount')}</th>
              <th class="mobile-hide">Expected</th>
            </tr>
          </thead>
          <tbody>
            ${pg.rows.length === 0
              ? '<tr><td colspan="6" class="empty-state">No open pre-sales.</td></tr>'
              : pg.rows.map(p => `<tr>
                <td class="fw-600"><span class="td-link" onclick="_pdOpenDrilldown('${esc(p.productName)}', '${esc(p.format)}')">${esc(p.productName)}</span></td>
                <td class="mobile-hide">${esc(p.format) || '—'}</td>
                <td class="fw-600">${p.totalQty}</td>
                <td class="mobile-hide">${p.orderCount}</td>
                <td class="mobile-hide">${p.accountCount}</td>
                <td class="mobile-hide text-sm">${fmtRange(p)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${paginationControls('presaleDemand', pg, 'renderPresaleDemand')}
    </div>
  `);

  requestAnimationFrame(() => _buildPdProductChart(data));
  refocusSearch('pd-search');
}

function _pdSortProducts(products) {
  const { col, dir } = _pdSort;
  const mult = dir === 'asc' ? 1 : -1;
  return [...products].sort((a, b) => {
    const av = a[col], bv = b[col];
    if (typeof av === 'string') return mult * av.localeCompare(bv);
    return mult * (av - bv);
  });
}

function _pdSortBy(col) {
  if (_pdSort.col === col) {
    _pdSort.dir = _pdSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    _pdSort.col = col;
    _pdSort.dir = (col === 'productName' || col === 'format') ? 'asc' : 'desc';
  }
  renderPresaleDemand();
}

function _buildPdProductChart(data) {
  const top = data.products.slice(0, 10);
  if (!top.length) return;
  const ctx = document.getElementById('chart-pd-products');
  if (!ctx) return;
  _pdCharts.products = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: top.map(p => p.productName + (p.format ? ' (' + p.format + ')' : '')),
      datasets: [{ label: 'Units Pre-Sold', data: top.map(p => p.totalQty), backgroundColor: '#6a1b9a' }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      plugins: { legend: { display: false } },
    },
  });
}

// Drill-down: list the specific pre-sales contributing to this SKU. Resolves
// the ProductName+Format back to an inventory row (via /api/inventory) so we
// can reuse the per-item /api/inventory/:id/pre-sales endpoint. Falls back
// gracefully if the SKU isn't in inventory at the current location.
async function _pdOpenDrilldown(productName, format) {
  const label = format ? `${productName} (${format})` : productName;
  modal.open(`Pre-Sales for ${label}`, `<p class="text-muted">Loading…</p>`, () => modal.close(), 'Close');
  try {
    const locParam = state.location ? `?location=${encodeURIComponent(state.location)}` : '';
    const inventory = await api.get('/api/inventory' + locParam);
    const inv = inventory.find(i => (i.Name || i.ProductName) === productName && (i.Format || '') === (format || ''));
    if (!inv) {
      document.getElementById('modal-body').innerHTML = `<p class="text-muted">No matching inventory row at ${esc(state.location || 'this location')}.</p>`;
      return;
    }
    const rows = await api.get(`/api/inventory/${encodeURIComponent(inv.ID)}/pre-sales`);
    document.getElementById('modal-body').innerHTML = _renderPresaleDrilldownRows(rows);
  } catch (err) {
    document.getElementById('modal-body').innerHTML = `<p class="text-danger">Error: ${esc(err.message)}</p>`;
  }
}

// Shared renderer used by both the report drill-down and the Stock Levels
// badge drill-down (see inventory.js).
function _renderPresaleDrilldownRows(rows) {
  if (!rows || rows.length === 0) return `<p class="text-muted">No open pre-sales for this product.</p>`;
  const totalQty = rows.reduce((s, r) => s + (parseInt(r.Quantity) || 0), 0);
  return `
    <p class="text-sm text-muted" style="margin-bottom:10px">
      ${rows.length} pre-sale${rows.length !== 1 ? 's' : ''} · <strong>${totalQty}</strong> unit${totalQty !== 1 ? 's' : ''} pre-sold.
    </p>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Account</th><th>Expected</th><th>Qty</th></tr></thead>
        <tbody>
          ${rows.map(r => `<tr>
            <td class="fw-600">${r.AccountID
              ? `<span class="td-link" onclick="modal.close(); loadAccountProfile('${esc(r.AccountID)}')">${esc(r.AccountName) || '—'}</span>`
              : esc(r.AccountName) || '—'}</td>
            <td class="text-sm">${r.DeliveryDate ? formatDate(r.DeliveryDate) : '<span class="text-muted">no date</span>'}</td>
            <td class="fw-600">${esc(r.Quantity)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function _pdExportCsv() {
  if (!_pdData) return;
  const lines = ['Product,Format,Units,Pre-Sales,Accounts,Earliest Expected,Latest Expected'];
  for (const p of _pdData.products) {
    lines.push(`"${p.productName}","${p.format}",${p.totalQty},${p.orderCount},${p.accountCount},${p.earliestExpected || ''},${p.latestExpected || ''}`);
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `presale-demand${state.location ? '_' + state.location : ''}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
