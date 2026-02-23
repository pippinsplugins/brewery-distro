'use strict';

// ── Inventory View ────────────────────────────────────────────────

const FORMATS = ['1/2 Keg', '1/4 Keg', '1/6 Keg', '12oz Can (case/24)', '16oz Can (case/24)', '22oz Bottle (case/12)', '750ml Bottle (case/12)', 'Other'];
const STYLES  = ['IPA', 'Double IPA', 'Pale Ale', 'Lager', 'Pilsner', 'Wheat', 'Hefeweizen', 'Stout', 'Porter', 'Sour', 'Saison', 'Amber', 'Brown Ale', 'Barleywine', 'Scottish', 'English Mild', 'Kölsch', 'Golden Ale', 'Other'];

function inventoryForm(item = {}) {
  const isEdit = !!item.ID;
  const unitsField = isEdit
    ? `<input class="form-control" id="f-units" value="${esc(item.Units || '0')}" readonly style="background:#f5f5f5;cursor:default;color:var(--text-muted)" title="Use the Adjust button to change stock levels" />`
    : `<input class="form-control" id="f-units" type="number" min="0" value="0" />`;
  return `
    <div class="form-row">
      <div class="form-group">
        <label>Name <span class="required">*</span></label>
        <input class="form-control" id="f-name" value="${esc(item.Name)}" placeholder="e.g. Cascade IPA" />
      </div>
      <div class="form-group">
        <label>Location <span class="required">*</span></label>
        <select class="form-control" id="f-location">
          ${LOCATIONS.map(l => `<option value="${l}" ${(item.Location || state.location) === l ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Style</label>
        <select class="form-control" id="f-style">
          <option value="">-- Select --</option>
          ${STYLES.map(s => `<option value="${s}" ${item.Style === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>ABV (%)</label>
        <input class="form-control" id="f-abv" type="number" step="0.1" min="0" max="20" value="${esc(item.ABV)}" placeholder="e.g. 6.5" />
      </div>
      <div class="form-group">
        <label>Format / Package</label>
        <select class="form-control" id="f-format">
          <option value="">-- Select --</option>
          ${FORMATS.map(f => `<option value="${f}" ${item.Format === f ? 'selected' : ''}>${f}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Units in Stock${isEdit ? ' <span class="text-muted text-sm">(adjust via Adjust button)</span>' : ' <span class="required">*</span>'}</label>
        ${unitsField}
      </div>
      <div class="form-group">
        <label>Price per Unit ($)</label>
        <input class="form-control" id="f-price" type="number" step="0.01" min="0" value="${esc(item.PricePerUnit)}" placeholder="0.00" />
      </div>
    </div>
    <div class="form-group">
      <label>Low-Stock Alert Threshold</label>
      <input class="form-control" id="f-threshold" type="number" min="0" value="${esc(item.LowStockThreshold || '5')}" />
    </div>
    <div class="form-group">
      <label>Notes</label>
      <textarea class="form-control" id="f-notes" rows="2">${esc(item.Notes)}</textarea>
    </div>`;
}

async function loadInventory() {
  _paginationReset('inventory');
  showLoading();
  const locParam = state.location ? `?location=${encodeURIComponent(state.location)}` : '';
  const items = await api.get(`/api/inventory${locParam}`);
  state.inventory = items;
  renderInventory();
}

let _invSort = { col: 'Name', dir: 'asc' };
let _invStockFilter = 'in-stock';

function sortInventory(col) {
  _paginationReset('inventory');
  if (_invSort.col === col) {
    _invSort.dir = _invSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    _invSort.col = col;
    _invSort.dir = 'asc';
  }
  renderInventory();
}

function renderInventory() {
  const items = state.inventory || [];
  const _focused = document.activeElement?.id;
  const search = (document.getElementById('inv-search') || {}).value || '';
  const stockFilter = _invStockFilter;

  let filtered = items;
  if (stockFilter === 'in-stock') filtered = filtered.filter(i => parseInt(i.Units || '0') > 0);
  else if (stockFilter === 'low') filtered = filtered.filter(i => { const u = parseInt(i.Units || '0'); return u > 0 && u <= parseInt(i.LowStockThreshold || '5'); });
  else if (stockFilter === 'out') filtered = filtered.filter(i => parseInt(i.Units || '0') <= 0);

  if (search) filtered = filtered.filter(i =>
    i.Name.toLowerCase().includes(search.toLowerCase()) || (i.Style || '').toLowerCase().includes(search.toLowerCase())
  );

  // Sort
  const { col, dir } = _invSort;
  filtered = [...filtered].sort((a, b) => {
    let av, bv;
    if (col === 'Name')       { av = (a.Name || '').toLowerCase();           bv = (b.Name || '').toLowerCase(); }
    else if (col === 'Style') { av = (a.Style || '').toLowerCase();          bv = (b.Style || '').toLowerCase(); }
    else if (col === 'ABV')   { av = parseFloat(a.ABV || 0);                 bv = parseFloat(b.ABV || 0); }
    else if (col === 'Format'){ av = (a.Format || '').toLowerCase();         bv = (b.Format || '').toLowerCase(); }
    else if (col === 'Units') { av = parseInt(a.Units || 0);                 bv = parseInt(b.Units || 0); }
    else if (col === 'Price') { av = parseFloat(a.PricePerUnit || 0);        bv = parseFloat(b.PricePerUnit || 0); }
    else if (col === 'Stock') { av = parseInt(a.Units||0) <= parseInt(a.LowStockThreshold||5) ? 0 : 1;
                                bv = parseInt(b.Units||0) <= parseInt(b.LowStockThreshold||5) ? 0 : 1; }
    if (av < bv) return dir === 'asc' ? -1 : 1;
    if (av > bv) return dir === 'asc' ? 1 : -1;
    return 0;
  });

  const pg = paginate(filtered, 'inventory');

  const th = (label, colKey) => {
    const active = _invSort.col === colKey;
    const arrow = active ? (_invSort.dir === 'asc' ? ' ▲' : ' ▼') : '';
    return `<th class="sortable-th${active ? ' sorted' : ''}" onclick="sortInventory('${colKey}')">${label}${arrow}</th>`;
  };

  setContent(`
    <div class="view-header">
      <div>
        <h2>Inventory</h2>
        <p class="subtitle">${items.length} product${items.length !== 1 ? 's' : ''} at ${esc(state.location)}</p>
      </div>
      <div class="view-header-actions">
        <button class="btn btn-primary" onclick="openAddInventory()">+ Add Product</button>
      </div>
    </div>
    <div class="filter-bar">
      <input type="search" id="inv-search" placeholder="Search products..." value="${esc(search)}" oninput="_paginationReset('inventory'); renderInventory()" />
      <select id="inv-stock" onchange="_invStockFilter=this.value; _paginationReset('inventory'); renderInventory()">
        <option value="in-stock"${stockFilter === 'in-stock' ? ' selected' : ''}>In-Stock Only</option>
        <option value="all"${stockFilter === 'all' ? ' selected' : ''}>All Products</option>
        <option value="low"${stockFilter === 'low' ? ' selected' : ''}>Low Stock</option>
        <option value="out"${stockFilter === 'out' ? ' selected' : ''}>Out of Stock</option>
      </select>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            ${th('Name', 'Name')}${th('Style', 'Style')}${th('ABV', 'ABV')}${th('Format', 'Format')}
            ${th('Units', 'Units')}${th('Price/Unit', 'Price')}${th('Stock', 'Stock')}<th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${pg.total === 0 ? `<tr><td colspan="8" class="empty-state">No products found. Add your first product!</td></tr>` :
            pg.rows.map(item => {
              const units = parseInt(item.Units || '0');
              const low = units <= parseInt(item.LowStockThreshold || '5');
              const out = units <= 0;
              return `<tr>
                <td class="fw-600"><span class="td-link" onclick="openEditInventory('${esc(item.ID)}')">${esc(item.Name)}</span></td>
                <td>${esc(item.Style)}</td>
                <td>${item.ABV ? esc(item.ABV) + '%' : '—'}</td>
                <td>${esc(item.Format) || '—'}</td>
                <td>${esc(item.Units)}</td>
                <td>${item.PricePerUnit ? '$' + esc(item.PricePerUnit) : '—'}</td>
                <td><span class="badge ${low ? 'badge-low-stock' : 'badge-ok-stock'}">${out ? 'Out' : low ? 'Low' : 'OK'}</span></td>
                <td class="td-actions">
                  <button class="btn btn-ghost btn-sm" onclick="openEditInventory('${esc(item.ID)}')">Edit</button>
                  <button class="btn btn-ghost btn-sm" onclick="openAdjustInventory('${esc(item.ID)}')">Adjust</button>
                  <button class="btn btn-ghost btn-sm" onclick="openInventoryHistory('${esc(item.ID)}')">History</button>
                  <button class="btn btn-ghost btn-sm text-danger" onclick="deleteInventory('${esc(item.ID)}', '${esc(item.Name)}')">Delete</button>
                </td>
              </tr>`;
            }).join('')}
        </tbody>
      </table>
    </div>
    ${pg.total > 0 ? paginationControls('inventory', pg, 'renderInventory') : ''}`);
  if (_focused === 'inv-search') refocusSearch('inv-search');
}

function openAddInventory() {
  modal.open('Add Product', inventoryForm(), async () => {
    const name = val('f-name');
    if (!name) { toast('Name is required', 'error'); return; }
    await api.post('/api/inventory', {
      Name: name, Location: val('f-location'), Style: val('f-style'), ABV: val('f-abv'),
      Format: val('f-format'), Units: val('f-units'),
      PricePerUnit: val('f-price'), LowStockThreshold: val('f-threshold'),
      Notes: val('f-notes'),
    });
    modal.close();
    toast('Product added');
    loadInventory();
  });
}

function openEditInventory(id) {
  const item = state.inventory.find(i => i.ID === id);
  if (!item) return;
  modal.open('Edit Product', inventoryForm(item), async () => {
    const name = val('f-name');
    if (!name) { toast('Name is required', 'error'); return; }
    await api.put(`/api/inventory/${id}`, {
      Name: name, Style: val('f-style'), ABV: val('f-abv'),
      Format: val('f-format'),
      PricePerUnit: val('f-price'), LowStockThreshold: val('f-threshold'),
      Notes: val('f-notes'),
    });
    modal.close();
    toast('Product updated');
    loadInventory();
  });
}

async function deleteInventory(id, name) {
  modal.confirm('Delete Product', `Delete "${name}"? This cannot be undone.`, async () => {
    await api.del(`/api/inventory/${id}`);
    modal.close();
    toast('Product deleted');
    loadInventory();
  });
}

function openAdjustInventory(id) {
  const item = state.inventory.find(i => i.ID === id);
  if (!item) return;
  const label = item.Format ? `${item.Name} — ${item.Format}` : item.Name;
  modal.open('Adjust Stock', `
    <p class="text-muted text-sm" style="margin-bottom:16px">
      <strong>${esc(label)}</strong> &mdash; current stock: <strong>${esc(item.Units)} units</strong>
    </p>
    <div class="form-group">
      <label>Movement Type <span class="required">*</span></label>
      <select class="form-control" id="f-adj-type">
        <option value="received">Received (add stock)</option>
        <option value="write-off">Write-off (remove stock)</option>
        <option value="adjustment">Adjustment (remove stock)</option>
      </select>
    </div>
    <div class="form-group">
      <label>Quantity <span class="required">*</span></label>
      <input class="form-control" id="f-adj-qty" type="number" min="1" placeholder="e.g. 10" />
    </div>
    <div class="form-group">
      <label>Date</label>
      <input class="form-control" id="f-adj-date" type="date" value="${today()}" />
    </div>
    <div class="form-group">
      <label>Notes</label>
      <textarea class="form-control" id="f-adj-notes" rows="2" placeholder="Reason for adjustment..."></textarea>
    </div>`, async () => {
    const type = val('f-adj-type');
    const qty  = parseInt(val('f-adj-qty'));
    if (!qty || qty <= 0) { toast('Enter a valid quantity', 'error'); return; }
    const result = await api.post('/api/stock-movements', {
      inventoryId: id,
      type,
      quantity: qty,
      notes: val('f-adj-notes'),
      date:  val('f-adj-date'),
    });
    modal.close();
    toast(`Stock adjusted — new total: ${result.newUnits} units`);
    loadInventory();
  });
}

async function openInventoryHistory(id) {
  const item = state.inventory.find(i => i.ID === id);
  if (!item) return;
  const movements = await api.get(`/api/stock-movements?inventoryId=${encodeURIComponent(id)}`);
  const typeLabel = { sale: 'Sale', received: 'Received', 'write-off': 'Write-off', adjustment: 'Adjustment' };
  const rows = movements.length === 0
    ? `<tr><td colspan="5" class="empty-state">No stock movements recorded yet.</td></tr>`
    : movements.map(m => {
        const qty = parseInt(m.Quantity || 0);
        const sign = qty >= 0 ? '+' : '';
        const cls  = qty >= 0 ? 'text-success' : 'text-danger';
        return `<tr>
          <td class="text-sm">${formatDate(m.Date)}</td>
          <td><span class="badge badge-type-other">${typeLabel[m.Type] || esc(m.Type)}</span></td>
          <td class="fw-600 ${cls}">${sign}${qty}</td>
          <td class="text-sm text-muted">${m.OrderID ? 'Order' : '—'}</td>
          <td class="text-sm note-cell">${truncateNote(m.Notes)}</td>
        </tr>`;
      }).join('');
  modal.open(`Stock History — ${esc(item.Name)}`, `
    <p class="text-muted text-sm" style="margin-bottom:16px">Current stock: <strong>${esc(item.Units)} units</strong></p>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Date</th><th>Type</th><th>Qty</th><th>Source</th><th>Notes</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`, () => { modal.close(); }, 'Close');
}

