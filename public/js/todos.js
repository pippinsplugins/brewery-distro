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
let _todoSearchFilter = '';
let _todoStaffFilter  = '';
// IDs of todos selected for bulk actions. Survives pagination clicks; cleared
// when filters/status change or a bulk action completes.
const _todoSelection = new Set();

async function loadTodos(preservePage = false) {
  if (!preservePage) _paginationReset('todos');
  // Capture filter values into module state before showLoading() wipes the
  // DOM, so renderTodos() can fall back to them when the inputs no longer
  // exist (e.g. after Done/Del/Reopen reloads).
  const statusEl = document.getElementById('todo-status');
  const searchEl = document.getElementById('todo-search');
  const staffEl  = document.getElementById('todo-staff');
  if (statusEl) _todoStatusFilter = statusEl.value || _todoStatusFilter;
  if (searchEl) _todoSearchFilter = searchEl.value;
  if (staffEl)  _todoStaffFilter  = staffEl.value;
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

// Apply the current search/staff/navFilter to the cache. Status filtering
// happens server-side via the loadTodos query param.
function _currentFilteredTodos() {
  const searchEl = document.getElementById('todo-search');
  const staffEl  = document.getElementById('todo-staff');
  const search = searchEl ? searchEl.value : _todoSearchFilter;
  const staffFilter = (staffEl ? staffEl.value : _todoStaffFilter) || state.navFilters?.staffId || '';
  let filtered = _todosCache;
  if (staffFilter) filtered = filtered.filter(r => r.StaffID === staffFilter);
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(r =>
      r.Title.toLowerCase().includes(q) ||
      (r.AccountName || '').toLowerCase().includes(q) ||
      (r.StaffName || '').toLowerCase().includes(q)
    );
  }
  return { filtered, staffFilter, search };
}

// Reset bulk selection (e.g. when filters change or after a bulk action).
function _clearTodoSelection() {
  _todoSelection.clear();
}

function renderTodos() {
  const todos = _todosCache;
  const _focused = document.activeElement?.id;
  const statusFilter = _todoStatusFilter;
  const { filtered, staffFilter, search } = _currentFilteredTodos();
  const staffFilterName = state.navFilters?.staffName || '';

  // Drop selections that no longer match the active filter (so the bulk bar
  // count and the header "all selected" check stay accurate).
  if (_todoSelection.size > 0) {
    const visibleIds = new Set(filtered.map(r => r.ID));
    for (const id of _todoSelection) if (!visibleIds.has(id)) _todoSelection.delete(id);
  }

  const pg = paginate(filtered, 'todos');
  const allFilteredSelected = filtered.length > 0 && filtered.every(r => _todoSelection.has(r.ID));

  const staffOpts = `<option value="">All Staff</option>` +
    [...new Map(todos.filter(r => r.StaffID).map(r => [r.StaffID, r.StaffName])).entries()]
      .sort((a, b) => (a[1] || '').localeCompare(b[1] || ''))
      .map(([id, name]) => `<option value="${esc(id)}" ${staffFilter === id ? 'selected' : ''}>${esc(name)}</option>`)
      .join('');

  setContent(`
    <div class="view-header">
      <div>
        <h2>Todos${staffFilterName ? ` — ${esc(staffFilterName)}` : ''}</h2>
        <p class="subtitle">${filtered.filter(r => r.Completed !== 'true').length} active todo${filtered.length !== 1 ? 's' : ''}${staffFilterName ? ` assigned to ${esc(staffFilterName)}` : ''}</p>
      </div>
      <div class="view-header-actions">
        ${staffFilterName ? `<button class="btn btn-ghost" onclick="state.navFilters={}; renderTodos()">Clear Filter</button>` : ''}
        <button class="btn btn-primary" onclick="openAddTodo()">+ Add Todo</button>
      </div>
    </div>
    <div class="filter-bar">
      <input type="search" id="todo-search" placeholder="Search title, account, staff..." value="${esc(search)}" oninput="_todoSearchFilter=this.value; _clearTodoSelection(); _paginationReset('todos'); renderTodos()" />
      <select id="todo-staff" onchange="_todoStaffFilter=this.value; state.navFilters={}; _clearTodoSelection(); _paginationReset('todos'); renderTodos()">${staffOpts}</select>
      <select id="todo-status" onchange="_clearTodoSelection(); _paginationReset('todos'); loadTodos()">
        <option value="active" ${statusFilter === 'active' ? 'selected' : ''}>Active</option>
        <option value="completed" ${statusFilter === 'completed' ? 'selected' : ''}>Completed</option>
        <option value="all" ${statusFilter === 'all' ? 'selected' : ''}>All</option>
      </select>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th style="width:32px"><input type="checkbox" id="todo-select-all" ${allFilteredSelected ? 'checked' : ''} onchange="toggleAllTodoSelection(this.checked)" title="Select all filtered" /></th>
            <th>Due</th><th class="mobile-hide">Status</th><th>Title</th><th class="mobile-hide">Account</th>
            <th class="mobile-hide">Type</th><th class="mobile-hide">Assigned To</th><th class="mobile-hide">Priority</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${pg.total === 0 ? `<tr><td colspan="9" class="empty-state">No todos found.</td></tr>` :
            pg.rows.map(r => `<tr>
              <td><input type="checkbox" class="todo-row-checkbox" data-id="${esc(r.ID)}" ${_todoSelection.has(r.ID) ? 'checked' : ''} onchange="toggleTodoSelection('${esc(r.ID)}', this.checked)" /></td>
              <td>${formatDate(r.DueDate)}</td>
              <td class="mobile-hide">${urgencyBadge(r.DueDate, r.Completed)}</td>
              <td class="fw-600"><span class="td-link" onclick="openEditTodo('${esc(r.ID)}')">${esc(r.Title)}</span>${r.Recurrence && r.Recurrence !== 'none' ? ` <span class="badge badge-recurrence" title="${esc(RECURRENCE_OPTIONS.find(o => o.value === r.Recurrence)?.label || r.Recurrence)}">↻</span>` : ''}</td>
              <td class="mobile-hide text-sm">${r.AccountID ? `<span class="td-link" onclick="loadAccountProfile('${esc(r.AccountID)}')">${esc(r.AccountName)}</span>` : '—'}</td>
              <td class="mobile-hide text-sm">${typeBadge(r.Type)}</td>
              <td class="mobile-hide text-sm">${esc(r.StaffName) || '<span class="text-muted">—</span>'}</td>
              <td class="mobile-hide">${priorityBadge(r.Priority)}</td>
              <td class="td-actions">
                <button class="btn btn-ghost btn-sm mobile-actions-toggle" onclick="toggleMobileActions(event)">&#8230;</button>
                <div class="mobile-actions-menu">
                ${r.Completed !== 'true'
                  ? `<button class="btn btn-ghost btn-sm text-success" onclick="completeTodo('${esc(r.ID)}')">Done</button>`
                  : `<button class="btn btn-ghost btn-sm" onclick="reopenTodo('${esc(r.ID)}')">Reopen</button>`
                }
                <button class="btn btn-ghost btn-sm" onclick="openEditTodo('${esc(r.ID)}')">Edit</button>
                <button class="btn btn-ghost btn-sm text-danger" onclick="deleteTodo('${esc(r.ID)}')">Del</button>
                </div>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${pg.total > 0 ? paginationControls('todos', pg, 'renderTodos') : ''}
    ${_bulkTodoBarHtml()}`);
  if (_focused === 'todo-search') refocusSearch('todo-search');
}

// ── Bulk selection + action bar ──────────────────────────────────

function toggleTodoSelection(id, checked) {
  if (checked) _todoSelection.add(id);
  else _todoSelection.delete(id);
  // Re-render so the bar count and the header "all selected" check update.
  renderTodos();
}

function toggleAllTodoSelection(checked) {
  const { filtered } = _currentFilteredTodos();
  if (checked) for (const r of filtered) _todoSelection.add(r.ID);
  else _clearTodoSelection();
  renderTodos();
}

// Render the floating bulk action bar at the bottom of the view when one or
// more todos are selected. The bar's button set depends on whether any of the
// selected items are still open (Reopen is only useful when all are done).
function _bulkTodoBarHtml() {
  if (_todoSelection.size === 0) return '';
  const selectedTodos = _todosCache.filter(r => _todoSelection.has(r.ID));
  const anyOpen = selectedTodos.some(r => r.Completed !== 'true');
  const allDone = selectedTodos.length > 0 && !anyOpen;
  return `
    <div class="bulk-action-bar" style="position:sticky;bottom:0;left:0;right:0;margin-top:16px;padding:12px 16px;background:var(--bg-secondary,#f7f7f8);border:1px solid var(--border,#e0e0e0);border-radius:8px;box-shadow:0 -2px 8px rgba(0,0,0,0.06);display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <span class="fw-600">${_todoSelection.size} selected</span>
      <button class="btn btn-secondary btn-sm" onclick="openBulkReassignTodos()">Reassign…</button>
      ${anyOpen ? `<button class="btn btn-secondary btn-sm" onclick="bulkMarkTodosDone()">Mark Done</button>` : ''}
      ${allDone ? `<button class="btn btn-secondary btn-sm" onclick="bulkReopenTodos()">Reopen</button>` : ''}
      <button class="btn btn-danger btn-sm" onclick="bulkDeleteTodos()">Delete</button>
      <button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="_clearTodoSelection(); renderTodos()">Clear selection</button>
    </div>`;
}

// Open a small modal with a staff dropdown (including "Unassigned") and PUT
// every selected reminder with the new StaffID/StaffName. Notifications fire
// per-row via the existing /api/reminders endpoint.
function openBulkReassignTodos() {
  const count = _todoSelection.size;
  if (count === 0) return;
  modal.open('Reassign Todos', `
    <p class="text-muted text-sm" style="margin-bottom:12px">
      Reassign <strong>${count}</strong> selected todo${count !== 1 ? 's' : ''}.
    </p>
    <div class="form-group">
      <label>Assign To</label>
      <select class="form-control" id="f-bulk-staff">
        <option value="">-- Unassigned --</option>
        ${staffOptions()}
      </select>
    </div>`, async () => {
    const staffId = val('f-bulk-staff');
    const staffName = staffId ? (state.staff.find(s => s.ID === staffId) || {}).Name || '' : '';
    const ids = [..._todoSelection];
    let succeeded = 0;
    for (const id of ids) {
      try {
        // ?silent=1 — bulk reassigns shouldn't email each recipient (see #389).
        await api.put(`/api/reminders/${id}?silent=1`, { StaffID: staffId, StaffName: staffName });
        succeeded++;
      } catch (err) {
        console.error('[bulk-reassign]', id, err.message);
      }
    }
    modal.close();
    _clearTodoSelection();
    toast(staffId
      ? `Reassigned ${succeeded} todo${succeeded !== 1 ? 's' : ''} to ${staffName}`
      : `Unassigned ${succeeded} todo${succeeded !== 1 ? 's' : ''}`);
    loadTodos(true);
  }, 'Reassign');
}

async function bulkMarkTodosDone() {
  // Only mark items that aren't already completed (idempotent + avoids spawning
  // a duplicate next occurrence for an already-completed recurring todo).
  const ids = _todosCache.filter(r => _todoSelection.has(r.ID) && r.Completed !== 'true').map(r => r.ID);
  if (ids.length === 0) return;
  let succeeded = 0;
  for (const id of ids) {
    try {
      await api.put(`/api/reminders/${id}`, { Completed: 'true' });
      succeeded++;
    } catch (err) {
      console.error('[bulk-done]', id, err.message);
    }
  }
  _clearTodoSelection();
  toast(`Marked ${succeeded} todo${succeeded !== 1 ? 's' : ''} as done`);
  loadTodos(true);
}

async function bulkReopenTodos() {
  const ids = _todosCache.filter(r => _todoSelection.has(r.ID) && r.Completed === 'true').map(r => r.ID);
  if (ids.length === 0) return;
  let succeeded = 0;
  for (const id of ids) {
    try {
      await api.put(`/api/reminders/${id}`, { Completed: 'false' });
      succeeded++;
    } catch (err) {
      console.error('[bulk-reopen]', id, err.message);
    }
  }
  _clearTodoSelection();
  toast(`Reopened ${succeeded} todo${succeeded !== 1 ? 's' : ''}`);
  loadTodos(true);
}

function bulkDeleteTodos() {
  const count = _todoSelection.size;
  if (count === 0) return;
  modal.confirm('Delete Todos', `Delete ${count} todo${count !== 1 ? 's' : ''}? This cannot be undone.`, async () => {
    const ids = [..._todoSelection];
    let succeeded = 0;
    for (const id of ids) {
      try {
        await api.del(`/api/reminders/${id}`);
        succeeded++;
      } catch (err) {
        console.error('[bulk-delete]', id, err.message);
      }
    }
    modal.close();
    _clearTodoSelection();
    toast(`Deleted ${succeeded} todo${succeeded !== 1 ? 's' : ''}`);
    loadTodos(true);
  });
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
  setTimeout(() => initMentions('f-notes'), 0);
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
    loadTodos(true);
  });
  setTimeout(() => initMentions('f-notes'), 0);
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
    else if (state.view === 'todos') loadTodos(true);
    else loadDashboard();
  }, 'Mark Done');

  // Wire up toggle after modal renders
  setTimeout(() => {
    const cb     = document.getElementById('f-log-outreach');
    const fields = document.getElementById('outreach-fields');
    if (cb && fields) cb.addEventListener('change', () => { fields.style.display = cb.checked ? '' : 'none'; });
    if (document.getElementById('f-notes')) initMentions('f-notes');
  }, 0);
}

async function reopenTodo(id) {
  await api.put(`/api/reminders/${id}`, { Completed: 'false' });
  toast('Todo reopened');
  loadTodos(true);
}

async function deleteTodo(id) {
  modal.confirm('Delete Todo', 'Delete this todo?', async () => {
    await api.del(`/api/reminders/${id}`);
    modal.close();
    toast('Todo deleted');
    loadTodos(true);
  });
}
