'use strict';

const ACCOUNT_TYPES = ['Bar', 'Distributor', 'Restaurant', 'Retail Store', 'Grocery Store', 'Hotel', 'Event Venue', 'Individual', 'Other'];
const CONTACT_METHODS = ['Email', 'Phone', 'SMS', 'In-Person', 'Any'];
const ACCOUNT_STATUSES = ['Active', 'Prospect', 'Inactive'];
const CHECK_IN_FREQUENCIES = ['Weekly', 'Biweekly', 'Monthly', 'Quarterly'];
const CHECK_IN_DAYS = { Weekly: 7, Biweekly: 14, Monthly: 30, Quarterly: 90 };

let _profileOutreachCache = [];
let _profileTodosCache = [];
let _profileOrdersCache = [];
let _profileOrderFooter = '';
let _profileKegsCache = [];
let _profileKegsContext = {};

const FORMAT_CATEGORIES = {
  'Kegs':    fmt => (fmt || '').toLowerCase().includes('keg'),
  'Cans':    fmt => (fmt || '').toLowerCase().includes('can'),
  'Bottles': fmt => (fmt || '').toLowerCase().includes('bottle'),
};
let _emailInventoryCache = null;
let _emailInventoryCategory = 'All';
let _emailInventoryShowQty = true;
let _acctTagFilters = [];

function collectSelectedTags() {
  const checkboxes = document.querySelectorAll('#f-tags input[type="checkbox"]:checked');
  return JSON.stringify(Array.from(checkboxes).map(cb => cb.value));
}

function parseAdditionalEmails(acct) {
  try { return JSON.parse(acct.AdditionalEmails || '[]').filter(Boolean); }
  catch (e) { return []; }
}

function accountHasEmail(acct) {
  return !!(acct.Email || parseAdditionalEmails(acct).length > 0);
}

function getAllAccountEmails(acct) {
  const emails = [];
  if (acct.Email) emails.push(acct.Email);
  emails.push(...parseAdditionalEmails(acct));
  return emails;
}

function collectAdditionalEmails() {
  const raw = val('f-additional-emails');
  if (!raw) return '[]';
  const emails = raw.split('\n').map(e => e.trim()).filter(Boolean);
  return JSON.stringify(emails);
}

function computeOrderFrequencyStats(orders) {
  const valid = orders.filter(o => o.Status !== 'Cancelled' && o.Status !== 'Draft' && o.Status !== 'Pre-Sale');
  const sorted = valid.slice().sort((a, b) => (a.OrderDate || '').localeCompare(b.OrderDate || ''));
  const orderCount = sorted.length;
  let avgDaysBetween = null;
  let avgOrderAmount = null;
  let daysSinceLastOrder = null;

  if (orderCount >= 1) {
    const totals = sorted.reduce((sum, o) => sum + (parseFloat(o.OrderAmount) || 0), 0);
    avgOrderAmount = totals / orderCount;
  }
  if (orderCount >= 2) {
    let totalDays = 0;
    for (let i = 1; i < sorted.length; i++) {
      const prev = new Date(sorted[i - 1].OrderDate);
      const curr = new Date(sorted[i].OrderDate);
      totalDays += (curr - prev) / (1000 * 60 * 60 * 24);
    }
    avgDaysBetween = Math.round(totalDays / (sorted.length - 1));
  }
  if (orderCount >= 1) {
    const last = new Date(sorted[sorted.length - 1].OrderDate);
    daysSinceLastOrder = Math.round((new Date() - last) / (1000 * 60 * 60 * 24));
  }
  return { orderCount, avgDaysBetween, avgOrderAmount, daysSinceLastOrder };
}

function accountForm(acct = {}) {
  let acctTags = [];
  try { acctTags = JSON.parse(acct.Tags || '[]'); } catch (e) { acctTags = []; }
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
      <div class="form-group">
        <label>Check-in Frequency</label>
        <select class="form-control" id="f-checkin-frequency">
          <option value="">-- Not Set --</option>
          ${CHECK_IN_FREQUENCIES.map(f => `<option value="${f}"${acct.CheckInFrequency === f ? ' selected' : ''}>${f}</option>`).join('')}
        </select>
      </div>
    </div>
    ${ACCOUNT_TAGS.length > 0 ? `<div class="form-group">
      <label>Tags</label>
      <div id="f-tags" class="checkbox-group">
        ${ACCOUNT_TAGS.map(t => {
          const checked = acctTags.includes(t) ? 'checked' : '';
          return '<label class="checkbox-label"><input type="checkbox" value="' + esc(t) + '" ' + checked + ' /> ' + esc(t) + '</label>';
        }).join('')}
      </div>
    </div>` : ''}
    <div class="form-group">
      <label>Assigned Sales Rep</label>
      <select class="form-control" id="f-staff">
        <option value="">-- Unassigned --</option>
        ${staffOptions(acct.StaffID)}
      </select>
    </div>
    ${LOCATIONS.length > 1 ? `<div class="form-group">
      <label>Serviced By</label>
      <select class="form-control" id="f-serviced-by">
        <option value="">-- None --</option>
        ${LOCATIONS.map(l => `<option value="${l}" ${acct.ServicedBy === l ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
    </div>` : ''}
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
    <div class="form-group">
      <label>Additional Emails</label>
      <textarea class="form-control" id="f-additional-emails" rows="2" placeholder="One email per line">${esc(parseAdditionalEmails(acct).join('\n'))}</textarea>
      <span class="text-muted text-sm">Extra email addresses that will also receive emails sent to this account.</span>
    </div>
    <hr class="form-divider" />
    <div class="form-section-title">Billing Contact</div>
    <div class="form-group">
      <label>Billing Contact Name</label>
      <input class="form-control" id="f-billing-contact" value="${esc(acct.BillingContactName)}" placeholder="Billing contact name" />
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Billing Email</label>
        <input class="form-control" id="f-billing-email" type="email" value="${esc(acct.BillingEmail)}" placeholder="billing@venue.com" />
      </div>
      <div class="form-group">
        <label>Billing Phone</label>
        <input class="form-control" id="f-billing-phone" type="tel" value="${esc(formatPhone(acct.BillingPhone))}" placeholder="(555) 000-0000" onblur="this.value=formatPhone(this.value)" />
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
    <div class="form-group">
      <label class="checkbox-label">
        <input type="checkbox" id="f-charge-deposits" ${acct.ChargeDeposits === 'true' ? 'checked' : ''} />
        Charge keg deposits for this account
      </label>
    </div>
    <div class="form-group">
      <label class="checkbox-label">
        <input type="checkbox" id="f-taxable" ${acct.Taxable === 'true' ? 'checked' : ''} />
        Charge tax for this account
      </label>
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

async function loadAccounts(preservePage = false) {
  if (!preservePage) _paginationReset('accounts');
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
  const typeFilter     = (document.getElementById('acct-type')     || {}).value ?? nav.type     ?? '';
  const statusFilter   = (document.getElementById('acct-status')   || {}).value ?? nav.status   ?? '';
  const tagFilter      = _acctTagFilters.length > 0 ? _acctTagFilters : [];
  const methodFilter   = (document.getElementById('acct-method')   || {}).value ?? nav.method   ?? '';
  const locationFilter = (document.getElementById('acct-location') || {}).value ?? (state.location || '');
  const search         = (document.getElementById('acct-search')   || {}).value ?? nav.search   ?? '';

  let filtered = accounts;
  if (locationFilter) filtered = filtered.filter(a => !a.ServicedBy || a.ServicedBy === locationFilter);
  if (typeFilter) filtered = filtered.filter(a => a.Type === typeFilter);
  if (statusFilter === 'Inactive') {
    filtered = filtered.filter(a => a.Status === 'Inactive');
  } else if (statusFilter) {
    filtered = filtered.filter(a => a.Status === statusFilter);
  } else {
    filtered = filtered.filter(a => a.Status !== 'Inactive');
  }
  if (tagFilter.length > 0) {
    filtered = filtered.filter(a => {
      let tags = [];
      try { tags = JSON.parse(a.Tags || '[]'); } catch (e) { tags = []; }
      return tagFilter.some(t => tags.includes(t));
    });
  }
  if (methodFilter) {
    filtered = filtered.filter(a => a.PreferredMethod === methodFilter);
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
        ${state.emailConfigured ? '<button class="btn btn-secondary" onclick="openBulkEmail()">Email Selected</button>' : ''}
        <button class="btn btn-primary" onclick="openAddAccount()">+ Add Account</button>
      </div>
    </div>
    <div id="bulk-actions-bar" class="bulk-actions-bar" style="display:none">
      <span id="bulk-selected-count" class="text-sm fw-600">0 selected</span>
      <button class="btn btn-sm btn-secondary" onclick="openBulkEmail()">Email Selected</button>
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
      ${ACCOUNT_TAGS.length > 0 ? `<div class="dropdown-multi" id="tag-filter-dropdown">
        <button type="button" class="btn btn-secondary btn-filter-multi" onclick="toggleTagFilterMenu()">
          ${tagFilter.length === 0 ? 'All Tags' : tagFilter.length === 1 ? esc(tagFilter[0]) : tagFilter.length + ' Tags'}
          <span style="margin-left:4px;font-size:10px">&#9662;</span>
        </button>
        <div class="dropdown-multi-menu" id="tag-filter-menu" style="display:none">
          ${ACCOUNT_TAGS.map(t => `<label class="dropdown-multi-item" onclick="event.stopPropagation()">
            <input type="checkbox" value="${esc(t)}" ${tagFilter.includes(t) ? 'checked' : ''} onchange="applyTagFilter()" />
            ${esc(t)}
          </label>`).join('')}
          ${tagFilter.length > 0 ? '<div style="border-top:1px solid var(--border);margin:4px 0"></div><div class="dropdown-multi-item" style="color:var(--text-muted);cursor:pointer" onclick="clearTagFilter()">Clear all</div>' : ''}
        </div>
      </div>` : ''}
      <select id="acct-method" onchange="_paginationReset('accounts'); renderAccounts()">
        <option value="">All Methods</option>
        ${CONTACT_METHODS.map(m => `<option value="${m}" ${methodFilter === m ? 'selected' : ''}>${m}</option>`).join('')}
      </select>
      ${LOCATIONS.length > 1 ? `<select id="acct-location" onchange="_paginationReset('accounts'); renderAccounts()">
        <option value="">All Locations</option>
        ${LOCATIONS.map(l => '<option value="' + esc(l) + '"' + (locationFilter === l ? ' selected' : '') + '>' + esc(l) + '</option>').join('')}
      </select>` : ''}
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            ${state.emailConfigured ? '<th style="width:32px"><input type="checkbox" onchange="toggleAllAccounts(this)" title="Select all" /></th>' : ''}
            <th class="sortable-th${_acctSort.col === 'Name' ? ' sorted' : ''}" onclick="sortAccounts('Name')">Name${_acctSort.col === 'Name' ? (_acctSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</th><th class="mobile-hide">Type</th>
            <th class="mobile-hide">Preferred</th><th class="mobile-hide">Location</th><th>Status</th><th class="mobile-hide sortable-th${_acctSort.col === 'LastContacted' ? ' sorted' : ''}" onclick="sortAccounts('LastContacted')">Last Contact${_acctSort.col === 'LastContacted' ? (_acctSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</th><th class="mobile-hide">Check-in</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${pg.total === 0 ? `<tr><td colspan="${state.emailConfigured ? 9 : 8}" class="empty-state">No accounts found.</td></tr>` :
            pg.rows.map(a => `<tr>
              ${state.emailConfigured ? `<td><input type="checkbox" class="acct-select" data-account-id="${esc(a.ID)}" onchange="updateBulkEmailBar()" /></td>` : ''}
              <td class="fw-600"><span class="td-link" onclick="loadAccountProfile('${esc(a.ID)}')">${esc(a.Name)}</span><br><span class="text-muted text-sm">${esc(a.City)}${a.City && (a.State || a.Zip) ? ', ' : ''}${esc(a.State)}${a.State && a.Zip ? ' ' : ''}${esc(a.Zip)}</span>${(() => { let t = []; try { t = JSON.parse(a.Tags || '[]'); } catch(e) {} return t.length > 0 ? '<div class="tag-badges">' + t.map(x => '<span class="badge badge-tag">' + esc(x) + '</span>').join(' ') + '</div>' : ''; })()}</td>
              <td class="mobile-hide">${esc(a.Type)}</td>
              <td class="mobile-hide">${methodBadge(a.PreferredMethod)}</td>
              <td class="mobile-hide text-sm">${esc(a.ServicedBy) || '<span class="text-muted">—</span>'}</td>
              <td>${statusBadge(a.Status)}</td>
              <td class="mobile-hide text-sm text-muted">${formatDate(a.LastContacted)}</td>
              <td class="mobile-hide text-sm">${esc(a.CheckInFrequency) || '<span class="text-muted">—</span>'}</td>
              <td class="td-actions">
                <button class="btn btn-ghost btn-sm mobile-actions-toggle" onclick="toggleMobileActions(event)">&#8230;</button>
                <div class="mobile-actions-menu">
                <button class="btn btn-ghost btn-sm" onclick="loadAccountProfile('${esc(a.ID)}')">View</button>
                <button class="btn btn-ghost btn-sm" onclick="openLogOutreach('${esc(a.ID)}')">+ Log</button>
                <button class="btn btn-ghost btn-sm" onclick="openEditAccount('${esc(a.ID)}')">Edit</button>
                <button class="btn btn-ghost btn-sm" onclick="openMergeAccount('${esc(a.ID)}')">Merge</button>
                <button class="btn btn-ghost btn-sm text-danger" data-name="${esc(a.Name)}" onclick="deleteAccount('${esc(a.ID)}', this.dataset.name)">Del</button>
                </div>
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
  // Keep 'accounts' nav item highlighted and submenu open
  // Update hash for back/forward navigation and deep-linking
  const profileHash = '#account/' + encodeURIComponent(accountId);
  if (window.location.hash !== profileHash) window.location.hash = profileHash;
  // Keep 'accounts' nav item highlighted
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.view === 'accounts');
  });
  document.querySelectorAll('.nav-subitem').forEach(el => {
    el.classList.toggle('active', el.dataset.view === 'accounts');
  });
  document.querySelectorAll('.nav-group').forEach(g => {
    g.classList.toggle('open', g.dataset.group === 'accounts');
  });
  showLoading();

  const [outreach, todos, orders, kegRecords, tapHandleRecords, acctCredits] = await Promise.all([
    api.get('/api/outreach'),
    api.get('/api/reminders?status=all'),
    api.get('/api/orders'),
    api.get(`/api/keg-tracking?accountId=${accountId}`),
    api.get(`/api/tap-handles?accountId=${accountId}`),
    api.get(`/api/credits?accountId=${accountId}`),
  ]);
  if (state.accounts.length === 0) state.accounts = await api.get('/api/accounts');

  const acct = state.accounts.find(a => a.ID === accountId);
  if (!acct) { toast('Account not found', 'error'); return; }

  const acctOutreach = outreach
    .filter(o => o.AccountID === accountId)
    .sort((a, b) => (b.Date || '').localeCompare(a.Date || ''));
  const acctTodos = todos
    .filter(t => t.AccountID === accountId)
    .sort((a, b) => {
      const aDone = a.Completed === 'true' ? 1 : 0;
      const bDone = b.Completed === 'true' ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;
      return (a.DueDate || '').localeCompare(b.DueDate || '');
    });
  const acctOrders = orders
    .filter(s => s.AccountID === accountId)
    .sort((a, b) => (b.OrderDate || '').localeCompare(a.OrderDate || ''));
  _profileOutreachCache = acctOutreach;
  _profileTodosCache = acctTodos;
  _profileOrdersCache = acctOrders;

  const totalRevenue = acctOrders.reduce((sum, s) => sum + (parseFloat(s.OrderAmount || 0) + parseFloat(s.TaxAmount || 0) + parseFloat(s.DepositAmount || 0)), 0);
  const activeTodos  = acctTodos.filter(t => t.Completed !== 'true').length;
  const freqStats = computeOrderFrequencyStats(acctOrders);

  // Keg tracking calculations
  const acctKegs = (kegRecords || []).sort((a, b) => (b.DeliveredDate || '').localeCompare(a.DeliveredDate || ''));
  _profileKegsCache = acctKegs;
  _profileKegsContext = { accountId, accountName: acct.Name };
  const outstandingKegs = acctKegs.reduce((sum, k) => {
    const qty = parseInt(k.Quantity) || 0;
    const returned = parseInt(k.ReturnedQuantity) || 0;
    return sum + Math.max(0, qty - returned);
  }, 0);

  // Deposit calculations
  const depositsOutstanding = acctKegs.reduce((sum, k) => {
    const depTotal = parseFloat(k.DepositTotal) || 0;
    const depRefunded = parseFloat(k.DepositRefunded) || 0;
    const qty = parseInt(k.Quantity) || 0;
    const returned = parseInt(k.ReturnedQuantity) || 0;
    if (depTotal > 0 && (qty - returned) > 0) return sum + (depTotal - depRefunded);
    return sum;
  }, 0);

  // Credit balance calculation
  const sortedCredits = (acctCredits || []).sort((a, b) => (b.CreatedAt || '').localeCompare(a.CreatedAt || ''));
  const creditBalance = sortedCredits.reduce((sum, c) => {
    const amt = parseFloat(c.Amount) || 0;
    return c.Type === 'credit' ? sum + amt : sum - amt;
  }, 0);
  const pendingOrderIds = new Set(acctOrders.filter(o => o.Status === 'Pending').map(o => o.ID));
  const creditOnPending = sortedCredits
    .filter(c => c.Type === 'applied' && pendingOrderIds.has(c.OrderID))
    .reduce((sum, c) => sum + (parseFloat(c.Amount) || 0), 0);
  const totalCreditAvailable = parseFloat((creditBalance + creditOnPending).toFixed(2));

  // Tap handle calculations
  const acctTapHandles = (tapHandleRecords || []).sort((a, b) => (b.DeployedDate || '').localeCompare(a.DeployedDate || ''));
  const outstandingHandles = acctTapHandles.reduce((sum, h) => {
    const qty = parseInt(h.Quantity) || 0;
    const collected = parseInt(h.CollectedQuantity) || 0;
    return sum + Math.max(0, qty - collected);
  }, 0);

  const infoRows = [
    `<div class="profile-info-item"><span class="profile-info-label">Account ID</span><span class="text-muted text-sm" style="font-family:monospace">${esc(acct.ID)}</span></div>`,
    acct.ContactName  ? `<div class="profile-info-item"><span class="profile-info-label">Contact</span><span>${esc(acct.ContactName)}</span></div>` : '',
    accountHasEmail(acct) ? `<div class="profile-info-item"><span class="profile-info-label">Email</span><span>${esc(acct.Email || '')}${(() => { const ae = parseAdditionalEmails(acct); return ae.length > 0 ? (acct.Email ? '<br>' : '') + ae.map(e => esc(e)).join('<br>') : ''; })()}</span></div>` : '',
    acct.Phone        ? `<div class="profile-info-item"><span class="profile-info-label">Phone</span><span>${esc(formatPhone(acct.Phone))}</span></div>` : '',
    acct.PreferredMethod ? `<div class="profile-info-item"><span class="profile-info-label">Preferred</span><span>${methodBadge(acct.PreferredMethod)}</span></div>` : '',
    acct.BillingContactName ? `<div class="profile-info-item"><span class="profile-info-label">Billing Contact</span><span>${esc(acct.BillingContactName)}</span></div>` : '',
    acct.BillingEmail ? `<div class="profile-info-item"><span class="profile-info-label">Billing Email</span><span>${esc(acct.BillingEmail)}</span></div>` : '',
    acct.BillingPhone ? `<div class="profile-info-item"><span class="profile-info-label">Billing Phone</span><span>${esc(formatPhone(acct.BillingPhone))}</span></div>` : '',
    (acct.Address || acct.City) ? `<div class="profile-info-item"><span class="profile-info-label">Address</span><span>${esc(acct.Address || '')}${acct.Address && (acct.City || acct.State || acct.Zip) ? ', ' : ''}${[acct.City, (acct.State && acct.Zip ? acct.State + ' ' + acct.Zip : acct.State || acct.Zip)].filter(Boolean).map(esc).join(', ')}</span></div>` : '',
    acct.ABCLicense   ? `<div class="profile-info-item"><span class="profile-info-label">ABC License</span><span>${esc(acct.ABCLicense)}</span></div>` : '',
    (() => { let tags = []; try { tags = JSON.parse(acct.Tags || '[]'); } catch (e) {} return tags.length > 0 ? `<div class="profile-info-item"><span class="profile-info-label">Tags</span><span class="tag-badges">${tags.map(t => '<span class="badge badge-tag">' + esc(t) + '</span>').join(' ')}</span></div>` : ''; })(),
    acct.StaffName    ? `<div class="profile-info-item"><span class="profile-info-label">Sales Rep</span><span>${esc(acct.StaffName)}</span></div>` : '',
    acct.ServicedBy   ? `<div class="profile-info-item"><span class="profile-info-label">Serviced By</span><span>${esc(acct.ServicedBy)}</span></div>` : '',
    acct.LastContacted ? `<div class="profile-info-item"><span class="profile-info-label">Last Contact</span><span>${formatDate(acct.LastContacted)}</span></div>` : '',
    acct.CheckInFrequency ? `<div class="profile-info-item"><span class="profile-info-label">Check-in Frequency</span><span>${esc(acct.CheckInFrequency)}</span></div>` : '',
    acct.Notes        ? `<div class="profile-info-item profile-info-full"><span class="profile-info-label">Notes</span><span>${esc(acct.Notes)}</span></div>` : '',
  ].filter(Boolean).join('');

  // Outreach, todo, and order rows rendered by their respective render functions after setContent
  _profileOrderFooter = acctOrders.length > 1
    ? `<tfoot><tr class="table-totals">
        <td class="text-muted text-sm">${acctOrders.length} orders</td>
        <td class="mobile-hide"></td>
        <td class="mobile-hide"></td>
        <td class="mobile-hide"></td>
        <td class="mobile-hide"></td>
        <td class="fw-600">${fmtMoney(totalRevenue)}</td>
        <td></td>
        <td class="mobile-hide"></td>
        <td></td>
      </tr></tfoot>`
    : '';

  // kegRows rendered by renderProfileKegs() after setContent

  const tapHandleRows = acctTapHandles.length === 0
    ? `<tr><td colspan="5" class="empty-state">No tap handles deployed.</td></tr>`
    : acctTapHandles.map(h => {
        const qty = parseInt(h.Quantity) || 0;
        const collected = parseInt(h.CollectedQuantity) || 0;
        const outstanding = Math.max(0, qty - collected);
        const fullyCollected = outstanding === 0;
        return `<tr class="${fullyCollected ? 'row-completed' : ''}">
          <td class="mobile-hide text-sm">${formatDate(h.DeployedDate)}</td>
          <td class="text-center">${qty}</td>
          <td class="mobile-hide text-center">${collected}</td>
          <td class="text-center fw-600${outstanding > 0 ? ' text-danger' : ''}">${outstanding}</td>
          <td class="td-actions">
            <button class="btn btn-ghost btn-sm mobile-actions-toggle" onclick="toggleMobileActions(event)">&#8230;</button>
            <div class="mobile-actions-menu">
            ${outstanding > 0
              ? `<button class="btn btn-ghost btn-sm" onclick="openCollectTapHandle('${esc(h.ID)}', ${qty}, ${collected}, '${esc(h.Notes || '')}')">Collect</button>`
              : '<span class="badge" style="background:#e8f5e9;color:#2e7d32">Collected</span>'}
            </div>
          </td>
        </tr>`;
      }).join('');

  setContent(`
    <div class="view-header">
      <div style="display:flex;align-items:center;gap:12px">
        <button class="btn btn-ghost btn-sm" onclick="loadAccounts()">&#8592; Accounts</button>
        <div>
          <h2>${esc(acct.Name)}</h2>
          <p class="subtitle">${esc(acct.Type)} &mdash; ${statusBadge(acct.Status)}${(() => { let tags = []; try { tags = JSON.parse(acct.Tags || '[]'); } catch(e) {} return tags.length > 0 ? ' &mdash; ' + tags.map(t => '<span class="badge badge-tag">' + esc(t) + '</span>').join(' ') : ''; })()}</p>
        </div>
      </div>
      <div class="view-header-actions profile-header-actions">
        <button class="btn btn-ghost btn-sm profile-action-more mobile-actions-toggle" onclick="toggleMobileActions(event)">&#8230;</button>
        <div class="mobile-actions-menu">
        <button class="btn btn-ghost btn-sm" onclick="openLogOutreach('${esc(accountId)}')">+ Log Contact</button>
        <button class="btn btn-ghost btn-sm" onclick="openAddTodo('${esc(accountId)}')">+ Add Todo</button>
        <button class="btn btn-ghost btn-sm" onclick="openAddOrder('${esc(accountId)}')">+ Log Order</button>
        ${state.emailConfigured && accountHasEmail(acct) ? `<button class="btn btn-ghost btn-sm" onclick="openEmailCompose('${esc(accountId)}')">Email</button>` : ''}
        <button class="btn btn-ghost btn-sm" onclick="openMergeAccount('${esc(accountId)}')">Merge</button>
        </div>
        <button class="btn btn-primary btn-sm" onclick="openEditAccount('${esc(accountId)}')">Edit Account</button>
      </div>
    </div>

    <div class="profile-stats">
      <div class="profile-stat"><div class="stat-value">${acctOutreach.length}</div><div class="stat-label">Contacts Logged</div></div>
      <div class="profile-stat"><div class="stat-value">${activeTodos}</div><div class="stat-label">Open Todos</div></div>
      <div class="profile-stat"><div class="stat-value">${acctOrders.length}</div><div class="stat-label">Orders</div></div>
      <div class="profile-stat"><div class="stat-value">${fmtMoney(totalRevenue)}</div><div class="stat-label">Total Revenue</div></div>
      <div class="profile-stat"><div class="stat-value">${freqStats.avgDaysBetween != null ? freqStats.avgDaysBetween + 'd' : '--'}</div><div class="stat-label">Avg Days Between Orders</div></div>
      <div class="profile-stat"><div class="stat-value">${freqStats.avgOrderAmount != null ? fmtMoney(freqStats.avgOrderAmount) : '--'}</div><div class="stat-label">Avg Order</div></div>
      <div class="profile-stat"><div class="stat-value${freqStats.daysSinceLastOrder != null && acct.CheckInFrequency && freqStats.daysSinceLastOrder > (CHECK_IN_DAYS[acct.CheckInFrequency] || Infinity) ? ' text-danger' : ''}">${freqStats.daysSinceLastOrder != null ? freqStats.daysSinceLastOrder + 'd' : '--'}</div><div class="stat-label">Since Last Order</div></div>
      <div class="profile-stat"><div class="stat-value${outstandingKegs > 0 ? ' text-danger' : ''}">${outstandingKegs}</div><div class="stat-label">Kegs Out</div></div>
      ${depositsOutstanding > 0 ? `<div class="profile-stat"><div class="stat-value text-danger">${fmtMoney(depositsOutstanding)}</div><div class="stat-label">Deposits Owed</div></div>` : ''}
      ${totalCreditAvailable > 0 ? `<div class="profile-stat"><div class="stat-value" style="color:#2e7d32">${fmtMoney(totalCreditAvailable)}</div><div class="stat-label">Credit Balance${creditOnPending > 0 ? `<br><span class="text-sm text-muted">(${fmtMoney(creditOnPending)} on pending)</span>` : ''}</div></div>` : ''}
      <div class="profile-stat"><div class="stat-value${outstandingHandles > 0 ? ' text-danger' : ''}">${outstandingHandles}</div><div class="stat-label">Tap Handles Out</div></div>
    </div>

    <div class="profile-info card" style="margin-bottom:24px">
      ${infoRows || '<span class="text-muted">No additional info on file.</span>'}
    </div>

    <div class="profile-section">
      <div class="profile-section-header">
        <h3>Outreach History <span class="text-muted text-sm">(${acctOutreach.length})</span></h3>
        <button class="btn btn-ghost btn-sm" onclick="openLogOutreach('${esc(accountId)}')">+ Log Contact</button>
      </div>
      <div id="profile-outreach-container"></div>
    </div>

    <div class="profile-section">
      <div class="profile-section-header">
        <h3>Todos <span class="text-muted text-sm">(${activeTodos} open / ${acctTodos.length} total)</span></h3>
        <button class="btn btn-ghost btn-sm" onclick="openAddTodo('${esc(accountId)}')">+ Add Todo</button>
      </div>
      <div id="profile-todos-container"></div>
    </div>

    <div class="profile-section">
      <div class="profile-section-header">
        <h3>Order History <span class="text-muted text-sm">(${acctOrders.length})</span></h3>
        <div>
          <button class="btn btn-ghost btn-sm" onclick="openAddPreSale('${esc(accountId)}')">+ Pre-Sale</button>
          <button class="btn btn-ghost btn-sm" onclick="openAddOrder('${esc(accountId)}')">+ Log Order</button>
        </div>
      </div>
      <div id="profile-orders-container"></div>
    </div>

    <div class="profile-section">
      <div class="profile-section-header">
        <h3>Credits <span class="text-muted text-sm">(${sortedCredits.length}${totalCreditAvailable > 0 ? ' · Balance: ' + fmtMoney(totalCreditAvailable) + (creditOnPending > 0 ? ' · ' + fmtMoney(creditOnPending) + ' on pending' : '') : ''})</span></h3>
        <button class="btn btn-ghost btn-sm" onclick="openAddCredit('${esc(accountId)}')">+ Add Credit</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Type</th><th>Amount</th><th class="mobile-hide">Reason</th><th class="mobile-hide">Order</th><th>Actions</th></tr></thead>
          <tbody>${sortedCredits.length === 0
            ? '<tr><td colspan="6" class="empty-state">No credits recorded.</td></tr>'
            : sortedCredits.map(c => {
                const isCredit = c.Type === 'credit';
                const isPendingOrder = !isCredit && pendingOrderIds.has(c.OrderID);
                const typeBadgeHtml = isCredit
                  ? '<span class="badge" style="background:#e8f5e9;color:#2e7d32">Credit</span>'
                  : isPendingOrder
                    ? '<span class="badge" style="background:#fff3e0;color:#e65100">Pending</span>'
                    : '<span class="badge" style="background:#fff3e0;color:#e65100">Applied</span>';
                return `<tr>
                  <td class="text-sm">${formatDate(c.CreatedAt)}</td>
                  <td>${typeBadgeHtml}</td>
                  <td class="fw-600" style="color:${isCredit ? '#2e7d32' : '#e65100'}">${isCredit ? '+' : '-'}${fmtMoney(c.Amount)}</td>
                  <td class="mobile-hide text-sm">${esc(c.Reason) || '—'}</td>
                  <td class="mobile-hide text-sm">${c.OrderID ? `<span class="td-link" onclick="profileEditOrder('${esc(c.OrderID)}')">View Order</span>` : '—'}</td>
                  <td class="td-actions">
                    <button class="btn btn-ghost btn-sm mobile-actions-toggle" onclick="toggleMobileActions(event)">&#8230;</button>
                    <div class="mobile-actions-menu">
                    ${isCredit ? `<button class="btn btn-ghost btn-sm" onclick="profileEditCredit('${esc(c.ID)}')">Edit</button><button class="btn btn-ghost btn-sm text-danger" onclick="profileDeleteCredit('${esc(c.ID)}')">Del</button>` : ''}
                    </div>
                  </td>
                </tr>`;
              }).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="profile-section">
      <div class="profile-section-header">
        <h3>Keg Tracking <span class="text-muted text-sm">(${outstandingKegs} outstanding)</span></h3>
        <button class="btn btn-ghost btn-sm" onclick="openAddKegs('${esc(accountId)}')">+ Add Kegs</button>
      </div>
      <div id="profile-kegs-container"></div>
    </div>

    <div class="profile-section">
      <div class="profile-section-header">
        <h3>Tap Handles <span class="text-muted text-sm">(${outstandingHandles} outstanding)</span></h3>
        <button class="btn btn-ghost btn-sm" onclick="openDeployTapHandle('${esc(accountId)}')">+ Deploy Tap Handle</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th class="mobile-hide">Deployed</th><th class="text-center">Qty</th><th class="mobile-hide text-center">Collected</th><th class="text-center">Outstanding</th><th>Actions</th></tr></thead>
          <tbody>${tapHandleRows}</tbody>
        </table>
      </div>
    </div>
  `);
  _paginationReset('profileOutreach');
  _paginationReset('profileTodos');
  _paginationReset('profileOrders');
  _paginationReset('profileKegs');
  renderProfileOutreach();
  renderProfileTodos();
  renderProfileOrders();
  renderProfileKegs();
}

function renderProfileOutreach() {
  const container = document.getElementById('profile-outreach-container');
  if (!container) return;
  const pg = paginate(_profileOutreachCache, 'profileOutreach');
  const rows = pg.rows.length === 0
    ? `<tr><td colspan="5" class="empty-state">No outreach logged yet.</td></tr>`
    : pg.rows.map(o => `<tr>
        <td class="text-sm">${formatDate(o.Date)}</td>
        <td>${methodBadge(o.Method)}</td>
        <td class="mobile-hide text-sm note-cell">${truncateNote(o.Notes)}</td>
        <td class="mobile-hide text-sm">${o.FollowUpDate ? formatDate(o.FollowUpDate) : '—'}</td>
        <td class="td-actions">
          <button class="btn btn-ghost btn-sm mobile-actions-toggle" onclick="toggleMobileActions(event)">&#8230;</button>
          <div class="mobile-actions-menu">
          <button class="btn btn-ghost btn-sm" onclick="profileEditOutreach('${esc(o.ID)}')">Edit</button>
          <button class="btn btn-ghost btn-sm text-danger" onclick="profileDeleteOutreach('${esc(o.ID)}')">Del</button>
          </div>
        </td>
      </tr>`).join('');
  container.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Date</th><th>Method</th><th class="mobile-hide">Notes</th><th class="mobile-hide">Follow-up</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${pg.total > 0 ? paginationControls('profileOutreach', pg, 'renderProfileOutreach') : ''}`;
}

function renderProfileTodos() {
  const container = document.getElementById('profile-todos-container');
  if (!container) return;
  const pg = paginate(_profileTodosCache, 'profileTodos');
  const rows = pg.rows.length === 0
    ? `<tr><td colspan="6" class="empty-state">No todos for this account.</td></tr>`
    : pg.rows.map(t => `<tr class="${t.Completed === 'true' ? 'row-completed' : ''}">
        <td class="fw-600"><span class="td-link" onclick="profileEditTodo('${esc(t.ID)}')">${esc(t.Title)}</span>${t.Recurrence && t.Recurrence !== 'none' ? ' <span class="badge badge-recurrence" title="Recurring">↻</span>' : ''}</td>
        <td class="mobile-hide">${typeBadge(t.Type) || '—'}</td>
        <td>${urgencyBadge(t.DueDate, t.Completed)}</td>
        <td class="mobile-hide">${priorityBadge(t.Priority)}</td>
        <td class="mobile-hide text-sm text-muted">${esc(t.Notes) || '—'}</td>
        <td class="td-actions">
          <button class="btn btn-ghost btn-sm mobile-actions-toggle" onclick="toggleMobileActions(event)">&#8230;</button>
          <div class="mobile-actions-menu">
          ${t.Completed !== 'true'
            ? `<button class="btn btn-ghost btn-sm" onclick="profileCompleteTodo('${esc(t.ID)}')">Done</button>`
            : `<button class="btn btn-ghost btn-sm" onclick="profileReopenTodo('${esc(t.ID)}')">Reopen</button>`}
          <button class="btn btn-ghost btn-sm" onclick="profileEditTodo('${esc(t.ID)}')">Edit</button>
          <button class="btn btn-ghost btn-sm text-danger" onclick="profileDeleteTodo('${esc(t.ID)}')">Del</button>
          </div>
        </td>
      </tr>`).join('');
  container.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Title</th><th class="mobile-hide">Type</th><th>Due</th><th class="mobile-hide">Priority</th><th class="mobile-hide">Notes</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${pg.total > 0 ? paginationControls('profileTodos', pg, 'renderProfileTodos') : ''}`;
}

function renderProfileOrders() {
  const container = document.getElementById('profile-orders-container');
  if (!container) return;
  const pg = paginate(_profileOrdersCache, 'profileOrders');
  const rows = pg.rows.length === 0
    ? `<tr><td colspan="9" class="empty-state">No orders recorded yet.</td></tr>`
    : pg.rows.map(s => {
        const total = parseFloat(s.OrderAmount || 0) + parseFloat(s.TaxAmount || 0) + parseFloat(s.DepositAmount || 0);
        const isPreSale = s.Status === 'Pre-Sale';
        return `<tr>
          <td class="text-sm">${formatDate(s.OrderDate)}${formatProductsSummary(s.RequestedProducts)}</td>
          <td class="mobile-hide text-sm">${esc(s.InvoiceNumber) || '—'}</td>
          <td class="mobile-hide text-sm">${s.DeliveryDate ? formatDate(s.DeliveryDate) : '—'}</td>
          <td class="mobile-hide">${isPreSale && !parseFloat(s.OrderAmount) ? '<span class="text-muted">—</span>' : fmtMoney(s.OrderAmount)}</td>
          <td class="mobile-hide">${s.TaxAmount && parseFloat(s.TaxAmount) > 0 ? fmtMoney(s.TaxAmount) : '—'}</td>
          <td class="fw-600">${isPreSale && !parseFloat(s.OrderAmount) ? '<span class="text-muted">—</span>' : fmtMoney(total)}</td>
          <td>${orderStatusBadge(s.Status)}</td>
          <td class="mobile-hide text-center">${isPreSale ? '—'
            : s.Delivered === 'true'
            ? '<input type="checkbox" checked disabled />'
            : `<input type="checkbox" onchange="profileToggleDelivered('${esc(s.ID)}')" />`}</td>
          <td class="td-actions">
            <button class="btn btn-ghost btn-sm mobile-actions-toggle" onclick="toggleMobileActions(event)">&#8230;</button>
            <div class="mobile-actions-menu">
            ${isPreSale ? `<button class="btn btn-ghost btn-sm" onclick="profileEditPreSale('${esc(s.ID)}')">Edit</button><button class="btn btn-ghost btn-sm text-success" onclick="profileConvertPreSale('${esc(s.ID)}')">Convert</button><button class="btn btn-ghost btn-sm text-danger" onclick="profileCancelPreSale('${esc(s.ID)}')">Cancel</button>`
            : `${s.Status === 'Pending' ? `<button class="btn btn-ghost btn-sm text-success" onclick="profileMarkOrderPaid('${esc(s.ID)}')">Mark Paid</button>` : ''}
            <button class="btn btn-ghost btn-sm" onclick="profileEditOrder('${esc(s.ID)}')">${s.Status === 'Paid' ? 'View' : 'Edit'}</button>
            <button class="btn btn-ghost btn-sm text-danger" onclick="profileDeleteOrder('${esc(s.ID)}')">Del</button>`}
            </div>
          </td>
        </tr>`;
      }).join('');
  container.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Order Date</th><th class="mobile-hide">Invoice #</th><th class="mobile-hide">Delivery Date</th><th class="mobile-hide">Amount</th><th class="mobile-hide">Tax</th><th>Total</th><th>Status</th><th class="mobile-hide">Delivered</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
        ${_profileOrderFooter}
      </table>
    </div>
    ${pg.total > 0 ? paginationControls('profileOrders', pg, 'renderProfileOrders') : ''}`;
}

function renderProfileKegs() {
  const container = document.getElementById('profile-kegs-container');
  if (!container) return;
  const { accountId, accountName } = _profileKegsContext;
  const pg = paginate(_profileKegsCache, 'profileKegs');
  const rows = pg.rows.length === 0
    ? `<tr><td colspan="9" class="empty-state">No keg deliveries recorded.</td></tr>`
    : pg.rows.map(k => {
        const qty = parseInt(k.Quantity) || 0;
        const returned = parseInt(k.ReturnedQuantity) || 0;
        const outstanding = Math.max(0, qty - returned);
        const fullyReturned = outstanding === 0;
        const depTotal = parseFloat(k.DepositTotal) || 0;
        const depRefunded = parseFloat(k.DepositRefunded) || 0;
        const depOutstanding = depTotal - depRefunded;
        return `<tr class="${fullyReturned ? 'row-completed' : ''}">
          <td class="mobile-hide text-sm">${formatDate(k.DeliveredDate)}</td>
          <td class="fw-600">${esc(k.ProductName)}</td>
          <td class="mobile-hide text-sm">${esc(k.Format)}</td>
          <td class="text-center">${qty}</td>
          <td class="mobile-hide text-center">${returned}</td>
          <td class="text-center fw-600${outstanding > 0 ? ' text-danger' : ''}">${outstanding}</td>
          <td class="mobile-hide text-sm">${depTotal > 0 ? fmtMoney(depTotal) : '—'}</td>
          <td class="mobile-hide text-sm">${depTotal > 0 ? (fullyReturned || depOutstanding <= 0 ? '<span class="badge" style="background:#e8f5e9;color:#2e7d32">Fully refunded</span>' : fmtMoney(depRefunded) + ' / ' + fmtMoney(depTotal)) : '—'}</td>
          <td class="td-actions">
            <button class="btn btn-ghost btn-sm mobile-actions-toggle" onclick="toggleMobileActions(event)">&#8230;</button>
            <div class="mobile-actions-menu">
            ${outstanding > 0
              ? `<button class="btn btn-ghost btn-sm" data-product="${esc(k.ProductName)}" data-format="${esc(k.Format)}" data-notes="${esc(k.Notes || '')}" data-deposit-per-unit="${esc(k.DepositPerUnit || '')}" data-deposit-refunded="${esc(k.DepositRefunded || '')}" data-deposit-total="${esc(k.DepositTotal || '')}" data-account-id="${esc(accountId)}" data-account-name="${esc(accountName)}" onclick="openReturnKegs('${esc(k.ID)}', this.dataset.product, this.dataset.format, ${qty}, ${returned}, this.dataset.notes, this.dataset.depositPerUnit, this.dataset.depositRefunded, this.dataset.depositTotal, this.dataset.accountId, this.dataset.accountName)">Return Kegs</button>`
              : '<span class="badge" style="background:#e8f5e9;color:#2e7d32">Returned</span>'}
            </div>
          </td>
        </tr>`;
      }).join('');
  container.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th class="mobile-hide">Delivered</th><th>Product</th><th class="mobile-hide">Format</th><th class="text-center">Qty</th><th class="mobile-hide text-center">Returned</th><th class="text-center">Outstanding</th><th class="mobile-hide">Deposit</th><th class="mobile-hide">Refund Status</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${pg.total > 0 ? paginationControls('profileKegs', pg, 'renderProfileKegs') : ''}`;
}

function openReturnKegs(kegId, productName, format, totalQty, alreadyReturned, existingNotes, depositPerUnit, depositRefunded, depositTotal, accountId, accountName) {
  const outstanding = totalQty - alreadyReturned;
  const depPerUnit = parseFloat(depositPerUnit) || 0;
  const depRefunded = parseFloat(depositRefunded) || 0;
  const depTotal = parseFloat(depositTotal) || 0;
  const notesHistory = existingNotes
    ? `<div style="margin-bottom:16px;padding:10px 12px;background:#f5f5f5;border-radius:6px;border:1px solid #e0e0e0">
        <div class="text-muted text-sm" style="margin-bottom:4px;font-weight:600">Previous notes</div>
        <div class="text-sm">${esc(existingNotes)}</div>
      </div>`
    : '';
  const depositSection = depPerUnit > 0 ? `
    <div style="margin-bottom:16px;padding:10px 12px;background:#fff8e1;border-radius:6px;border:1px solid #ffe082">
      <div class="text-sm" style="margin-bottom:4px;font-weight:600">Deposit Info</div>
      <div class="text-sm">
        Deposit per keg: <strong>$${depPerUnit.toFixed(2)}</strong> &mdash;
        Total deposit: <strong>$${depTotal.toFixed(2)}</strong> &mdash;
        Already refunded: <strong>$${depRefunded.toFixed(2)}</strong>
      </div>
      <div class="text-sm" style="margin-top:8px">
        Refund for this return: <strong id="deposit-refund-preview">$${(outstanding * depPerUnit).toFixed(2)}</strong>
      </div>
      ${accountId ? `<div style="margin-top:8px">
        <label class="checkbox-label" style="margin-right:12px">
          <input type="radio" name="deposit-refund-dest" value="credit" checked /> Credit on account
        </label>
        <label class="checkbox-label">
          <input type="radio" name="deposit-refund-dest" value="refund" /> Record refund only
        </label>
      </div>` : ''}
    </div>` : '';
  const formHtml = `
    <p class="text-muted text-sm" style="margin-bottom:16px">
      <strong>${esc(productName)} — ${esc(format)}</strong><br>
      Delivered: <strong>${totalQty}</strong> &mdash;
      Returned: <strong>${alreadyReturned}</strong> &mdash;
      Outstanding: <strong class="text-danger">${outstanding}</strong>
    </p>
    ${notesHistory}
    ${depositSection}
    <div class="form-group">
      <label for="f-return-qty">Kegs Returned Now <span class="required">*</span></label>
      <input class="form-control" type="number" id="f-return-qty" min="1" max="${outstanding}" value="${outstanding}"
        ${depPerUnit > 0 ? `oninput="var q=parseInt(this.value)||0; var el=document.getElementById('deposit-refund-preview'); if(el) el.textContent='$'+(q*${depPerUnit}).toFixed(2)"` : ''} />
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
    const updates = {
      ReturnedQuantity: String(newReturnedTotal),
      ReturnedDate: new Date().toISOString().split('T')[0],
      Notes: combinedNotes,
    };
    if (depPerUnit > 0) {
      const refundAmount = returnQty * depPerUnit;
      updates.DepositRefunded = String((depRefunded + refundAmount).toFixed(2));
    }
    await api.put(`/api/keg-tracking/${kegId}`, updates);
    const refundDest = document.querySelector('input[name="deposit-refund-dest"]:checked')?.value;
    if (depPerUnit > 0 && refundDest === 'credit' && accountId) {
      const refundAmount = returnQty * depPerUnit;
      await api.post('/api/credits', {
        accountId, accountName: accountName || '', type: 'credit',
        amount: refundAmount.toFixed(2),
        reason: `Keg deposit refund — ${productName} (${format}) x${returnQty}`,
      });
    }
    modal.close();
    let msg = `${returnQty} keg${returnQty > 1 ? 's' : ''} marked as returned`;
    if (depPerUnit > 0) {
      const refundAmt = (returnQty * depPerUnit).toFixed(2);
      msg += refundDest === 'credit' ? ` · $${refundAmt} credited to account` : ` · $${refundAmt} deposit refunded`;
    }
    toast(msg);
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
    setTimeout(() => initMentions('f-notes'), 0);
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
    setTimeout(() => initMentions('f-notes'), 0);
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
  api.get('/api/orders').then(async items => {
    const order = items.find(s => s.ID === id);
    if (!order) return;
    const isPaid = order.Status === 'Paid';
    if (isPaid) {
      modal.open('View Order', orderForm(order, '', true), async () => {
        await api.put(`/api/orders/${id}`, {
          InvoiceNumber: val('f-invoice'),
          Notes: val('f-notes'),
        });
        modal.close();
        toast('Order updated');
        loadAccountProfile(state.accountProfileId);
      }, 'Save');
    } else {
      modal.open('Edit Order', orderForm(order), async () => {
        const staffId = val('f-staff');
        const staffName = staffId ? (state.staff.find(s => s.ID === staffId) || {}).Name || '' : '';
        const products = collectOrderProducts();
        const creditApplied = _orderCreditApplied;
        const orderAmount = parseFloat(val('f-amount')) || 0;
        const finalAmount = creditApplied > 0 ? Math.max(0, orderAmount - creditApplied).toFixed(2) : val('f-amount');
        // Reverse any previously applied credits for this order
        const existingCredits = await api.get(`/api/credits?accountId=${order.AccountID}`);
        const oldApplied = existingCredits.filter(c => c.Type === 'applied' && c.OrderID === id);
        for (const oc of oldApplied) {
          await api.del(`/api/credits/${oc.ID}`);
        }
        await api.put(`/api/orders/${id}`, {
          StaffID: staffId, StaffName: staffName,
          OrderDate: val('f-order-date'), DeliveryDate: val('f-delivery-date'),
          InvoiceNumber: val('f-invoice'), Status: val('f-status'),
          OrderAmount: finalAmount, TaxAmount: val('f-tax'),
          Notes: val('f-notes'),
          RequestedProducts: products || order.RequestedProducts || '',
        });
        await saveOrderItems(id);
        if (creditApplied > 0) {
          const accountName = (state.accounts.find(a => a.ID === order.AccountID) || {}).Name || order.AccountName;
          await api.post('/api/credits', {
            accountId: order.AccountID, accountName, type: 'applied',
            amount: creditApplied.toFixed(2), orderId: id,
            reason: 'Applied to order',
          });
          const currentItems = await api.get(`/api/order-items?orderId=${encodeURIComponent(id)}`);
          const creditItems = currentItems.filter(i => i.ProductName === 'Account Credit');
          for (const ci of creditItems) {
            await api.del(`/api/order-items/${ci.ID}`);
          }
          await api.post('/api/order-items/bulk', {
            items: [{
              OrderID: id, InventoryID: '', ProductName: 'Account Credit',
              Format: '', Quantity: '1',
              UnitPrice: (-creditApplied).toFixed(2),
              LineTotal: (-creditApplied).toFixed(2),
            }],
          });
        }
        modal.close();
        toast('Order updated');
        loadAccountProfile(state.accountProfileId);
      });
    }
    setTimeout(() => initMentions('f-notes'), 0);
    const orderItems = await api.get(`/api/order-items?orderId=${encodeURIComponent(id)}`);
    if (orderItems && orderItems.length > 0) {
      await refreshOrderProductsFromItems(orderItems, isPaid);
    } else {
      await refreshOrderProducts(order.RequestedProducts, isPaid);
    }
    if (!isPaid) initOrderCredit(order.AccountID, id);
  });
}

function profileDeleteOrder(id) {
  modal.confirm('Delete Order', 'Delete this order? This cannot be undone.', async () => {
    await api.del(`/api/order-items?orderId=${encodeURIComponent(id)}`);
    await api.del(`/api/orders/${id}`);
    modal.close();
    toast('Order deleted');
    loadAccountProfile(state.accountProfileId);
  });
}

function openAddCredit(accountId) {
  const acct = state.accounts.find(a => a.ID === accountId);
  const formHtml = `
    <div class="form-group">
      <label>Amount ($) <span class="required">*</span></label>
      <input class="form-control" type="number" step="0.01" min="0.01" id="f-credit-amount" placeholder="0.00" />
    </div>
    <div class="form-group">
      <label>Reason</label>
      <input class="form-control" type="text" id="f-credit-reason" placeholder="e.g. Overcharge on delivery" />
    </div>
    <div class="form-group">
      <label>Notes</label>
      <textarea class="form-control" id="f-credit-notes" rows="2" placeholder="Optional notes"></textarea>
    </div>
  `;
  modal.open('Add Credit', formHtml, async () => {
    const amount = parseFloat(val('f-credit-amount'));
    if (!amount || amount <= 0) { toast('Enter a valid amount', 'error'); return; }
    await api.post('/api/credits', {
      accountId,
      accountName: acct ? acct.Name : '',
      type: 'credit',
      amount: amount.toFixed(2),
      reason: val('f-credit-reason'),
      notes: val('f-credit-notes'),
    });
    modal.close();
    toast('Credit added');
    loadAccountProfile(state.accountProfileId);
  });
}

function profileEditCredit(id) {
  api.get('/api/credits').then(items => {
    const credit = items.find(c => c.ID === id);
    if (!credit) return;
    const formHtml = `
      <div class="form-group">
        <label>Amount ($) <span class="required">*</span></label>
        <input class="form-control" type="number" step="0.01" min="0.01" id="f-credit-amount" value="${esc(credit.Amount)}" />
      </div>
      <div class="form-group">
        <label>Reason</label>
        <input class="form-control" type="text" id="f-credit-reason" value="${esc(credit.Reason)}" />
      </div>
      <div class="form-group">
        <label>Notes</label>
        <textarea class="form-control" id="f-credit-notes" rows="2">${esc(credit.Notes)}</textarea>
      </div>
    `;
    modal.open('Edit Credit', formHtml, async () => {
      const amount = parseFloat(val('f-credit-amount'));
      if (!amount || amount <= 0) { toast('Enter a valid amount', 'error'); return; }
      await api.put(`/api/credits/${id}`, {
        Amount: amount.toFixed(2),
        Reason: val('f-credit-reason'),
        Notes: val('f-credit-notes'),
      });
      modal.close();
      toast('Credit updated');
      loadAccountProfile(state.accountProfileId);
    });
  });
}

function profileDeleteCredit(id) {
  modal.confirm('Delete Credit', 'Delete this credit record? This cannot be undone.', async () => {
    await api.del(`/api/credits/${id}`);
    modal.close();
    toast('Credit deleted');
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
      Name: name, Type: val('f-type'), Tags: collectSelectedTags(), Status: val('f-status'),
      ContactName: val('f-contact'), PreferredMethod: val('f-method'),
      Email: val('f-email'), AdditionalEmails: collectAdditionalEmails(), Phone: val('f-phone'),
      BillingContactName: val('f-billing-contact'), BillingEmail: val('f-billing-email'), BillingPhone: val('f-billing-phone'),
      Address: val('f-address'), City: val('f-city'), State: val('f-state'), Zip: val('f-zip'),
      ABCLicense: val('f-abc-license'),
      ChargeDeposits: document.getElementById('f-charge-deposits').checked ? 'true' : 'false',
      Taxable: document.getElementById('f-taxable').checked ? 'true' : 'false',
      CheckInFrequency: val('f-checkin-frequency'),
      Notes: val('f-notes'), StaffID: staffId, StaffName: staffName,
      ServicedBy: val('f-serviced-by') || '',
    });
    modal.close();
    toast('Account added');
    loadAccounts();
  });
  setTimeout(() => initMentions('f-notes'), 0);
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
      Name: name, Type: val('f-type'), Tags: collectSelectedTags(), Status: val('f-status'),
      ContactName: val('f-contact'), PreferredMethod: val('f-method'),
      Email: val('f-email'), AdditionalEmails: collectAdditionalEmails(), Phone: val('f-phone'),
      BillingContactName: val('f-billing-contact'), BillingEmail: val('f-billing-email'), BillingPhone: val('f-billing-phone'),
      Address: val('f-address'), City: val('f-city'), State: val('f-state'), Zip: val('f-zip'),
      ABCLicense: val('f-abc-license'),
      ChargeDeposits: document.getElementById('f-charge-deposits').checked ? 'true' : 'false',
      Taxable: document.getElementById('f-taxable').checked ? 'true' : 'false',
      CheckInFrequency: val('f-checkin-frequency'),
      Notes: val('f-notes'), StaffID: staffId, StaffName: staffName,
      ServicedBy: val('f-serviced-by') || '',
    });
    modal.close();
    toast('Account updated');
    if (state.view === 'account-profile') loadAccountProfile(id);
    else loadAccounts(true);
  });
  setTimeout(() => initMentions('f-notes'), 0);
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

// ── Email Inventory Helper ──────────────────────────────────────

function formatItemLine(item, showQty) {
  const parts = [item.Name];
  const meta = [item.Style, item.ABV ? item.ABV + '%' : ''].filter(Boolean);
  if (meta.length) parts[0] += ` (${meta.join(', ')})`;
  if (item.Format) parts.push(item.Format);
  if (item.PricePerUnit) parts.push('$' + parseFloat(item.PricePerUnit).toFixed(2));
  if (showQty) parts.push((item.Available || item.Units || '0') + ' available');
  return parts.join(' - ');
}

function buildInventoryOfferingText(items, category, showQty) {
  const inStock = items.filter(i => parseInt(i.Available || i.Units || '0') > 0 && i.ExcludeFromEmailOfferings !== 'true');
  if (inStock.length === 0) return 'No in-stock inventory found.';

  const fmt = item => formatItemLine(item, showQty);

  if (category !== 'All') {
    const matcher = FORMAT_CATEGORIES[category];
    if (!matcher) return '';
    const filtered = inStock.filter(i => matcher(i.Format));
    if (filtered.length === 0) return `No in-stock ${category.toLowerCase()} found.`;
    let text = `Available Inventory - ${category}\n` + '-'.repeat(26 + category.length) + '\n';
    text += filtered.map(fmt).join('\n');
    return text;
  }

  // "All" — group by category
  const sections = [];
  const categorized = new Set();

  for (const [label, matcher] of Object.entries(FORMAT_CATEGORIES)) {
    const matched = inStock.filter(i => matcher(i.Format));
    if (matched.length > 0) {
      sections.push(`-- ${label} --\n` + matched.map(fmt).join('\n'));
      matched.forEach(i => categorized.add(i.ID));
    }
  }

  const other = inStock.filter(i => !categorized.has(i.ID));
  if (other.length > 0) {
    sections.push('-- Other --\n' + other.map(fmt).join('\n'));
  }

  return 'Available Inventory\n===================\n\n' + sections.join('\n\n');
}

function inventoryHelperHtml() {
  return `
    <div class="form-group">
      <button type="button" class="btn btn-secondary btn-sm" onclick="toggleInventoryHelper()">Insert Available Inventory</button>
      <div id="inventory-helper-panel" style="display:none;margin-top:8px;padding:10px 12px;background:var(--bg-secondary);border-radius:6px;border:1px solid var(--border)">
        <div style="display:flex;gap:4px;margin-bottom:8px;flex-wrap:wrap">
          <button type="button" class="btn btn-sm btn-primary" data-inv-cat="All" onclick="selectInventoryCategory('All')">All</button>
          <button type="button" class="btn btn-sm btn-secondary" data-inv-cat="Kegs" onclick="selectInventoryCategory('Kegs')">Kegs</button>
          <button type="button" class="btn btn-sm btn-secondary" data-inv-cat="Cans" onclick="selectInventoryCategory('Cans')">Cans</button>
          <button type="button" class="btn btn-sm btn-secondary" data-inv-cat="Bottles" onclick="selectInventoryCategory('Bottles')">Bottles</button>
        </div>
        <label style="display:flex;align-items:center;gap:6px;margin-bottom:8px;font-size:13px;cursor:pointer">
          <input type="checkbox" id="inv-show-qty" checked onchange="toggleInventoryQty(this.checked)" /> Show available quantities
        </label>
        <pre id="inventory-preview" style="max-height:160px;overflow-y:auto;white-space:pre-wrap;font-size:12px;margin:0 0 8px 0;padding:8px;background:var(--bg-primary);border-radius:4px;border:1px solid var(--border)">Loading...</pre>
        <button type="button" class="btn btn-sm btn-primary" onclick="insertInventoryText()">Insert into Message</button>
      </div>
    </div>`;
}

async function toggleInventoryHelper() {
  const panel = document.getElementById('inventory-helper-panel');
  if (!panel) return;
  const isHidden = panel.style.display === 'none';
  panel.style.display = isHidden ? 'block' : 'none';
  if (isHidden && !_emailInventoryCache) {
    const preview = document.getElementById('inventory-preview');
    if (preview) preview.textContent = 'Loading...';
    try {
      const loc = state.location || '';
      _emailInventoryCache = await api.get('/api/inventory' + (loc ? '?location=' + encodeURIComponent(loc) : ''));
      updateInventoryPreview();
    } catch (err) {
      if (preview) preview.textContent = 'Failed to load inventory.';
    }
  }
}

function selectInventoryCategory(cat) {
  _emailInventoryCategory = cat;
  document.querySelectorAll('[data-inv-cat]').forEach(btn => {
    btn.className = btn.dataset.invCat === cat ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-secondary';
  });
  updateInventoryPreview();
}

function toggleInventoryQty(checked) {
  _emailInventoryShowQty = checked;
  updateInventoryPreview();
}

function updateInventoryPreview() {
  const preview = document.getElementById('inventory-preview');
  if (!preview || !_emailInventoryCache) return;
  preview.textContent = buildInventoryOfferingText(_emailInventoryCache, _emailInventoryCategory, _emailInventoryShowQty);
}

function insertInventoryText() {
  const textarea = document.getElementById('f-email-body');
  const preview = document.getElementById('inventory-preview');
  if (!textarea || !preview) return;
  const text = preview.textContent;
  if (!text || text === 'Loading...') return;

  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const current = textarea.value;

  if (start !== end || start > 0) {
    // Insert at cursor
    const before = current.substring(0, start);
    const after = current.substring(end);
    const sep = before && !before.endsWith('\n') ? '\n\n' : '';
    textarea.value = before + sep + text + after;
  } else if (current) {
    textarea.value = current + '\n\n' + text;
  } else {
    textarea.value = text;
  }
  textarea.focus();
}

// ── Tag Filter ───────────────────────────────────────────────────

function toggleTagFilterMenu() {
  const menu = document.getElementById('tag-filter-menu');
  if (!menu) return;
  const isOpen = menu.style.display !== 'none';
  menu.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) {
    // Close on outside click
    setTimeout(() => {
      const handler = (e) => {
        if (!document.getElementById('tag-filter-dropdown')?.contains(e.target)) {
          menu.style.display = 'none';
          document.removeEventListener('click', handler);
        }
      };
      document.addEventListener('click', handler);
    });
  }
}

function applyTagFilter() {
  const checkboxes = document.querySelectorAll('#tag-filter-menu input[type="checkbox"]');
  _acctTagFilters = Array.from(checkboxes).filter(cb => cb.checked).map(cb => cb.value);
  _paginationReset('accounts');
  renderAccounts();
}

function clearTagFilter() {
  _acctTagFilters = [];
  _paginationReset('accounts');
  renderAccounts();
}

// ── Email Functions ──────────────────────────────────────────────

function toggleAllAccounts(masterCheckbox) {
  document.querySelectorAll('.acct-select').forEach(cb => { cb.checked = masterCheckbox.checked; });
  updateBulkEmailBar();
}

function updateBulkEmailBar() {
  const count = document.querySelectorAll('.acct-select:checked').length;
  const bar = document.getElementById('bulk-actions-bar');
  if (bar) {
    bar.style.display = count > 0 ? 'flex' : 'none';
    const label = document.getElementById('bulk-selected-count');
    if (label) label.textContent = `${count} selected`;
  }
}

function fromEmailHtml() {
  if (state.userEmails && state.userEmails.length > 1) {
    const opts = state.userEmails.map(e =>
      `<option value="${esc(e)}"${e === state.userEmail ? ' selected' : ''}>${esc(e)}</option>`
    ).join('');
    return `<select class="form-control" id="f-email-from">${opts}</select>`;
  }
  return `<input class="form-control" id="f-email-from" value="${esc(state.userEmail || '')}" readonly style="background:#f5f5f5;cursor:default" />`;
}

function openEmailCompose(accountId) {
  const acct = state.accounts.find(a => a.ID === accountId);
  if (!acct) return;
  _emailInventoryCache = null;
  _emailInventoryCategory = 'All';
  _emailInventoryShowQty = true;

  const additionalEmails = parseAdditionalEmails(acct);
  const allEmails = getAllAccountEmails(acct);

  if (allEmails.length === 0) {
    toast('This account has no email address on file', 'error');
    return;
  }

  const primaryEmail = acct.Email || additionalEmails[0];
  const ccEmails = acct.Email ? additionalEmails : additionalEmails.slice(1);
  const recipientDisplay = allEmails.join(', ');

  const formHtml = `
    <div class="form-group">
      <label>To${ccEmails.length > 0 ? ' / Cc' : ''}</label>
      <input class="form-control" value="${esc(recipientDisplay)}" readonly style="background:#f5f5f5;cursor:default" />
    </div>
    <div class="form-group">
      <label>From</label>
      ${fromEmailHtml()}
    </div>
    <div class="form-group">
      <label>Subject <span class="required">*</span></label>
      <input class="form-control" id="f-email-subject" placeholder="Email subject..." />
    </div>
    ${inventoryHelperHtml()}
    <div class="form-group">
      <label>Message <span class="required">*</span></label>
      <textarea class="form-control" id="f-email-body" rows="8" placeholder="Type your message..."></textarea>
    </div>`;

  modal.open('Send Email', formHtml, async () => {
    const subject   = val('f-email-subject');
    const body      = val('f-email-body');
    const fromEmail = val('f-email-from');
    if (!subject) { toast('Subject is required', 'error'); return; }
    if (!body)    { toast('Message is required', 'error'); return; }

    try {
      await api.post('/api/email/send', {
        to:          primaryEmail,
        cc:          ccEmails.length > 0 ? ccEmails : undefined,
        subject,
        body,
        fromEmail,
        accountId:   acct.ID,
        accountName: acct.Name,
      });
      modal.close();
      toast('Email sent successfully');
      if (state.view === 'account-profile') loadAccountProfile(state.accountProfileId);
    } catch (err) {
      toast('Failed to send email: ' + (err.message || 'Unknown error'), 'error');
    }
  }, 'Send');
}

function openBulkEmail() {
  const checked = document.querySelectorAll('.acct-select:checked');
  if (checked.length === 0) {
    toast('Select at least one account first', 'error');
    return;
  }
  _emailInventoryCache = null;
  _emailInventoryCategory = 'All';
  _emailInventoryShowQty = true;

  const selectedIds = Array.from(checked).map(cb => cb.dataset.accountId);
  const selectedAccounts = selectedIds.map(id => state.accounts.find(a => a.ID === id)).filter(Boolean);

  const withEmail    = selectedAccounts.filter(a => accountHasEmail(a));
  const withoutEmail = selectedAccounts.filter(a => !accountHasEmail(a));

  if (withEmail.length === 0) {
    toast('None of the selected accounts have email addresses', 'error');
    return;
  }

  const recipientList = withEmail.map(a => {
    const allEmails = getAllAccountEmails(a);
    return `<li>${esc(a.Name)} &lt;${allEmails.map(e => esc(e)).join(', ')}&gt;</li>`;
  }).join('');
  const totalAddresses = withEmail.reduce((sum, a) => sum + getAllAccountEmails(a).length, 0);
  const warningHtml = withoutEmail.length > 0
    ? `<div style="margin-bottom:12px;padding:8px 12px;background:#fff3e0;border-radius:6px;border:1px solid #ffe0b2">
        <strong class="text-sm">Note:</strong>
        <span class="text-sm">${withoutEmail.length} account${withoutEmail.length > 1 ? 's' : ''} skipped (no email):
          ${withoutEmail.map(a => esc(a.Name)).join(', ')}
        </span>
      </div>`
    : '';

  const formHtml = `
    ${warningHtml}
    <div class="form-group">
      <label>BCC Recipients (${totalAddresses} address${totalAddresses !== 1 ? 'es' : ''} across ${withEmail.length} account${withEmail.length !== 1 ? 's' : ''})</label>
      <ul class="text-sm" style="max-height:120px;overflow-y:auto;margin:4px 0;padding-left:20px;color:var(--text-secondary)">
        ${recipientList}
      </ul>
    </div>
    <div class="form-group">
      <label>From</label>
      ${fromEmailHtml()}
    </div>
    <div class="form-group">
      <label>Subject <span class="required">*</span></label>
      <input class="form-control" id="f-email-subject" placeholder="Email subject..." />
    </div>
    ${inventoryHelperHtml()}
    <div class="form-group">
      <label>Message <span class="required">*</span></label>
      <textarea class="form-control" id="f-email-body" rows="8" placeholder="Type your message..."></textarea>
    </div>`;

  modal.open('Send Bulk Email', formHtml, async () => {
    const subject   = val('f-email-subject');
    const body      = val('f-email-body');
    const fromEmail = val('f-email-from');
    if (!subject) { toast('Subject is required', 'error'); return; }
    if (!body)    { toast('Message is required', 'error'); return; }

    const recipients = withEmail.map(a => ({
      email:            a.Email,
      additionalEmails: parseAdditionalEmails(a),
      accountId:        a.ID,
      accountName:      a.Name,
    }));

    try {
      const result = await api.post('/api/email/bulk', { recipients, subject, body, fromEmail });
      modal.close();
      toast(`Email sent to ${result.sent} address${result.sent !== 1 ? 'es' : ''}`);
      document.querySelectorAll('.acct-select:checked').forEach(cb => { cb.checked = false; });
      updateBulkEmailBar();
    } catch (err) {
      toast('Failed to send email: ' + (err.message || 'Unknown error'), 'error');
    }
  }, 'Send');
}

// ── Merge Account ─────────────────────────────────────────────────

async function openMergeAccount(targetId) {
  if (state.accounts.length === 0) state.accounts = await api.get('/api/accounts');
  const target = state.accounts.find(a => a.ID === targetId);
  if (!target) { toast('Account not found', 'error'); return; }

  const formHtml = `
    <p class="text-sm" style="margin-bottom:16px">Merge another account into <strong>${esc(target.Name)}</strong>. All records from the selected account will be transferred here, and the selected account will be deleted.</p>
    <div class="form-group">
      <label>Search for account to merge in</label>
      <div style="position:relative">
        <input class="form-control" id="merge-search" placeholder="Type to search accounts..." autocomplete="off" />
        <div id="merge-dropdown" style="position:absolute;top:100%;left:0;right:0;z-index:10;max-height:200px;overflow-y:auto;background:var(--bg-primary);border:1px solid var(--border);border-top:none;border-radius:0 0 8px 8px;display:none"></div>
      </div>
    </div>
    <div id="merge-selected" style="display:none;margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--bg-secondary);border-radius:6px">
        <span id="merge-selected-name" class="fw-600"></span>
        <a href="#" id="merge-clear" class="text-sm" style="margin-left:auto" onclick="event.preventDefault();clearMergeSelection()">Clear</a>
      </div>
    </div>
    <div id="merge-preview" style="display:none;margin-bottom:8px">
      <div style="padding:12px;background:#fff3e0;border-radius:6px;border:1px solid #ffe0b2">
        <div class="fw-600 text-sm" style="margin-bottom:8px">Records that will be transferred:</div>
        <div id="merge-preview-counts" class="text-sm"></div>
        <div class="text-sm text-danger" style="margin-top:8px">The source account will be permanently deleted.</div>
      </div>
    </div>`;

  let selectedSourceId = null;

  modal.open('Merge Account', formHtml, async () => {
    if (!selectedSourceId) { toast('Select an account to merge', 'error'); return; }

    try {
      const result = await api.post(`/api/accounts/${encodeURIComponent(targetId)}/merge`, { sourceAccountId: selectedSourceId });
      modal.close();
      const m = result.merged;
      const parts = [];
      if (m.outreach)  parts.push(`${m.outreach} outreach`);
      if (m.reminders) parts.push(`${m.reminders} reminder${m.reminders !== 1 ? 's' : ''}`);
      if (m.orders)    parts.push(`${m.orders} order${m.orders !== 1 ? 's' : ''}`);
      if (m.kegs)      parts.push(`${m.kegs} keg record${m.kegs !== 1 ? 's' : ''}`);
      if (m.tapHandles) parts.push(`${m.tapHandles} tap handle${m.tapHandles !== 1 ? 's' : ''}`);
      if (m.emails)    parts.push(`${m.emails} email${m.emails !== 1 ? 's' : ''}`);
      toast(parts.length > 0 ? 'Merged: ' + parts.join(', ') : 'Accounts merged successfully');
      state.accounts = [];
      if (state.view === 'account-profile') loadAccountProfile(targetId);
      else loadAccounts();
    } catch (err) {
      toast('Merge failed: ' + (err.message || 'Unknown error'), 'error');
    }
  }, 'Merge Accounts');

  // Style submit button as danger
  document.getElementById('modal-submit-btn').className = 'btn btn-danger';

  // Wire up search
  const searchInput = document.getElementById('merge-search');
  const dropdown = document.getElementById('merge-dropdown');

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.toLowerCase().trim();
    if (!q) { dropdown.style.display = 'none'; return; }
    const matches = state.accounts
      .filter(a => a.ID !== targetId && a.Name.toLowerCase().includes(q))
      .slice(0, 20);
    if (matches.length === 0) {
      dropdown.innerHTML = '<div style="padding:8px 12px" class="text-muted text-sm">No matches</div>';
    } else {
      dropdown.innerHTML = matches.map(a =>
        `<div class="merge-option" style="padding:8px 12px;cursor:pointer" onmouseover="this.style.background='var(--bg-secondary)'" onmouseout="this.style.background=''" data-id="${esc(a.ID)}">${esc(a.Name)} <span class="text-muted text-sm">${esc(a.City || '')}${a.City && a.State ? ', ' : ''}${esc(a.State || '')}</span></div>`
      ).join('');
    }
    dropdown.style.display = 'block';
  });

  dropdown.addEventListener('click', async (e) => {
    const opt = e.target.closest('.merge-option');
    if (!opt) return;
    const sourceId = opt.dataset.id;
    const source = state.accounts.find(a => a.ID === sourceId);
    if (!source) return;

    selectedSourceId = sourceId;
    searchInput.style.display = 'none';
    dropdown.style.display = 'none';
    document.getElementById('merge-selected').style.display = 'block';
    document.getElementById('merge-selected-name').textContent = source.Name;

    // Fetch preview
    document.getElementById('merge-preview').style.display = 'block';
    document.getElementById('merge-preview-counts').textContent = 'Loading...';
    try {
      const p = await api.get(`/api/accounts/${encodeURIComponent(targetId)}/merge-preview?sourceId=${encodeURIComponent(sourceId)}`);
      const lines = [];
      if (p.outreach)   lines.push(`${p.outreach} outreach entr${p.outreach === 1 ? 'y' : 'ies'}`);
      if (p.reminders)  lines.push(`${p.reminders} reminder${p.reminders === 1 ? '' : 's'}`);
      if (p.orders)     lines.push(`${p.orders} order${p.orders === 1 ? '' : 's'}`);
      if (p.kegs)       lines.push(`${p.kegs} keg record${p.kegs === 1 ? '' : 's'}`);
      if (p.tapHandles) lines.push(`${p.tapHandles} tap handle record${p.tapHandles === 1 ? '' : 's'}`);
      if (p.emails)     lines.push(`${p.emails} email log${p.emails === 1 ? '' : 's'}`);
      if (p.credits)    lines.push(`${p.credits} credit record${p.credits === 1 ? '' : 's'}`);
      document.getElementById('merge-preview-counts').textContent = lines.length > 0 ? lines.join(', ') : 'No associated records (account metadata will still be merged)';
    } catch (err) {
      document.getElementById('merge-preview-counts').textContent = 'Failed to load preview';
    }
  });

  // clearMergeSelection is global so the onclick can find it
  window.clearMergeSelection = () => {
    selectedSourceId = null;
    searchInput.style.display = '';
    searchInput.value = '';
    dropdown.style.display = 'none';
    document.getElementById('merge-selected').style.display = 'none';
    document.getElementById('merge-preview').style.display = 'none';
  };
}
