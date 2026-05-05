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

function getTaxRate() {
  if (!state.settings || !state.settings.taxRate) return 0;
  return parseFloat(state.settings.taxRate) || 0;
}

function renderSettings() {
  const s = state.settings;
  const companyName = s.companyName || '';
  const locations = Array.isArray(s.locations) ? s.locations : [...LOCATIONS];
  const accountTags = Array.isArray(s.accountTags) ? s.accountTags : [];
  const styles = Array.isArray(s.styles) ? s.styles : [...STYLES];
  const kegDeposits = getKegDeposits();
  const kegFormats = ['1/6 Keg', '1/4 Keg', '1/2 Keg'];

  setContent(`
    <div class="view-header">
      <div>
        <h2>Settings</h2>
        <p class="subtitle">Manage application configuration</p>
      </div>
    </div>

    <div class="settings-tabs">
      <button class="settings-tab active" data-tab="general" onclick="switchSettingsTab('general')">General</button>
      <button class="settings-tab" data-tab="integrations" onclick="switchSettingsTab('integrations')">Integrations</button>
    </div>

    <div class="settings-tab-content active" data-tab="general">
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
        <div class="card-header">
          <h3>Beer Styles</h3>
          <button class="btn btn-ghost btn-sm" onclick="openAddStyle()">+ Add Style</button>
        </div>
        <div style="padding:0 18px 18px">
          <p class="text-sm text-muted" style="margin-bottom:12px">
            Manage beer style options. These appear in the product form style dropdown.
          </p>
          ${styles.length === 0
            ? '<p class="empty-state">No styles configured.</p>'
            : `<ul class="settings-location-list">
                ${styles.map((st, i) => `
                  <li class="settings-location-item">
                    <span class="settings-location-name">${esc(st)}</span>
                    <div class="settings-location-actions">
                      <button class="btn btn-ghost btn-sm" onclick="openRenameStyle(${i}, '${esc(st)}')">Rename</button>
                      <button class="btn btn-ghost btn-sm text-danger" onclick="removeStyle(${i}, '${esc(st)}')">Remove</button>
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

      <div class="card">
        <div class="card-header"><h3>Tax Rate</h3></div>
        <div style="padding:0 18px 18px">
          <p class="text-sm text-muted" style="margin-bottom:12px">
            Set the tax rate for orders. Accounts can be marked as taxable, and orders for those accounts will auto-calculate tax.
          </p>
          <div class="form-row" style="align-items:center;margin-bottom:8px">
            <div style="flex:1">
              <div style="position:relative">
                <input class="form-control" id="settings-tax-rate"
                  type="number" step="0.01" min="0" max="100" value="${esc(s.taxRate || '')}" placeholder="0.00"
                  style="padding-right:30px" />
                <span style="position:absolute;right:10px;top:50%;transform:translateY(-50%);color:var(--text-muted)">%</span>
              </div>
            </div>
          </div>
          <button class="btn btn-primary" onclick="saveTaxRate()">Save</button>
        </div>
      </div>
    </div>
    </div>

    <div class="settings-tab-content" data-tab="integrations">
    <div class="settings-grid">
      <div class="card" id="api-keys-card">
        <div class="card-header">
          <h3>API Keys</h3>
          <button class="btn btn-ghost btn-sm" onclick="openGenerateApiKey()">+ Generate Key</button>
        </div>
        <div style="padding:0 18px 18px" id="api-keys-body">
          <p class="text-sm text-muted" style="margin-bottom:12px">
            API keys allow external platforms (POS, e-commerce, automation tools) to access the API without browser login.
          </p>
          <div id="api-keys-list"><p class="text-sm text-muted">Loading...</p></div>
        </div>
      </div>

      <div class="card" id="inbound-email-card">
        <div class="card-header"><h3>Email Order Requests</h3></div>
        <div style="padding:0 18px 18px" id="inbound-email-body">
          <p class="text-sm text-muted" style="margin-bottom:12px">
            Receive order emails via a Google Apps Script webhook, parse them with AI, and create Draft orders for review.
          </p>
          <div class="form-group">
            <label>Target Email Address</label>
            <input class="form-control" id="settings-inbound-email" value="${esc(s.inboundEmail || '')}" placeholder="e.g. orders@yourdomain.com" />
          </div>
          <div class="form-group">
            <label>Gemini API Key</label>
            <input class="form-control" id="settings-gemini-key" type="password" value="" placeholder="${s.geminiApiKeySet ? '••••••••  (saved)' : 'Enter Gemini API key'}" />
            <p class="text-sm text-muted" style="margin-top:4px">Used to parse order emails with Google Gemini AI. <a href="https://aistudio.google.com/apikey" target="_blank">Get a key</a></p>
          </div>
          <div class="form-group">
            <label>Webhook URL</label>
            <div style="display:flex;gap:8px">
              <input class="form-control" id="settings-webhook-url" value="${esc(location.origin + BASE_PATH + '/webhooks/inbound-email')}" readonly style="font-family:monospace;font-size:13px;background:var(--bg-secondary)" />
              <button class="btn btn-secondary" onclick="copyToClipboard('settings-webhook-url','Webhook URL')">Copy</button>
            </div>
          </div>
          <div class="form-group">
            <label>Webhook Token</label>
            <div style="display:flex;gap:8px">
              <input class="form-control" id="settings-webhook-token" value="${s.inboundEmailWebhookTokenSet ? '••••••••••••••••' : '(not generated)'}" readonly style="font-family:monospace;font-size:13px;background:var(--bg-secondary)" />
              <button class="btn btn-secondary" onclick="regenerateWebhookToken()">Generate</button>
              <button class="btn btn-secondary" id="btn-copy-webhook-token" onclick="copyWebhookToken()" style="display:${s.inboundEmailWebhookTokenSet ? 'inline-flex' : 'none'}">Copy</button>
            </div>
            <p class="text-sm text-muted" style="margin-top:4px">
              Generate a token, then paste it into your Google Apps Script configuration.
            </p>
          </div>
          <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
            <button class="btn btn-primary" onclick="saveInboundEmailSettings()">Save</button>
            <button class="btn btn-secondary" onclick="openInboundEmailQueue()">View Email Queue</button>
          </div>
          <p class="text-sm text-muted" style="margin-top:12px">
            <strong>Setup:</strong> Install the <a href="${BASE_PATH}/docs/inbound-email-apps-script.js" target="_blank">Google Apps Script</a> on the Gmail account that receives order emails.
            Configure it with the webhook URL and token above, then run the <code>setup()</code> function to start polling every 5 minutes.
          </p>
        </div>
      </div>

      <div class="card" id="qbo-settings-card">
        <div class="card-header"><h3>QuickBooks Online</h3></div>
        <div style="padding:0 18px 18px" id="qbo-settings-body">
          <p class="text-sm text-muted">Loading QuickBooks status...</p>
        </div>
      </div>
    </div>
    </div>`);

  // Load API keys and QBO status asynchronously
  loadApiKeys();
  loadQboStatus();
}

function switchSettingsTab(tab) {
  document.querySelectorAll('.settings-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
  document.querySelectorAll('.settings-tab-content').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
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

// ── Tax Rate ──────────────────────────────────────────────────────

function saveTaxRate() {
  const v = val('settings-tax-rate');
  const rate = parseFloat(v) || 0;
  if (rate < 0 || rate > 100) { toast('Tax rate must be between 0 and 100', 'error'); return; }
  const value = rate > 0 ? rate.toString() : '';
  api.put('/api/settings', { taxRate: value }).then(updated => {
    state.settings = updated;
    toast('Tax rate saved');
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

// ── Beer Styles ──────────────────────────────────────────────────

function openAddStyle() {
  modal.open('Add Beer Style', `
    <div class="form-group">
      <label>Style Name <span class="required">*</span></label>
      <input class="form-control" id="f-style-name" placeholder="e.g. Hazy IPA, Witbier" />
    </div>
  `, async () => {
    const name = val('f-style-name');
    if (!name) { toast('Style name is required', 'error'); return; }
    const current = Array.isArray(state.settings.styles) ? [...state.settings.styles] : [...STYLES];
    if (current.includes(name)) { toast('Style already exists', 'error'); return; }
    current.push(name);
    const updated = await api.put('/api/settings', { styles: current });
    state.settings = updated;
    applySettings(updated);
    modal.close();
    toast('Style added');
    renderSettings();
  });
}

function openRenameStyle(index, oldName) {
  modal.open('Rename Beer Style', `
    <div class="form-group">
      <label>New Name <span class="required">*</span></label>
      <input class="form-control" id="f-style-name" value="${esc(oldName)}" />
    </div>
    <p class="text-sm text-muted" style="margin-top:8px">All products and inventory with this style will be updated.</p>
  `, async () => {
    const newName = val('f-style-name');
    if (!newName) { toast('Style name is required', 'error'); return; }
    const current = Array.isArray(state.settings.styles) ? [...state.settings.styles] : [...STYLES];
    if (current.includes(newName) && newName !== oldName) { toast('Style already exists', 'error'); return; }
    current[index] = newName;
    const updated = await api.put('/api/settings/rename-style', { oldName, newName, styles: current });
    state.settings = updated;
    applySettings(updated);
    modal.close();
    const info = updated._renamed || {};
    toast(`Style renamed — ${info.productsUpdated || 0} product(s) and ${info.inventoryUpdated || 0} inventory item(s) updated`);
    renderSettings();
  });
}

function removeStyle(index, name) {
  const current = Array.isArray(state.settings.styles) ? [...state.settings.styles] : [...STYLES];
  modal.confirm('Remove Style', `Remove "${name}"? Existing products with this style will not be affected.`, async () => {
    current.splice(index, 1);
    const updated = await api.put('/api/settings', { styles: current });
    state.settings = updated;
    applySettings(updated);
    modal.close();
    toast('Style removed');
    renderSettings();
  });
}

// ── API Keys ──────────────────────────────────────────────────────

async function loadApiKeys() {
  const container = document.getElementById('api-keys-list');
  if (!container) return;
  try {
    const keys = await api.get('/api/settings/api-keys');
    if (keys.length === 0) {
      container.innerHTML = '<p class="empty-state">No API keys generated yet.</p>';
      return;
    }
    container.innerHTML = `<table class="data-table" style="margin:0">
      <thead><tr><th>Name</th><th>Key Prefix</th><th>Created</th><th></th></tr></thead>
      <tbody>${keys.map(k => `<tr>
        <td>${esc(k.name)}</td>
        <td><code>${esc(k.prefix)}...</code></td>
        <td>${esc(k.createdAt ? k.createdAt.split('T')[0] : '')}</td>
        <td style="text-align:right"><button class="btn btn-ghost btn-sm text-danger" onclick="revokeApiKey('${esc(k.id)}','${esc(k.name)}')">Revoke</button></td>
      </tr>`).join('')}</tbody>
    </table>`;
  } catch (err) {
    container.innerHTML = '<p class="text-sm text-danger">Failed to load API keys.</p>';
  }
}

function openGenerateApiKey() {
  modal.open('Generate API Key', `
    <div class="form-group">
      <label>Key Name <span class="required">*</span></label>
      <input class="form-control" id="f-api-key-name" placeholder="e.g. POS Integration, Zapier" />
    </div>
  `, async () => {
    const name = val('f-api-key-name');
    if (!name) { toast('Key name is required', 'error'); return; }
    try {
      const result = await api.post('/api/settings/api-keys', { name });
      modal.close();
      // Show the key in a read-only modal — user must copy it now
      modal.open('API Key Generated', `
        <p style="margin-bottom:12px"><strong>Copy this key now.</strong> It will not be shown again.</p>
        <div class="form-group">
          <label>API Key</label>
          <div style="display:flex;gap:8px">
            <input class="form-control" id="f-api-key-value" value="${esc(result.key)}" readonly style="font-family:monospace;font-size:13px" />
            <button class="btn btn-primary" onclick="copyApiKey()">Copy</button>
          </div>
        </div>
      `);
      // Hide the submit button since this is display-only
      document.getElementById('modal-submit-btn').style.display = 'none';
      loadApiKeys();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function copyApiKey() {
  const input = document.getElementById('f-api-key-value');
  if (!input) return;
  navigator.clipboard.writeText(input.value).then(() => {
    toast('API key copied to clipboard');
  }).catch(() => {
    input.select();
    toast('Press Ctrl+C to copy', 'error');
  });
}

function revokeApiKey(id, name) {
  modal.confirm('Revoke API Key', `Revoke "${name}"? Any integrations using this key will stop working immediately.`, async () => {
    try {
      await api.del('/api/settings/api-keys/' + id);
      modal.close();
      toast('API key revoked');
      loadApiKeys();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

// ── QuickBooks Online ─────────────────────────────────────────────

async function loadQboStatus() {
  const body = document.getElementById('qbo-settings-body');
  if (!body) return;

  try {
    const status = await api.get('/api/qbo/status');

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
        ${status.redirectUri ? `
        <div class="form-group" style="margin-bottom:12px">
          <label>Redirect URI</label>
          <input class="form-control" value="${esc(status.redirectUri)}" readonly onclick="this.select()" style="font-family:monospace;font-size:13px;background:var(--bg-secondary)" />
          <p class="text-sm text-muted" style="margin-top:4px">
            Add this exact URI to your Intuit Developer app's <strong>Redirect URIs</strong> list before connecting, otherwise Intuit will reject the request with a redirect URI error.
          </p>
        </div>` : ''}
        <a class="btn btn-primary" href="${BASE_PATH}/auth/qbo">Connect to QuickBooks</a>`;
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

// ── Inbound Email Order Requests ──────────────────────────────────

async function saveInboundEmailSettings() {
  const settings = {
    inboundEmail: val('settings-inbound-email'),
  };

  // Only send gemini key if user typed something
  const geminiKey = val('settings-gemini-key');
  if (geminiKey) {
    settings.geminiApiKey = geminiKey;
  }

  try {
    const updated = await api.put('/api/settings', settings);
    state.settings = updated;
    if (geminiKey) state.settings.geminiApiKeySet = true;
    toast('Email order settings saved');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function regenerateWebhookToken() {
  modal.confirm('Generate Webhook Token', 'Generate a new webhook token? Any existing Apps Script configuration using the old token will stop working.', async () => {
    try {
      const result = await api.post('/api/settings/inbound-email-webhook-token');
      modal.close();
      // Show the token for the user to copy
      const tokenInput = document.getElementById('settings-webhook-token');
      if (tokenInput) tokenInput.value = result.token;
      const copyBtn = document.getElementById('btn-copy-webhook-token');
      if (copyBtn) copyBtn.style.display = 'inline-flex';
      state.settings.inboundEmailWebhookTokenSet = true;
      toast('Webhook token generated — copy it now');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

async function copyWebhookToken() {
  const input = document.getElementById('settings-webhook-token');
  if (!input || input.value.includes('••')) {
    // Token is masked — need to fetch it fresh
    try {
      const result = await api.post('/api/settings/inbound-email-webhook-token/reveal');
      input.value = result.token;
      navigator.clipboard.writeText(result.token).then(() => toast('Webhook token copied'));
    } catch (err) {
      toast(err.message, 'error');
    }
    return;
  }
  navigator.clipboard.writeText(input.value).then(() => toast('Webhook token copied')).catch(() => {
    input.select();
    toast('Press Ctrl+C to copy');
  });
}

function copyToClipboard(inputId, label) {
  const input = document.getElementById(inputId);
  if (!input) return;
  navigator.clipboard.writeText(input.value).then(() => toast((label || 'Value') + ' copied')).catch(() => {
    input.select();
    toast('Press Ctrl+C to copy');
  });
}

function openInboundEmailQueue() {
  if (typeof loadInboundEmails === 'function') {
    loadInboundEmails();
  } else {
    toast('Email queue module not loaded', 'error');
  }
}
