'use strict';

async function loadDashboard() {
  showLoading();
  const locParam = state.location ? `?location=${encodeURIComponent(state.location)}` : '';
  const [dash, accounts, staff, kegSummary, allOrders] = await Promise.all([
    api.get(`/api/dashboard${locParam}`),
    api.get('/api/accounts'),
    api.get('/api/staff'),
    api.get('/api/keg-tracking/summary'),
    api.get('/api/orders'),
  ]);
  state.accounts = accounts;
  state.staff = staff;
  state.dashTodos = [...(dash.overdueReminders || []), ...(dash.upcomingReminders || [])];

  // Build set of staff IDs assigned to the current location (for filtering)
  const locationStaffIds = new Set();
  if (state.location && LOCATIONS.length > 1) {
    for (const s of staff) {
      try {
        const locs = JSON.parse(s.Locations || '[]');
        if (Array.isArray(locs) && locs.includes(state.location)) locationStaffIds.add(s.ID);
      } catch { /* ignore */ }
    }
  }
  const _staffAtLocation = (id) => !state.location || LOCATIONS.length <= 1 || !id || locationStaffIds.has(id);

  // Pending deliveries: undelivered orders with a delivery date
  const pendingDeliveries = (allOrders || [])
    .filter(o => o.Delivered !== 'true' && o.DeliveryDate && _staffAtLocation(o.StaffID))
    .map(o => ({
      _type: 'delivery',
      ID: o.ID,
      Title: `Deliver order${o.InvoiceNumber ? ' #' + o.InvoiceNumber : ''} to ${o.AccountName || 'account'}`,
      DueDate: o.DeliveryDate,
      AccountID: o.AccountID,
      AccountName: o.AccountName,
      StaffID: o.StaffID || '',
      StaffName: o.StaffName || '',
      Completed: 'false',
      Type: 'Delivery',
    }));

  // Identify current staff member by matching email
  const currentStaff = staff.find(s => s.Email && s.Email.split(',').map(e => e.trim().toLowerCase()).includes((state.userEmail || '').toLowerCase()));
  const currentStaffId = currentStaff ? currentStaff.ID : null;

  // Split pending deliveries into overdue vs upcoming
  const overdueDeliveries = pendingDeliveries.filter(d => {
    const diff = daysFromToday(d.DueDate);
    return diff !== null && diff < 0;
  });
  const upcomingDeliveries = pendingDeliveries.filter(d => {
    const diff = daysFromToday(d.DueDate);
    return diff !== null && diff >= 0 && diff <= 7;
  });
  const allUpcoming = [...(dash.upcomingReminders || []), ...upcomingDeliveries]
    .sort((a, b) => (a.DueDate || '').localeCompare(b.DueDate || ''));
  const allOverdue = [...(dash.overdueReminders || []), ...overdueDeliveries]
    .sort((a, b) => (a.DueDate || '').localeCompare(b.DueDate || ''));

  // Build "My Todos" — overdue + upcoming assigned to current staff, including pending deliveries
  const myOverdue = currentStaffId ? allOverdue.filter(r => r.StaffID === currentStaffId) : [];
  const myUpcoming = currentStaffId ? allUpcoming.filter(r => r.StaffID === currentStaffId) : [];
  const myTodos = [...myOverdue, ...myUpcoming]
    .sort((a, b) => (a.DueDate || '').localeCompare(b.DueDate || ''));

  const lowStockHtml = dash.lowStockItems.length === 0
    ? '<li class="empty-state" style="padding:12px 0">All products are well stocked.</li>'
    : dash.lowStockItems.map(i => `
        <li class="clickable" onclick="navigate('inventory')">
          <span class="dash-label">${esc(i.Name)}</span>
          <span class="dash-meta">${esc(i.Units)} left (${esc(i.Format || 'units')})</span>
          <span class="badge badge-low-stock">Low</span>
        </li>`).join('');

  const upcomingHtml = allUpcoming.length === 0
    ? '<li class="empty-state" style="padding:12px 0">No upcoming todos or deliveries in the next 7 days.</li>'
    : allUpcoming.map(r => `
        <li class="clickable" onclick="${r.AccountID ? `loadAccountProfile('${esc(r.AccountID)}')` : `navigate('todos')`}">
          <div>
            ${urgencyBadge(r.DueDate, r.Completed)}
            ${typeBadge(r.Type)}
            <span class="dash-label">${esc(r.Title)}</span>
            ${r.AccountName ? `<span class="text-muted text-sm"> &mdash; ${esc(r.AccountName)}</span>` : ''}
          </div>
          <span class="dash-meta">${r.StaffName ? `${esc(r.StaffName)} · ` : ''}${formatDate(r.DueDate)}</span>
        </li>`).join('');

  const myTodosHtml = !currentStaffId
    ? '<li class="empty-state" style="padding:12px 0">No staff profile linked to your account.</li>'
    : myTodos.length === 0
      ? '<li class="empty-state" style="padding:12px 0">You have no upcoming todos or deliveries.</li>'
      : myTodos.map(r => `
          <li class="clickable" onclick="${r.AccountID ? `loadAccountProfile('${esc(r.AccountID)}')` : `navigate('todos')`}">
            <div>
              ${urgencyBadge(r.DueDate, r.Completed)}
              ${typeBadge(r.Type)}
              <span class="dash-label">${esc(r.Title)}</span>
              ${r.AccountName ? `<span class="text-muted text-sm"> &mdash; ${esc(r.AccountName)}</span>` : ''}
            </div>
            <span class="dash-meta">${formatDate(r.DueDate)}</span>
          </li>`).join('');

  const overdueHtml = allOverdue.length === 0 ? '' : `
    <div class="card">
      <div class="card-header"><h3 class="text-danger">Overdue (${allOverdue.length})</h3></div>
      <ul class="dash-list">
        ${allOverdue.map(r => `
          <li class="clickable" onclick="${r.AccountID ? `loadAccountProfile('${esc(r.AccountID)}')` : `navigate('todos')`}">
            ${urgencyBadge(r.DueDate, r.Completed)}
            ${typeBadge(r.Type)}
            <span class="dash-label">${esc(r.Title)}</span>
            ${r.AccountName ? `<span class="text-muted text-sm"> &mdash; ${esc(r.AccountName)}</span>` : ''}
            ${r._type !== 'delivery' ? `<button class="btn btn-ghost btn-sm text-success" onclick="event.stopPropagation();completeTodo('${esc(r.ID)}')">Done</button>` : ''}
          </li>`).join('')}
      </ul>
    </div>`;

  const recentHtml = dash.recentOutreach.length === 0
    ? '<li class="empty-state" style="padding:12px 0">No outreach logged yet.</li>'
    : dash.recentOutreach.map(o => `
        <li class="clickable" onclick="loadAccountProfile('${esc(o.AccountID)}')">
          ${methodBadge(o.Method)}
          <span class="dash-label">${esc(o.AccountName)}</span>
          <span class="dash-meta">${formatDate(o.Date)}</span>
        </li>`).join('');

  setContent(`
    <div class="view-header">
      <div>
        <h2>Dashboard</h2>
        <p class="subtitle">Distribution overview</p>
      </div>
      <div class="view-header-actions">
        <button class="btn btn-secondary" onclick="loadDashboard()">Refresh</button>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card" onclick="navigate('inventory')">
        <div class="stat-value">${dash.totalProducts}</div>
        <div class="stat-label">Products</div>
      </div>
      <div class="stat-card accent" onclick="navigate('accounts', {status: 'Active'})">
        <div class="stat-value">${dash.activeAccounts}</div>
        <div class="stat-label">Active Accounts</div>
      </div>
      <div class="stat-card" onclick="navigate('accounts', {status: 'Prospect'})">
        <div class="stat-value">${dash.prospectAccounts}</div>
        <div class="stat-label">Prospects</div>
      </div>
      <div class="stat-card accent" onclick="navigate('orders')">
        <div class="stat-value">$${parseFloat(dash.monthlyOrdersTotal || 0).toLocaleString('en-US', {minimumFractionDigits: 0, maximumFractionDigits: 0})}</div>
        <div class="stat-label">Orders This Month (${dash.monthlyOrdersCount || 0})</div>
      </div>
      <div class="stat-card ${dash.overdueCount > 0 ? 'danger' : 'warning'}" onclick="navigate('todos')">
        <div class="stat-value">${dash.overdueCount > 0 ? dash.overdueCount : dash.totalActiveReminders}</div>
        <div class="stat-label">${dash.overdueCount > 0 ? 'Overdue' : 'Active Todos'}</div>
      </div>
    </div>

    <div class="dashboard-grid">
      <div class="card">
        <div class="card-header">
          <h3>My Todos${myOverdue.length > 0 ? ` <span class="text-danger">(${myOverdue.length} overdue)</span>` : ''}</h3>
          ${currentStaffId ? `<button class="btn btn-ghost btn-sm" data-name="${esc(currentStaff.Name)}" onclick="navigate('todos', {staffId: '${esc(currentStaffId)}', staffName: this.dataset.name})">View all</button>` : ''}
        </div>
        <ul class="dash-list">${myTodosHtml}</ul>
      </div>

      ${overdueHtml}

      <div class="card">
        <div class="card-header">
          <h3>Upcoming (7 days)</h3>
          <button class="btn btn-ghost btn-sm" onclick="navigate('todos')">View all</button>
        </div>
        <ul class="dash-list">${upcomingHtml}</ul>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>Recent Outreach</h3>
          <button class="btn btn-ghost btn-sm" onclick="navigate('outreach')">View all</button>
        </div>
        <ul class="dash-list">${recentHtml}</ul>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>Low Stock Alerts</h3>
          <button class="btn btn-ghost btn-sm" onclick="navigate('inventory')">View all</button>
        </div>
        <ul class="dash-list">${lowStockHtml}</ul>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>Kegs Outstanding</h3>
          <button class="btn btn-ghost btn-sm" onclick="navigate('kegs')">View all</button>
        </div>
        <ul class="dash-list">${(kegSummary || []).length === 0
          ? '<li class="empty-state" style="padding:12px 0">No outstanding kegs.</li>'
          : (kegSummary || [])
              .sort((a, b) => b.outstanding - a.outstanding)
              .slice(0, 8)
              .map(k => {
                const depLabel = k.depositOutstanding > 0 ? ` · $${parseFloat(k.depositOutstanding).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : '';
                return `
                <li class="clickable" onclick="loadAccountProfile('${esc(k.accountId)}')">
                  <span class="dash-label">${esc(k.accountName)}</span>
                  <span class="badge badge-low-stock">${k.outstanding} keg${k.outstanding !== 1 ? 's' : ''}${depLabel}</span>
                </li>`;
              }).join('')}</ul>
      </div>
    </div>`);
}
