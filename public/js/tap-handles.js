'use strict';

let _tapHandlesCache = [];
let _tapHandlesStatusFilter = 'outstanding';

async function loadTapHandles(preservePage = false) {
  if (!preservePage) _paginationReset('tapHandles');
  showLoading();
  _tapHandlesCache = await api.get('/api/tap-handles');
  renderTapHandles();
}

function renderTapHandles() {
  const _focused = document.activeElement?.id;
  const search = (document.getElementById('th-search') || {}).value || '';
  const statusFilter = _tapHandlesStatusFilter;

  let filtered = _tapHandlesCache;

  // Status filter
  if (statusFilter === 'outstanding') {
    filtered = filtered.filter(h => {
      const qty = parseInt(h.Quantity) || 0;
      const collected = parseInt(h.CollectedQuantity) || 0;
      return qty - collected > 0;
    });
  }

  // Search filter
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(r =>
      (r.AccountName || '').toLowerCase().includes(q)
    );
  }

  // Sort: outstanding first (by deployed date descending)
  filtered.sort((a, b) => {
    const aOut = Math.max(0, (parseInt(a.Quantity) || 0) - (parseInt(a.CollectedQuantity) || 0));
    const bOut = Math.max(0, (parseInt(b.Quantity) || 0) - (parseInt(b.CollectedQuantity) || 0));
    if (aOut > 0 && bOut === 0) return -1;
    if (aOut === 0 && bOut > 0) return 1;
    return (b.DeployedDate || '').localeCompare(a.DeployedDate || '');
  });

  const totalOutstanding = _tapHandlesCache.reduce((sum, h) => {
    const qty = parseInt(h.Quantity) || 0;
    const collected = parseInt(h.CollectedQuantity) || 0;
    return sum + Math.max(0, qty - collected);
  }, 0);

  const pg = paginate(filtered, 'tapHandles');

  const rows = pg.total === 0
    ? `<tr><td colspan="6" class="empty-state">No tap handle records found.</td></tr>`
    : pg.rows.map(h => {
        const qty = parseInt(h.Quantity) || 0;
        const collected = parseInt(h.CollectedQuantity) || 0;
        const outstanding = Math.max(0, qty - collected);
        const fullyCollected = outstanding === 0;
        return `<tr class="${fullyCollected ? 'row-completed' : ''}">
          <td class="fw-600"><span class="td-link" onclick="loadAccountProfile('${esc(h.AccountID)}')">${esc(h.AccountName)}</span></td>
          <td class="text-sm">${formatDate(h.DeployedDate)}</td>
          <td class="text-center">${qty}</td>
          <td class="text-center">${collected}</td>
          <td class="text-center fw-600${outstanding > 0 ? ' text-danger' : ''}">${outstanding}</td>
          <td class="td-actions">
            <button class="btn btn-ghost btn-sm mobile-actions-toggle" onclick="toggleMobileActions(event)">&#8230;</button>
            <div class="mobile-actions-menu">
            ${outstanding > 0
              ? `<button class="btn btn-ghost btn-sm" onclick="openCollectTapHandle('${esc(h.ID)}', ${qty}, ${collected}, '${esc(h.Notes || '')}')">Collect</button>`
              : '<span class="badge" style="background:#e8f5e9;color:#2e7d32">Collected</span>'}
            <button class="btn btn-ghost btn-sm text-danger" onclick="deleteTapHandle('${esc(h.ID)}')">Del</button>
            </div>
          </td>
        </tr>`;
      }).join('');

  setContent(`
    <div class="view-header">
      <div>
        <h2>Tap Handles</h2>
        <p class="subtitle">${totalOutstanding} outstanding handle${totalOutstanding !== 1 ? 's' : ''} &mdash; ${filtered.length} record${filtered.length !== 1 ? 's' : ''}</p>
      </div>
      <div class="view-header-actions">
        <button class="btn btn-primary" onclick="openDeployTapHandle()">+ Deploy Tap Handle</button>
      </div>
    </div>

    <div class="filter-bar">
      <input type="search" id="th-search" placeholder="Search accounts…" value="${esc(search)}"
             oninput="_paginationReset('tapHandles'); renderTapHandles()" />
      <select id="th-status" onchange="_tapHandlesStatusFilter=this.value; _paginationReset('tapHandles'); renderTapHandles()">
        <option value="outstanding"${statusFilter === 'outstanding' ? ' selected' : ''}>Outstanding Only</option>
        <option value="all"${statusFilter === 'all' ? ' selected' : ''}>All Records</option>
      </select>
    </div>

    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Account</th><th>Deployed</th>
          <th class="text-center">Qty</th><th class="text-center">Collected</th><th class="text-center">Outstanding</th><th>Actions</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${pg.total > 0 ? paginationControls('tapHandles', pg, 'renderTapHandles') : ''}`);

  if (_focused === 'th-search') refocusSearch('th-search');
}

async function openDeployTapHandle(presetAccountId = '') {
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
        <label>Quantity <span class="required">*</span></label>
        <input class="form-control" id="f-qty" type="number" min="1" value="1" />
      </div>
      <div class="form-group">
        <label>Deployed Date</label>
      <input class="form-control" id="f-date" type="date" value="${today()}" />
    </div>
    <div class="form-group">
      <label>Notes</label>
      <input class="form-control" id="f-notes" type="text" placeholder="Optional notes" />
    </div>`;
  modal.open('Deploy Tap Handle', formHtml, async () => {
    const accountId = presetAccountId || val('f-account');
    if (!accountId) { toast('Please select an account', 'error'); return; }
    const qty = parseInt(val('f-qty'));
    if (!qty || qty < 1) { toast('Enter a valid quantity', 'error'); return; }
    const accountName = (state.accounts.find(a => a.ID === accountId) || {}).Name || '';
    await api.post('/api/tap-handles', {
      accountId, accountName,
      quantity: qty,
      deployedDate: val('f-date') || today(),
      notes: val('f-notes') || '',
    });
    modal.close();
    toast(`${qty} tap handle${qty > 1 ? 's' : ''} deployed`);
    if (state.view === 'account-profile') loadAccountProfile(state.accountProfileId);
    else loadTapHandles();
  });
  setTimeout(() => initMentions('f-notes'), 0);
}

async function openCollectTapHandle(handleId, totalQty, alreadyCollected, existingNotes) {
  if (state.staff.length === 0) state.staff = await api.get('/api/staff');
  const outstanding = totalQty - alreadyCollected;
  const notesHistory = existingNotes
    ? `<div style="margin-bottom:16px;padding:10px 12px;background:#f5f5f5;border-radius:6px;border:1px solid #e0e0e0">
        <div class="text-muted text-sm" style="margin-bottom:4px;font-weight:600">Previous notes</div>
        <div class="text-sm">${esc(existingNotes)}</div>
      </div>`
    : '';
  const formHtml = `
    <p class="text-muted text-sm" style="margin-bottom:16px">
      Deployed: <strong>${totalQty}</strong> &mdash;
      Collected: <strong>${alreadyCollected}</strong> &mdash;
      Outstanding: <strong class="text-danger">${outstanding}</strong>
    </p>
    ${notesHistory}
    <div class="form-group">
      <label for="f-collect-qty">Handles Collected Now <span class="required">*</span></label>
      <input class="form-control" type="number" id="f-collect-qty" min="1" max="${outstanding}" value="${outstanding}" />
    </div>
    <div class="form-group">
      <label for="f-collect-notes">Notes</label>
      <input class="form-control" type="text" id="f-collect-notes" placeholder="Optional notes" />
    </div>
  `;
  modal.open('Collect Tap Handles', formHtml, async () => {
    const collectQty = parseInt(val('f-collect-qty'));
    if (!collectQty || collectQty < 1 || collectQty > outstanding) {
      toast('Enter a valid quantity (1–' + outstanding + ')', 'error');
      return;
    }
    const newCollectedTotal = alreadyCollected + collectQty;
    const newNote = val('f-collect-notes') || '';
    const combinedNotes = [existingNotes, newNote].filter(Boolean).join(' | ');
    await api.put(`/api/tap-handles/${handleId}`, {
      CollectedQuantity: String(newCollectedTotal),
      CollectedDate: today(),
      Notes: combinedNotes,
    });
    modal.close();
    toast(`${collectQty} tap handle${collectQty > 1 ? 's' : ''} collected`);
    if (state.view === 'account-profile') loadAccountProfile(state.accountProfileId);
    else loadTapHandles();
  });
  setTimeout(() => initMentions('f-collect-notes'), 0);
}

async function deleteTapHandle(id) {
  modal.confirm('Delete Tap Handle', 'Are you sure you want to delete this tap handle record?', async () => {
    await api.del(`/api/tap-handles/${id}`);
    toast('Tap handle record deleted');
    if (state.view === 'account-profile') loadAccountProfile(state.accountProfileId);
    else loadTapHandles();
  });
}
