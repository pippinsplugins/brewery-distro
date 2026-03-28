'use strict';

// ── Gallonage Module ─────────────────────────────────────────────

let _galPreset = 'this-month';
let _galStart = '';
let _galEnd = '';
let _galData = null;
let _galCharts = {};
let _galSort = { col: 'gallons', dir: 'desc' };

function _destroyGalCharts() {
  for (const key of Object.keys(_galCharts)) {
    if (_galCharts[key]) { _galCharts[key].destroy(); delete _galCharts[key]; }
  }
}

async function loadGallonage() {
  // Compute date range from preset
  if (_galPreset !== 'custom') {
    const [s, e] = dateRange(_galPreset);
    _galStart = s;
    _galEnd = e;
  }
  if (!_galStart || !_galEnd) {
    const [s, e] = dateRange('this-month');
    _galStart = s;
    _galEnd = e;
  }

  showLoading();

  try {
    const params = new URLSearchParams({ start: _galStart, end: _galEnd });
    if (state.location) params.set('location', state.location);

    // Read filter values from DOM if present
    const typeEl = document.getElementById('gal-account-type');
    const tagEl = document.getElementById('gal-tag');
    if (typeEl && typeEl.value) params.set('accountType', typeEl.value);
    if (tagEl && tagEl.value) params.set('tag', tagEl.value);

    _galData = await api.get('/api/gallonage?' + params.toString());
    _paginationReset('gallonage');
    renderGallonage();
  } catch (err) {
    setContent(`<div class="empty-state text-danger" style="padding:40px">Error loading gallonage: ${esc(err.message)}</div>`);
  }
}

function renderGallonage() {
  _destroyGalCharts();
  const data = _galData;
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

  const customInputs = _galPreset === 'custom'
    ? ` <input type="date" id="gal-start" value="${esc(_galStart)}" onchange="_galCustomDate()">
       <input type="date" id="gal-end" value="${esc(_galEnd)}" onchange="_galCustomDate()">`
    : '';

  const typeOptions = (data.meta.availableTypes || []).map(t =>
    `<option value="${esc(t)}" ${document.getElementById('gal-account-type')?.value === t ? 'selected' : ''}>${esc(t)}</option>`
  ).join('');

  const tagOptions = (data.meta.availableTags || []).map(t =>
    `<option value="${esc(t)}" ${document.getElementById('gal-tag')?.value === t ? 'selected' : ''}>${esc(t)}</option>`
  ).join('');

  // Preserve current filter values
  const curType = document.getElementById('gal-account-type')?.value || '';
  const curTag = document.getElementById('gal-tag')?.value || '';
  const curSearch = document.getElementById('gal-search')?.value || '';

  const t = data.totals;

  // Filter accounts by search
  let filteredAccounts = data.accounts;
  if (curSearch) {
    const q = curSearch.toLowerCase();
    filteredAccounts = filteredAccounts.filter(a => a.accountName.toLowerCase().includes(q));
  }

  // Sort accounts
  filteredAccounts = _galSortAccounts(filteredAccounts);

  // Paginate
  const pg = paginate(filteredAccounts, 'gallonage');

  const sortIcon = (col) => {
    if (_galSort.col !== col) return '';
    return _galSort.dir === 'asc' ? ' &#9650;' : ' &#9660;';
  };

  setContent(`
    <div class="view-header">
      <div>
        <h2>Gallonage</h2>
        <div class="subtitle">${esc(formatDate(_galStart))} — ${esc(formatDate(_galEnd))}</div>
      </div>
      <div class="view-header-actions">
        <button class="btn btn-secondary" onclick="_galExportCsv()">Export CSV</button>
      </div>
    </div>

    <div class="filter-bar">
      <select id="gal-preset" onchange="_galPresetChange(this.value)">
        ${presetOptions.map(([v, l]) => `<option value="${v}" ${v === _galPreset ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      ${customInputs}
      <select id="gal-account-type" onchange="loadGallonage()">
        <option value="">All Account Types</option>
        ${(data.meta.availableTypes || []).map(t => `<option value="${esc(t)}" ${curType === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
      </select>
      <select id="gal-tag" onchange="loadGallonage()">
        <option value="">All Tags</option>
        ${(data.meta.availableTags || []).map(t => `<option value="${esc(t)}" ${curTag === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
      </select>
      <input type="text" id="gal-search" placeholder="Search accounts..." value="${esc(curSearch)}" oninput="renderGallonage()">
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${t.units}</div>
        <div class="stat-label">Total Units</div>
      </div>
      <div class="stat-card accent">
        <div class="stat-value">${t.gallons.toFixed(1)}</div>
        <div class="stat-label">Total Gallons</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${t.bbls.toFixed(2)}</div>
        <div class="stat-label">Total BBLs</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${data.accounts.length}</div>
        <div class="stat-label">Accounts</div>
      </div>
    </div>

    <div class="reports-grid">
      <div class="card">
        <div class="card-header"><h3>Format Breakdown</h3></div>
        <canvas id="chart-gal-formats" height="300"></canvas>
      </div>
      <div class="card">
        <div class="card-header"><h3>Top Accounts</h3></div>
        <canvas id="chart-gal-accounts" height="300"></canvas>
      </div>
    </div>

    <div class="card full-width" style="margin-top:var(--space-4)">
      <div class="card-header"><h3>Account Breakdown</h3><span class="text-muted text-sm">${filteredAccounts.length} accounts</span></div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="sortable" onclick="_galSortBy('accountName')" style="cursor:pointer">Account${sortIcon('accountName')}</th>
              <th class="sortable" onclick="_galSortBy('accountType')" style="cursor:pointer">Type${sortIcon('accountType')}</th>
              <th class="sortable" onclick="_galSortBy('unitsSold')" style="cursor:pointer">Units Sold${sortIcon('unitsSold')}</th>
              <th class="sortable" onclick="_galSortBy('gallons')" style="cursor:pointer">Gallons${sortIcon('gallons')}</th>
              <th class="sortable" onclick="_galSortBy('bbls')" style="cursor:pointer">BBLs${sortIcon('bbls')}</th>
            </tr>
          </thead>
          <tbody>
            ${pg.rows.length === 0
              ? '<tr><td colspan="5" class="empty-state">No accounts found</td></tr>'
              : pg.rows.map(a => `<tr>
                <td>${esc(a.accountName)}</td>
                <td>${esc(a.accountType)}</td>
                <td>${a.unitsSold}</td>
                <td>${a.gallons.toFixed(2)}</td>
                <td>${a.bbls.toFixed(2)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${paginationControls('gallonage', pg, 'renderGallonage')}
    </div>
  `);

  // Build charts after DOM
  requestAnimationFrame(() => {
    _buildGalFormatChart(data);
    _buildGalAccountChart(data);
  });

  // Restore search focus
  refocusSearch('gal-search');
}

// ── Sorting ──────────────────────────────────────────────────────

function _galSortAccounts(accounts) {
  const { col, dir } = _galSort;
  const mult = dir === 'asc' ? 1 : -1;
  return [...accounts].sort((a, b) => {
    const av = a[col], bv = b[col];
    if (typeof av === 'string') return mult * av.localeCompare(bv);
    return mult * (av - bv);
  });
}

function _galSortBy(col) {
  if (_galSort.col === col) {
    _galSort.dir = _galSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    _galSort.col = col;
    _galSort.dir = col === 'accountName' || col === 'accountType' ? 'asc' : 'desc';
  }
  renderGallonage();
}

// ── Date controls ────────────────────────────────────────────────

function _galPresetChange(preset) {
  _galPreset = preset;
  if (preset !== 'custom') {
    loadGallonage();
  } else {
    renderGallonage();
  }
}

function _galCustomDate() {
  const s = val('gal-start');
  const e = val('gal-end');
  if (s && e && s <= e) {
    _galStart = s;
    _galEnd = e;
    loadGallonage();
  }
}

// ── Charts ───────────────────────────────────────────────────────

function _buildGalFormatChart(data) {
  const formats = data.formats.filter(f => f.gallons > 0);
  if (!formats.length) return;
  const ctx = document.getElementById('chart-gal-formats');
  if (!ctx) return;
  _galCharts.formats = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: formats.map(f => f.format),
      datasets: [{ label: 'Gallons', data: formats.map(f => f.gallons), backgroundColor: '#1565c0' }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      plugins: { legend: { display: false } },
    },
  });
}

function _buildGalAccountChart(data) {
  const accounts = data.accounts.slice(0, 15);
  if (!accounts.length) return;
  const ctx = document.getElementById('chart-gal-accounts');
  if (!ctx) return;
  _galCharts.accounts = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: accounts.map(a => a.accountName),
      datasets: [{ label: 'Gallons', data: accounts.map(a => a.gallons), backgroundColor: '#2e7d32' }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      plugins: { legend: { display: false } },
    },
  });
}

// ── CSV Export ────────────────────────────────────────────────────

function _galExportCsv() {
  if (!_galData) return;
  const d = _galData;
  const lines = [];

  // Format section
  lines.push('--- Gallonage by Format ---');
  lines.push('Format,Units Sold,Gallons,BBLs');
  for (const f of d.formats) {
    lines.push(`"${f.format}",${f.unitsSold},${f.gallons.toFixed(2)},${f.bbls.toFixed(2)}`);
  }
  lines.push(`Total,${d.totals.units},${d.totals.gallons.toFixed(2)},${d.totals.bbls.toFixed(2)}`);
  lines.push('');

  // Account section
  lines.push('--- Gallonage by Account ---');
  lines.push('Account,Type,Units Sold,Gallons,BBLs');
  for (const a of d.accounts) {
    lines.push(`"${a.accountName}","${a.accountType}",${a.unitsSold},${a.gallons.toFixed(2)},${a.bbls.toFixed(2)}`);
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `gallonage_${_galStart}_${_galEnd}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
