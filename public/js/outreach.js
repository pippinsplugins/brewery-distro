'use strict';

const OUTREACH_METHODS = ['Email', 'Phone', 'SMS', 'In-Person'];

function outreachForm(entry = {}, presetAccountId = '') {
  const selId = entry.AccountID || presetAccountId;
  return `
    <div class="form-group">
      <label>Account <span class="required">*</span></label>
      <select class="form-control" id="f-account" ${presetAccountId ? 'disabled' : ''}>
        <option value="">-- Select Account --</option>
        ${accountOptions(selId)}
      </select>
      ${presetAccountId ? `<input type="hidden" id="f-account-hidden" value="${esc(presetAccountId)}" />` : ''}
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Date <span class="required">*</span></label>
        <input class="form-control" id="f-date" type="date" value="${esc(entry.Date || today())}" />
      </div>
      <div class="form-group">
        <label>Method Used</label>
        <select class="form-control" id="f-method">
          ${OUTREACH_METHODS.map(m => `<option value="${m}" ${entry.Method === m ? 'selected' : ''}>${m}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-group">
      <label>Notes / Outcome</label>
      <textarea class="form-control" id="f-notes" rows="3" placeholder="What was discussed? What was the outcome?">${esc(entry.Notes)}</textarea>
    </div>
    <hr class="form-divider" />
    <div class="form-section-title">Follow-up</div>
    <div class="form-group">
      <label>Follow-up Date</label>
      <input class="form-control" id="f-followup-date" type="date" value="${esc(entry.FollowUpDate)}" />
    </div>
    <div class="form-group">
      <label>
        <input type="checkbox" id="f-create-todo" style="margin-right:6px;" onchange="document.getElementById('todo-fields').style.display=this.checked?'':'none'" />
        Create a todo for this follow-up
      </label>
    </div>
    <div class="form-row" id="todo-fields" style="display:none">
      <div class="form-group">
        <label>Todo Type</label>
        <select class="form-control" id="f-todo-type">
          ${TODO_TYPES.map(t => `<option value="${t}" ${t === 'Follow-up' ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Assign To</label>
        <select class="form-control" id="f-todo-staff">
          <option value="">-- Unassigned --</option>
          ${staffOptions()}
        </select>
      </div>
    </div>`;
}

async function loadOutreach(preservePage = false) {
  if (!preservePage) _paginationReset('outreach');
  showLoading();
  const [outreach, accounts, staff] = await Promise.all([api.get('/api/outreach'), api.get('/api/accounts'), api.get('/api/staff')]);
  state.outreach = outreach;
  state.accounts = accounts;
  state.staff = staff;
  renderOutreach();
}

function renderOutreach() {
  const outreach = state.outreach || [];
  const _focused = document.activeElement?.id;
  const accountFilter = (document.getElementById('out-account') || {}).value || '';
  const methodFilter  = (document.getElementById('out-method') || {}).value || '';
  const search        = (document.getElementById('out-search') || {}).value || '';

  let filtered = outreach;
  if (accountFilter) filtered = filtered.filter(o => o.AccountID === accountFilter);
  if (methodFilter)  filtered = filtered.filter(o => o.Method === methodFilter);
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(o =>
      (o.AccountName || '').toLowerCase().includes(q) ||
      (o.Notes || '').toLowerCase().includes(q)
    );
  }

  const acctOpts = `<option value="">All Accounts</option>` +
    [...new Set(outreach.map(o => o.AccountID))]
      .map(id => {
        const o = outreach.find(x => x.AccountID === id);
        return `<option value="${esc(id)}" ${accountFilter === id ? 'selected' : ''}>${esc(o.AccountName)}</option>`;
      }).join('');

  const pg = paginate(filtered, 'outreach');

  setContent(`
    <div class="view-header">
      <div>
        <h2>Outreach Log</h2>
        <p class="subtitle">${outreach.length} contact${outreach.length !== 1 ? 's' : ''} logged</p>
      </div>
      <div class="view-header-actions">
        <button class="btn btn-primary" onclick="openAddOutreach()">+ Log Contact</button>
      </div>
    </div>
    <div class="filter-bar">
      <input type="search" id="out-search" placeholder="Search..." value="${esc(search)}" oninput="_paginationReset('outreach'); renderOutreach()" />
      <select id="out-account" onchange="_paginationReset('outreach'); renderOutreach()">${acctOpts}</select>
      <select id="out-method" onchange="_paginationReset('outreach'); renderOutreach()">
        <option value="">All Methods</option>
        ${OUTREACH_METHODS.map(m => `<option value="${m}" ${methodFilter === m ? 'selected' : ''}>${m}</option>`).join('')}
      </select>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Account</th><th>Date</th><th class="mobile-hide">Method</th><th class="mobile-hide">Notes</th>
            <th class="mobile-hide">Follow-up</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${pg.total === 0 ? `<tr><td colspan="6" class="empty-state">No outreach logged yet.</td></tr>` :
            pg.rows.map(o => `<tr>
              <td class="fw-600"><span class="td-link" onclick="loadAccountProfile('${esc(o.AccountID)}')">${esc(o.AccountName)}</span></td>
              <td>${formatDate(o.Date)}</td>
              <td class="mobile-hide">${methodBadge(o.Method)}</td>
              <td class="mobile-hide text-sm note-cell">${truncateNote(o.Notes)}</td>
              <td class="mobile-hide text-sm">${o.FollowUpDate ? formatDate(o.FollowUpDate) : '—'}</td>
              <td class="td-actions">
                <button class="btn btn-ghost btn-sm mobile-actions-toggle" onclick="toggleMobileActions(event)">&#8230;</button>
                <div class="mobile-actions-menu">
                <button class="btn btn-ghost btn-sm" onclick="openEditOutreach('${esc(o.ID)}')">Edit</button>
                <button class="btn btn-ghost btn-sm text-danger" onclick="deleteOutreach('${esc(o.ID)}')">Del</button>
                </div>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${pg.total > 0 ? paginationControls('outreach', pg, 'renderOutreach') : ''}`);
  if (_focused === 'out-search') refocusSearch('out-search');
}

let _outreachCache = [];

function openAddOutreach(presetAccountId = '', presetAccountName = '') {
  modal.open('Log Contact', outreachForm({}, presetAccountId), async () => {
    const accountId = presetAccountId
      ? presetAccountId
      : val('f-account');
    if (!accountId) { toast('Please select an account', 'error'); return; }

    const accountName = presetAccountName ||
      (state.accounts.find(a => a.ID === accountId) || {}).Name || '';
    const followUpDate = val('f-followup-date');
    const createTodo = document.getElementById('f-create-todo') && document.getElementById('f-create-todo').checked;

    const entry = await api.post('/api/outreach', {
      AccountID: accountId, AccountName: accountName,
      Date: val('f-date'), Method: val('f-method'),
      Notes: val('f-notes'), FollowUpDate: followUpDate,
    });

    if (createTodo && followUpDate) {
      const todoType = val('f-todo-type') || 'Follow-up';
      const todoStaffId = val('f-todo-staff');
      const todoStaffName = todoStaffId ? (state.staff.find(s => s.ID === todoStaffId) || {}).Name || '' : '';
      await api.post('/api/reminders', {
        Type: todoType, AccountID: accountId, AccountName: accountName,
        Title: `Follow up with ${accountName}`,
        DueDate: followUpDate, Priority: 'Medium',
        Notes: `Re: outreach on ${val('f-date')}`,
        StaffID: todoStaffId, StaffName: todoStaffName,
      });
    }

    modal.close();
    toast('Contact logged');
    if (state.view === 'account-profile') loadAccountProfile(state.accountProfileId);
    else if (state.view === 'outreach') loadOutreach();
    else if (state.view === 'accounts') loadAccounts();
    else loadDashboard();
  });
}

function openLogOutreach(accountId) {
  const accountName = (state.accounts.find(a => a.ID === accountId) || {}).Name || '';
  openAddOutreach(accountId, accountName);
}

function openEditOutreach(id) {
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
      loadOutreach();
    });
  });
}

async function deleteOutreach(id) {
  modal.confirm('Delete Entry', 'Delete this outreach log entry?', async () => {
    await api.del(`/api/outreach/${id}`);
    modal.close();
    toast('Entry deleted');
    loadOutreach();
  });
}
