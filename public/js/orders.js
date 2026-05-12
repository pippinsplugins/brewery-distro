'use strict';

const ORDER_STATUSES = ['Draft', 'Pending', 'Paid', 'Cancelled', 'Pre-Sale'];

let _qboAppUrl = '';
let _orderCreditBalance = 0;
let _orderCreditApplied = 0;
(async () => {
  try {
    const s = await api.get('/api/qbo/status');
    if (s.appUrl) _qboAppUrl = s.appUrl;
  } catch { /* ignore — QBO not configured */ }
})();

function qboInvoiceUrl(order) {
  if (!_qboAppUrl || !order.QboInvoiceId) return '';
  return `${_qboAppUrl}/app/invoice?txnId=${encodeURIComponent(order.QboInvoiceId)}`;
}

function qboSyncBadge(order) {
  if (!_qboAppUrl) return '';
  switch (order.QboSyncStatus) {
    case 'synced':
      return ' <span class="badge badge-success" title="Synced to QuickBooks">QBO Synced</span>';
    case 'failed':
      return ` <span class="badge badge-danger" style="cursor:pointer" title="${esc(order.QboSyncError || 'QBO sync failed')} — click to retry" onclick="event.stopPropagation(); retryQboSync('${esc(order.ID)}')">QBO Failed</span>`;
    case 'disabled':
      return ' <span class="badge badge-neutral" title="QuickBooks not connected">QBO Off</span>';
    case 'skipped':
      return ' <span class="badge badge-neutral" title="QBO sync disabled for this order">QBO Disabled</span>';
    default:
      // No badge for pre-integration orders that are already paid/delivered
      if (!order.QboSyncStatus && order.Status === 'Paid' && order.Delivered === 'true') return '';
      return ' <span class="badge badge-neutral" title="Not synced to QuickBooks">QBO Pending</span>';
  }
}

async function retryQboSync(orderId) {
  try {
    toast('Retrying QuickBooks sync...');
    const updated = await api.post(`/api/qbo/sync/${orderId}`);
    if (updated.QboSyncStatus === 'synced') {
      toast('Synced to QuickBooks');
    } else {
      toast('QBO sync failed: ' + (updated.QboSyncError || updated.error || 'unknown error — check Settings'), 'error');
    }
    await loadOrders(true);
  } catch (err) {
    toast('QBO sync error: ' + err.message, 'error');
  }
}

async function promptQboSync(orderId, reloadFn) {
  // Check if QBO is connected before prompting
  try {
    const s = await api.get('/api/qbo/status');
    if (s.appUrl) _qboAppUrl = s.appUrl;
    if (!s.connected) {
      api.put(`/api/orders/${orderId}`, { QboSyncStatus: 'disabled' }).catch(() => {});
      reloadFn();
      return;
    }
  } catch {
    reloadFn();
    return;
  }
  // Show prompt with inline buttons (no standard modal submit/cancel)
  modal.open('Create QuickBooks Invoice?', `
    <p style="margin-bottom:16px">Would you like to create an invoice in QuickBooks for this order?</p>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn btn-ghost" id="qbo-prompt-skip">Skip</button>
      <button class="btn btn-primary" id="qbo-prompt-create">Create Invoice</button>
    </div>
  `, null, 'Save');
  // Hide the standard modal footer buttons
  document.getElementById('modal-submit-btn').style.display = 'none';
  document.getElementById('modal-cancel-btn').style.display = 'none';

  document.getElementById('qbo-prompt-create').onclick = async () => {
    modal.close();
    toast('Creating QuickBooks invoice...');
    let syncedOrder;
    try {
      syncedOrder = await api.post(`/api/qbo/sync/${orderId}`);
      if (syncedOrder.QboSyncStatus === 'synced') {
        toast('Invoice created in QuickBooks');
      } else {
        toast('QBO sync failed: ' + (syncedOrder.QboSyncError || syncedOrder.error || 'unknown error — check Settings'), 'error');
      }
    } catch (err) {
      toast('QBO sync error: ' + err.message, 'error');
    }
    await reloadFn();
    // Refresh cache and reopen the order so the user sees the QBO result
    if (state.view === 'account-profile') {
      _ordersCache = await api.get(`/api/orders?accountId=${encodeURIComponent(state.accountProfileId)}`);
    }
    // Patch cached order with sync response to ensure InvoiceNumber is current
    if (syncedOrder && syncedOrder.ID) {
      const idx = _ordersCache.findIndex(o => o.ID === syncedOrder.ID);
      if (idx >= 0) _ordersCache[idx] = { ..._ordersCache[idx], ...syncedOrder };
    }
    openEditOrder(orderId);
  };
  document.getElementById('qbo-prompt-skip').onclick = async () => {
    modal.close();
    await api.put(`/api/orders/${orderId}`, { QboSyncStatus: 'skipped' }).catch(() => {});
    toast('QuickBooks sync skipped');
    await reloadFn();
    if (state.view === 'account-profile') {
      _ordersCache = await api.get(`/api/orders?accountId=${encodeURIComponent(state.accountProfileId)}`);
    }
    openEditOrder(orderId);
  };
}

function orderForm(order = {}, presetAccountId = '', readOnly = false) {
  const selAcctId = order.AccountID || presetAccountId;
  const dis = readOnly ? ' disabled' : '';
  return `
    <div class="form-row">
      <div class="form-group">
        <label>Account <span class="required">*</span></label>
        <select class="form-control" id="f-account" ${presetAccountId || readOnly ? 'disabled' : ''} onchange="initOrderDepositCheckbox(); initOrderTaxCheckbox(); refreshLineItemDeliversTo()">
          <option value="">-- Select Account --</option>
          ${accountOptions(selAcctId, order.Location || state.location)}
        </select>
        ${presetAccountId ? `<input type="hidden" id="f-account-hidden" value="${esc(presetAccountId)}" />` : ''}
      </div>
      <div class="form-group">
        <label>Location <span class="required">*</span></label>
        <select class="form-control" id="f-location"${dis}${readOnly ? '' : ' onchange="refreshOrderAccounts(); refreshOrderProducts()"'}>
          ${LOCATIONS.map(l => `<option value="${l}" ${(order.Location || state.location) === l ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Sales Rep</label>
        <select class="form-control" id="f-staff"${dis}>
          <option value="">-- Unassigned --</option>
          ${staffOptions(order.StaffID)}
        </select>
      </div>
      <div class="form-group">
        <label>Status</label>
        <select class="form-control" id="f-status"${dis} ${readOnly ? '' : 'onchange="togglePaymentFields()"'}>
          ${ORDER_STATUSES.map(s => `<option value="${s}" ${order.Status === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </div>
    </div>
    <div id="payment-fields" style="display:${order.Status === 'Paid' || (readOnly && order.PaymentMethod) ? '' : 'none'}">
      <div class="form-row">
        <div class="form-group">
          <label>Payment Method${readOnly ? '' : ' <span class="required">*</span>'}</label>
          <select class="form-control" id="f-payment-method"${dis}>
            <option value="">-- Select Method --</option>
            ${PAYMENT_METHODS.map(m => `<option value="${m}" ${order.PaymentMethod === m ? 'selected' : ''}>${m}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Reference / Check #</label>
          <input class="form-control" id="f-payment-ref" value="${esc(order.PaymentReference || '')}" placeholder="e.g. Check #1234"${dis} />
        </div>
        <div class="form-group">
          <label>Payment Date</label>
          <input class="form-control" id="f-payment-date" type="date" value="${esc(order.PaymentDate || today())}"${dis} />
        </div>
      </div>
      ${order.QboPaymentId ? '<div style="margin-top:4px"><span class="badge badge-success" title="Payment synced to QuickBooks">QBO Payment Synced</span></div>' : ''}
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Order Date <span class="required">*</span></label>
        <input class="form-control" id="f-order-date" type="date" value="${esc(dateOnly(order.OrderDate) || today())}"${dis} />
      </div>
      <div class="form-group">
        <label>Delivery Date</label>
        <input class="form-control" id="f-delivery-date" type="date" value="${esc(order.DeliveryDate)}"${dis} />
      </div>
    </div>
    <div class="form-group">
      <label>Invoice Number</label>
      <input class="form-control" id="f-invoice" value="${esc(order.InvoiceNumber)}" placeholder="e.g. INV-2024-001"${dis} />
    </div>
    <hr class="form-divider" />
    <div class="form-section-title">Products</div>
    <div id="order-products-wrap">
      <p class="text-muted text-sm">Loading products...</p>
    </div>
    ${readOnly ? '' : `<div class="form-row" style="margin-top:12px">
      <div class="form-group">
        <label class="checkbox-label">
          <input type="checkbox" id="f-charge-tax" onchange="toggleOrderTax()" ${order.TaxAmount && parseFloat(order.TaxAmount) > 0 ? 'checked' : ''} />
          Charge tax for this order
        </label>
      </div>
      <div class="form-group" id="deposit-checkbox-group" style="display:none">
        <label class="checkbox-label">
          <input type="checkbox" id="f-charge-deposits" onchange="toggleOrderDeposits()" ${order.DepositAmount && parseFloat(order.DepositAmount) > 0 ? 'checked' : ''} />
          Charge keg deposits for this order
        </label>
      </div>
    </div>`}
    <hr class="form-divider" />
    <div class="form-row-3">
      <div class="form-group">
        <label>Order Amount ($) <span class="required">*</span></label>
        <input class="form-control" id="f-amount" type="number" step="0.01" min="0" value="${esc(order.OrderAmount || '')}" placeholder="0.00"${dis} oninput="recalcTaxFromAmount()" />
      </div>
      <div class="form-group">
        <label>Tax Amount ($)</label>
        <input class="form-control" id="f-tax" type="number" step="0.01" min="0" value="${esc(order.TaxAmount || '')}" placeholder="0.00"${dis} oninput="recalcOrderTotal()" />
      </div>
      <div class="form-group" id="deposit-amount-group" style="display:${order.DepositAmount && parseFloat(order.DepositAmount) > 0 ? 'block' : 'none'}">
        <label>Keg Deposits ($)</label>
        <input class="form-control" id="f-deposit-amount" type="number" step="0.01" min="0" value="${esc(order.DepositAmount || '')}" placeholder="0.00" readonly${dis} />
      </div>
    </div>
    ${readOnly ? '' : `<div id="order-credit-section" style="display:none">
      <hr class="form-divider" />
      <div class="form-section-title">Account Credit</div>
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <span id="order-credit-info" class="text-sm"></span>
        <label class="text-sm" style="margin:0;white-space:nowrap">Apply ($)</label>
        <input class="form-control" type="number" step="0.01" min="0" id="f-credit-apply" value="0" oninput="updateCreditApplication()" style="width:90px" />
        <button type="button" class="btn btn-ghost btn-sm" onclick="applyMaxCredit()">Apply Max</button>
      </div>
      <div id="order-credit-summary" class="text-sm" style="color:#2e7d32"></div>
    </div>`}
    <div id="order-total-summary" class="order-total-summary" style="display:none"></div>
    <div class="form-group" style="margin-top:14px">
      <label>Notes / Reference</label>
      <textarea class="form-control" id="f-notes" rows="2" placeholder="Order details, product breakdown, etc."${dis}>${esc(order.Notes)}</textarea>
    </div>
    ${_qboAppUrl && order.ID && !(!order.QboSyncStatus && order.Status === 'Paid' && order.Delivered === 'true') ? `
    <hr class="form-divider" />
    <div class="form-section-title">QuickBooks</div>
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      ${order.QboSyncStatus === 'synced' ? `<span class="badge badge-success">Synced</span>${qboInvoiceUrl(order) ? `<a href="${qboInvoiceUrl(order)}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm">View in QuickBooks</a>` : `<span class="text-sm text-muted">Invoice ID: ${esc(order.QboInvoiceId)}</span>`}${order.InvoicePdf ? `<a href="/api/qbo/invoice-pdf/${esc(order.ID)}" target="_blank" class="btn btn-ghost btn-sm">Download Invoice</a>` : ''}` : ''}
      ${order.QboSyncStatus === 'failed' ? `<span class="badge badge-danger">Sync Failed</span>${order.QboSyncError ? `<span class="text-sm text-danger">${esc(order.QboSyncError)}</span>` : ''}<button class="btn btn-ghost btn-sm" onclick="retryQboSync('${esc(order.ID)}')">Retry</button>` : ''}
      ${order.QboSyncStatus === 'disabled' ? '<span class="badge badge-neutral">Not Connected</span>' : ''}
      ${order.QboSyncStatus === 'skipped' ? `<span class="badge badge-neutral">Sync Disabled</span><button class="btn btn-ghost btn-sm" onclick="retryQboSync('${esc(order.ID)}')">Create Invoice</button>` : ''}
      ${!order.QboSyncStatus ? `<span class="badge badge-neutral">Pending</span><button class="btn btn-ghost btn-sm" onclick="retryQboSync('${esc(order.ID)}')">Create Invoice</button>` : ''}
    </div>` : ''}`;
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
let _orderItemSummary = {}; // { orderId: { count, endCustomers: [] } }

function togglePaymentFields() {
  const status = val('f-status');
  const wrap = document.getElementById('payment-fields');
  if (wrap) wrap.style.display = status === 'Paid' ? '' : 'none';
}

function toggleOrderDeposits() {
  const checked = document.getElementById('f-charge-deposits')?.checked;
  const depGroup = document.getElementById('deposit-amount-group');
  if (depGroup) depGroup.style.display = checked ? 'block' : 'none';
  recalcOrderAmount();
}

function initOrderDepositCheckbox(presetAccountId) {
  const acctId = presetAccountId || val('f-account');
  if (!acctId) return;
  const acct = state.accounts.find(a => a.ID === acctId);
  const cb = document.getElementById('f-charge-deposits');
  if (cb && acct) {
    cb.checked = acct.ChargeDeposits === 'true';
    toggleOrderDeposits();
  }
}

function toggleOrderTax() {
  const checked = document.getElementById('f-charge-tax')?.checked;
  const taxEl = document.getElementById('f-tax');
  const rate = getTaxRate();
  if (taxEl) {
    if (checked && rate > 0) {
      taxEl.readOnly = true;
      taxEl.style.background = '#f5f5f5';
    } else {
      taxEl.readOnly = false;
      taxEl.style.background = '';
    }
  }
  if (!checked && taxEl) {
    taxEl.value = '';
  }
  recalcOrderAmount();
}

function initOrderTaxCheckbox(presetAccountId) {
  const acctId = presetAccountId || val('f-account');
  if (!acctId) return;
  const acct = state.accounts.find(a => a.ID === acctId);
  const cb = document.getElementById('f-charge-tax');
  if (cb && acct) {
    cb.checked = acct.Taxable === 'true';
    toggleOrderTax();
  }
}

function recalcTaxFromAmount() {
  const checked = document.getElementById('f-charge-tax')?.checked;
  if (!checked) { recalcOrderTotal(); return; }
  const rate = getTaxRate();
  if (rate <= 0) { recalcOrderTotal(); return; }
  // Use taxable total from line items if available
  let taxableAmount = 0;
  const lineItems = getOrderLineItems();
  if (lineItems.length > 0) {
    for (const { qty, unitPrice, taxable } of lineItems) {
      if (taxable) taxableAmount += qty * (parseFloat(unitPrice) || 0);
    }
  } else {
    taxableAmount = parseFloat(val('f-amount')) || 0;
  }
  const taxEl = document.getElementById('f-tax');
  if (taxEl) taxEl.value = taxableAmount > 0 ? (taxableAmount * rate / 100).toFixed(2) : '';
  recalcOrderTotal();
}

async function initOrderCredit(accountId, orderId) {
  const section = document.getElementById('order-credit-section');
  if (!section) return;
  _orderCreditBalance = 0;
  _orderCreditApplied = 0;
  if (!accountId) { section.style.display = 'none'; return; }
  let existingApplied = 0;
  let pendingOtherCredit = 0;
  try {
    const { balance } = await api.get(`/api/credits/balance/${accountId}`);
    _orderCreditBalance = balance || 0;
    // Fetch all credits + orders to find credit on pending orders
    const [credits, orders] = await Promise.all([
      api.get(`/api/credits?accountId=${accountId}`),
      api.get('/api/orders'),
    ]);
    const pendingOrderIds = new Set(
      orders.filter(o => o.AccountID === accountId && o.Status === 'Pending').map(o => o.ID)
    );
    // If editing an existing order, find any credit already applied to it
    // and add it back to the available balance (it will be reversed on save)
    if (orderId) {
      const orderCredits = credits.filter(c => c.Type === 'applied' && c.OrderID === orderId);
      existingApplied = orderCredits.reduce((sum, c) => sum + (parseFloat(c.Amount) || 0), 0);
      _orderCreditBalance = parseFloat((_orderCreditBalance + existingApplied).toFixed(2));
      pendingOrderIds.delete(orderId); // don't count this order's credit as "other"
    }
    // Credit applied to other pending orders
    pendingOtherCredit = credits
      .filter(c => c.Type === 'applied' && pendingOrderIds.has(c.OrderID))
      .reduce((sum, c) => sum + (parseFloat(c.Amount) || 0), 0);
  } catch { _orderCreditBalance = 0; }
  const totalAvailable = parseFloat((_orderCreditBalance + pendingOtherCredit).toFixed(2));
  if (totalAvailable <= 0 && existingApplied <= 0) { section.style.display = 'none'; return; }
  section.style.display = '';
  // If editing, the saved OrderAmount was already reduced by the credit.
  // Restore the pre-credit amount so the save logic doesn't double-deduct.
  // But skip this if line items are present — recalcOrderAmount() already
  // calculated the pre-credit total from line item prices.
  if (existingApplied > 0) {
    const hasLineItems = document.querySelectorAll('#order-line-items .order-line-item').length > 0;
    if (!hasLineItems) {
      const amountEl = document.getElementById('f-amount');
      if (amountEl) {
        const currentAmt = parseFloat(amountEl.value) || 0;
        amountEl.value = (currentAmt + existingApplied).toFixed(2);
      }
    }
  }
  const info = document.getElementById('order-credit-info');
  if (info) {
    let html = `Available credit: <strong style="color:#2e7d32">${fmtMoney(_orderCreditBalance)}</strong>`;
    if (pendingOtherCredit > 0) {
      html += ` <span class="text-muted">(${fmtMoney(pendingOtherCredit)} on other pending orders)</span>`;
    }
    info.innerHTML = html;
  }
  const applyEl = document.getElementById('f-credit-apply');
  if (applyEl) applyEl.value = existingApplied > 0 ? existingApplied.toFixed(2) : '0';
  updateCreditApplication();
}

function updateCreditApplication() {
  let applied = parseFloat(val('f-credit-apply')) || 0;
  const orderAmt = parseFloat(val('f-amount')) || 0;
  const max = Math.min(_orderCreditBalance, orderAmt);
  if (applied > max) {
    applied = max;
    const el = document.getElementById('f-credit-apply');
    if (el) el.value = applied.toFixed(2);
  }
  if (applied < 0) {
    applied = 0;
    const el = document.getElementById('f-credit-apply');
    if (el) el.value = '0';
  }
  _orderCreditApplied = applied;
  const summary = document.getElementById('order-credit-summary');
  if (summary) summary.textContent = '';
  recalcOrderTotal();
}

function applyMaxCredit() {
  const orderAmt = parseFloat(val('f-amount')) || 0;
  const max = Math.min(_orderCreditBalance, orderAmt);
  const el = document.getElementById('f-credit-apply');
  if (el) el.value = max > 0 ? max.toFixed(2) : '0';
  updateCreditApplication();
}

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

// Render the "→ Venue" indirect-delivery hint under an order's account name.
// Pulls from _orderItemSummary built by /api/order-items/counts.
function formatEndCustomers(orderId) {
  const ec = _orderItemSummary[orderId]?.endCustomers || [];
  if (ec.length === 0) return '';
  const label = ec.length === 1 ? `→ ${ec[0]}` : `→ ${ec.length} venues`;
  return `<br><span class="text-muted text-sm" title="${esc(ec.join(', '))}" style="cursor:default">${esc(label)}</span>`;
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

  // For paid/read-only orders, only show products that are on the order
  if (readOnly) {
    const orderItems = items.filter(i => quantities[i.ID] > 0);
    if (orderItems.length === 0) {
      return `<p class="text-muted text-sm">No products on this order.</p>`;
    }
    const rows = orderItems.map(item => {
      const price = parseFloat(item.PricePerUnit || 0);
      const qty = quantities[item.ID] || 0;
      return `<tr>
        <td class="fw-600">${esc(item.Name)}</td>
        <td class="text-sm">${esc(item.Format) || '—'}</td>
        <td class="text-sm">${price ? '$' + price.toFixed(2) : '—'}</td>
        <td class="text-sm">${qty}</td>
      </tr>`;
    });
    return `
      <div class="table-wrap" style="margin-bottom:8px">
        <table>
          <thead><tr><th>Product</th><th>Format</th><th>Price</th><th>Qty</th></tr></thead>
          <tbody>${rows.join('')}</tbody>
        </table>
      </div>`;
  }

  // Editable: use line-item builder
  return orderProductsHtml();
}

function orderProductsHtml() {
  return `
    <div id="order-line-items"></div>
    <div style="margin-top:8px;display:flex;gap:8px">
      <button type="button" class="btn btn-secondary btn-sm" onclick="addOrderLineItem()">+ Add Product</button>
      <button type="button" class="btn btn-secondary btn-sm" onclick="addCustomLineItem()">+ Add Custom Item</button>
    </div>`;
}

function _buildProductOptions(selectedId) {
  const sortByName = (a, b) => {
    const la = (a.Name || '').toLowerCase();
    const lb = (b.Name || '').toLowerCase();
    return la.localeCompare(lb) || (a.Format || '').localeCompare(b.Format || '');
  };
  const inStock = _orderFormInventory.filter(i => parseInt(i.Available || i.Units || '0') > 0).sort(sortByName);
  const outOfStock = _orderFormInventory.filter(i => parseInt(i.Available || i.Units || '0') <= 0).sort(sortByName);

  let html = '<option value="">-- Select Product --</option>';
  if (inStock.length) {
    html += '<optgroup label="In Stock">';
    for (const item of inStock) {
      const label = item.Format ? `${item.Name} (${item.Format})` : item.Name;
      const sel = item.ID === selectedId ? ' selected' : '';
      html += `<option value="${esc(item.ID)}"${sel}>${esc(label)} [${item.Available || item.Units}]</option>`;
    }
    html += '</optgroup>';
  }
  if (outOfStock.length) {
    html += '<optgroup label="Out of Stock">';
    for (const item of outOfStock) {
      const label = item.Format ? `${item.Name} (${item.Format})` : item.Name;
      const sel = item.ID === selectedId ? ' selected' : '';
      html += `<option value="${esc(item.ID)}"${sel}>${esc(label)}</option>`;
    }
    html += '</optgroup>';
  }
  return html;
}

function _parsePrices(item) {
  if (!item) return [];
  if (item.Prices) {
    try {
      const parsed = JSON.parse(item.Prices);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch { /* ignore */ }
  }
  if (item.PricePerUnit) return [{ label: '', price: item.PricePerUnit }];
  return [];
}

// True if the currently-selected order account is flagged as a pass-through
// distributor — used to decide whether to show per-line "Delivers to" pickers.
function _orderAccountIsIndirect() {
  const presetId = document.getElementById('f-account-hidden')?.value || '';
  const acctId = presetId || val('f-account');
  if (!acctId) return false;
  const acct = (state.accounts || []).find(a => a.ID === acctId);
  return acct && acct.DeliversIndirectly === 'true';
}

// Inline HTML for the optional per-line "Delivers to (end customer)" picker.
// Hidden by default; refreshLineItemDeliversTo() toggles visibility based on
// the selected account's DeliversIndirectly flag. The default option is
// labeled with the distributor's own account name so it's clear that leaving
// it blank means the line stays with that account (no pass-through).
function _endCustomerPickerHtml(selectedId) {
  const indirect = _orderAccountIsIndirect();
  const acctId = document.getElementById('f-account-hidden')?.value || val('f-account');
  const acctName = acctId ? ((state.accounts || []).find(a => a.ID === acctId) || {}).Name : '';
  const defaultLabel = acctName ? `Stays with ${acctName}` : 'No pass-through (stays with this account)';
  const opts = `<option value="">${esc(defaultLabel)}</option>${accountOptions(selectedId || '')}`;
  return `<div class="line-item-delivers-to" style="display:${indirect ? 'flex' : 'none'};gap:6px;align-items:center;flex-wrap:wrap;margin-top:4px;margin-left:12px;padding-left:8px;border-left:2px solid var(--color-border, #e5e7eb)">
    <span class="line-item-delivers-to-label text-sm text-muted" style="white-space:nowrap">&rarr; Delivers to:</span>
    <select class="form-control line-item-end-customer" style="flex:1;min-width:140px;font-size:13px;padding:4px 8px;height:auto">${opts}</select>
  </div>`;
}

// Toggle visibility of all per-line "Delivers to" pickers when the order's
// account changes. Clears the selection when hiding so saved end-customer
// data isn't smuggled along after switching to a non-indirect account.
// Also refreshes the default option label so it tracks the new account name.
function refreshLineItemDeliversTo() {
  const indirect = _orderAccountIsIndirect();
  const acctId = document.getElementById('f-account-hidden')?.value || val('f-account');
  const acctName = acctId ? ((state.accounts || []).find(a => a.ID === acctId) || {}).Name : '';
  const defaultLabel = acctName ? `Stays with ${acctName}` : 'No pass-through (stays with this account)';
  document.querySelectorAll('.line-item-delivers-to').forEach(el => {
    el.style.display = indirect ? 'flex' : 'none';
    const sel = el.querySelector('.line-item-end-customer');
    if (!sel) return;
    if (!indirect) {
      sel.value = '';
    } else {
      const blank = sel.querySelector('option[value=""]');
      if (blank) blank.textContent = defaultLabel;
    }
  });
}

function _buildTierDropdown(prices, selectedTier) {
  if (prices.length <= 1) return '';
  return `<select class="form-control line-item-tier" onchange="onLineItemTierChange(this)" style="flex:1;min-width:100px;max-width:140px">
    ${prices.map(p => {
      const lbl = p.label ? `${p.label} ($${parseFloat(p.price).toFixed(2)})` : `$${parseFloat(p.price).toFixed(2)}`;
      const sel = selectedTier === p.label ? ' selected' : '';
      return `<option value="${esc(p.label)}" data-price="${esc(p.price)}"${sel}>${esc(lbl)}</option>`;
    }).join('')}
  </select>`;
}

function addOrderLineItem(inventoryId, qty, priceTier, savedUnitPrice, endCustomerId) {
  const wrap = document.getElementById('order-line-items');
  if (!wrap) return;

  const item = inventoryId ? _orderFormInventory.find(i => i.ID === inventoryId) : null;
  const prices = _parsePrices(item);
  // Find selected tier price
  let selectedPrice = item ? parseFloat(item.PricePerUnit || 0) : 0;
  let selectedTierLabel = '';
  if (prices.length > 1 && priceTier !== undefined) {
    const tier = prices.find(p => p.label === priceTier);
    if (tier) { selectedPrice = parseFloat(tier.price); selectedTierLabel = tier.label; }
  } else if (prices.length === 1) {
    selectedPrice = parseFloat(prices[0].price || 0);
    selectedTierLabel = prices[0].label || '';
  }
  // Override with saved unit price from order item (preserves original price during edit)
  if (savedUnitPrice !== undefined && parseFloat(savedUnitPrice) > 0) {
    selectedPrice = parseFloat(savedUnitPrice);
  }
  const lineQty = qty || 1;
  const lineTotal = selectedPrice * lineQty;

  const div = document.createElement('div');
  div.className = 'order-line-item';
  div.setAttribute('data-inventory-id', inventoryId || '');
  div.setAttribute('data-unit-price', selectedPrice.toFixed(2));
  div.setAttribute('data-price-tier', selectedTierLabel);
  div.style.cssText = 'margin-bottom:6px';

  const tierHtml = prices.length > 1 ? _buildTierDropdown(prices, selectedTierLabel) : '';

  div.innerHTML = `
    <div class="order-line-item-row" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <select class="form-control line-item-product" onchange="onLineItemProductChange(this)" style="flex:2;min-width:120px">
        ${_buildProductOptions(inventoryId || '')}
      </select>
      ${tierHtml}
      <span class="line-item-price text-sm" style="min-width:55px">${selectedPrice ? '$' + selectedPrice.toFixed(2) : '—'}</span>
      <input class="form-control line-item-qty" type="number" min="0" value="${lineQty}" style="width:60px"
        onchange="recalcOrderAmount()" oninput="recalcOrderAmount()" />
      <span class="line-item-total text-sm fw-600" style="min-width:55px">${lineTotal ? '$' + lineTotal.toFixed(2) : ''}</span>
      <button type="button" class="btn btn-ghost btn-sm text-danger" onclick="removeOrderLineItem(this)" style="flex-shrink:0">&times;</button>
    </div>
    ${_endCustomerPickerHtml(endCustomerId)}`;
  wrap.appendChild(div);
  recalcOrderAmount();
}

function resolveInventoryMatch(productName, format) {
  if (!productName || !_orderFormInventory.length) return null;
  const pLower = productName.toLowerCase().trim();
  const fLower = (format || '').toLowerCase().trim();

  // Exact name + format
  if (fLower) {
    const exact = _orderFormInventory.find(i =>
      (i.Name || '').toLowerCase().trim() === pLower &&
      (i.Format || '').toLowerCase().trim() === fLower
    );
    if (exact) return exact;
  }

  // Exact name only (pick first match)
  const byName = _orderFormInventory.find(i =>
    (i.Name || '').toLowerCase().trim() === pLower
  );
  if (byName) return byName;

  // Fuzzy name match
  const fuzzy = _orderFormInventory.find(i => {
    const n = (i.Name || '').toLowerCase().trim();
    return n && (pLower.includes(n) || n.includes(pLower));
  });
  return fuzzy || null;
}

function addUnmatchedLineItem(item) {
  const wrap = document.getElementById('order-line-items');
  if (!wrap) return;
  const price = parseFloat(item.UnitPrice || 0);
  const qty = parseInt(item.Quantity || 0);
  const total = price * qty;

  const div = document.createElement('div');
  div.className = 'order-line-item';
  div.setAttribute('data-inventory-id', item.InventoryID || '');
  div.setAttribute('data-unit-price', price.toFixed(2));
  div.setAttribute('data-price-tier', item.PriceTier || '');
  div.style.cssText = 'margin-bottom:6px';
  div.innerHTML = `
    <div class="order-line-item-row" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <span class="line-item-unmatched" style="flex:2;min-width:120px;font-size:13px" title="Not in current location inventory">${esc(item.ProductName)}${item.Format ? ' — ' + esc(item.Format) : ''}</span>
      <span class="line-item-price text-sm" style="min-width:55px">${price ? '$' + price.toFixed(2) : '—'}</span>
      <input class="form-control line-item-qty" type="number" min="0" value="${qty}" style="width:60px"
        onchange="recalcOrderAmount()" oninput="recalcOrderAmount()" />
      <span class="line-item-total text-sm fw-600" style="min-width:55px">${total ? '$' + total.toFixed(2) : ''}</span>
      <button type="button" class="btn btn-ghost btn-sm text-danger" onclick="removeOrderLineItem(this)" style="flex-shrink:0">&times;</button>
    </div>
    ${_endCustomerPickerHtml(item.EndCustomerAccountID || '')}`;
  wrap.appendChild(div);
  recalcOrderAmount();
}

function addCustomLineItem(description, unitPrice, qty, taxable, endCustomerId) {
  const wrap = document.getElementById('order-line-items');
  if (!wrap) return;
  const price = parseFloat(unitPrice || 0);
  const lineQty = parseInt(qty) || 1;
  const lineTotal = price * lineQty;
  const isTaxable = taxable === true || taxable === 'true';

  const div = document.createElement('div');
  div.className = 'order-line-item';
  div.setAttribute('data-inventory-id', '');
  div.setAttribute('data-custom', 'true');
  div.setAttribute('data-unit-price', price.toFixed(2));
  div.setAttribute('data-price-tier', '');
  div.style.cssText = 'margin-bottom:6px';
  div.innerHTML = `
    <div class="order-line-item-row" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <input class="form-control custom-item-desc" type="text" value="${esc(description || '')}" placeholder="e.g. T-shirt, service charge" style="flex:2;min-width:120px" />
      <input class="form-control custom-item-price" type="number" step="0.01" min="0" value="${price ? price.toFixed(2) : ''}" placeholder="Price" style="width:80px"
        onchange="onCustomItemPriceChange(this)" oninput="onCustomItemPriceChange(this)" />
      <input class="form-control line-item-qty" type="number" min="0" value="${lineQty}" style="width:60px"
        onchange="recalcOrderAmount()" oninput="recalcOrderAmount()" />
      <label class="custom-item-tax-label" style="display:flex;align-items:center;gap:3px;font-size:12px;white-space:nowrap;cursor:pointer">
        <input type="checkbox" class="custom-item-taxable" ${isTaxable ? 'checked' : ''} onchange="recalcOrderAmount()" /> Tax
      </label>
      <span class="line-item-total text-sm fw-600" style="min-width:55px">${lineTotal ? '$' + lineTotal.toFixed(2) : ''}</span>
      <button type="button" class="btn btn-ghost btn-sm text-danger" onclick="removeOrderLineItem(this)" style="flex-shrink:0">&times;</button>
    </div>
    ${_endCustomerPickerHtml(endCustomerId)}`;
  wrap.appendChild(div);
  recalcOrderAmount();
}

function onCustomItemPriceChange(input) {
  const row = input.closest('.order-line-item');
  if (!row) return;
  const price = parseFloat(input.value) || 0;
  row.setAttribute('data-unit-price', price.toFixed(2));
  recalcOrderAmount();
}

function removeOrderLineItem(btn) {
  const row = btn.closest('.order-line-item');
  if (row) row.remove();
  recalcOrderAmount();
}

function onLineItemProductChange(select) {
  const row = select.closest('.order-line-item');
  if (!row) return;
  const invId = select.value;
  row.setAttribute('data-inventory-id', invId);
  const item = _orderFormInventory.find(i => i.ID === invId);
  const prices = _parsePrices(item);

  // Remove existing tier dropdown if any
  const oldTier = row.querySelector('.line-item-tier');
  if (oldTier) oldTier.remove();

  let price = item ? parseFloat(item.PricePerUnit || 0) : 0;
  let tierLabel = '';

  if (prices.length > 1) {
    // Insert tier dropdown after product select
    const tierSelect = document.createElement('select');
    tierSelect.className = 'form-control line-item-tier';
    tierSelect.setAttribute('onchange', 'onLineItemTierChange(this)');
    tierSelect.style.cssText = 'flex:1;min-width:100px;max-width:140px';
    for (const p of prices) {
      const opt = document.createElement('option');
      opt.value = p.label || '';
      opt.setAttribute('data-price', p.price);
      opt.textContent = p.label ? `${p.label} ($${parseFloat(p.price).toFixed(2)})` : `$${parseFloat(p.price).toFixed(2)}`;
      tierSelect.appendChild(opt);
    }
    select.insertAdjacentElement('afterend', tierSelect);
    price = parseFloat(prices[0].price || 0);
    tierLabel = prices[0].label || '';
  } else if (prices.length === 1) {
    price = parseFloat(prices[0].price || 0);
    tierLabel = prices[0].label || '';
  }

  row.setAttribute('data-unit-price', price.toFixed(2));
  row.setAttribute('data-price-tier', tierLabel);
  const priceEl = row.querySelector('.line-item-price');
  if (priceEl) priceEl.textContent = price ? '$' + price.toFixed(2) : '—';
  recalcOrderAmount();
}

function onLineItemTierChange(select) {
  const row = select.closest('.order-line-item');
  if (!row) return;
  const opt = select.options[select.selectedIndex];
  const price = parseFloat(opt.getAttribute('data-price') || 0);
  const tierLabel = select.value;
  row.setAttribute('data-unit-price', price.toFixed(2));
  row.setAttribute('data-price-tier', tierLabel);
  const priceEl = row.querySelector('.line-item-price');
  if (priceEl) priceEl.textContent = price ? '$' + price.toFixed(2) : '—';
  recalcOrderAmount();
}

function getOrderLineItems() {
  const rows = document.querySelectorAll('#order-line-items .order-line-item');
  const items = [];
  rows.forEach(row => {
    const invId = row.getAttribute('data-inventory-id') || '';
    const qtyEl = row.querySelector('.line-item-qty');
    const qty = parseInt(qtyEl?.value) || 0;
    const unitPrice = row.getAttribute('data-unit-price') || '';
    const priceTier = row.getAttribute('data-price-tier') || '';
    const isCustom = row.getAttribute('data-custom') === 'true';
    const taxable = isCustom ? (row.querySelector('.custom-item-taxable')?.checked || false) : true;
    if (qty > 0) {
      items.push({ inventoryId: invId, qty, unitPrice, priceTier, taxable });
    }
  });
  return items;
}

function refreshOrderAccounts() {
  const location = val('f-location');
  const sel = document.getElementById('f-account');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">-- Select Account --</option>' + accountOptions(current, location);
}

async function refreshOrderProducts(existingProducts = '', readOnly = false) {
  const location = val('f-location');
  const locQuery = location ? `?location=${encodeURIComponent(location)}` : '';
  _orderFormInventory = await api.get(`/api/inventory${locQuery}`);
  const wrap = document.getElementById('order-products-wrap');
  if (!wrap) return;

  if (readOnly) {
    const quantities = parseRequestedProducts(existingProducts, _orderFormInventory);
    wrap.innerHTML = productPickerHtml(_orderFormInventory, quantities, true);
    return;
  }

  // Editable mode: render line-item builder
  wrap.innerHTML = orderProductsHtml();
  if (existingProducts) {
    const quantities = parseRequestedProducts(existingProducts, _orderFormInventory);
    for (const [invId, qty] of Object.entries(quantities)) {
      if (qty > 0) addOrderLineItem(invId, qty);
    }
  }
  // Only auto-recalc if not restoring existing quantities (preserve manually set amount)
  if (!existingProducts) recalcOrderAmount();
}

async function refreshOrderProductsFromItems(orderItems, readOnly = false) {
  const location = val('f-location');
  const locQuery = location ? `?location=${encodeURIComponent(location)}` : '';
  _orderFormInventory = await api.get(`/api/inventory${locQuery}`);
  const wrap = document.getElementById('order-products-wrap');
  if (!wrap) return;

  if (readOnly) {
    // Render directly from OrderItems — works even if inventory items were deleted
    wrap.innerHTML = orderItemsReadOnlyHtml(orderItems);
    return;
  }

  // Editable mode: render line-item builder and populate from order items
  // Account Credit rows are intentionally skipped — they're managed via the
  // dedicated "Account Credit" section of the form and re-created on save.
  // Without this, they fall through to addUnmatchedLineItem which renders a
  // Delivers-to dropdown that doesn't apply to a credit.
  wrap.innerHTML = orderProductsHtml();
  for (const item of orderItems) {
    if (item.ProductName === 'Account Credit') continue;
    const ec = item.EndCustomerAccountID || '';
    if (item.InventoryID && _orderFormInventory.find(i => i.ID === item.InventoryID)) {
      addOrderLineItem(item.InventoryID, parseInt(item.Quantity || 0), item.PriceTier || undefined, item.UnitPrice, ec);
    } else if (!item.InventoryID && item.ProductName) {
      // Custom item (no InventoryID)
      addCustomLineItem(item.ProductName, item.UnitPrice, item.Quantity, item.Taxable, ec);
    } else if (item.ProductName) {
      // Try to match by product name + format against current inventory
      const resolved = resolveInventoryMatch(item.ProductName, item.Format);
      if (resolved) {
        addOrderLineItem(resolved.ID, parseInt(item.Quantity || 0), item.PriceTier || undefined, item.UnitPrice, ec);
      } else {
        addUnmatchedLineItem(item);
      }
    }
  }
}

function orderItemsReadOnlyHtml(orderItems) {
  if (!orderItems || orderItems.length === 0) {
    return `<p class="text-muted text-sm">No products on this order.</p>`;
  }
  const rows = orderItems.map(item => {
    const price = parseFloat(item.UnitPrice || 0);
    const qty = parseInt(item.Quantity || 0);
    const total = parseFloat(item.LineTotal || 0);
    const isNeg = total < 0;
    const fmtDisplay = item.PriceTier
      ? `${esc(item.Format)} (${esc(item.PriceTier)})`
      : (esc(item.Format) || '—');
    const endCustomer = item.EndCustomerAccountID && item.EndCustomerName
      ? `<div class="text-sm text-muted">→ ${esc(item.EndCustomerName)}</div>`
      : '';
    return `<tr>
      <td class="fw-600">${esc(item.ProductName || '—')}${endCustomer}</td>
      <td class="text-sm">${fmtDisplay}</td>
      <td class="text-sm">${qty}</td>
      <td class="text-sm"${isNeg ? ' style="color:#2e7d32"' : ''}>${price ? '$' + price.toFixed(2) : '—'}</td>
      <td class="text-sm"${isNeg ? ' style="color:#2e7d32"' : ''}>${total ? '$' + total.toFixed(2) : '—'}</td>
    </tr>`;
  });
  return `
    <div class="table-wrap" style="margin-bottom:8px">
      <table>
        <thead><tr><th>Product</th><th>Format</th><th>Qty</th><th>Unit Price</th><th>Total</th></tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>`;
}

function recalcOrderAmount() {
  let total = 0;
  let taxableTotal = 0;
  let depositTotal = 0;
  let hasProducts = false;
  let hasKegs = false;
  const chargeDeposits = document.getElementById('f-charge-deposits')?.checked;
  for (const { inventoryId, qty, unitPrice, taxable } of getOrderLineItems()) {
    if (qty > 0) {
      const item = inventoryId ? _orderFormInventory.find(i => i.ID === inventoryId) : null;
      const price = unitPrice ? parseFloat(unitPrice) : (item ? parseFloat(item.PricePerUnit || 0) : 0);
      if (!item && price <= 0) continue;
      hasProducts = true;
      const lineAmount = qty * price;
      total += lineAmount;
      if (taxable) taxableTotal += lineAmount;
      if (item) {
        if ((item.Format || '').toLowerCase().includes('keg')) hasKegs = true;
        if (chargeDeposits) {
          const dep = getDepositForFormat(item.Format);
          if (dep > 0) depositTotal += qty * dep;
        }
      }
    }
  }
  // Show/hide deposit checkbox based on whether any line item is a keg
  const depCbGroup = document.getElementById('deposit-checkbox-group');
  if (depCbGroup) depCbGroup.style.display = hasKegs ? '' : 'none';
  // Update line item totals
  document.querySelectorAll('#order-line-items .order-line-item').forEach(row => {
    const qtyEl = row.querySelector('.line-item-qty');
    const totalEl = row.querySelector('.line-item-total');
    if (qtyEl && totalEl) {
      const rowPrice = parseFloat(row.getAttribute('data-unit-price') || 0);
      const lineQty = parseInt(qtyEl.value) || 0;
      const lineTotal = rowPrice * lineQty;
      totalEl.textContent = lineTotal > 0 ? '$' + lineTotal.toFixed(2) : '';
    }
  });
  if (hasProducts) {
    const amountEl = document.getElementById('f-amount');
    if (amountEl) amountEl.value = total.toFixed(2);
  }
  const depEl = document.getElementById('f-deposit-amount');
  if (depEl) depEl.value = chargeDeposits && depositTotal > 0 ? depositTotal.toFixed(2) : '';
  // Auto-calculate tax if charge-tax is checked (only on taxable items)
  const chargeTax = document.getElementById('f-charge-tax')?.checked;
  const taxRate = getTaxRate();
  if (chargeTax && taxRate > 0) {
    const taxEl = document.getElementById('f-tax');
    if (taxEl) taxEl.value = taxableTotal > 0 ? (taxableTotal * taxRate / 100).toFixed(2) : '';
  }
  recalcOrderTotal();
}

function recalcOrderTotal() {
  const el = document.getElementById('order-total-summary');
  if (!el) return;
  const amount = parseFloat(val('f-amount')) || 0;
  const tax = parseFloat(val('f-tax')) || 0;
  const deposit = parseFloat(val('f-deposit-amount')) || 0;
  const credit = (typeof _orderCreditApplied !== 'undefined') ? _orderCreditApplied : 0;
  const total = amount + tax + deposit - credit;
  if (amount <= 0 && tax <= 0 && deposit <= 0) {
    el.style.display = 'none';
    return;
  }
  el.style.display = '';
  let rows = `<div class="order-total-row"><span>Subtotal</span><span>${fmtMoney(amount)}</span></div>`;
  if (tax > 0) rows += `<div class="order-total-row"><span>Tax</span><span>${fmtMoney(tax)}</span></div>`;
  if (deposit > 0) rows += `<div class="order-total-row"><span>Keg Deposits</span><span>${fmtMoney(deposit)}</span></div>`;
  if (credit > 0) rows += `<div class="order-total-row order-total-credit"><span>Credit Applied</span><span>-${fmtMoney(credit)}</span></div>`;
  rows += `<div class="order-total-row order-total-final"><span>Total</span><span>${fmtMoney(total)}</span></div>`;
  el.innerHTML = rows;
}

function collectOrderProducts() {
  const selected = [];
  const rows = document.querySelectorAll('#order-line-items .order-line-item');
  for (const row of rows) {
    const invId = row.getAttribute('data-inventory-id') || '';
    const qtyEl = row.querySelector('.line-item-qty');
    const qty = parseInt(qtyEl?.value) || 0;
    if (qty <= 0) continue;
    const priceTier = row.getAttribute('data-price-tier') || '';
    if (invId) {
      const item = _orderFormInventory.find(i => i.ID === invId);
      if (!item) continue;
      let label = item.Format ? `${item.Name} (${item.Format})` : item.Name;
      if (priceTier) label += ` [${priceTier}]`;
      selected.push(`${qty}x ${label}`);
    } else if (row.getAttribute('data-custom') === 'true') {
      const descInput = row.querySelector('.custom-item-desc');
      const desc = descInput ? descInput.value.trim() : 'Custom item';
      selected.push(`${qty}x ${desc}`);
    }
  }
  return selected.join(', ');
}

function collectOrderItems() {
  const items = [];
  const rows = document.querySelectorAll('#order-line-items .order-line-item');
  // End-customer fields are only meaningful when the order's account is
  // flagged as DeliversIndirectly; otherwise we always send empty strings.
  const indirect = _orderAccountIsIndirect();
  rows.forEach(row => {
    const invId = row.getAttribute('data-inventory-id') || '';
    const qtyEl = row.querySelector('.line-item-qty');
    const qty = parseInt(qtyEl?.value) || 0;
    if (qty <= 0) return;
    const unitPrice = row.getAttribute('data-unit-price') || '';
    const priceTier = row.getAttribute('data-price-tier') || '';
    const item = invId ? _orderFormInventory.find(i => i.ID === invId) : null;
    const price = unitPrice ? parseFloat(unitPrice) : (item ? parseFloat(item.PricePerUnit || 0) : 0);
    const isCustom = row.getAttribute('data-custom') === 'true';
    const taxable = isCustom ? (row.querySelector('.custom-item-taxable')?.checked ? 'true' : '') : 'true';
    const endCustomerSel = indirect ? row.querySelector('.line-item-end-customer') : null;
    const endCustomerId   = endCustomerSel?.value || '';
    const endCustomerName = endCustomerId
      ? ((state.accounts || []).find(a => a.ID === endCustomerId) || {}).Name || ''
      : '';
    if (item) {
      items.push({
        InventoryID: item.ID,
        ProductName: item.Name,
        Format: item.Format || '',
        PriceTier: priceTier || '',
        Quantity: qty,
        UnitPrice: price.toFixed(2),
        LineTotal: (qty * price).toFixed(2),
        Taxable: taxable,
        EndCustomerAccountID: endCustomerId,
        EndCustomerName: endCustomerName,
      });
    } else {
      // Custom or unmatched item
      let productName = '', format = '';
      if (isCustom) {
        const descInput = row.querySelector('.custom-item-desc');
        productName = descInput ? descInput.value.trim() : '';
      } else {
        const nameSpan = row.querySelector('span[title]');
        const text = nameSpan ? nameSpan.textContent : '';
        [productName, format] = text.includes(' — ') ? text.split(' — ', 2) : [text, ''];
        format = (format || '').trim();
      }
      items.push({
        InventoryID: invId,
        ProductName: productName.trim(),
        Format: (format || '').trim(),
        PriceTier: priceTier || '',
        Quantity: qty,
        UnitPrice: price.toFixed(2),
        LineTotal: (qty * price).toFixed(2),
        Taxable: taxable,
        EndCustomerAccountID: endCustomerId,
        EndCustomerName: endCustomerName,
      });
    }
  });
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

async function loadOrders(preservePage = false) {
  if (!preservePage) _paginationReset('orders');
  _ordersDatePreset = '';
  _ordersDateFrom = '';
  _ordersDateTo = '';
  showLoading();
  const locParam = state.location ? `?location=${encodeURIComponent(state.location)}` : '';
  const [orders, accounts, staff, itemSummary] = await Promise.all([
    api.get(`/api/orders${locParam}`),
    api.get('/api/accounts'),
    api.get('/api/staff'),
    api.get('/api/order-items/counts'),
  ]);
  state.accounts = accounts;
  state.staff = staff;
  _ordersCache = orders;
  _orderItemSummary = itemSummary || {};
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
    else if (sortCol === 'Total')  { av = parseFloat(a.OrderAmount||0)+parseFloat(a.TaxAmount||0)+parseFloat(a.DepositAmount||0); bv = parseFloat(b.OrderAmount||0)+parseFloat(b.TaxAmount||0)+parseFloat(b.DepositAmount||0); }
    else if (sortCol === 'Status') { av = (a.Status||'').toLowerCase();  bv = (b.Status||'').toLowerCase(); }
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const totalOrder   = filtered.reduce((sum, s) => sum + parseFloat(s.OrderAmount   || 0), 0);
  const totalTax     = filtered.reduce((sum, s) => sum + parseFloat(s.TaxAmount     || 0), 0);
  const totalDeposit = filtered.reduce((sum, s) => sum + parseFloat(s.DepositAmount || 0), 0);
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

  // Email draft orders banner
  const emailDrafts = orders.filter(o => o.Status === 'Draft' && (o.Notes || '').includes('[Email Order]'));
  const emailDraftBanner = emailDrafts.length > 0
    ? `<div class="info-banner" style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:8px;padding:10px 16px;margin-bottom:12px;display:flex;align-items:center;gap:8px">
        <span style="font-size:16px">&#128233;</span>
        <span>${emailDrafts.length} email order request${emailDrafts.length !== 1 ? 's' : ''} awaiting review. Filter by <a href="#" onclick="event.preventDefault(); document.getElementById('orders-status').value='Draft'; _paginationReset('orders'); renderOrders()">Draft status</a> to see them.</span>
      </div>`
    : '';

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
    ${emailDraftBanner}
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
            ${ordTh('Order Date','OrderDate')}${ordTh('Account','Account')}<th class="mobile-hide">Invoice #</th>
            <th class="mobile-hide sortable-th${_ordersSort.col === 'Amount' ? ' sorted' : ''}" onclick="sortOrders('Amount')">Order Amt${_ordersSort.col === 'Amount' ? (_ordersSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</th><th class="mobile-hide">Tax</th>${ordTh('Total','Total')}${ordTh('Status','Status')}<th class="mobile-hide">Delivered</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${pg.total === 0 ? `<tr><td colspan="9" class="empty-state">No orders found.</td></tr>` :
            pg.rows.map(s => {
              const total = parseFloat(s.OrderAmount || 0) + parseFloat(s.TaxAmount || 0) + parseFloat(s.DepositAmount || 0);
              const isPreSale = s.Status === 'Pre-Sale';
              return `<tr>
                <td>${formatDate(s.OrderDate)}</td>
                <td class="fw-600"><span class="td-link" onclick="loadAccountProfile('${esc(s.AccountID)}')">${esc(s.AccountName)}</span>${formatEndCustomers(s.ID)}${formatProductsSummary(s.RequestedProducts)}</td>
                <td class="mobile-hide text-sm">${esc(s.InvoiceNumber) || '—'}${(_orderItemSummary[s.ID]?.count) ? ` <span class="badge badge-items" title="${_orderItemSummary[s.ID].count} line item${_orderItemSummary[s.ID].count > 1 ? 's' : ''}">${_orderItemSummary[s.ID].count} items</span>` : ''}${qboSyncBadge(s)}</td>
                <td class="mobile-hide">${isPreSale && !parseFloat(s.OrderAmount) ? '<span class="text-muted">—</span>' : fmtMoney(s.OrderAmount)}${s.DepositAmount && parseFloat(s.DepositAmount) > 0 ? `<br><span class="text-muted text-sm">+${fmtMoney(s.DepositAmount)} deposit</span>` : ''}</td>
                <td class="mobile-hide">${s.TaxAmount && parseFloat(s.TaxAmount) > 0 ? fmtMoney(s.TaxAmount) : '—'}</td>
                <td class="fw-600">${isPreSale && !parseFloat(s.OrderAmount) ? '<span class="text-muted">—</span>' : fmtMoney(total)}</td>
                <td>${orderStatusBadge(s.Status)}${s.PaymentMethod ? `<br><span class="text-muted text-sm">${esc(s.PaymentMethod)}${s.PaymentReference ? ' · ' + esc(s.PaymentReference) : ''}</span>` : ''}</td>
                <td class="mobile-hide text-center">${isPreSale || s.Status === 'Draft' ? '—'
                  : s.Delivered === 'true'
                  ? `<input type="checkbox" checked disabled title="${s.DeliveryDate ? formatDate(s.DeliveryDate) : 'Delivered'}" />`
                  : `<input type="checkbox" onchange="toggleDelivered('${esc(s.ID)}')" />`}</td>
                <td class="td-actions">
                  <button class="btn btn-ghost btn-sm mobile-actions-toggle" onclick="toggleMobileActions(event)">&#8230;</button>
                  <div class="mobile-actions-menu">
                  ${isPreSale ? `<button class="btn btn-ghost btn-sm" onclick="openEditPreSale('${esc(s.ID)}')">Edit</button><button class="btn btn-ghost btn-sm text-success" onclick="convertPreSale('${esc(s.ID)}')">Convert</button><button class="btn btn-ghost btn-sm text-danger" onclick="cancelPreSale('${esc(s.ID)}')">Cancel</button>`
                  : `${s.Status === 'Pending' || s.Status === 'Draft' ? `<button class="btn btn-ghost btn-sm text-success" onclick="markOrderPaid('${esc(s.ID)}')">Paid</button>` : ''}
                  <button class="btn btn-ghost btn-sm" onclick="openEditOrder('${esc(s.ID)}')">${s.Status === 'Paid' ? 'View' : 'Edit'}</button>
                  <button class="btn btn-ghost btn-sm text-danger" onclick="deleteOrder('${esc(s.ID)}')">Del</button>
                  ${s.Delivered === 'true'
                    ? `<button class="btn btn-ghost btn-sm mobile-only" disabled>&#10003; Delivered</button>`
                    : `<button class="btn btn-ghost btn-sm mobile-only" onclick="toggleDelivered('${esc(s.ID)}')">Mark Delivered</button>`}`}
                  </div>
                </td>
              </tr>`;
            }).join('')}
        </tbody>
        ${pg.total > 1 ? `
        <tfoot>
          <tr class="table-totals">
            <td class="text-muted text-sm">${pg.total} records</td>
            <td></td>
            <td class="mobile-hide"></td>
            <td class="mobile-hide">${fmtMoney(totalOrder)}</td>
            <td class="mobile-hide">${fmtMoney(totalTax)}</td>
            <td class="fw-600">${fmtMoney(totalOrder + totalTax + totalDeposit)}</td>
            <td></td>
            <td class="mobile-hide"></td>
            <td></td>
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
    const newStatus = val('f-status');
    if (newStatus === 'Paid' && !val('f-payment-method')) {
      toast('Please select a payment method', 'error'); return;
    }
    const creditApplied = _orderCreditApplied;
    const orderAmount = parseFloat(val('f-amount')) || 0;
    const finalAmount = creditApplied > 0 ? Math.max(0, orderAmount - creditApplied).toFixed(2) : val('f-amount');
    const orderData = {
      AccountID: accountId, AccountName: accountName,
      Location: val('f-location') || state.location,
      StaffID: staffId, StaffName: staffName,
      OrderDate: orderDate, DeliveryDate: val('f-delivery-date'),
      InvoiceNumber: val('f-invoice'), Status: newStatus,
      OrderAmount: finalAmount, TaxAmount: val('f-tax'),
      DepositAmount: val('f-deposit-amount') || '0',
      Notes: val('f-notes'),
      RequestedProducts: products,
    };
    if (newStatus === 'Paid') {
      orderData.PaymentMethod = val('f-payment-method');
      orderData.PaymentReference = val('f-payment-ref');
      orderData.PaymentDate = val('f-payment-date') || today();
    }
    const order = await api.post('/api/orders', orderData);
    await saveOrderItems(order.ID);
    if (creditApplied > 0) {
      await api.post('/api/credits', {
        accountId, accountName, type: 'applied',
        amount: creditApplied.toFixed(2), orderId: order.ID,
        reason: 'Applied to order',
      });
      await api.post('/api/order-items/bulk', {
        items: [{
          OrderID: order.ID, InventoryID: '', ProductName: 'Account Credit',
          Format: '', Quantity: '1',
          UnitPrice: (-creditApplied).toFixed(2),
          LineTotal: (-creditApplied).toFixed(2),
        }],
      });
    }
    modal.close();
    toast('Order logged');
    const reloadFn = state.view === 'account-profile'
      ? () => loadAccountProfile(state.accountProfileId)
      : () => loadOrders();
    if (newStatus !== 'Draft') {
      promptQboSync(order.ID, reloadFn);
    } else {
      reloadFn();
    }
  });
  setTimeout(() => initMentions('f-notes'), 0);
  await refreshOrderProducts();
  initOrderDepositCheckbox(presetAccountId);
  initOrderTaxCheckbox(presetAccountId);
  initOrderCredit(presetAccountId);
  // Wire up account dropdown change to also refresh credit
  const acctSelect = document.getElementById('f-account');
  if (acctSelect) {
    const origOnchange = acctSelect.getAttribute('onchange') || '';
    acctSelect.setAttribute('onchange', origOnchange + '; initOrderCredit(this.value)');
  }
}

async function openEditOrder(id) {
  if (state.staff.length === 0) state.staff = await api.get('/api/staff');
  const order = _ordersCache.find(s => s.ID === id);
  if (!order) return;
  const isPaid = order.Status === 'Paid';
  if (isPaid) {
    // Paid orders are view-only — the only mutation still available is the
    // Delivered checkbox in the orders list (handled outside this modal).
    modal.open('View Order', orderForm(order, '', true), () => modal.close(), 'Close');
  } else {
    modal.open('Edit Order', orderForm(order), async () => {
      const staffId = val('f-staff');
      const staffName = staffId ? (state.staff.find(s => s.ID === staffId) || {}).Name || '' : '';
      const products = collectOrderProducts();
      const creditApplied = _orderCreditApplied;
      const orderAmount = parseFloat(val('f-amount')) || 0;
      const finalAmount = creditApplied > 0 ? Math.max(0, orderAmount - creditApplied).toFixed(2) : val('f-amount');
      // Reverse any previously applied credits for this order
      const existingCredits = await api.get(`/api/credits?accountId=${order.AccountID}`);
      const oldApplied = existingCredits.filter(c => c.Type === 'applied' && c.OrderID === id);
      for (const oc of oldApplied) {
        await api.del(`/api/credits/${oc.ID}`);
      }
      const newStatus = val('f-status');
      const becomingPaid = newStatus === 'Paid' && order.Status !== 'Paid';
      // Require payment method when changing status to Paid
      if (becomingPaid && !val('f-payment-method')) {
        toast('Please select a payment method', 'error'); return;
      }
      const updateData = {
        Location: val('f-location') || state.location,
        StaffID: staffId, StaffName: staffName,
        OrderDate: val('f-order-date'), DeliveryDate: val('f-delivery-date'),
        InvoiceNumber: val('f-invoice'), Status: newStatus,
        OrderAmount: finalAmount, TaxAmount: val('f-tax'),
        DepositAmount: val('f-deposit-amount') || '0',
        Notes: val('f-notes'),
        RequestedProducts: products || order.RequestedProducts || '',
      };
      // Include payment fields when status is Paid
      if (newStatus === 'Paid') {
        updateData.PaymentMethod = val('f-payment-method');
        updateData.PaymentReference = val('f-payment-ref');
        updateData.PaymentDate = val('f-payment-date') || today();
      }
      await api.put(`/api/orders/${id}`, updateData);
      await saveOrderItems(id);
      if (creditApplied > 0) {
        const accountName = (state.accounts.find(a => a.ID === order.AccountID) || {}).Name || order.AccountName;
        await api.post('/api/credits', {
          accountId: order.AccountID, accountName, type: 'applied',
          amount: creditApplied.toFixed(2), orderId: id,
          reason: 'Applied to order',
        });
        // Remove old credit line items, add new one
        const currentItems = await api.get(`/api/order-items?orderId=${encodeURIComponent(id)}`);
        const creditItems = currentItems.filter(i => i.ProductName === 'Account Credit');
        for (const ci of creditItems) {
          await api.del(`/api/order-items/${ci.ID}`);
        }
        await api.post('/api/order-items/bulk', {
          items: [{
            OrderID: id, InventoryID: '', ProductName: 'Account Credit',
            Format: '', Quantity: '1',
            UnitPrice: (-creditApplied).toFixed(2),
            LineTotal: (-creditApplied).toFixed(2),
          }],
        });
      }
      modal.close();
      toast('Order updated');
      // Best-effort QBO payment sync when status changed to Paid
      if (becomingPaid && order.QboInvoiceId && order.QboSyncStatus === 'synced') {
        try {
          await api.post(`/api/qbo/payment/${id}`);
          toast('Payment synced to QuickBooks');
        } catch (err) {
          toast('Payment saved but QBO sync failed: ' + (err.message || 'unknown error'), 'error');
        }
      }
      // Prompt QBO sync when transitioning from Draft to Pending or Paid
      const leavingDraft = order.Status === 'Draft' && newStatus !== 'Draft';
      if (leavingDraft && !order.QboInvoiceId) {
        const reloadFn = state.view === 'account-profile'
          ? () => loadAccountProfile(state.accountProfileId)
          : () => loadOrders();
        promptQboSync(id, reloadFn);
      } else {
        loadOrders();
      }
    });
  }
  setTimeout(() => initMentions('f-notes'), 0);
  // Prefer order items (with correct InventoryID) over text-matching RequestedProducts
  const orderItems = await api.get(`/api/order-items?orderId=${encodeURIComponent(id)}`);
  if (orderItems && orderItems.length > 0) {
    await refreshOrderProductsFromItems(orderItems, isPaid);
  } else {
    await refreshOrderProducts(order.RequestedProducts, isPaid);
  }
  // Set tax field readonly state for non-paid orders with auto-calculated tax
  if (!isPaid) {
    const chargeTaxCb = document.getElementById('f-charge-tax');
    const taxEl = document.getElementById('f-tax');
    if (chargeTaxCb && chargeTaxCb.checked && getTaxRate() > 0 && taxEl) {
      taxEl.readOnly = true;
      taxEl.style.background = '#f5f5f5';
    }
  }
  if (!isPaid) await initOrderCredit(order.AccountID, id);
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
  setTimeout(() => initMentions('f-notes'), 0);
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
  setTimeout(() => initMentions('f-notes'), 0);
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
    const reloadFn = state.view === 'account-profile'
      ? () => loadAccountProfile(state.accountProfileId)
      : () => loadOrders();
    promptQboSync(id, reloadFn);
  });
  setTimeout(() => initMentions('f-notes'), 0);
  await refreshOrderProducts(ps.RequestedProducts);
  initOrderDepositCheckbox(ps.AccountID);
  initOrderTaxCheckbox(ps.AccountID);
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

async function openPaymentModal(id, onComplete) {
  const order = _ordersCache.find(s => s.ID === id);
  if (!order) return;
  const total = parseFloat(order.OrderAmount || 0) + parseFloat(order.TaxAmount || 0) + parseFloat(order.DepositAmount || 0);
  modal.open('Record Payment', `
    <div style="margin-bottom:16px">
      <p class="fw-600">${esc(order.AccountName)}</p>
      <p class="text-sm text-muted">Order total: ${fmtMoney(total)}</p>
    </div>
    <div class="form-group">
      <label>Payment Method <span class="required">*</span></label>
      <select class="form-control" id="f-payment-method">
        <option value="">-- Select Method --</option>
        ${PAYMENT_METHODS.map(m => `<option value="${m}">${m}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label>Reference / Check #</label>
      <input class="form-control" id="f-payment-ref" placeholder="e.g. Check #1234" />
    </div>
    <div class="form-group">
      <label>Payment Date</label>
      <input class="form-control" id="f-payment-date" type="date" value="${today()}" />
    </div>
  `, async () => {
    const method = val('f-payment-method');
    if (!method) { toast('Please select a payment method', 'error'); return; }
    const ref = val('f-payment-ref');
    const date = val('f-payment-date') || today();
    await api.put(`/api/orders/${id}`, {
      Status: 'Paid',
      PaymentMethod: method,
      PaymentReference: ref,
      PaymentDate: date,
    });
    modal.close();
    toast('Order marked as paid');
    // Best-effort QBO payment sync
    if (order.QboInvoiceId && order.QboSyncStatus === 'synced') {
      try {
        await api.post(`/api/qbo/payment/${id}`);
        toast('Payment synced to QuickBooks');
      } catch (err) {
        toast('Payment saved but QBO sync failed: ' + (err.message || 'unknown error'), 'error');
      }
    }
    onComplete();
  }, 'Record Payment');
}

async function markOrderPaid(id) {
  openPaymentModal(id, () => loadOrders());
}

async function toggleDelivered(id) {
  const order = _ordersCache.find(s => s.ID === id);
  if (!order) return;
  await openDeliveryConfirmModal(id, order, loadOrders);
}

async function profileMarkOrderPaid(id) {
  // Ensure orders cache is populated for the modal
  if (!_ordersCache.find(s => s.ID === id)) {
    _ordersCache = await api.get(`/api/orders?accountId=${encodeURIComponent(state.accountProfileId)}`);
  }
  openPaymentModal(id, () => loadAccountProfile(state.accountProfileId));
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
  const [items, kegRecords, lineItems] = await Promise.all([
    api.get(`/api/inventory${locQuery}`),
    api.get(`/api/keg-tracking?accountId=${encodeURIComponent(order.AccountID)}`),
    api.get(`/api/order-items?orderId=${encodeURIComponent(orderId)}`),
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

  // Build order quantity map from line items, falling back to legacy RequestedProducts
  const orderQtyMap = {};
  if (lineItems.length) {
    for (const li of lineItems) {
      if (li.InventoryID) orderQtyMap[li.InventoryID] = (orderQtyMap[li.InventoryID] || 0) + parseInt(li.Quantity || 0);
    }
  } else {
    Object.assign(orderQtyMap, parseRequestedProducts(order.RequestedProducts, items));
  }

  // Split inventory into order products vs other products
  const orderProducts = items.filter(i => orderQtyMap[i.ID]);
  const otherProducts = items.filter(i => !orderQtyMap[i.ID]);

  const delivRow = (item, group) => {
    const stock = parseInt(item.Units || '0');
    const prefill = group === 'order' ? Math.min(orderQtyMap[item.ID] || 0, stock) : 0;
    const hidden = group === 'other';
    return `<tr data-stock="${group}"${hidden ? ' style="display:none"' : ''}>
            <td class="fw-600">${esc(item.Name)}</td>
            <td class="text-sm">${esc(item.Format) || '—'}</td>
            <td class="text-sm">${esc(item.Units)}</td>
            <td><input class="form-control" type="number" min="0" max="${stock}" value="${prefill}"
                 id="deliv-qty-${item.ID}" style="width:80px" /></td>
          </tr>`;
  };

  // Products section (only if inventory items exist)
  const productsSection = items.length ? `
    ${!orderProducts.length ? '<p class="text-muted text-sm" style="margin-bottom:8px">No products assigned to this order.</p>' : ''}
    <div class="table-wrap" style="margin-bottom:16px">
      <table>
        <thead><tr><th>Product</th><th>Format</th><th>In Stock</th><th>Qty Delivered</th></tr></thead>
        <tbody>
          ${orderProducts.map(i => delivRow(i, 'order')).join('')}
          ${otherProducts.map(i => delivRow(i, 'other')).join('')}
        </tbody>
      </table>
    </div>
    ${otherProducts.length ? `<div class="form-group">
      <label style="cursor:pointer">
        <input type="checkbox" id="deliv-show-other" style="margin-right:6px"
          onchange="document.querySelectorAll('#modal-overlay tr[data-stock=other]').forEach(r=>r.style.display=this.checked?'':'none')" />
        Show all products (${otherProducts.length} more)
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
        <thead><tr><th>Product</th><th>Format</th><th>Outstanding</th><th>Deposit</th><th>Returned</th></tr></thead>
        <tbody>
          ${outstandingKegs.map(k => {
            const outstanding = Math.max(0, (parseInt(k.Quantity)||0) - (parseInt(k.ReturnedQuantity)||0));
            const depPerUnit = parseFloat(k.DepositPerUnit) || 0;
            return `<tr>
              <td class="fw-600">${esc(k.ProductName)}</td>
              <td class="text-sm">${esc(k.Format) || '—'}</td>
              <td class="text-sm">${outstanding}</td>
              <td class="text-sm">${depPerUnit > 0 ? '$' + depPerUnit.toFixed(2) + '/keg' : '—'}</td>
              <td><input class="form-control" type="number" min="0" max="${outstanding}" value="0"
                   id="keg-ret-${k.ID}" style="width:80px" /></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    ${outstandingKegs.some(k => parseFloat(k.DepositPerUnit) > 0) ? `<div class="text-sm" style="margin-bottom:12px">
      <strong>Keg deposit refunds:</strong>
      <label class="checkbox-label" style="display:inline;margin-left:8px;margin-right:12px">
        <input type="radio" name="keg-deposit-dest" value="credit" checked /> Credit on account
      </label>
      <label class="checkbox-label" style="display:inline">
        <input type="radio" name="keg-deposit-dest" value="refund" /> Record refund only
      </label>
    </div>` : ''}` : '';

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

    // Add order line items for any extra products not originally on the order
    const extraItems = delivItems
      .filter(d => !orderQtyMap[d.inventoryId])
      .map(d => {
        const inv = items.find(i => i.ID === d.inventoryId);
        const price = parseFloat(inv?.PricePerUnit || 0);
        return {
          OrderID: orderId,
          InventoryID: d.inventoryId,
          ProductName: inv?.Name || d.name,
          Format: inv?.Format || '',
          Quantity: String(d.quantity),
          UnitPrice: String(price),
          LineTotal: String((price * d.quantity).toFixed(2)),
        };
      });
    if (extraItems.length) {
      await api.post('/api/order-items/bulk', { items: extraItems });
      // Update order amount (and tax if applicable) to include the extra products
      const extraTotal = extraItems.reduce((sum, ei) => sum + parseFloat(ei.LineTotal), 0);
      const currentAmount = parseFloat(order.OrderAmount || 0);
      const newAmount = currentAmount + extraTotal;
      const updates = { OrderAmount: String(newAmount.toFixed(2)) };
      const currentTax = parseFloat(order.TaxAmount || 0);
      if (currentTax > 0) {
        const taxRate = getTaxRate();
        if (taxRate > 0) {
          updates.TaxAmount = String((newAmount * taxRate).toFixed(2));
        }
      }
      await api.put(`/api/orders/${orderId}`, updates);
    }

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
    let totalDepositRefund = 0;
    for (const r of kegReturns) {
      const newReturnedTotal = (parseInt(r.keg.ReturnedQuantity) || 0) + r.returnQty;
      const combinedNotes = [r.keg.Notes, notes].filter(Boolean).join(' | ');
      const updates = {
        ReturnedQuantity: String(newReturnedTotal),
        ReturnedDate: today(),
        Notes: combinedNotes,
      };
      const depPerUnit = parseFloat(r.keg.DepositPerUnit) || 0;
      if (depPerUnit > 0) {
        const refundAmount = r.returnQty * depPerUnit;
        const existingRefunded = parseFloat(r.keg.DepositRefunded) || 0;
        updates.DepositRefunded = String((existingRefunded + refundAmount).toFixed(2));
        totalDepositRefund += refundAmount;
      }
      await api.put(`/api/keg-tracking/${r.keg.ID}`, updates);
    }

    const kegDepositDest = document.querySelector('input[name="keg-deposit-dest"]:checked')?.value;
    if (totalDepositRefund > 0 && kegDepositDest === 'credit') {
      await api.post('/api/credits', {
        accountId: order.AccountID,
        accountName: order.AccountName || '',
        type: 'credit',
        amount: totalDepositRefund.toFixed(2),
        orderId: orderId,
        reason: 'Keg deposit refund on delivery',
      });
    }

    modal.close();
    const parts = [];
    if (delivItems.length) parts.push('Delivery confirmed');
    if (kegReturns.length) {
      const totalReturned = kegReturns.reduce((sum, r) => sum + r.returnQty, 0);
      let returnMsg = `${totalReturned} keg${totalReturned !== 1 ? 's' : ''} returned`;
      if (totalDepositRefund > 0) {
        returnMsg += kegDepositDest === 'credit'
          ? ` · $${totalDepositRefund.toFixed(2)} credited to account`
          : ` · $${totalDepositRefund.toFixed(2)} deposit refunded`;
      }
      parts.push(returnMsg);
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
    const res = await fetch(BASE_PATH + '/api/orders/import', { method: 'POST', body: formData, headers: { 'X-Requested-With': 'XMLHttpRequest' } });
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
              <label>Phone</label>
              <input class="form-control form-control-sm" id="imp-phone-${idx}" value="${esc(p.phone)}" placeholder="Phone number" />
            </div>
            <div class="form-group">
              <label>Email</label>
              <input class="form-control form-control-sm" id="imp-email-${idx}" value="${esc(p.email)}" placeholder="Email address" />
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
      phone: val(`imp-phone-${idx}`) || '',
      email: val(`imp-email-${idx}`) || '',
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
