'use strict';

let _kegsCache = [];
let _kegsStatusFilter = 'outstanding';

async function loadKegs(preservePage = false) {
  if (!preservePage) _paginationReset('kegs');
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
    ? `<tr><td colspan="10" class="empty-state">No keg records found.</td></tr>`
    : pg.rows.map(k => {
        const qty = parseInt(k.Quantity) || 0;
        const returned = parseInt(k.ReturnedQuantity) || 0;
        const outstanding = Math.max(0, qty - returned);
        const fullyReturned = outstanding === 0;
        const depTotal = parseFloat(k.DepositTotal) || 0;
        const depRefunded = parseFloat(k.DepositRefunded) || 0;
        const depOutstanding = depTotal - depRefunded;
        return `<tr class="${fullyReturned ? 'row-completed' : ''}">
          <td class="fw-600"><span class="td-link" onclick="loadAccountProfile('${esc(k.AccountID)}')">${esc(k.AccountName)}</span></td>
          <td>${esc(k.ProductName)}</td>
          <td class="text-sm">${esc(k.Format)}</td>
          <td class="mobile-hide text-sm">${formatDate(k.DeliveredDate)}</td>
          <td class="text-center">${qty}</td>
          <td class="mobile-hide text-center">${returned}</td>
          <td class="text-center fw-600${outstanding > 0 ? ' text-danger' : ''}">${outstanding}</td>
          <td class="mobile-hide text-sm">${depTotal > 0 ? fmtMoney(depTotal) : '—'}</td>
          <td class="mobile-hide text-sm">${depTotal > 0 ? (fullyReturned || depOutstanding <= 0 ? '<span class="badge" style="background:#e8f5e9;color:#2e7d32">Refunded</span>' : fmtMoney(depRefunded) + ' / ' + fmtMoney(depTotal)) : '—'}</td>
          <td class="td-actions">
            <button class="btn btn-ghost btn-sm mobile-actions-toggle" onclick="toggleMobileActions(event)">&#8230;</button>
            <div class="mobile-actions-menu">
            ${outstanding > 0
              ? `<button class="btn btn-ghost btn-sm" data-product="${esc(k.ProductName)}" data-format="${esc(k.Format)}" data-notes="${esc(k.Notes || '')}" data-deposit-per-unit="${esc(k.DepositPerUnit || '')}" data-deposit-refunded="${esc(k.DepositRefunded || '')}" data-deposit-total="${esc(k.DepositTotal || '')}" data-account-id="${esc(k.AccountID || '')}" data-account-name="${esc(k.AccountName || '')}" onclick="openReturnKegs('${esc(k.ID)}', this.dataset.product, this.dataset.format, ${qty}, ${returned}, this.dataset.notes, this.dataset.depositPerUnit, this.dataset.depositRefunded, this.dataset.depositTotal, this.dataset.accountId, this.dataset.accountName)">Return</button>`
              : '<span class="badge" style="background:#e8f5e9;color:#2e7d32">Returned</span>'}
            </div>
          </td>
        </tr>`;
      }).join('');

  setContent(`
    <div class="view-header">
      <div>
        <h2>Keg Tracking</h2>
        <p class="subtitle">${totalOutstanding} outstanding keg${totalOutstanding !== 1 ? 's' : ''} &mdash; ${filtered.length} record${filtered.length !== 1 ? 's' : ''}</p>
      </div>
      <div class="view-header-actions">
        <button class="btn btn-primary" onclick="openAddKegs()">+ Add Kegs</button>
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
          <th>Account</th><th>Product</th><th>Format</th><th class="mobile-hide">Delivered</th>
          <th class="text-center">Qty</th><th class="mobile-hide text-center">Returned</th><th class="text-center">Outstanding</th><th class="mobile-hide">Deposit</th><th class="mobile-hide">Refunded</th><th>Actions</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${pg.total > 0 ? paginationControls('kegs', pg, 'renderKegs') : ''}`);

  if (_focused === 'kegs-search') refocusSearch('kegs-search');
}

const KEG_FORMATS = ['1/6 Keg', '1/4 Keg', '1/2 Keg'];

async function openAddKegs(presetAccountId = '') {
  if (state.accounts.length === 0) state.accounts = await api.get('/api/accounts');
  if (state.staff.length === 0) state.staff = await api.get('/api/staff');
  const formHtml = `
    <div class="form-group">
      <label>Account <span class="required">*</span></label>
      <select class="form-control" id="f-account" ${presetAccountId ? 'disabled' : ''}>
        <option value="">-- Select Account --</option>
        ${accountOptions(presetAccountId)}
      </select>
      ${presetAccountId ? `<input type="hidden" id="f-account-hidden" value="${esc(presetAccountId)}" />` : ''}
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Product Name <span class="required">*</span></label>
        <input class="form-control" id="f-product" placeholder="e.g. Cascade IPA" />
      </div>
      <div class="form-group">
        <label>Format <span class="required">*</span></label>
        <select class="form-control" id="f-format" onchange="var d=getDepositForFormat(this.value); document.getElementById('f-deposit').value=d||''">
          ${KEG_FORMATS.map(f => `<option value="${f}">${f}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Quantity <span class="required">*</span></label>
        <input class="form-control" id="f-qty" type="number" min="1" value="1" />
      </div>
      <div class="form-group">
        <label>Delivered Date</label>
        <input class="form-control" id="f-date" type="date" value="${today()}" />
      </div>
    </div>
    <div class="form-group">
      <label>Deposit per Keg ($)</label>
      <input class="form-control" id="f-deposit" type="number" step="0.01" min="0" value="${getDepositForFormat(KEG_FORMATS[0]) || ''}" placeholder="0.00" />
      <span class="text-muted text-sm">Pre-filled from Settings. Clear to record no deposit.</span>
    </div>
    <div class="form-group">
      <label>Notes</label>
      <input class="form-control" id="f-notes" type="text" placeholder="e.g. Migrated from previous system" />
    </div>`;
  modal.open('Add Kegs', formHtml, async () => {
    const accountId = presetAccountId || val('f-account');
    if (!accountId) { toast('Please select an account', 'error'); return; }
    const productName = val('f-product');
    if (!productName) { toast('Product name is required', 'error'); return; }
    const format = val('f-format');
    if (!format) { toast('Format is required', 'error'); return; }
    const qty = parseInt(val('f-qty'));
    if (!qty || qty < 1) { toast('Enter a valid quantity', 'error'); return; }
    const accountName = (state.accounts.find(a => a.ID === accountId) || {}).Name || '';
    await api.post('/api/keg-tracking', {
      accountId, accountName, productName, format,
      quantity: qty,
      depositPerUnit: val('f-deposit') || '',
      deliveredDate: val('f-date') || today(),
      notes: val('f-notes') || '',
    });
    modal.close();
    toast(`${qty} keg${qty > 1 ? 's' : ''} added`);
    if (state.view === 'account-profile') loadAccountProfile(state.accountProfileId);
    else loadKegs();
  });
  setTimeout(() => initMentions('f-notes'), 0);
}
