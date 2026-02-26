'use strict';

const ORDER_STATUSES = ['Pending', 'Paid', 'Cancelled', 'Pre-Sale'];

function orderForm(order = {}, presetAccountId = '') {
  const selAcctId = order.AccountID || presetAccountId;
  return `
    <div class="form-row">
      <div class="form-group">
        <label>Account <span class="required">*</span></label>
        <select class="form-control" id="f-account" ${presetAccountId ? 'disabled' : ''}>
          <option value="">-- Select Account --</option>
          ${accountOptions(selAcctId)}
        </select>
        ${presetAccountId ? `<input type="hidden" id="f-account-hidden" value="${esc(presetAccountId)}" />` : ''}
      </div>
      <div class="form-group">
        <label>Location <span class="required">*</span></label>
        <select class="form-control" id="f-location" onchange="refreshOrderProducts()">
          ${LOCATIONS.map(l => `<option value="${l}" ${(order.Location || state.location) === l ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Sales Rep</label>
        <select class="form-control" id="f-staff">
          <option value="">-- Unassigned --</option>
          ${staffOptions(order.StaffID)}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Order Date <span class="required">*</span></label>
        <input class="form-control" id="f-order-date" type="date" value="${esc(dateOnly(order.OrderDate) || today())}" />
      </div>
      <div class="form-group">
        <label>Delivery Date</label>
        <input class="form-control" id="f-delivery-date" type="date" value="${esc(order.DeliveryDate)}" />
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Invoice Number</label>
        <input class="form-control" id="f-invoice" value="${esc(order.InvoiceNumber)}" placeholder="e.g. INV-2024-001" />
      </div>
      <div class="form-group">
        <label>Status</label>
        <select class="form-control" id="f-status">
          ${ORDER_STATUSES.map(s => `<option value="${s}" ${order.Status === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </div>
    </div>
    <hr class="form-divider" />
    <div class="form-section-title">Products</div>
    <div id="order-products-wrap">
      <p class="text-muted text-sm">Loading products...</p>
    </div>
    <hr class="form-divider" />
    <div class="form-row">
      <div class="form-group">
        <label>Order Amount ($) <span class="required">*</span></label>
        <input class="form-control" id="f-amount" type="number" step="0.01" min="0" value="${esc(order.OrderAmount || '')}" placeholder="0.00" />
      </div>
      <div class="form-group">
        <label>Tax Amount ($)</label>
        <input class="form-control" id="f-tax" type="number" step="0.01" min="0" value="${esc(order.TaxAmount || '')}" placeholder="0.00" />
      </div>
    </div>
    <div class="form-group">
      <label>Notes / Reference</label>
      <textarea class="form-control" id="f-notes" rows="2" placeholder="Order details, product breakdown, etc.">${esc(order.Notes)}</textarea>
    </div>`;
}

function preSaleForm(ps = {}, presetAccountId = '') {
  const selAcctId = ps.AccountID || presetAccountId;
  return `
    <div class="form-row">
      <div class="form-group">
        <label>Account <span class="required">*</span></label>
        <select class="form-control" id="f-account" ${presetAccountId ? 'disabled' : ''}>
          <option value="">-- Select Account --</option>
          ${accountOptions(selAcctId)}
        </select>
        ${presetAccountId ? `<input type="hidden" id="f-account-hidden" value="${esc(presetAccountId)}" />` : ''}
      </div>
      <div class="form-group">
        <label>Location <span class="required">*</span></label>
        <select class="form-control" id="f-location">
          ${LOCATIONS.map(l => `<option value="${l}" ${(ps.Location || state.location) === l ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Sales Rep</label>
        <select class="form-control" id="f-staff">
          <option value="">-- Unassigned --</option>
          ${staffOptions(ps.StaffID)}
        </select>
      </div>
      <div class="form-group">
        <label>Expected Date</label>
        <input class="form-control" id="f-expected-date" type="date" value="${esc(ps.DeliveryDate)}" />
      </div>
    </div>
    <div class="form-group">
      <label>Requested Products <span class="required">*</span></label>
      <textarea class="form-control" id="f-requested-products" rows="3" placeholder="List the products being requested, e.g.:\n2x Cascade IPA (1/6 keg)\n1x Porter (1/4 keg)">${esc(ps.RequestedProducts)}</textarea>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Estimated Amount ($)</label>
        <input class="form-control" id="f-amount" type="number" step="0.01" min="0" value="${esc(ps.OrderAmount || '')}" placeholder="0.00" />
      </div>
    </div>
    <div class="form-group">
      <label>Notes</label>
      <textarea class="form-control" id="f-notes" rows="2">${esc(ps.Notes)}</textarea>
    </div>`;
}

let _ordersCache = [];
let _ordersDatePreset = '';
let _ordersDateFrom = '';
let _ordersDateTo = '';
let _orderFormInventory = [];
let _ordersSort = { col: 'OrderDate', dir: 'desc' };
let _orderItemCounts = {}; // { orderId: count } for item count badges

function sortOrders(col) {
  _paginationReset('orders');
  if (_ordersSort.col === col) {
    _ordersSort.dir = _ordersSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    _ordersSort.col = col;
    _ordersSort.dir = col === 'OrderDate' ? 'desc' : 'asc';
  }
  renderOrders();
}

function formatProductsSummary(products) {
  if (!products) return '';
  const items = products.split(',').map(s => s.trim()).filter(Boolean);
  if (items.length === 0) return '';
  // Extract just product names: "2x Cascade IPA (1/6 Keg)" → "Cascade IPA"
  const names = items.map(p => {
    const stripped = p.replace(/^\d+x\s*/, '');
    const parenIdx = stripped.indexOf('(');
    return (parenIdx > 0 ? stripped.slice(0, parenIdx) : stripped).trim();
  });
  let summary;
  if (names.length <= 2) {
    summary = names.join(', ');
  } else {
    summary = `${names[0]}, ${names[1]} +${names.length - 2} more`;
  }
  return `<br><span class="text-muted text-sm" title="${esc(products)}" style="cursor:default">${esc(summary)}</span>`;
}

function parseRequestedProducts(productsStr, inventoryItems) {
  const quantities = {};
  if (!productsStr) return quantities;
  const parts = productsStr.split(',').map(s => s.trim()).filter(Boolean);
  for (const part of parts) {
    // Extract quantity prefix: "2x Cascade IPA (1/6 Keg)" → qty=2, rest="Cascade IPA (1/6 Keg)"
    const qtyMatch = part.match(/^(\d+)x\s+/);
    if (!qtyMatch) continue;
    const qty = parseInt(qtyMatch[1]);
    const rest = part.slice(qtyMatch[0].length).trim();
    // Match against inventory by reconstructing "Name (Format)" as collectOrderProducts does
    const item = inventoryItems.find(i => {
      const label = i.Format ? `${i.Name} (${i.Format})` : i.Name;
      return rest === label || rest === i.Name;
    });
    if (item) quantities[item.ID] = qty;
  }
  return quantities;
}

function productPickerHtml(items, quantities = {}, readOnly = false) {
  if (!items || items.length === 0) {
    return `<p class="text-muted text-sm">No products available for this location.</p>`;
  }
  const inStock = items.filter(i => parseInt(i.Units || '0') > 0);
  const outOfStock = items.filter(i => parseInt(i.Units || '0') <= 0);
  // Out-of-stock items that are already on this order should always be visible
  const oosWithQty = outOfStock.filter(i => quantities[i.ID] > 0);
  const oosHidden = outOfStock.filter(i => !quantities[i.ID]);

  const row = (item, hidden) => {
    const price = parseFloat(item.PricePerUnit || 0);
    const qty = quantities[item.ID] || 0;
    const qtyCell = readOnly
      ? `<td class="text-sm">${qty || '—'}</td>`
      : `<td><input class="form-control" type="number" min="0" value="${qty}"
           id="op-qty-${item.ID}" style="width:80px"
           onchange="recalcOrderAmount()" oninput="recalcOrderAmount()" /></td>`;
    return `<tr data-product-stock="${hidden ? 'out' : 'in'}"${hidden ? ' style="display:none"' : ''}>
      <td class="fw-600">${esc(item.Name)}</td>
      <td class="text-sm">${esc(item.Format) || '—'}</td>
      <td class="text-sm">${price ? '$' + price.toFixed(2) : '—'}</td>
      <td class="text-sm">${esc(item.Units)}</td>
      ${qtyCell}
    </tr>`;
  };

  return `
    <div class="table-wrap" style="margin-bottom:8px">
      <table>
        <thead><tr><th>Product</th><th>Format</th><th>Price</th><th>In Stock</th><th>Qty</th></tr></thead>
        <tbody>
          ${inStock.map(i => row(i, false)).join('')}
          ${oosWithQty.map(i => row(i, false)).join('')}
          ${oosHidden.map(i => row(i, true)).join('')}
        </tbody>
      </table>
    </div>
    ${!readOnly && oosHidden.length ? `<label style="cursor:pointer;font-size:0.85rem">
      <input type="checkbox" id="op-show-oos" style="margin-right:6px"
        onchange="document.querySelectorAll('#order-products-wrap tr[data-product-stock=out]').forEach(r=>r.style.display=this.checked?'':'none')" />
      Show out-of-stock products (${oosHidden.length})
    </label>` : ''}`;
}

async function refreshOrderProducts(existingProducts = '', readOnly = false) {
  const location = val('f-location');
  const locQuery = location ? `?location=${encodeURIComponent(location)}` : '';
  _orderFormInventory = await api.get(`/api/inventory${locQuery}`);
  const quantities = parseRequestedProducts(existingProducts, _orderFormInventory);
  const wrap = document.getElementById('order-products-wrap');
  if (wrap) wrap.innerHTML = productPickerHtml(_orderFormInventory, quantities, readOnly);
  // Only auto-recalc if not restoring existing quantities (preserve manually set amount)
  if (!existingProducts && !readOnly) recalcOrderAmount();
}

async function refreshOrderProductsFromItems(orderItems, readOnly = false) {
  const location = val('f-location');
  const locQuery = location ? `?location=${encodeURIComponent(location)}` : '';
  _orderFormInventory = await api.get(`/api/inventory${locQuery}`);
  // Build quantities directly from InventoryID (exact match, no text parsing)
  const quantities = {};
  for (const item of orderItems) {
    if (item.InventoryID) {
      quantities[item.InventoryID] = (parseInt(quantities[item.InventoryID]) || 0) + parseInt(item.Quantity || 0);
    }
  }
  const wrap = document.getElementById('order-products-wrap');
  if (wrap) wrap.innerHTML = productPickerHtml(_orderFormInventory, quantities, readOnly);
}

function recalcOrderAmount() {
  let total = 0;
  let hasProducts = false;
  for (const item of _orderFormInventory) {
    const qtyEl = document.getElementById(`op-qty-${item.ID}`);
    if (qtyEl) {
      const qty = parseInt(qtyEl.value) || 0;
      if (qty > 0) {
        hasProducts = true;
        total += qty * parseFloat(item.PricePerUnit || 0);
      }
    }
  }
  if (hasProducts) {
    const amountEl = document.getElementById('f-amount');
    if (amountEl) amountEl.value = total.toFixed(2);
  }
}

function collectOrderProducts() {
  const selected = [];
  for (const item of _orderFormInventory) {
    const qtyEl = document.getElementById(`op-qty-${item.ID}`);
    if (qtyEl) {
      const qty = parseInt(qtyEl.value) || 0;
      if (qty > 0) {
        const label = item.Format ? `${item.Name} (${item.Format})` : item.Name;
        selected.push(`${qty}x ${label}`);
      }
    }
  }
  return selected.join(', ');
}

function collectOrderItems() {
  const items = [];
  for (const item of _orderFormInventory) {
    const qtyEl = document.getElementById(`op-qty-${item.ID}`);
    if (qtyEl) {
      const qty = parseInt(qtyEl.value) || 0;
      if (qty > 0) {
        const price = parseFloat(item.PricePerUnit || 0);
        items.push({
          InventoryID: item.ID,
          ProductName: item.Name,
          Quantity: qty,
          UnitPrice: price.toFixed(2),
          LineTotal: (qty * price).toFixed(2),
        });
      }
    }
  }
  return items;
}

async function saveOrderItems(orderId) {
  const items = collectOrderItems();
  // Delete existing items for this order first
  await api.del(`/api/order-items?orderId=${encodeURIComponent(orderId)}`);
  // Create new items if any
  if (items.length > 0) {
    await api.post('/api/order-items/bulk', {
      items: items.map(i => ({ ...i, OrderID: orderId })),
    });
  }
}

async function loadOrders() {
  _paginationReset('orders');
  _ordersDatePreset = '';
  _ordersDateFrom = '';
  _ordersDateTo = '';
  showLoading();
  const locParam = state.location ? `?location=${encodeURIComponent(state.location)}` : '';
  const [orders, accounts, staff, itemCounts] = await Promise.all([
    api.get(`/api/orders${locParam}`),
    api.get('/api/accounts'),
    api.get('/api/staff'),
    api.get('/api/order-items/counts'),
  ]);
  state.accounts = accounts;
  state.staff = staff;
  _ordersCache = orders;
  _orderItemCounts = itemCounts || {};
  renderOrders();
}

function applyOrderDatePreset(preset) {
  _ordersDatePreset = preset;
  if (preset && preset !== 'custom') {
    const [from, to] = dateRange(preset);
    _ordersDateFrom = from;
    _ordersDateTo = to;
  } else if (preset === '') {
    _ordersDateFrom = '';
    _ordersDateTo = '';
  }
  _paginationReset('orders');
  renderOrders();
}

function renderOrders() {
  const orders = _ordersCache;
  const _focused = document.activeElement?.id;
  const accountFilter = (document.getElementById('orders-account') || {}).value || '';
  const staffFilter   = (document.getElementById('orders-staff') || {}).value || '';
  const statusFilter  = (document.getElementById('orders-status') || {}).value || '';
  const search        = (document.getElementById('orders-search') || {}).value || '';

  // Read date filter from DOM or fall back to state
  const datePreset = (document.getElementById('orders-date-preset') || {}).value || _ordersDatePreset;
  const dateFrom = (document.getElementById('orders-date-from') || {}).value || _ordersDateFrom;
  const dateTo = (document.getElementById('orders-date-to') || {}).value || _ordersDateTo;
  _ordersDatePreset = datePreset;
  _ordersDateFrom = dateFrom;
  _ordersDateTo = dateTo;

  let filtered = orders;
  if (accountFilter) filtered = filtered.filter(s => s.AccountID === accountFilter);
  if (staffFilter)   filtered = filtered.filter(s => s.StaffID === staffFilter);
  if (statusFilter)  filtered = filtered.filter(s => s.Status === statusFilter);
  if (dateFrom) filtered = filtered.filter(s => dateOnly(s.OrderDate || '') >= dateFrom);
  if (dateTo)   filtered = filtered.filter(s => dateOnly(s.OrderDate || '') <= dateTo);
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(s =>
      (s.AccountName || '').toLowerCase().includes(q) ||
      (s.InvoiceNumber || '').toLowerCase().includes(q) ||
      (s.Notes || '').toLowerCase().includes(q) ||
      (s.RequestedProducts || '').toLowerCase().includes(q)
    );
  }

  // Sort
  const { col: sortCol, dir: sortDir } = _ordersSort;
  filtered = [...filtered].sort((a, b) => {
    let av, bv;
    if (sortCol === 'OrderDate')   { av = a.OrderDate || '';             bv = b.OrderDate || ''; }
    else if (sortCol === 'Account'){ av = (a.AccountName||'').toLowerCase(); bv = (b.AccountName||'').toLowerCase(); }
    else if (sortCol === 'Amount') { av = parseFloat(a.OrderAmount||0);  bv = parseFloat(b.OrderAmount||0); }
    else if (sortCol === 'Total')  { av = parseFloat(a.OrderAmount||0)+parseFloat(a.TaxAmount||0); bv = parseFloat(b.OrderAmount||0)+parseFloat(b.TaxAmount||0); }
    else if (sortCol === 'Status') { av = (a.Status||'').toLowerCase();  bv = (b.Status||'').toLowerCase(); }
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const totalOrder = filtered.reduce((sum, s) => sum + parseFloat(s.OrderAmount || 0), 0);
  const totalTax   = filtered.reduce((sum, s) => sum + parseFloat(s.TaxAmount   || 0), 0);
  const pg = paginate(filtered, 'orders');

  const acctOpts = `<option value="">All Accounts</option>` +
    [...new Map(orders.map(s => [s.AccountID, s.AccountName])).entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([id, name]) => `<option value="${esc(id)}" ${accountFilter === id ? 'selected' : ''}>${esc(name)}</option>`)
      .join('');

  const staffOpts = `<option value="">All Reps</option>` +
    [...new Map(orders.filter(s => s.StaffID).map(s => [s.StaffID, s.StaffName])).entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([id, name]) => `<option value="${esc(id)}" ${staffFilter === id ? 'selected' : ''}>${esc(name)}</option>`)
      .join('');

  const ordTh = (label, colKey) => {
    const active = _ordersSort.col === colKey;
    const arrow = active ? (_ordersSort.dir === 'asc' ? ' ▲' : ' ▼') : '';
    return `<th class="sortable-th${active ? ' sorted' : ''}" onclick="sortOrders('${colKey}')">${label}${arrow}</th>`;
  };

  setContent(`
    <div class="view-header">
      <div>
        <h2>Orders</h2>
        <p class="subtitle">${orders.length} order${orders.length !== 1 ? 's' : ''} at ${esc(state.location)}</p>
      </div>
      <div class="view-header-actions">
        <button class="btn btn-secondary" onclick="openImportInvoices()">Import Invoices</button>
        <button class="btn btn-secondary" onclick="openAddPreSale()">+ Pre-Sale</button>
        <button class="btn btn-primary" onclick="openAddOrder()">+ Log Order</button>
      </div>
    </div>
    <div class="filter-bar">
      <input type="search" id="orders-search" placeholder="Search account, invoice…" value="${esc(search)}" oninput="_paginationReset('orders'); renderOrders()" />
      <select id="orders-account" onchange="_paginationReset('orders'); renderOrders()">${acctOpts}</select>
      <select id="orders-staff" onchange="_paginationReset('orders'); renderOrders()">${staffOpts}</select>
      <select id="orders-status" onchange="_paginationReset('orders'); renderOrders()">
        <option value="">All Statuses</option>
        ${ORDER_STATUSES.map(s => `<option value="${s}" ${statusFilter === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
      <select id="orders-date-preset" onchange="applyOrderDatePreset(this.value)">
        <option value="" ${datePreset === '' ? 'selected' : ''}>All Dates</option>
        <option value="today" ${datePreset === 'today' ? 'selected' : ''}>Today</option>
        <option value="yesterday" ${datePreset === 'yesterday' ? 'selected' : ''}>Yesterday</option>
        <option value="last7" ${datePreset === 'last7' ? 'selected' : ''}>Last 7 Days</option>
        <option value="last30" ${datePreset === 'last30' ? 'selected' : ''}>Last 30 Days</option>
        <option value="this-month" ${datePreset === 'this-month' ? 'selected' : ''}>This Month</option>
        <option value="last-month" ${datePreset === 'last-month' ? 'selected' : ''}>Last Month</option>
        <option value="this-year" ${datePreset === 'this-year' ? 'selected' : ''}>This Year</option>
        <option value="last-year" ${datePreset === 'last-year' ? 'selected' : ''}>Last Year</option>
        <option value="custom" ${datePreset === 'custom' ? 'selected' : ''}>Custom Range</option>
      </select>
    </div>
    ${datePreset === 'custom' ? `
    <div class="filter-bar">
      <label class="text-sm text-muted" style="white-space:nowrap">From</label>
      <input type="date" class="form-control" id="orders-date-from" value="${esc(dateFrom)}" onchange="_paginationReset('orders'); renderOrders()" />
      <label class="text-sm text-muted" style="white-space:nowrap">To</label>
      <input type="date" class="form-control" id="orders-date-to" value="${esc(dateTo)}" onchange="_paginationReset('orders'); renderOrders()" />
    </div>` : ''}
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            ${ordTh('Order Date','OrderDate')}${ordTh('Account','Account')}<th>Invoice #</th>
            ${ordTh('Order Amt','Amount')}<th>Tax</th>${ordTh('Total','Total')}${ordTh('Status','Status')}<th>Delivered</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${pg.total === 0 ? `<tr><td colspan="9" class="empty-state">No orders found.</td></tr>` :
            pg.rows.map(s => {
              const total = parseFloat(s.OrderAmount || 0) + parseFloat(s.TaxAmount || 0);
              const isPreSale = s.Status === 'Pre-Sale';
              return `<tr>
                <td>${formatDate(s.OrderDate)}</td>
                <td class="fw-600"><span class="td-link" onclick="loadAccountProfile('${esc(s.AccountID)}')">${esc(s.AccountName)}</span>${formatProductsSummary(s.RequestedProducts)}</td>
                <td class="text-sm">${esc(s.InvoiceNumber) || '—'}${_orderItemCounts[s.ID] ? ` <span class="badge badge-items" title="${_orderItemCounts[s.ID]} line item${_orderItemCounts[s.ID] > 1 ? 's' : ''}">${_orderItemCounts[s.ID]} items</span>` : ''}</td>
                <td>${isPreSale && !parseFloat(s.OrderAmount) ? '<span class="text-muted">—</span>' : fmtMoney(s.OrderAmount)}</td>
                <td>${s.TaxAmount && parseFloat(s.TaxAmount) > 0 ? fmtMoney(s.TaxAmount) : '—'}</td>
                <td class="fw-600">${isPreSale && !parseFloat(s.OrderAmount) ? '<span class="text-muted">—</span>' : fmtMoney(total)}</td>
                <td>${orderStatusBadge(s.Status)}</td>
                <td class="text-center">${isPreSale ? '—'
                  : s.Delivered === 'true'
                  ? `<input type="checkbox" checked disabled title="${s.DeliveryDate ? formatDate(s.DeliveryDate) : 'Delivered'}" />`
                  : `<input type="checkbox" onchange="toggleDelivered('${esc(s.ID)}')" />`}</td>
                <td class="td-actions">
                  ${isPreSale ? `<button class="btn btn-ghost btn-sm" onclick="openEditPreSale('${esc(s.ID)}')">Edit</button><button class="btn btn-ghost btn-sm text-success" onclick="convertPreSale('${esc(s.ID)}')">Convert</button><button class="btn btn-ghost btn-sm text-danger" onclick="cancelPreSale('${esc(s.ID)}')">Cancel</button>`
                  : `${s.Status === 'Pending' ? `<button class="btn btn-ghost btn-sm text-success" onclick="markOrderPaid('${esc(s.ID)}')">Paid</button>` : ''}
                  <button class="btn btn-ghost btn-sm" onclick="openEditOrder('${esc(s.ID)}')">Edit</button>
                  <button class="btn btn-ghost btn-sm text-danger" onclick="deleteOrder('${esc(s.ID)}')">Del</button>`}
                </td>
              </tr>`;
            }).join('')}
        </tbody>
        ${pg.total > 1 ? `
        <tfoot>
          <tr class="table-totals">
            <td colspan="3" class="text-muted text-sm">${pg.total} records</td>
            <td>${fmtMoney(totalOrder)}</td>
            <td>${fmtMoney(totalTax)}</td>
            <td class="fw-600">${fmtMoney(totalOrder + totalTax)}</td>
            <td colspan="3"></td>
          </tr>
        </tfoot>` : ''}
      </table>
    </div>
    ${pg.total > 0 ? paginationControls('orders', pg, 'renderOrders') : ''}`);
  if (_focused === 'orders-search') refocusSearch('orders-search');
}

async function openAddOrder(presetAccountId = '') {
  if (state.staff.length === 0) state.staff = await api.get('/api/staff');
  if (state.accounts.length === 0) state.accounts = await api.get('/api/accounts');
  modal.open('Log Order', orderForm({}, presetAccountId), async () => {
    const accountId = presetAccountId || val('f-account');
    if (!accountId) { toast('Please select an account', 'error'); return; }
    const orderDate = val('f-order-date');
    if (!orderDate) { toast('Order date is required', 'error'); return; }
    const accountName = (state.accounts.find(a => a.ID === accountId) || {}).Name || '';
    const staffId = val('f-staff');
    const staffName = staffId ? (state.staff.find(s => s.ID === staffId) || {}).Name || '' : '';
    const products = collectOrderProducts();
    const order = await api.post('/api/orders', {
      AccountID: accountId, AccountName: accountName,
      Location: val('f-location') || state.location,
      StaffID: staffId, StaffName: staffName,
      OrderDate: orderDate, DeliveryDate: val('f-delivery-date'),
      InvoiceNumber: val('f-invoice'), Status: val('f-status'),
      OrderAmount: val('f-amount'), TaxAmount: val('f-tax'),
      Notes: val('f-notes'),
      RequestedProducts: products,
    });
    await saveOrderItems(order.ID);
    modal.close();
    toast('Order logged');
    if (state.view === 'account-profile') loadAccountProfile(state.accountProfileId);
    else loadOrders();
  });
  await refreshOrderProducts();
}

async function openEditOrder(id) {
  const order = _ordersCache.find(s => s.ID === id);
  if (!order) return;
  const isPaid = order.Status === 'Paid';
  modal.open('Edit Order', orderForm(order), async () => {
    const staffId = val('f-staff');
    const staffName = staffId ? (state.staff.find(s => s.ID === staffId) || {}).Name || '' : '';
    const products = collectOrderProducts();
    await api.put(`/api/orders/${id}`, {
      Location: val('f-location') || state.location,
      StaffID: staffId, StaffName: staffName,
      OrderDate: val('f-order-date'), DeliveryDate: val('f-delivery-date'),
      InvoiceNumber: val('f-invoice'), Status: val('f-status'),
      OrderAmount: val('f-amount'), TaxAmount: val('f-tax'),
      Notes: val('f-notes'),
      RequestedProducts: products || order.RequestedProducts || '',
    });
    // Update order items (skip for paid orders — quantities are read-only)
    if (!isPaid) await saveOrderItems(id);
    modal.close();
    toast('Order updated');
    loadOrders();
  });
  // Prefer order items (with correct InventoryID) over text-matching RequestedProducts
  const orderItems = await api.get(`/api/order-items?orderId=${encodeURIComponent(id)}`);
  if (orderItems && orderItems.length > 0) {
    await refreshOrderProductsFromItems(orderItems, isPaid);
  } else {
    await refreshOrderProducts(order.RequestedProducts, isPaid);
  }
}

async function deleteOrder(id) {
  modal.confirm('Delete Order', 'Delete this order? This cannot be undone.', async () => {
    await api.del(`/api/order-items?orderId=${encodeURIComponent(id)}`);
    await api.del(`/api/orders/${id}`);
    modal.close();
    toast('Order deleted');
    loadOrders();
  });
}

async function openAddPreSale(presetAccountId = '') {
  if (state.staff.length === 0) state.staff = await api.get('/api/staff');
  if (state.accounts.length === 0) state.accounts = await api.get('/api/accounts');
  modal.open('Add Pre-Sale', preSaleForm({}, presetAccountId), async () => {
    const accountId = presetAccountId || val('f-account');
    if (!accountId) { toast('Please select an account', 'error'); return; }
    const requestedProducts = val('f-requested-products');
    if (!requestedProducts) { toast('Requested products are required', 'error'); return; }
    const accountName = (state.accounts.find(a => a.ID === accountId) || {}).Name || '';
    const staffId = val('f-staff');
    const staffName = staffId ? (state.staff.find(s => s.ID === staffId) || {}).Name || '' : '';
    await api.post('/api/orders', {
      AccountID: accountId, AccountName: accountName,
      Location: val('f-location') || state.location,
      StaffID: staffId, StaffName: staffName,
      OrderDate: today(), DeliveryDate: val('f-expected-date'),
      RequestedProducts: requestedProducts,
      OrderAmount: val('f-amount') || '0', TaxAmount: '0',
      Notes: val('f-notes'),
      Status: 'Pre-Sale',
    });
    modal.close();
    toast('Pre-sale created');
    if (state.view === 'account-profile') loadAccountProfile(state.accountProfileId);
    else loadOrders();
  });
}

async function openEditPreSale(id) {
  const ps = _ordersCache.find(s => s.ID === id);
  if (!ps) return;
  if (state.staff.length === 0) state.staff = await api.get('/api/staff');
  if (state.accounts.length === 0) state.accounts = await api.get('/api/accounts');
  modal.open('Edit Pre-Sale', preSaleForm(ps, ps.AccountID), async () => {
    const requestedProducts = val('f-requested-products');
    if (!requestedProducts) { toast('Requested products are required', 'error'); return; }
    const staffId = val('f-staff');
    const staffName = staffId ? (state.staff.find(s => s.ID === staffId) || {}).Name || '' : '';
    await api.put(`/api/orders/${id}`, {
      Location: val('f-location') || state.location,
      StaffID: staffId, StaffName: staffName,
      DeliveryDate: val('f-expected-date'),
      RequestedProducts: requestedProducts,
      OrderAmount: val('f-amount') || '0',
      Notes: val('f-notes'),
    });
    modal.close();
    toast('Pre-sale updated');
    if (state.view === 'account-profile') loadAccountProfile(state.accountProfileId);
    else loadOrders();
  });
}

async function convertPreSale(id) {
  const ps = _ordersCache.find(s => s.ID === id);
  if (!ps) return;
  if (state.staff.length === 0) state.staff = await api.get('/api/staff');
  if (state.accounts.length === 0) state.accounts = await api.get('/api/accounts');

  // Build notes that include requested products for reference
  const noteParts = [];
  if (ps.RequestedProducts) noteParts.push('Requested products: ' + ps.RequestedProducts);
  if (ps.Notes) noteParts.push(ps.Notes);
  const combinedNotes = noteParts.join('\n');

  const prefilledOrder = {
    AccountID: ps.AccountID,
    Location: ps.Location,
    StaffID: ps.StaffID,
    OrderDate: today(),
    DeliveryDate: ps.DeliveryDate || '',
    InvoiceNumber: '',
    Status: 'Pending',
    OrderAmount: ps.OrderAmount && parseFloat(ps.OrderAmount) > 0 ? ps.OrderAmount : '',
    TaxAmount: '',
    Notes: combinedNotes,
  };

  modal.open('Convert Pre-Sale to Order', orderForm(prefilledOrder, ps.AccountID), async () => {
    const orderDate = val('f-order-date');
    if (!orderDate) { toast('Order date is required', 'error'); return; }
    const amount = val('f-amount');
    if (!amount) { toast('Order amount is required', 'error'); return; }
    const staffId = val('f-staff');
    const staffName = staffId ? (state.staff.find(s => s.ID === staffId) || {}).Name || '' : '';
    const products = collectOrderProducts();
    await api.put(`/api/orders/${id}`, {
      Location: val('f-location') || state.location,
      StaffID: staffId, StaffName: staffName,
      OrderDate: orderDate, DeliveryDate: val('f-delivery-date'),
      InvoiceNumber: val('f-invoice'), Status: 'Pending',
      OrderAmount: amount, TaxAmount: val('f-tax'),
      Notes: val('f-notes'),
      RequestedProducts: products || ps.RequestedProducts || '',
    });
    await saveOrderItems(id);
    modal.close();
    toast('Pre-sale converted to order');
    if (state.view === 'account-profile') loadAccountProfile(state.accountProfileId);
    else loadOrders();
  });
  await refreshOrderProducts(ps.RequestedProducts);
}

async function cancelPreSale(id) {
  modal.confirm('Cancel Pre-Sale', 'Cancel this pre-sale? It will be marked as cancelled.', async () => {
    await api.put(`/api/orders/${id}`, { Status: 'Cancelled' });
    modal.close();
    toast('Pre-sale cancelled');
    if (state.view === 'account-profile') loadAccountProfile(state.accountProfileId);
    else loadOrders();
  });
}

async function markOrderPaid(id) {
  await api.put(`/api/orders/${id}`, { Status: 'Paid' });
  toast('Order marked as paid');
  loadOrders();
}

async function toggleDelivered(id) {
  const order = _ordersCache.find(s => s.ID === id);
  if (!order) return;
  await openDeliveryConfirmModal(id, order, loadOrders);
}

async function profileMarkOrderPaid(id) {
  await api.put(`/api/orders/${id}`, { Status: 'Paid' });
  toast('Order marked as paid');
  loadAccountProfile(state.accountProfileId);
}

async function profileToggleDelivered(id) {
  const orders = await api.get(`/api/orders?accountId=${encodeURIComponent(state.accountProfileId)}`);
  const order = orders.find(s => s.ID === id);
  if (!order) return;
  await openDeliveryConfirmModal(id, order, () => loadAccountProfile(state.accountProfileId));
}

async function profileEditPreSale(id) {
  const orders = await api.get(`/api/orders?accountId=${encodeURIComponent(state.accountProfileId)}`);
  _ordersCache = orders;
  await openEditPreSale(id);
}

async function profileConvertPreSale(id) {
  // Load orders into _ordersCache so convertPreSale can find it
  const orders = await api.get(`/api/orders?accountId=${encodeURIComponent(state.accountProfileId)}`);
  _ordersCache = orders;
  await convertPreSale(id);
}

async function profileCancelPreSale(id) {
  await cancelPreSale(id);
}

async function openDeliveryConfirmModal(orderId, order, onComplete) {
  const locQuery = order.Location ? `?location=${encodeURIComponent(order.Location)}` : '';
  const [items, kegRecords] = await Promise.all([
    api.get(`/api/inventory${locQuery}`),
    api.get(`/api/keg-tracking?accountId=${encodeURIComponent(order.AccountID)}`),
  ]);
  const acctName = order.AccountName || '';
  const invLabel = order.InvoiceNumber ? ` — Invoice #${esc(order.InvoiceNumber)}` : '';

  // Filter to outstanding kegs only
  const outstandingKegs = kegRecords.filter(k => {
    const qty = parseInt(k.Quantity) || 0;
    const returned = parseInt(k.ReturnedQuantity) || 0;
    return qty - returned > 0;
  });

  if (!items.length && !outstandingKegs.length) {
    modal.confirm('Confirm Delivery',
      `No inventory products are configured for ${order.Location || 'this location'}. Mark this order as delivered without recording stock movements?`,
      async () => {
        await api.put(`/api/orders/${orderId}`, { Delivered: 'true' });
        modal.close();
        toast('Order marked as delivered');
        onComplete();
      });
    return;
  }

  // Pre-fill delivery quantities from order's requested products
  const orderQuantities = parseRequestedProducts(order.RequestedProducts, items);

  const inStock = items.filter(i => parseInt(i.Units || '0') > 0);
  const outOfStock = items.filter(i => parseInt(i.Units || '0') <= 0);
  const delivRow = (item, hidden) => {
    const stock = parseInt(item.Units || '0');
    const prefill = Math.min(orderQuantities[item.ID] || 0, stock);
    return `<tr data-stock="${hidden ? 'out' : 'in'}"${hidden ? ' style="display:none"' : ''}>
            <td class="fw-600">${esc(item.Name)}</td>
            <td class="text-sm">${esc(item.Format) || '—'}</td>
            <td class="text-sm">${esc(item.Units)}</td>
            <td><input class="form-control" type="number" min="0" max="${stock}" value="${prefill}"
                 id="deliv-qty-${item.ID}" style="width:80px" /></td>
          </tr>`;
  };

  // Products section (only if inventory items exist)
  const productsSection = items.length ? `
    <div class="table-wrap" style="margin-bottom:16px">
      <table>
        <thead><tr><th>Product</th><th>Format</th><th>In Stock</th><th>Qty Delivered</th></tr></thead>
        <tbody>
          ${inStock.map(i => delivRow(i, false)).join('')}
          ${outOfStock.map(i => delivRow(i, true)).join('')}
        </tbody>
      </table>
    </div>
    ${outOfStock.length ? `<div class="form-group">
      <label style="cursor:pointer">
        <input type="checkbox" id="deliv-show-oos" style="margin-right:6px"
          onchange="document.querySelectorAll('#modal-overlay tr[data-stock=out]').forEach(r=>r.style.display=this.checked?'':'none')" />
        Show out-of-stock products (${outOfStock.length})
      </label>
    </div>` : ''}` : '';

  // Keg returns section (only if outstanding kegs exist)
  const totalOutstanding = outstandingKegs.reduce((sum, k) =>
    sum + Math.max(0, (parseInt(k.Quantity)||0) - (parseInt(k.ReturnedQuantity)||0)), 0);
  const kegSection = outstandingKegs.length ? `
    <hr class="form-divider" />
    <div class="form-section-title">Keg Returns</div>
    <p class="text-muted text-sm" style="margin-bottom:8px">
      <strong>${totalOutstanding}</strong> keg${totalOutstanding !== 1 ? 's' : ''} outstanding for this account. Enter any returns collected during this delivery.
    </p>
    <div class="table-wrap" style="margin-bottom:16px">
      <table>
        <thead><tr><th>Product</th><th>Format</th><th>Outstanding</th><th>Returned</th></tr></thead>
        <tbody>
          ${outstandingKegs.map(k => {
            const outstanding = Math.max(0, (parseInt(k.Quantity)||0) - (parseInt(k.ReturnedQuantity)||0));
            return `<tr>
              <td class="fw-600">${esc(k.ProductName)}</td>
              <td class="text-sm">${esc(k.Format) || '—'}</td>
              <td class="text-sm">${outstanding}</td>
              <td><input class="form-control" type="number" min="0" max="${outstanding}" value="0"
                   id="keg-ret-${k.ID}" style="width:80px" /></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>` : '';

  modal.open('Confirm Delivery', `
    <p class="text-muted text-sm" style="margin-bottom:16px">
      Confirming delivery for <strong>${esc(acctName)}</strong>${invLabel}.
      ${items.length ? 'Enter the quantity delivered for each product (leave at 0 to skip).' : ''}
    </p>
    ${productsSection}
    ${kegSection}
    <div class="form-group">
      <label>Delivery Notes</label>
      <textarea class="form-control" id="deliv-notes" rows="2" placeholder="Optional notes..."></textarea>
    </div>`, async () => {
    // Validate stock movements
    const delivItems = items
      .map(item => ({
        inventoryId: item.ID,
        name: item.Name,
        stock: parseInt(item.Units || '0'),
        quantity: parseInt(document.getElementById(`deliv-qty-${item.ID}`)?.value || '0'),
      }))
      .filter(i => i.quantity > 0);
    const overStock = delivItems.find(i => i.quantity > i.stock);
    if (overStock) { toast(`${overStock.name} only has ${overStock.stock} in stock`, 'error'); return; }

    // Validate keg returns
    const kegReturns = outstandingKegs
      .map(k => {
        const returnQty = parseInt(document.getElementById(`keg-ret-${k.ID}`)?.value || '0');
        const outstanding = Math.max(0, (parseInt(k.Quantity)||0) - (parseInt(k.ReturnedQuantity)||0));
        return { keg: k, returnQty, outstanding };
      })
      .filter(r => r.returnQty > 0);
    const overReturn = kegReturns.find(r => r.returnQty > r.outstanding);
    if (overReturn) { toast(`${overReturn.keg.ProductName} only has ${overReturn.outstanding} kegs outstanding`, 'error'); return; }

    const notes = (document.getElementById('deliv-notes')?.value || '').trim();

    // Process stock movements (also marks order as delivered)
    if (delivItems.length) {
      await api.post('/api/stock-movements/bulk', {
        orderId,
        items: delivItems,
        notes,
        date: today(),
      });
    } else {
      // No stock items selected — still mark order as delivered
      await api.put(`/api/orders/${orderId}`, { Delivered: 'true' });
    }

    // Process keg returns
    for (const r of kegReturns) {
      const newReturnedTotal = (parseInt(r.keg.ReturnedQuantity) || 0) + r.returnQty;
      const combinedNotes = [r.keg.Notes, notes].filter(Boolean).join(' | ');
      await api.put(`/api/keg-tracking/${r.keg.ID}`, {
        ReturnedQuantity: String(newReturnedTotal),
        ReturnedDate: today(),
        Notes: combinedNotes,
      });
    }

    modal.close();
    const parts = [];
    if (delivItems.length) parts.push('Delivery confirmed');
    if (kegReturns.length) {
      const totalReturned = kegReturns.reduce((sum, r) => sum + r.returnQty, 0);
      parts.push(`${totalReturned} keg${totalReturned !== 1 ? 's' : ''} returned`);
    }
    toast(parts.join(' · ') || 'Delivery confirmed');
    onComplete();
  }, 'Confirm Delivery');
}

// ── Invoice Import ──────────────────────────────────────────────────

let _importParsedInvoices = [];

function openImportInvoices() {
  _importParsedInvoices = [];
  const body = `
    <div id="import-upload-step">
      <p class="text-muted text-sm" style="margin-bottom:12px">
        Upload one or more PDF invoices to extract order data. You'll be able to review and edit before creating orders.
      </p>
      <div class="form-group">
        <label>PDF Invoices</label>
        <input class="form-control" type="file" id="import-files" accept=".pdf,application/pdf" multiple />
      </div>
      <p class="text-muted text-sm">Accepted: PDF files up to 10MB each, max 50 files.</p>
    </div>`;
  modal.open('Import Invoices', body, processImportFiles, 'Upload & Parse');
  // Widen modal for import
  const modalEl = document.getElementById('modal-box');
  if (modalEl) modalEl.classList.add('modal-wide');
}

async function processImportFiles() {
  const fileInput = document.getElementById('import-files');
  if (!fileInput || !fileInput.files.length) {
    toast('Please select at least one PDF file', 'error');
    return;
  }

  const formData = new FormData();
  for (const file of fileInput.files) {
    formData.append('invoices', file);
  }

  // Show loading state
  document.getElementById('modal-body').innerHTML = `
    <div class="loading-state" style="padding:40px 20px">
      <div class="spinner"></div>
      <p>Parsing ${fileInput.files.length} invoice${fileInput.files.length > 1 ? 's' : ''}...</p>
    </div>`;

  try {
    const res = await fetch('/api/orders/import', { method: 'POST', body: formData });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Upload failed');
    }
    _importParsedInvoices = await res.json();
    renderImportPreview();
  } catch (err) {
    toast('Import error: ' + err.message, 'error');
    modal.close();
  }
}

function renderImportPreview() {
  if (!_importParsedInvoices.length) {
    modal.close();
    return;
  }

  // Make sure accounts are loaded for the dropdown
  const acctOptions = state.accounts
    .filter(a => a.Status !== 'Inactive')
    .sort((a, b) => a.Name.localeCompare(b.Name))
    .map(a => `<option value="${esc(a.ID)}">${esc(a.Name)}</option>`)
    .join('');

  let html = `
    <p class="text-muted text-sm" style="margin-bottom:12px">
      Review the extracted data below. Edit any fields as needed, then click "Create Orders" to import.
    </p>`;

  _importParsedInvoices.forEach((inv, idx) => {
    const p = inv.parsed;
    const dupBadge = inv.duplicate ? ' <span class="badge badge-import-duplicate">Duplicate</span>' : '';
    const confBadge = inv.confidence === 'high' ? '<span class="badge badge-paid">High</span>'
      : inv.confidence === 'medium' ? '<span class="badge badge-pending">Medium</span>'
      : inv.confidence === 'error' ? '<span class="badge badge-high">Error</span>'
      : '<span class="badge badge-inactive">Low</span>';
    const errMsg = inv.error ? `<p class="text-danger text-sm">${esc(inv.error)}</p>` : '';

    // Build account select with best match pre-selected + "create new" option
    const showCreateNew = p.accountMatch === 'none' || p.accountMatch === 'fuzzy';
    let acctSelect = `<select class="form-control form-control-sm" id="imp-acct-${idx}" onchange="toggleNewAccountField(${idx})">
      <option value="">-- Select Account --</option>
      <option value="__new__">+ Create New Account</option>
      ${acctOptions}
    </select>
    <div id="imp-new-acct-wrap-${idx}" style="margin-top:6px;display:none">
      <input class="form-control form-control-sm" id="imp-new-acct-name-${idx}" placeholder="New account name" value="${esc(p.accountMatch === 'none' && p.accountName ? p.accountName : '')}" />
    </div>`;

    // Match indicator
    const matchLabel = p.accountMatch === 'exact' ? '<span class="match-exact">exact match</span>'
      : p.accountMatch === 'fuzzy' ? '<span class="match-fuzzy">fuzzy match</span>'
      : p.accountName ? '<span class="match-none">no match</span>' : '';
    const acctHint = p.accountName && p.accountMatch !== 'exact'
      ? `<span class="text-muted text-sm">Extracted: "${esc(p.accountName)}" ${matchLabel}</span>` : matchLabel;

    // Line items table
    let lineItemsHtml = '';
    if (p.lineItems && p.lineItems.length > 0) {
      lineItemsHtml = `
        <div class="import-line-items">
          <div class="table-wrap" style="margin-top:8px">
            <table>
              <thead><tr><th>Product</th><th>Format</th><th>Match</th><th>Qty</th><th>Unit Price</th><th>Total</th>${p.lineItems.some(li => li.inventoryMatch === 'none') ? '<th>Create</th>' : ''}</tr></thead>
              <tbody>
                ${p.lineItems.map((li, liIdx) => {
                  const matchBadge = li.inventoryMatch === 'exact' ? '<span class="match-exact">exact</span>'
                    : li.inventoryMatch === 'fuzzy' ? '<span class="match-fuzzy">fuzzy</span>'
                    : '<span class="match-none">none</span>';
                  const createCheck = li.inventoryMatch === 'none'
                    ? `<td><label class="checkbox-label"><input type="checkbox" id="imp-create-${idx}-${liIdx}" checked /> New</label></td>` : '';
                  return `<tr>
                    <td><input class="form-control form-control-sm" id="imp-li-name-${idx}-${liIdx}" value="${esc(li.productName)}" /></td>
                    <td class="text-sm">${esc(li.format) || '—'}</td>
                    <td class="text-sm">${matchBadge}</td>
                    <td><input class="form-control form-control-sm" id="imp-li-qty-${idx}-${liIdx}" type="number" min="0" step="1" value="${esc(li.quantity)}" style="width:70px" /></td>
                    <td><input class="form-control form-control-sm" id="imp-li-price-${idx}-${liIdx}" type="number" min="0" step="0.01" value="${esc(li.unitPrice)}" style="width:90px" /></td>
                    <td><input class="form-control form-control-sm" id="imp-li-total-${idx}-${liIdx}" type="number" min="0" step="0.01" value="${esc(li.lineTotal)}" style="width:90px" /></td>
                    ${p.lineItems.some(l => l.inventoryMatch === 'none') ? (li.inventoryMatch === 'none' ? createCheck : '<td></td>') : ''}
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>`;
    }

    html += `
      <div class="import-invoice-section${inv.duplicate ? ' import-row-duplicate' : ''}" id="imp-section-${idx}">
        <div class="import-invoice-header">
          <label class="checkbox-label">
            <input type="checkbox" id="imp-include-${idx}" checked />
            <strong>${esc(inv.filename)}</strong>
          </label>
          <span class="text-sm">Confidence: ${confBadge}${dupBadge}</span>
        </div>
        ${errMsg}
        <div class="import-invoice-fields">
          <div class="form-row">
            <div class="form-group">
              <label>Account</label>
              ${acctSelect}
              ${acctHint ? `<div style="margin-top:3px">${acctHint}</div>` : ''}
            </div>
            <div class="form-group">
              <label>Contact Name</label>
              <input class="form-control form-control-sm" id="imp-contact-${idx}" value="${esc(p.contactName)}" placeholder="Contact person" />
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Invoice #</label>
              <input class="form-control form-control-sm" id="imp-inv-${idx}" value="${esc(p.invoiceNumber)}" />
            </div>
            <div class="form-group">
              <label>ABC License #</label>
              <input class="form-control form-control-sm" id="imp-abc-${idx}" value="${esc(p.abcLicense)}" placeholder="e.g. 18833" />
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Order Date</label>
              <input class="form-control form-control-sm" id="imp-date-${idx}" type="date" value="${esc(p.orderDate)}" />
            </div>
            <div class="form-group">
              <label>Status</label>
              <select class="form-control form-control-sm" id="imp-status-${idx}">
                ${ORDER_STATUSES.map(s => `<option value="${s}" ${s === 'Paid' ? 'selected' : ''}>${s}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Order Amount ($)</label>
              <input class="form-control form-control-sm" id="imp-amount-${idx}" type="number" step="0.01" min="0" value="${esc(p.orderAmount)}" />
            </div>
            <div class="form-group">
              <label>Tax Amount ($)</label>
              <input class="form-control form-control-sm" id="imp-tax-${idx}" type="number" step="0.01" min="0" value="${esc(p.taxAmount)}" />
            </div>
          </div>
          ${lineItemsHtml}
        </div>
      </div>`;
  });

  document.getElementById('modal-body').innerHTML = html;
  document.getElementById('modal-submit-btn').textContent = 'Create Orders';

  // Set pre-selected account values after DOM is rendered
  _importParsedInvoices.forEach((inv, idx) => {
    const sel = document.getElementById(`imp-acct-${idx}`);
    if (!sel) return;
    if (inv.parsed.accountId) {
      sel.value = inv.parsed.accountId;
    } else if (inv.parsed.accountMatch === 'none' && inv.parsed.accountName) {
      // No match found — default to "Create New Account"
      sel.value = '__new__';
      toggleNewAccountField(idx);
    }
  });

  // Swap the submit handler
  modal._onSubmit = confirmImport;
}

function toggleNewAccountField(idx) {
  const sel = document.getElementById(`imp-acct-${idx}`);
  const wrap = document.getElementById(`imp-new-acct-wrap-${idx}`);
  if (!sel || !wrap) return;
  wrap.style.display = sel.value === '__new__' ? 'block' : 'none';
}

async function confirmImport() {
  const orderDefs = [];

  for (let idx = 0; idx < _importParsedInvoices.length; idx++) {
    const includeEl = document.getElementById(`imp-include-${idx}`);
    if (includeEl && !includeEl.checked) continue;

    const inv = _importParsedInvoices[idx];
    const p = inv.parsed;
    const acctVal = val(`imp-acct-${idx}`);
    const isNewAccount = acctVal === '__new__';
    const accountId = isNewAccount ? '' : acctVal;
    const newAccountName = isNewAccount ? val(`imp-new-acct-name-${idx}`) : '';
    const accountName = isNewAccount
      ? newAccountName
      : (accountId ? (state.accounts.find(a => a.ID === accountId) || {}).Name || '' : '');

    const lineItems = [];
    const newProducts = [];
    if (p.lineItems) {
      p.lineItems.forEach((li, liIdx) => {
        const productName = val(`imp-li-name-${idx}-${liIdx}`) || li.productName;
        const quantity = val(`imp-li-qty-${idx}-${liIdx}`) || li.quantity;
        const unitPrice = val(`imp-li-price-${idx}-${liIdx}`) || li.unitPrice;
        const lineTotal = val(`imp-li-total-${idx}-${liIdx}`) || li.lineTotal;
        lineItems.push({
          productName,
          format: li.format || '',
          quantity,
          unitPrice,
          lineTotal,
          inventoryId: li.inventoryId || '',
          inventoryMatch: li.inventoryMatch,
        });
        // Check if user wants to create this as new inventory
        const createEl = document.getElementById(`imp-create-${idx}-${liIdx}`);
        if (createEl && createEl.checked && li.inventoryMatch === 'none') {
          newProducts.push({ productName, unitPrice, format: li.format || '' });
        }
      });
    }

    orderDefs.push({
      filename: inv.filename,
      AccountID: accountId,
      AccountName: accountName,
      newAccountName: newAccountName || '',
      contactName: val(`imp-contact-${idx}`) || '',
      abcLicense: val(`imp-abc-${idx}`) || '',
      Location: state.location || '',
      OrderDate: val(`imp-date-${idx}`) || p.orderDate || today(),
      InvoiceNumber: val(`imp-inv-${idx}`) || '',
      OrderAmount: val(`imp-amount-${idx}`) || '0',
      TaxAmount: val(`imp-tax-${idx}`) || '0',
      Status: val(`imp-status-${idx}`) || 'Paid',
      Notes: 'Imported from invoice',
      lineItems,
      newProducts,
    });
  }

  if (orderDefs.length === 0) {
    toast('No invoices selected for import', 'error');
    return;
  }

  // Show loading
  document.getElementById('modal-body').innerHTML = `
    <div class="loading-state" style="padding:40px 20px">
      <div class="spinner"></div>
      <p>Creating ${orderDefs.length} order${orderDefs.length > 1 ? 's' : ''}...</p>
    </div>`;

  try {
    const result = await api.post('/api/orders/import/confirm', { orders: orderDefs });
    modal.close();
    // Remove modal-wide class
    const modalEl = document.getElementById('modal-box');
    if (modalEl) modalEl.classList.remove('modal-wide');

    const msgs = [];
    if (result.created.length) msgs.push(`${result.created.length} order${result.created.length > 1 ? 's' : ''} created`);
    if (result.newAccountsCreated) msgs.push(`${result.newAccountsCreated} new account${result.newAccountsCreated > 1 ? 's' : ''} created`);
    if (result.newProductsCreated) msgs.push(`${result.newProductsCreated} new product${result.newProductsCreated > 1 ? 's' : ''} added to inventory`);
    if (result.errors.length) msgs.push(`${result.errors.length} error${result.errors.length > 1 ? 's' : ''}`);
    toast(msgs.join(' · ') || 'Import complete');
    if (result.errors.length) {
      console.warn('Import errors:', result.errors);
    }
    loadOrders();
  } catch (err) {
    toast('Import error: ' + err.message, 'error');
    modal.close();
    const modalEl = document.getElementById('modal-box');
    if (modalEl) modalEl.classList.remove('modal-wide');
  }
}
