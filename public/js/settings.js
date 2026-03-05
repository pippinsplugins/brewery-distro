'use strict';

async function loadSettings() {
  showLoading();
  const settings = await api.get('/api/settings');
  state.settings = settings;
  renderSettings();
}

function getKegDeposits() {
  return (state.settings && typeof state.settings.kegDeposits === 'object') ? state.settings.kegDeposits : {};
}

function getDepositForFormat(format) {
  if (!format) return 0;
  const deposits = getKegDeposits();
  return parseFloat(deposits[format]) || 0;
}

function renderSettings() {
  const s = state.settings;
  const companyName = s.companyName || '';
  const locations = Array.isArray(s.locations) ? s.locations : [...LOCATIONS];
  const accountTags = Array.isArray(s.accountTags) ? s.accountTags : [];
  const kegDeposits = getKegDeposits();
  const kegFormats = ['1/6 Keg', '1/4 Keg', '1/2 Keg'];

  setContent(`
    <div class="view-header">
      <div>
        <h2>Settings</h2>
        <p class="subtitle">Manage application configuration</p>
      </div>
    </div>

    <div class="settings-grid">
      <div class="card">
        <div class="card-header"><h3>Company</h3></div>
        <div style="padding:0 18px 18px">
          <div class="form-group">
            <label>Company Name</label>
            <input class="form-control" id="settings-company-name" value="${esc(companyName)}" placeholder="e.g. My Brewery" />
          </div>
          <button class="btn btn-primary" onclick="saveCompanyName()">Save</button>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>Locations</h3>
          <button class="btn btn-ghost btn-sm" onclick="openAddLocation()">+ Add Location</button>
        </div>
        <div style="padding:0 18px 18px">
          <p class="text-sm text-muted" style="margin-bottom:12px">
            Manage warehouse and distribution locations. These appear in the sidebar switcher and in inventory/order forms.
          </p>
          ${locations.length === 0
            ? '<p class="empty-state">No locations configured.</p>'
            : `<ul class="settings-location-list">
                ${locations.map((loc, i) => `
                  <li class="settings-location-item">
                    <span class="settings-location-name">${esc(loc)}</span>
                    <div class="settings-location-actions">
                      <button class="btn btn-ghost btn-sm" onclick="openRenameLocation(${i}, '${esc(loc)}')">Rename</button>
                      <button class="btn btn-ghost btn-sm text-danger" onclick="removeLocation(${i}, '${esc(loc)}')">Remove</button>
                    </div>
                  </li>`).join('')}
              </ul>`
          }
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>Account Tags</h3>
          <button class="btn btn-ghost btn-sm" onclick="openAddAccountTag()">+ Add Tag</button>
        </div>
        <div style="padding:0 18px 18px">
          <p class="text-sm text-muted" style="margin-bottom:12px">
            Categorize accounts by purchase behavior, territory, or other criteria. Tags can be assigned to accounts in the account form.
          </p>
          ${accountTags.length === 0
            ? '<p class="empty-state">No tags configured.</p>'
            : `<ul class="settings-location-list">
                ${accountTags.map((t, i) => `
                  <li class="settings-location-item">
                    <span class="settings-location-name">${esc(t)}</span>
                    <div class="settings-location-actions">
                      <button class="btn btn-ghost btn-sm" onclick="openRenameAccountTag(${i}, '${esc(t)}')">Rename</button>
                      <button class="btn btn-ghost btn-sm text-danger" onclick="removeAccountTag(${i}, '${esc(t)}')">Remove</button>
                    </div>
                  </li>`).join('')}
              </ul>`
          }
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h3>Keg Deposits</h3></div>
        <div style="padding:0 18px 18px">
          <p class="text-sm text-muted" style="margin-bottom:12px">
            Set deposit amounts per keg format. These are used when accounts are configured to charge keg deposits.
          </p>
          ${kegFormats.map(fmt => `
            <div class="form-row" style="align-items:center;margin-bottom:8px">
              <div style="flex:1;font-weight:500">${esc(fmt)}</div>
              <div style="flex:1">
                <div style="position:relative">
                  <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--text-muted)">$</span>
                  <input class="form-control" id="settings-deposit-${esc(fmt.replace(/[^a-zA-Z0-9]/g, '-'))}"
                    type="number" step="0.01" min="0" value="${esc(kegDeposits[fmt] || '')}" placeholder="0.00"
                    style="padding-left:24px" />
                </div>
              </div>
            </div>`).join('')}
          <button class="btn btn-primary" style="margin-top:12px" onclick="saveKegDeposits()">Save</button>
        </div>
      </div>

      <div class="card" id="qbo-settings-card">
        <div class="card-header"><h3>QuickBooks Online</h3></div>
        <div style="padding:0 18px 18px" id="qbo-settings-body">
          <p class="text-sm text-muted">Loading QuickBooks status...</p>
        </div>
      </div>
    </div>`);

  // Load QBO status asynchronously
  loadQboStatus();
}

function saveCompanyName() {
  const name = val('settings-company-name');
  api.put('/api/settings', { companyName: name }).then(updated => {
    state.settings = updated;
    applySettings(updated);
    toast('Company name saved');
  }).catch(err => toast(err.message, 'error'));
}

function openAddLocation() {
  modal.open('Add Location', `
    <div class="form-group">
      <label>Location Name <span class="required">*</span></label>
      <input class="form-control" id="f-location-name" placeholder="e.g. Kansas City" />
    </div>
  `, async () => {
    const name = val('f-location-name');
    if (!name) { toast('Location name is required', 'error'); return; }
    const current = Array.isArray(state.settings.locations) ? [...state.settings.locations] : [...LOCATIONS];
    if (current.includes(name)) { toast('Location already exists', 'error'); return; }
    current.push(name);
    const updated = await api.put('/api/settings', { locations: current });
    state.settings = updated;
    applySettings(updated);
    modal.close();
    toast('Location added');
    renderSettings();
  });
}

function openRenameLocation(index, oldName) {
  modal.open('Rename Location', `
    <div class="form-group">
      <label>New Name <span class="required">*</span></label>
      <input class="form-control" id="f-location-name" value="${esc(oldName)}" />
    </div>
    <p class="text-sm text-muted" style="margin-top:8px">All inventory and order records at this location will be updated.</p>
  `, async () => {
    const newName = val('f-location-name');
    if (!newName) { toast('Location name is required', 'error'); return; }
    const current = Array.isArray(state.settings.locations) ? [...state.settings.locations] : [...LOCATIONS];
    if (current.includes(newName) && newName !== oldName) { toast('Location already exists', 'error'); return; }
    current[index] = newName;
    const updated = await api.put('/api/settings/rename-location', { oldName, newName, locations: current });
    state.settings = updated;
    applySettings(updated);
    if (state.location === oldName) {
      state.location = newName;
      localStorage.setItem('brewLocation', newName);
    }
    state.inventory = []; // clear cached inventory
    modal.close();
    const info = updated._renamed || {};
    toast(`Location renamed — ${info.inventoryUpdated || 0} product(s) and ${info.ordersUpdated || 0} order(s) updated`);
    renderSettings();
  });
}

function removeLocation(index, name) {
  const current = Array.isArray(state.settings.locations) ? [...state.settings.locations] : [...LOCATIONS];
  if (current.length <= 1) { toast('At least one location is required', 'error'); return; }
  modal.confirm('Remove Location', `Remove "${name}"? Existing inventory and orders at this location will not be affected.`, async () => {
    current.splice(index, 1);
    const updated = await api.put('/api/settings', { locations: current });
    state.settings = updated;
    applySettings(updated);
    if (state.location === name && current.length > 0) {
      state.location = current[0];
      localStorage.setItem('brewLocation', current[0]);
    }
    modal.close();
    toast('Location removed');
    renderSettings();
  });
}

// ── Keg Deposits ─────────────────────────────────────────────────

function saveKegDeposits() {
  const kegFormats = ['1/6 Keg', '1/4 Keg', '1/2 Keg'];
  const deposits = {};
  for (const fmt of kegFormats) {
    const id = 'settings-deposit-' + fmt.replace(/[^a-zA-Z0-9]/g, '-');
    const v = val(id);
    if (v && parseFloat(v) > 0) deposits[fmt] = parseFloat(v).toFixed(2);
  }
  api.put('/api/settings', { kegDeposits: deposits }).then(updated => {
    state.settings = updated;
    toast('Keg deposit rates saved');
  }).catch(err => toast(err.message, 'error'));
}

// ── Account Tags ──────────────────────────────────────────────────

function openAddAccountTag() {
  modal.open('Add Account Tag', `
    <div class="form-group">
      <label>Tag Name <span class="required">*</span></label>
      <input class="form-control" id="f-account-tag-name" placeholder='e.g. Kegs Only, Territory A' />
    </div>
  `, async () => {
    const name = val('f-account-tag-name');
    if (!name) { toast('Tag name is required', 'error'); return; }
    const current = Array.isArray(state.settings.accountTags) ? [...state.settings.accountTags] : [];
    if (current.includes(name)) { toast('Tag already exists', 'error'); return; }
    current.push(name);
    const updated = await api.put('/api/settings', { accountTags: current });
    state.settings = updated;
    applySettings(updated);
    modal.close();
    toast('Tag added');
    renderSettings();
  });
}

function openRenameAccountTag(index, oldName) {
  modal.open('Rename Account Tag', `
    <div class="form-group">
      <label>New Name <span class="required">*</span></label>
      <input class="form-control" id="f-account-tag-name" value="${esc(oldName)}" />
    </div>
    <p class="text-sm text-muted" style="margin-top:8px">All accounts with this tag will be updated.</p>
  `, async () => {
    const newName = val('f-account-tag-name');
    if (!newName) { toast('Tag name is required', 'error'); return; }
    const current = Array.isArray(state.settings.accountTags) ? [...state.settings.accountTags] : [];
    if (current.includes(newName) && newName !== oldName) { toast('Tag already exists', 'error'); return; }
    current[index] = newName;
    const updated = await api.put('/api/settings/rename-account-tag', { oldName, newName, accountTags: current });
    state.settings = updated;
    applySettings(updated);
    modal.close();
    const info = updated._renamed || {};
    toast(`Tag renamed — ${info.accountsUpdated || 0} account(s) updated`);
    renderSettings();
  });
}

function removeAccountTag(index, name) {
  const current = Array.isArray(state.settings.accountTags) ? [...state.settings.accountTags] : [];
  modal.confirm('Remove Tag', `Remove "${name}"? Existing accounts with this tag will not be affected.`, async () => {
    current.splice(index, 1);
    const updated = await api.put('/api/settings', { accountTags: current });
    state.settings = updated;
    applySettings(updated);
    modal.close();
    toast('Tag removed');
    renderSettings();
  });
}

// ── QuickBooks Online ─────────────────────────────────────────────

async function loadQboStatus() {
  const body = document.getElementById('qbo-settings-body');
  if (!body) return;

  try {
    const status = await api.get('/api/qbo/status');
    const autoSync = state.settings.qboAutoSync !== 'false';

    if (!status.configured) {
      body.innerHTML = `
        <p class="text-sm text-muted" style="margin-bottom:8px">
          QuickBooks integration is not configured. Set <code>QBO_CLIENT_ID</code> and <code>QBO_CLIENT_SECRET</code> environment variables to enable.
        </p>
        <span class="badge badge-neutral">Not Configured</span>`;
      return;
    }

    if (!status.connected) {
      body.innerHTML = `
        <p class="text-sm text-muted" style="margin-bottom:12px">
          Connect your QuickBooks Online account to create invoices in QuickBooks when saving orders.
        </p>
        <a class="btn btn-primary" href="/auth/qbo">Connect to QuickBooks</a>`;
      return;
    }

    body.innerHTML = `
      <p class="text-sm text-muted" style="margin-bottom:12px">
        Connected to QuickBooks Online. You will be prompted to create a QuickBooks invoice after saving an order.
      </p>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <span class="badge badge-success">Connected</span>
        <span class="text-sm text-muted">Company ID: ${esc(status.realmId)}</span>
      </div>
      <div class="form-group" style="margin-bottom:12px">
        <label class="checkbox-label">
          <input type="checkbox" id="qbo-auto-sync" ${autoSync ? 'checked' : ''} onchange="toggleQboAutoSync()" />
          Auto-sync new orders to QuickBooks
        </label>
      </div>
      <div class="form-group" style="margin-bottom:12px">
        <label>Tax Code</label>
        <select class="form-control" id="qbo-tax-code" onchange="saveQboTaxCode()" disabled>
          <option value="">Loading tax codes...</option>
        </select>
        <p class="text-sm text-muted" style="margin-top:4px">Select which QuickBooks tax code to apply to invoices.</p>
      </div>
      <button class="btn btn-ghost text-danger" onclick="disconnectQbo()">Disconnect</button>`;

    // Load tax codes into the dropdown
    loadQboTaxCodes();
  } catch (err) {
    body.innerHTML = `<p class="text-sm text-danger">Failed to load QuickBooks status.</p>`;
  }
}

async function toggleQboAutoSync() {
  const checked = document.getElementById('qbo-auto-sync')?.checked;
  try {
    const updated = await api.put('/api/settings', { qboAutoSync: checked ? 'true' : 'false' });
    state.settings = updated;
    toast(checked ? 'Auto-sync enabled' : 'Auto-sync disabled');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function loadQboTaxCodes() {
  const sel = document.getElementById('qbo-tax-code');
  if (!sel) return;
  try {
    const codes = await api.get('/api/qbo/tax-codes');
    const saved = state.settings.qboTaxCodeId || '';
    sel.innerHTML = '<option value="">None (no tax applied)</option>' +
      codes.map(c =>
        `<option value="${esc(c.id)}" ${saved === c.id ? 'selected' : ''}>${esc(c.name)}${c.rate ? ` (${c.rate}%)` : ''}</option>`
      ).join('');
    sel.disabled = false;
  } catch {
    sel.innerHTML = '<option value="">Failed to load tax codes</option>';
  }
}

async function saveQboTaxCode() {
  const taxCodeId = document.getElementById('qbo-tax-code')?.value || '';
  try {
    await api.post('/api/qbo/tax-code', { taxCodeId });
    const updated = await api.get('/api/settings');
    state.settings = updated;
    toast('Tax code saved');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function disconnectQbo() {
  modal.confirm('Disconnect QuickBooks', 'Disconnect from QuickBooks Online? New orders will no longer sync automatically.', async () => {
    try {
      await api.post('/api/qbo/disconnect');
      modal.close();
      toast('Disconnected from QuickBooks');
      loadQboStatus();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}
