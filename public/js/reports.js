'use strict';

// ── Reports Module ────────────────────────────────────────────────

let _reportsPreset = 'this-month';
let _reportsStart = '';
let _reportsEnd = '';
let _reportsTaxableOnly = false;
let _reportsData = null;
let _reportCharts = {};

function _destroyReportCharts() {
  for (const key of Object.keys(_reportCharts)) {
    if (_reportCharts[key]) { _reportCharts[key].destroy(); delete _reportCharts[key]; }
  }
}

async function loadReports() {
  // Compute date range from preset
  if (_reportsPreset !== 'custom') {
    const [s, e] = dateRange(_reportsPreset);
    _reportsStart = s;
    _reportsEnd = e;
  }
  if (!_reportsStart || !_reportsEnd) {
    const [s, e] = dateRange('this-month');
    _reportsStart = s;
    _reportsEnd = e;
  }

  showLoading();

  try {
    const params = new URLSearchParams({ start: _reportsStart, end: _reportsEnd });
    if (state.location) params.set('location', state.location);
    if (_reportsTaxableOnly) params.set('taxableOnly', '1');
    _reportsData = await api.get('/api/reports?' + params.toString());
    renderReports();
  } catch (err) {
    setContent(`<div class="empty-state text-danger" style="padding:40px">Error loading reports: ${esc(err.message)}</div>`);
  }
}

function renderReports() {
  _destroyReportCharts();
  const data = _reportsData;
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

  const customInputs = _reportsPreset === 'custom'
    ? ` <input type="date" id="reports-start" value="${esc(_reportsStart)}" onchange="_reportsCustomDate()">
       <input type="date" id="reports-end" value="${esc(_reportsEnd)}" onchange="_reportsCustomDate()">`
    : '';

  const s = data.salesSummary.totals;

  setContent(`
    <div class="view-header">
      <div>
        <h2>Reports</h2>
        <div class="subtitle">${esc(formatDate(_reportsStart))} — ${esc(formatDate(_reportsEnd))}${_reportsTaxableOnly ? ' · <strong>Taxable Only</strong>' : ''}</div>
      </div>
      <div class="view-header-actions">
        <button class="btn btn-secondary" onclick="_reportsExportCsv()">Export CSV</button>
      </div>
    </div>

    <div class="filter-bar">
      <select id="reports-preset" onchange="_reportsPresetChange(this.value)">
        ${presetOptions.map(([v, l]) => `<option value="${v}" ${v === _reportsPreset ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      ${customInputs}
      <select id="reports-taxable" onchange="_reportsTaxableChange(this.value)" title="Filter to orders that had tax applied">
        <option value="all" ${!_reportsTaxableOnly ? 'selected' : ''}>All Sales</option>
        <option value="taxable" ${_reportsTaxableOnly ? 'selected' : ''}>Taxable Only</option>
      </select>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${s.orderCount}</div>
        <div class="stat-label">Orders<br><span class="text-sm text-muted">${s.paidOrderCount || 0} paid / ${s.pendingOrderCount || 0} pending</span></div>
      </div>
      <div class="stat-card accent">
        <div class="stat-value">${fmtMoney(s.orderAmount)}</div>
        <div class="stat-label">Total Revenue</div>
      </div>
      <div class="stat-card">
        <div class="stat-value text-success">${fmtMoney(s.paidAmount || 0)}</div>
        <div class="stat-label">Paid Revenue</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${fmtMoney(s.pendingAmount || 0)}</div>
        <div class="stat-label">Awaiting Payment</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${fmtMoney(s.taxAmount)}</div>
        <div class="stat-label">Tax Collected</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${fmtMoney(s.depositAmount)}</div>
        <div class="stat-label">Deposits</div>
      </div>
    </div>

    <div class="reports-grid">
      ${_renderSalesChart(data)}
      ${_renderTopProducts(data)}
      ${_renderAccountActivity(data)}
      ${_renderStockMovements(data)}
      ${_renderSalesByRep(data)}
    </div>
  `);

  // Render charts after DOM is ready
  requestAnimationFrame(() => {
    _buildSalesChart(data);
    _buildTopProductsChart(data);
    _buildAccountActivityChart(data);
    _buildStockMovementsChart(data);
    _buildSalesByRepChart(data);
  });
}

// ── Date range controls ─────────────────────────────────────────

function _reportsPresetChange(preset) {
  _reportsPreset = preset;
  if (preset !== 'custom') {
    loadReports();
  } else {
    renderReports();
  }
}

function _reportsCustomDate() {
  const s = val('reports-start');
  const e = val('reports-end');
  if (s && e && s <= e) {
    _reportsStart = s;
    _reportsEnd = e;
    loadReports();
  }
}

function _reportsTaxableChange(value) {
  _reportsTaxableOnly = value === 'taxable';
  loadReports();
}

// ── Chart colors ────────────────────────────────────────────────

const _chartColors = {
  green:  '#2e7d32',
  amber:  '#e07b00',
  dark:   '#1b5e20',
  danger: '#c62828',
  blue:   '#1565c0',
  purple: '#6a1b9a',
};

// ── Sales Summary ───────────────────────────────────────────────

function _renderSalesChart(data) {
  const buckets = data.salesSummary.buckets;
  if (!buckets.length) return _emptyCard('Sales Over Time', 'full-width');
  return `
    <div class="card full-width">
      <div class="card-header"><h3>Sales Over Time</h3></div>
      <canvas id="chart-sales" height="300"></canvas>
      <details class="report-table-toggle">
        <summary>View Table</summary>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Period</th><th>Orders</th><th>Paid Revenue</th><th>Pending Revenue</th><th>Total Revenue</th><th>Tax</th><th>Deposits</th></tr></thead>
            <tbody>
              ${buckets.map(b => `<tr>
                <td>${esc(b.bucket)}</td>
                <td>${b.orderCount} <span class="text-muted text-sm">(${b.paidOrderCount || 0}/${b.pendingOrderCount || 0})</span></td>
                <td class="text-success">${fmtMoney(b.paidAmount || 0)}</td>
                <td>${fmtMoney(b.pendingAmount || 0)}</td>
                <td class="fw-600">${fmtMoney(b.orderAmount)}</td>
                <td>${fmtMoney(b.taxAmount)}</td><td>${fmtMoney(b.depositAmount)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </details>
    </div>`;
}

function _buildSalesChart(data) {
  const buckets = data.salesSummary.buckets;
  if (!buckets.length) return;
  const ctx = document.getElementById('chart-sales');
  if (!ctx) return;
  _reportCharts.sales = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: buckets.map(b => b.bucket),
      datasets: [
        { label: 'Paid Revenue',    data: buckets.map(b => b.paidAmount    || 0), backgroundColor: _chartColors.green },
        { label: 'Pending Revenue', data: buckets.map(b => b.pendingAmount || 0), backgroundColor: _chartColors.amber },
        { label: 'Tax',             data: buckets.map(b => b.taxAmount),         backgroundColor: _chartColors.blue  },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top' } },
      scales: {
        x: { stacked: true },
        y: { stacked: true, ticks: { callback: v => '$' + v.toLocaleString() } },
      },
    },
  });
}

// ── Top Products ────────────────────────────────────────────────

function _renderTopProducts(data) {
  const products = data.topProducts;
  if (!products.length) return _emptyCard('Top Products');
  const top15 = products.slice(0, 15);
  return `
    <div class="card">
      <div class="card-header"><h3>Top Products</h3><span class="text-muted text-sm">${products.length} products</span></div>
      <canvas id="chart-products" height="300"></canvas>
      <details class="report-table-toggle">
        <summary>View Table</summary>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Product</th><th>Format</th><th>Qty Sold</th><th>Revenue</th><th>Avg Price</th><th>Orders</th></tr></thead>
            <tbody>
              ${products.map(p => {
                const fmtParts = [p.format];
                if (p.priceTier) fmtParts.push(`(${p.priceTier})`);
                return `<tr>
                <td>${esc(p.productName)}</td><td>${esc(fmtParts.join(' '))}</td><td>${p.quantitySold}</td>
                <td>${fmtMoney(p.revenue)}</td><td>${fmtMoney(p.avgPrice)}</td><td>${p.orderCount}</td>
              </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </details>
    </div>`;
}

function _buildTopProductsChart(data) {
  const products = data.topProducts.slice(0, 15);
  if (!products.length) return;
  const ctx = document.getElementById('chart-products');
  if (!ctx) return;
  _reportCharts.products = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: products.map(p => {
        let lbl = p.productName;
        if (p.format) lbl += ' (' + p.format + ')';
        if (p.priceTier) lbl += ' — ' + p.priceTier;
        return lbl;
      }),
      datasets: [{ label: 'Qty Sold', data: products.map(p => p.quantitySold), backgroundColor: _chartColors.green }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      plugins: { legend: { display: false } },
    },
  });
}

// ── Account Activity ────────────────────────────────────────────

function _renderAccountActivity(data) {
  const accounts = data.accountActivity;
  if (!accounts.length) return _emptyCard('Account Activity');
  return `
    <div class="card">
      <div class="card-header"><h3>Account Activity</h3><span class="text-muted text-sm">${accounts.length} accounts</span></div>
      <canvas id="chart-accounts" height="300"></canvas>
      <details class="report-table-toggle">
        <summary>View Table</summary>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Account</th><th>Type</th><th>Orders</th><th>Paid</th><th>Pending</th><th>Total Spent</th><th>Avg Order</th><th>Last Order</th></tr></thead>
            <tbody>
              ${accounts.map(a => `<tr>
                <td>${esc(a.name)}</td><td>${esc(a.type)}</td><td>${a.orderCount}</td>
                <td class="text-success">${fmtMoney(a.paidSpent || 0)}</td>
                <td>${fmtMoney(a.pendingSpent || 0)}</td>
                <td class="fw-600">${fmtMoney(a.totalSpent)}</td><td>${fmtMoney(a.avgOrder)}</td><td>${formatDate(a.lastOrderDate)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </details>
    </div>`;
}

function _buildAccountActivityChart(data) {
  const accounts = data.accountActivity.slice(0, 15);
  if (!accounts.length) return;
  const ctx = document.getElementById('chart-accounts');
  if (!ctx) return;
  _reportCharts.accounts = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: accounts.map(a => a.name),
      datasets: [{ label: 'Total Spent', data: accounts.map(a => a.totalSpent), backgroundColor: _chartColors.amber }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: { x: { ticks: { callback: v => '$' + v.toLocaleString() } } },
    },
  });
}

// ── Stock Movements ─────────────────────────────────────────────

function _renderStockMovements(data) {
  const sm = data.stockMovements;
  if (!sm.buckets.length && !sm.products.length) return _emptyCard('Stock Movements', 'full-width');
  return `
    <div class="card full-width">
      <div class="card-header"><h3>Stock Movements</h3></div>
      <canvas id="chart-movements" height="300"></canvas>
      <details class="report-table-toggle">
        <summary>View Table</summary>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Product</th><th>Received</th><th>Sold</th><th>Write-Off</th><th>Adjustment</th><th>Net</th></tr></thead>
            <tbody>
              ${sm.products.map(p => `<tr>
                <td>${esc(p.name)}</td><td>${p.received}</td><td>${p.sold}</td>
                <td>${p.writeOff}</td><td>${p.adjustment}</td>
                <td class="${p.netChange >= 0 ? 'text-success' : 'text-danger'}">${p.netChange > 0 ? '+' : ''}${p.netChange}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </details>
    </div>`;
}

function _buildStockMovementsChart(data) {
  const buckets = data.stockMovements.buckets;
  if (!buckets.length) return;
  const ctx = document.getElementById('chart-movements');
  if (!ctx) return;
  _reportCharts.movements = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: buckets.map(b => b.bucket),
      datasets: [
        { label: 'Received', data: buckets.map(b => b.received), backgroundColor: _chartColors.green },
        { label: 'Sold', data: buckets.map(b => b.sold), backgroundColor: _chartColors.amber },
        { label: 'Write-Off', data: buckets.map(b => b.writeOff), backgroundColor: _chartColors.danger },
        { label: 'Adjustment', data: buckets.map(b => b.adjustment), backgroundColor: _chartColors.blue },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top' } },
      scales: { x: { stacked: true }, y: { stacked: true } },
    },
  });
}

// ── Sales by Rep ────────────────────────────────────────────────

function _renderSalesByRep(data) {
  const reps = data.salesByRep;
  if (!reps.length) return _emptyCard('Sales by Rep', 'full-width');
  return `
    <div class="card full-width">
      <div class="card-header"><h3>Sales by Rep</h3></div>
      <canvas id="chart-reps" height="250"></canvas>
      <details class="report-table-toggle">
        <summary>View Table</summary>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Rep</th><th>Orders</th><th>Paid Revenue</th><th>Pending Revenue</th><th>Total Revenue</th><th>Avg Order</th><th>Accounts</th></tr></thead>
            <tbody>
              ${reps.map(r => `<tr>
                <td>${esc(r.name)}</td><td>${r.orderCount}</td>
                <td class="text-success">${fmtMoney(r.paidRevenue || 0)}</td>
                <td>${fmtMoney(r.pendingRevenue || 0)}</td>
                <td class="fw-600">${fmtMoney(r.totalRevenue)}</td>
                <td>${fmtMoney(r.avgOrder)}</td><td>${r.accountsServed}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </details>
    </div>`;
}

function _buildSalesByRepChart(data) {
  const reps = data.salesByRep;
  if (!reps.length) return;
  const ctx = document.getElementById('chart-reps');
  if (!ctx) return;
  _reportCharts.reps = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: reps.map(r => r.name),
      datasets: [
        { label: 'Revenue', data: reps.map(r => r.totalRevenue), backgroundColor: _chartColors.green, yAxisID: 'y' },
        { label: 'Orders', data: reps.map(r => r.orderCount), backgroundColor: _chartColors.amber, yAxisID: 'y1' },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top' } },
      scales: {
        y: { position: 'left', ticks: { callback: v => '$' + v.toLocaleString() } },
        y1: { position: 'right', grid: { drawOnChartArea: false } },
      },
    },
  });
}

// ── Helpers ──────────────────────────────────────────────────────

function _emptyCard(title, extraClass = '') {
  return `<div class="card ${extraClass}">
    <div class="card-header"><h3>${esc(title)}</h3></div>
    <div class="empty-state">No data for this period</div>
  </div>`;
}

// ── CSV Export ───────────────────────────────────────────────────

function _reportsExportCsv() {
  if (!_reportsData) return;
  const d = _reportsData;
  const lines = [];

  // Sales Summary
  lines.push('--- Sales Summary ---');
  lines.push('Period,Orders,Paid Orders,Pending Orders,Paid Revenue,Pending Revenue,Total Revenue,Tax,Deposits');
  for (const b of d.salesSummary.buckets) {
    lines.push(`${b.bucket},${b.orderCount},${b.paidOrderCount || 0},${b.pendingOrderCount || 0},${(b.paidAmount || 0).toFixed(2)},${(b.pendingAmount || 0).toFixed(2)},${b.orderAmount.toFixed(2)},${b.taxAmount.toFixed(2)},${b.depositAmount.toFixed(2)}`);
  }
  lines.push('');

  // Top Products
  lines.push('--- Top Products ---');
  lines.push('Product,Format,Qty Sold,Revenue,Avg Price,Orders');
  for (const p of d.topProducts) {
    lines.push(`"${p.productName}","${p.format}",${p.quantitySold},${p.revenue.toFixed(2)},${p.avgPrice.toFixed(2)},${p.orderCount}`);
  }
  lines.push('');

  // Gallonage
  lines.push('--- Gallonage ---');
  lines.push('Format,Units Sold,Gallons,BBLs');
  for (const f of d.gallonage.formats) {
    lines.push(`"${f.format}",${f.unitsSold},${f.gallons.toFixed(2)},${f.bbls.toFixed(2)}`);
  }
  lines.push(`Total,${d.gallonage.totals.units},${d.gallonage.totals.gallons.toFixed(2)},${d.gallonage.totals.bbls.toFixed(2)}`);
  lines.push('');

  // Account Activity
  lines.push('--- Account Activity ---');
  lines.push('Account,Type,Orders,Paid Spent,Pending Spent,Total Spent,Avg Order,Last Order');
  for (const a of d.accountActivity) {
    lines.push(`"${a.name}","${a.type}",${a.orderCount},${(a.paidSpent || 0).toFixed(2)},${(a.pendingSpent || 0).toFixed(2)},${a.totalSpent.toFixed(2)},${a.avgOrder.toFixed(2)},${a.lastOrderDate}`);
  }
  lines.push('');

  // Stock Movements
  lines.push('--- Stock Movements ---');
  lines.push('Product,Received,Sold,Write-Off,Adjustment,Net');
  for (const p of d.stockMovements.products) {
    lines.push(`"${p.name}",${p.received},${p.sold},${p.writeOff},${p.adjustment},${p.netChange}`);
  }
  lines.push('');

  // Sales by Rep
  lines.push('--- Sales by Rep ---');
  lines.push('Rep,Orders,Paid Revenue,Pending Revenue,Total Revenue,Avg Order,Accounts');
  for (const r of d.salesByRep) {
    lines.push(`"${r.name}",${r.orderCount},${(r.paidRevenue || 0).toFixed(2)},${(r.pendingRevenue || 0).toFixed(2)},${r.totalRevenue.toFixed(2)},${r.avgOrder.toFixed(2)},${r.accountsServed}`);
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `reports_${_reportsStart}_${_reportsEnd}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
