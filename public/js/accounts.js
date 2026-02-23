'use strict';

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
        <input class="form-control" id="f-phone" type="tel" value="${esc(formatPhone(acct.Phone))}" placeholder="(555) 000-0000" onblur="this.value=formatPhone(this.value)" />
      </div>
    </div>
    <hr class="form-divider" />
    <div class="form-section-title">Location</div>
    <div class="form-group">
      <label>Address</label>
      <input class="form-control" id="f-address" value="${esc(acct.Address)}" placeholder="123 Main St" />
    </div>
    <div class="form-row">
      <div class="form-group" style="flex:2">
        <label>City</label>
        <input class="form-control" id="f-city" value="${esc(acct.City)}" />
      </div>
      <div class="form-group" style="flex:1">
        <label>State</label>
        <input class="form-control" id="f-state" value="${esc(acct.State)}" placeholder="e.g. CA" maxlength="2" />
      </div>
      <div class="form-group" style="flex:1">
        <label>Zip</label>
        <input class="form-control" id="f-zip" value="${esc(acct.Zip)}" placeholder="e.g. 90210" maxlength="10" />
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

let _acctSort = { col: '', dir: 'asc' };

function sortAccounts(col) {
  _paginationReset('accounts');
  if (_acctSort.col === col) {
    _acctSort.dir = _acctSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    _acctSort.col = col;
    _acctSort.dir = 'asc';
  }
  renderAccounts();
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

  // Sort
  if (_acctSort.col) {
    const { col, dir } = _acctSort;
    filtered = [...filtered].sort((a, b) => {
      let av, bv;
      if (col === 'LastContacted') { av = a.LastContacted || ''; bv = b.LastContacted || ''; }
      else if (col === 'Name')     { av = (a.Name || '').toLowerCase(); bv = (b.Name || '').toLowerCase(); }
      if (av < bv) return dir === 'asc' ? -1 : 1;
      if (av > bv) return dir === 'asc' ? 1 : -1;
      return 0;
    });
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
            <th class="sortable-th${_acctSort.col === 'Name' ? ' sorted' : ''}" onclick="sortAccounts('Name')">Name${_acctSort.col === 'Name' ? (_acctSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</th><th>Type</th><th>Contact</th><th>Email / Phone</th>
            <th>Preferred</th><th>Sales Rep</th><th>Status</th><th class="sortable-th${_acctSort.col === 'LastContacted' ? ' sorted' : ''}" onclick="sortAccounts('LastContacted')">Last Contact${_acctSort.col === 'LastContacted' ? (_acctSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${pg.total === 0 ? `<tr><td colspan="9" class="empty-state">No accounts found.</td></tr>` :
            pg.rows.map(a => `<tr>
              <td class="fw-600"><span class="td-link" onclick="loadAccountProfile('${esc(a.ID)}')">${esc(a.Name)}</span><br><span class="text-muted text-sm">${esc(a.City)}${a.City && (a.State || a.Zip) ? ', ' : ''}${esc(a.State)}${a.State && a.Zip ? ' ' : ''}${esc(a.Zip)}</span></td>
              <td>${esc(a.Type)}</td>
              <td>${esc(a.ContactName) || '—'}</td>
              <td class="text-sm">${a.Email ? esc(a.Email) + '<br>' : ''}${esc(formatPhone(a.Phone))}</td>
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
    acct.Phone        ? `<div class="profile-info-item"><span class="profile-info-label">Phone</span><span>${esc(formatPhone(acct.Phone))}</span></div>` : '',
    acct.PreferredMethod ? `<div class="profile-info-item"><span class="profile-info-label">Preferred</span><span>${methodBadge(acct.PreferredMethod)}</span></div>` : '',
    (acct.Address || acct.City) ? `<div class="profile-info-item"><span class="profile-info-label">Address</span><span>${esc(acct.Address || '')}${acct.Address && (acct.City || acct.State || acct.Zip) ? ', ' : ''}${[acct.City, (acct.State && acct.Zip ? acct.State + ' ' + acct.Zip : acct.State || acct.Zip)].filter(Boolean).map(esc).join(', ')}</span></div>` : '',
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
        const isPreSale = s.Status === 'Pre-Sale';
        return `<tr>
          <td class="text-sm">${formatDate(s.OrderDate)}${s.RequestedProducts ? `<br><span class="text-muted text-sm">${truncateNote(s.RequestedProducts)}</span>` : ''}</td>
          <td class="text-sm">${esc(s.InvoiceNumber) || '—'}</td>
          <td class="text-sm">${esc(s.StaffName) || '—'}</td>
          <td>${isPreSale && !parseFloat(s.OrderAmount) ? '<span class="text-muted">—</span>' : fmtMoney(s.OrderAmount)}</td>
          <td>${s.TaxAmount && parseFloat(s.TaxAmount) > 0 ? fmtMoney(s.TaxAmount) : '—'}</td>
          <td class="fw-600">${isPreSale && !parseFloat(s.OrderAmount) ? '<span class="text-muted">—</span>' : fmtMoney(total)}</td>
          <td>${orderStatusBadge(s.Status)}</td>
          <td class="text-center">${isPreSale ? '—'
            : s.Delivered === 'true'
            ? '<input type="checkbox" checked disabled />'
            : `<input type="checkbox" onchange="profileToggleDelivered('${esc(s.ID)}')" />`}</td>
          <td class="td-actions">
            ${isPreSale ? `<button class="btn btn-ghost btn-sm text-success" onclick="profileConvertPreSale('${esc(s.ID)}')">Convert</button><button class="btn btn-ghost btn-sm text-danger" onclick="profileCancelPreSale('${esc(s.ID)}')">Cancel</button>`
            : `${s.Status === 'Pending' ? `<button class="btn btn-ghost btn-sm text-success" onclick="profileMarkOrderPaid('${esc(s.ID)}')">Mark Paid</button>` : ''}
            <button class="btn btn-ghost btn-sm" onclick="profileEditOrder('${esc(s.ID)}')">Edit</button>
            <button class="btn btn-ghost btn-sm text-danger" onclick="profileDeleteOrder('${esc(s.ID)}')">Del</button>`}
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
              ? `<button class="btn btn-ghost btn-sm" onclick="openReturnKegs('${esc(k.ID)}', '${esc(k.ProductName)}', '${esc(k.Format)}', ${qty}, ${returned}, '${esc(k.Notes || '')}')">Return Kegs</button>`
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
        <div>
          <button class="btn btn-ghost btn-sm" onclick="openAddPreSale('${esc(accountId)}')">+ Pre-Sale</button>
          <button class="btn btn-ghost btn-sm" onclick="openAddOrder('${esc(accountId)}')">+ Log Order</button>
        </div>
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
        <button class="btn btn-ghost btn-sm" onclick="openAddKegs('${esc(accountId)}')">+ Add Kegs</button>
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

function openReturnKegs(kegId, productName, format, totalQty, alreadyReturned, existingNotes) {
  const outstanding = totalQty - alreadyReturned;
  const notesHistory = existingNotes
    ? `<div style="margin-bottom:16px;padding:10px 12px;background:#f5f5f5;border-radius:6px;border:1px solid #e0e0e0">
        <div class="text-muted text-sm" style="margin-bottom:4px;font-weight:600">Previous notes</div>
        <div class="text-sm">${esc(existingNotes)}</div>
      </div>`
    : '';
  const formHtml = `
    <p class="text-muted text-sm" style="margin-bottom:16px">
      <strong>${esc(productName)} — ${esc(format)}</strong><br>
      Delivered: <strong>${totalQty}</strong> &mdash;
      Returned: <strong>${alreadyReturned}</strong> &mdash;
      Outstanding: <strong class="text-danger">${outstanding}</strong>
    </p>
    ${notesHistory}
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
    const newNote = val('f-return-notes') || '';
    const combinedNotes = [existingNotes, newNote].filter(Boolean).join(' | ');
    await api.put(`/api/keg-tracking/${kegId}`, {
      ReturnedQuantity: String(newReturnedTotal),
      ReturnedDate: new Date().toISOString().split('T')[0],
      Notes: combinedNotes,
    });
    modal.close();
    toast(`${returnQty} keg${returnQty > 1 ? 's' : ''} marked as returned`);
    if (state.view === 'account-profile') loadAccountProfile(state.accountProfileId);
    else loadKegs();
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
      Address: val('f-address'), City: val('f-city'), State: val('f-state'), Zip: val('f-zip'),
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
      Address: val('f-address'), City: val('f-city'), State: val('f-state'), Zip: val('f-zip'),
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
