'use strict';

const TODO_TYPES = ['Follow-up', 'Delivery', 'Collect Payment', 'Sampling', 'Event', 'Draft Cleaning', 'Pre-Sale', 'Other'];
const PRIORITIES = ['High', 'Medium', 'Low'];
const RECURRENCE_OPTIONS = [
  { value: 'none',      label: 'None' },
  { value: 'daily',     label: 'Daily' },
  { value: 'weekly',    label: 'Weekly' },
  { value: 'biweekly',  label: 'Every Other Week' },
  { value: 'monthly',   label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly',    label: 'Yearly' },
];

function todoForm(todo = {}) {
  return `
    <div class="form-group">
      <label>Title <span class="required">*</span></label>
      <input class="form-control" id="f-title" value="${esc(todo.Title)}" placeholder="e.g. Call The Rusty Tap about order" />
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Due Date <span class="required">*</span></label>
        <input class="form-control" id="f-due" type="date" value="${esc(todo.DueDate || today())}" />
      </div>
      <div class="form-group">
        <label>Priority</label>
        <select class="form-control" id="f-priority">
          ${PRIORITIES.map(p => `<option value="${p}" ${todo.Priority === p ? 'selected' : ''}>${p}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Type</label>
        <select class="form-control" id="f-type">
          ${TODO_TYPES.map(t => `<option value="${t}" ${todo.Type === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Linked Account (optional)</label>
        <select class="form-control" id="f-account">
          <option value="">-- None --</option>
          ${accountOptions(todo.AccountID)}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Assign To</label>
        <select class="form-control" id="f-staff">
          <option value="">-- Unassigned --</option>
          ${staffOptions(todo.StaffID)}
        </select>
      </div>
      <div class="form-group">
        <label>Recurrence</label>
        <select class="form-control" id="f-recurrence">
          ${RECURRENCE_OPTIONS.map(o => `<option value="${o.value}" ${(todo.Recurrence || 'none') === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-group">
      <label>Notes</label>
      <textarea class="form-control" id="f-notes" rows="2">${esc(todo.Notes)}</textarea>
    </div>`;
}

let _todosCache = [];
let _todoStatusFilter = 'active';

async function loadTodos() {
  _paginationReset('todos');
  _todoStatusFilter = (document.getElementById('todo-status') || {}).value || _todoStatusFilter;
  showLoading();

  const [todos, accounts, staff] = await Promise.all([
    api.get(`/api/reminders?status=${_todoStatusFilter}`),
    api.get('/api/accounts'),
    api.get('/api/staff'),
  ]);
  state.accounts = accounts;
  state.staff = staff;
  _todosCache = todos;

  renderTodos();
}

function renderTodos() {
  const todos = _todosCache;
  const _focused = document.activeElement?.id;
  const statusFilter = _todoStatusFilter;
  const search = (document.getElementById('todo-search') || {}).value || '';
  const staffFilter = state.navFilters?.staffId || '';
  const staffFilterName = state.navFilters?.staffName || '';

  let filtered = todos;
  if (staffFilter) filtered = filtered.filter(r => r.StaffID === staffFilter);
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(r =>
      r.Title.toLowerCase().includes(q) ||
      (r.AccountName || '').toLowerCase().includes(q)
    );
  }

  const pg = paginate(filtered, 'todos');

  setContent(`
    <div class="view-header">
      <div>
        <h2>Todos${staffFilterName ? ` — ${esc(staffFilterName)}` : ''}</h2>
        <p class="subtitle">${filtered.filter(r => r.Completed !== 'true').length} active todo${filtered.length !== 1 ? 's' : ''}${staffFilterName ? ` assigned to ${esc(staffFilterName)}` : ''}</p>
      </div>
      <div class="view-header-actions">
        ${staffFilter ? `<button class="btn btn-ghost" onclick="state.navFilters={}; renderTodos()">Clear Filter</button>` : ''}
        <button class="btn btn-primary" onclick="openAddTodo()">+ Add Todo</button>
      </div>
    </div>
    <div class="filter-bar">
      <input type="search" id="todo-search" placeholder="Search todos..." value="${esc(search)}" oninput="_paginationReset('todos'); renderTodos()" />
      <select id="todo-status" onchange="_paginationReset('todos'); loadTodos()">
        <option value="active" ${statusFilter === 'active' ? 'selected' : ''}>Active</option>
        <option value="completed" ${statusFilter === 'completed' ? 'selected' : ''}>Completed</option>
        <option value="all" ${statusFilter === 'all' ? 'selected' : ''}>All</option>
      </select>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Due</th><th>Status</th><th>Title</th><th>Account</th>
            <th>Type</th><th>Assigned To</th><th>Priority</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${pg.total === 0 ? `<tr><td colspan="8" class="empty-state">No todos found.</td></tr>` :
            pg.rows.map(r => `<tr>
              <td>${formatDate(r.DueDate)}</td>
              <td>${urgencyBadge(r.DueDate, r.Completed)}</td>
              <td class="fw-600"><span class="td-link" onclick="openEditTodo('${esc(r.ID)}')">${esc(r.Title)}</span>${r.Recurrence && r.Recurrence !== 'none' ? ` <span class="badge badge-recurrence" title="${esc(RECURRENCE_OPTIONS.find(o => o.value === r.Recurrence)?.label || r.Recurrence)}">↻</span>` : ''}</td>
              <td class="text-sm">${r.AccountID ? `<span class="td-link" onclick="loadAccountProfile('${esc(r.AccountID)}')">${esc(r.AccountName)}</span>` : '—'}</td>
              <td class="text-sm">${typeBadge(r.Type)}</td>
              <td class="text-sm">${esc(r.StaffName) || '<span class="text-muted">—</span>'}</td>
              <td>${priorityBadge(r.Priority)}</td>
              <td class="td-actions">
                ${r.Completed !== 'true'
                  ? `<button class="btn btn-ghost btn-sm text-success" onclick="completeTodo('${esc(r.ID)}')">Done</button>`
                  : `<button class="btn btn-ghost btn-sm" onclick="reopenTodo('${esc(r.ID)}')">Reopen</button>`
                }
                <button class="btn btn-ghost btn-sm" onclick="openEditTodo('${esc(r.ID)}')">Edit</button>
                <button class="btn btn-ghost btn-sm text-danger" onclick="deleteTodo('${esc(r.ID)}')">Del</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${pg.total > 0 ? paginationControls('todos', pg, 'renderTodos') : ''}`);
  if (_focused === 'todo-search') refocusSearch('todo-search');
}

function openAddTodo(presetAccountId = '') {
  // Pre-populate the assigned staff from the account's assigned rep if available
  const presetAcct = presetAccountId ? (state.accounts.find(a => a.ID === presetAccountId) || {}) : {};
  modal.open('Add Todo', todoForm({ AccountID: presetAccountId, StaffID: presetAcct.StaffID, StaffName: presetAcct.StaffName }), async () => {
    const title = val('f-title');
    const dueDate = val('f-due');
    if (!title) { toast('Title is required', 'error'); return; }
    if (!dueDate) { toast('Due date is required', 'error'); return; }
    const accountId = val('f-account');
    const accountName = accountId ? (state.accounts.find(a => a.ID === accountId) || {}).Name || '' : '';
    const staffId = val('f-staff');
    const staffName = staffId ? (state.staff.find(s => s.ID === staffId) || {}).Name || '' : '';
    await api.post('/api/reminders', {
      Title: title, DueDate: dueDate, Priority: val('f-priority'),
      Type: val('f-type'), AccountID: accountId, AccountName: accountName,
      StaffID: staffId, StaffName: staffName, Notes: val('f-notes'),
      Recurrence: val('f-recurrence'),
    });
    modal.close();
    toast('Todo added');
    if (state.view === 'account-profile') loadAccountProfile(state.accountProfileId);
    else loadTodos();
  });
}

function openEditTodo(id) {
  const todo = _todosCache.find(r => r.ID === id);
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
    loadTodos();
  });
}

async function completeTodo(id) {
  // Look up todo data from whichever cache is populated
  const todo = _todosCache.find(r => r.ID === id)
                || (state.dashTodos || []).find(r => r.ID === id);
  const acctId   = todo?.AccountID   || '';
  const acctName = todo?.AccountName || '';
  const title    = todo?.Title       || '';

  const formHtml = `
    <p style="margin:0 0 14px;color:var(--text-secondary);font-size:13px">
      Marking <strong>${esc(title) || 'this todo'}</strong> as done${acctName ? ` for <strong>${esc(acctName)}</strong>` : ''}.
    </p>
    ${acctId ? `
    <div class="form-group">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:600">
        <input type="checkbox" id="f-log-outreach" />
        Also log an outreach contact
      </label>
    </div>
    <div id="outreach-fields" style="display:none;margin-top:10px">
      <div class="form-row">
        <div class="form-group">
          <label>Date</label>
          <input class="form-control" id="f-date" type="date" value="${today()}" />
        </div>
        <div class="form-group">
          <label>Method</label>
          <select class="form-control" id="f-method">
            ${OUTREACH_METHODS.map(m => `<option value="${m}">${m}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>Notes / Outcome</label>
        <textarea class="form-control" id="f-notes" rows="2" placeholder="What was discussed?"></textarea>
      </div>
    </div>` : ''}
  `;

  modal.open('Complete Todo', formHtml, async () => {
    const logOutreach = acctId && document.getElementById('f-log-outreach')?.checked;

    const result = await api.put(`/api/reminders/${id}`, { Completed: 'true' });

    if (logOutreach) {
      await api.post('/api/outreach', {
        AccountID: acctId, AccountName: acctName,
        Date: val('f-date'), Method: val('f-method'),
        Notes: val('f-notes'), FollowUpStatus: 'None',
      });
    }

    modal.close();

    if (result._nextReminder) {
      const label = RECURRENCE_OPTIONS.find(o => o.value === result._nextReminder.Recurrence)?.label || result._nextReminder.Recurrence;
      toast(`Done — next ${label.toLowerCase()} occurrence on ${formatDate(result._nextReminder.DueDate)}`);
    } else {
      toast(logOutreach ? 'Marked done & outreach logged' : 'Marked as done');
    }

    if (state.view === 'account-profile') loadAccountProfile(state.accountProfileId);
    else if (state.view === 'todos') loadTodos();
    else loadDashboard();
  }, 'Mark Done');

  // Wire up toggle after modal renders
  setTimeout(() => {
    const cb     = document.getElementById('f-log-outreach');
    const fields = document.getElementById('outreach-fields');
    if (cb && fields) cb.addEventListener('change', () => { fields.style.display = cb.checked ? '' : 'none'; });
  }, 0);
}

async function reopenTodo(id) {
  await api.put(`/api/reminders/${id}`, { Completed: 'false' });
  toast('Todo reopened');
  loadTodos();
}

async function deleteTodo(id) {
  modal.confirm('Delete Todo', 'Delete this todo?', async () => {
    await api.del(`/api/reminders/${id}`);
    modal.close();
    toast('Todo deleted');
    loadTodos();
  });
}
