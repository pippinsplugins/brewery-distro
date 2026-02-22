'use strict';

const STAFF_ROLES = ['Sales Rep', 'Delivery Driver', 'Sales Manager', 'Account Manager', 'Other'];

function staffForm(member = {}) {
  return `
    <div class="form-row">
      <div class="form-group">
        <label>Name <span class="required">*</span></label>
        <input class="form-control" id="f-name" value="${esc(member.Name)}" placeholder="e.g. Alex Johnson" />
      </div>
      <div class="form-group">
        <label>Role</label>
        <select class="form-control" id="f-role">
          <option value="">-- Select --</option>
          ${STAFF_ROLES.map(r => `<option value="${r}" ${member.Role === r ? 'selected' : ''}>${r}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Email</label>
        <input class="form-control" id="f-email" type="email" value="${esc(member.Email)}" placeholder="alex@brewery.com" />
      </div>
      <div class="form-group">
        <label>Phone</label>
        <input class="form-control" id="f-phone" type="tel" value="${esc(formatPhone(member.Phone))}" placeholder="(555) 000-0000" onblur="this.value=formatPhone(this.value)" />
      </div>
    </div>
    <div class="form-group">
      <label>Active</label>
      <select class="form-control" id="f-active">
        <option value="true" ${member.Active !== 'false' ? 'selected' : ''}>Active</option>
        <option value="false" ${member.Active === 'false' ? 'selected' : ''}>Inactive</option>
      </select>
    </div>
    <div class="form-group">
      <label>Notes</label>
      <textarea class="form-control" id="f-notes" rows="2">${esc(member.Notes)}</textarea>
    </div>`;
}

let _staffCache = [];

async function loadStaff() {
  _paginationReset('staff');
  showLoading();
  const [staff, accounts] = await Promise.all([api.get('/api/staff'), api.get('/api/accounts')]);
  state.staff = staff;
  state.accounts = accounts;
  _staffCache = staff;
  renderStaff();
}

function renderStaff() {
  const staff = _staffCache;
  const _focused = document.activeElement?.id;
  const accounts = state.accounts || [];

  // Compute account count per staff member
  const acctCounts = {};
  accounts.forEach(a => { if (a.StaffID) acctCounts[a.StaffID] = (acctCounts[a.StaffID] || 0) + 1; });

  const search = (document.getElementById('staff-search') || {}).value || '';
  const filtered = search
    ? staff.filter(s => s.Name.toLowerCase().includes(search.toLowerCase()) || (s.Role || '').toLowerCase().includes(search.toLowerCase()))
    : staff;

  const pg = paginate(filtered, 'staff');

  setContent(`
    <div class="view-header">
      <div>
        <h2>Staff Directory</h2>
        <p class="subtitle">${staff.filter(s => s.Active !== 'false').length} active member${staff.length !== 1 ? 's' : ''}</p>
      </div>
      <div class="view-header-actions">
        <button class="btn btn-primary" onclick="openAddStaff()">+ Add Staff Member</button>
      </div>
    </div>
    <div class="filter-bar">
      <input type="search" id="staff-search" placeholder="Search staff..." value="${esc(search)}" oninput="_paginationReset('staff'); renderStaff()" />
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Name</th><th>Role</th><th>Email</th><th>Phone</th>
            <th>Accounts</th><th>Status</th><th>Notes</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${pg.total === 0 ? `<tr><td colspan="8" class="empty-state">No staff found. Add your first team member!</td></tr>` :
            pg.rows.map(s => `<tr>
              <td class="fw-600"><span class="td-link" onclick="openEditStaff('${esc(s.ID)}')">${esc(s.Name)}</span></td>
              <td>${esc(s.Role) || '—'}</td>
              <td class="text-sm">${esc(s.Email) || '—'}</td>
              <td class="text-sm">${s.Phone ? esc(formatPhone(s.Phone)) : '—'}</td>
              <td><span class="badge badge-prospect">${acctCounts[s.ID] || 0} account${(acctCounts[s.ID] || 0) !== 1 ? 's' : ''}</span></td>
              <td><span class="badge ${s.Active !== 'false' ? 'badge-staff-active' : 'badge-staff-inactive'}">${s.Active !== 'false' ? 'Active' : 'Inactive'}</span></td>
              <td class="text-sm text-muted">${esc(s.Notes).substring(0, 50)}${s.Notes && s.Notes.length > 50 ? '…' : ''}</td>
              <td class="td-actions">
                <button class="btn btn-ghost btn-sm" onclick="navigate('todos', { staffId: '${esc(s.ID)}', staffName: '${esc(s.Name)}' })">Todos</button>
                <button class="btn btn-ghost btn-sm" onclick="openEditStaff('${esc(s.ID)}')">Edit</button>
                <button class="btn btn-ghost btn-sm text-danger" onclick="deleteStaff('${esc(s.ID)}', '${esc(s.Name)}')">Delete</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${pg.total > 0 ? paginationControls('staff', pg, 'renderStaff') : ''}`);
  if (_focused === 'staff-search') refocusSearch('staff-search');
}

function openAddStaff() {
  modal.open('Add Staff Member', staffForm(), async () => {
    const name = val('f-name');
    if (!name) { toast('Name is required', 'error'); return; }
    await api.post('/api/staff', {
      Name: name, Role: val('f-role'), Email: val('f-email'),
      Phone: val('f-phone'), Notes: val('f-notes'),
    });
    modal.close();
    toast('Staff member added');
    loadStaff();
  });
}

function openEditStaff(id) {
  const member = _staffCache.find(s => s.ID === id);
  if (!member) return;
  modal.open('Edit Staff Member', staffForm(member), async () => {
    const name = val('f-name');
    if (!name) { toast('Name is required', 'error'); return; }
    await api.put(`/api/staff/${id}`, {
      Name: name, Role: val('f-role'), Email: val('f-email'),
      Phone: val('f-phone'), Active: val('f-active'), Notes: val('f-notes'),
    });
    modal.close();
    toast('Staff member updated');
    loadStaff();
  });
}

async function deleteStaff(id, name) {
  modal.confirm(
    'Delete Staff Member',
    `Delete "${name}"? They will be unassigned from all accounts.`,
    async () => {
      await api.del(`/api/staff/${id}`);
      modal.close();
      toast('Staff member deleted');
      loadStaff();
    }
  );
}
