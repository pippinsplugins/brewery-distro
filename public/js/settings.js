'use strict';

async function loadSettings() {
  showLoading();
  const settings = await api.get('/api/settings');
  state.settings = settings;
  renderSettings();
}

function renderSettings() {
  const s = state.settings;
  const companyName = s.companyName || '';
  const locations = Array.isArray(s.locations) ? s.locations : [...LOCATIONS];

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
    </div>`);
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
