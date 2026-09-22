'use strict';

// Refunds — modal + list rendering. See issue #462.
// This slice records refund events only. Inventory restock, QBO sync,
// and store-credit interaction ship in subsequent PRs.

async function openRefundModal(orderId) {
  if (!canIssueRefunds()) { toast('Refunds are limited to Account Managers', 'error'); return; }
  const order = _ordersCache.find(o => o.ID === orderId);
  if (!order) { toast('Order not found in cache', 'error'); return; }
  let items, existing, kegs;
  try {
    [items, existing, kegs] = await Promise.all([
      api.get(`/api/order-items?orderId=${encodeURIComponent(orderId)}`),
      api.get(`/api/refunds?orderId=${encodeURIComponent(orderId)}`),
      api.get(`/api/keg-tracking?orderId=${encodeURIComponent(orderId)}`).catch(() => []),
    ]);
  } catch (err) {
    toast('Failed to load order data: ' + err.message, 'error'); return;
  }
  const isDelivered = order.Delivered === 'true';
  // Inventory IDs with outstanding keg tracking on this order (customer
  // still holds the kegs / their deposit). Used to warn the operator that
  // a refund alone won't reconcile the keg return — the existing Keg
  // Returns workflow still owns that side of the transaction.
  const outstandingKegInvIds = new Set(
    (kegs || [])
      .filter(k => (parseInt(k.Quantity || '0') - parseInt(k.ReturnedQuantity || '0')) > 0)
      .map(k => k.InventoryID)
  );

  // Aggregate already-refunded qty per original OrderItemID so the modal
  // can cap each line's stepper at (original - already refunded).
  const alreadyByItem = {};
  for (const r of existing) {
    for (const ri of (r.items || [])) {
      alreadyByItem[ri.OrderItemID] = (alreadyByItem[ri.OrderItemID] || 0) + parseInt(ri.Quantity || '0');
    }
  }
  const alreadyRefundedTotal = existing.reduce((s, r) => s + parseFloat(r.TotalAmount || '0'), 0);
  const orderTotal = parseFloat(order.OrderAmount || 0) + parseFloat(order.TaxAmount || 0) + parseFloat(order.DepositAmount || 0);
  const available = Math.max(0, orderTotal - alreadyRefundedTotal);

  // Filter out Account Credit "payment" line items — they represent a
  // credit application, not a sale, and shouldn't be refunded as a line.
  const refundable = items.filter(i => i.ProductName !== 'Account Credit');
  const anyRefundable = refundable.some(i => (parseInt(i.Quantity || '0') - (alreadyByItem[i.ID] || 0)) > 0);

  const html = `
    <div class="form-section-title">${esc(order.AccountName)} — Invoice ${esc(order.InvoiceNumber || order.ID.slice(0, 8))}</div>
    <p class="text-sm text-muted" style="margin:4px 0 12px">
      Original total: <strong>$${orderTotal.toFixed(2)}</strong>
      · Already refunded: <strong>$${alreadyRefundedTotal.toFixed(2)}</strong>
      · Available to refund: <strong>$${available.toFixed(2)}</strong>
    </p>

    ${!anyRefundable ? '<div class="info-banner warn" style="margin-bottom:12px">All line items on this order have been fully refunded.</div>' : ''}
    ${!isDelivered ? '<div class="info-banner warn" style="margin-bottom:12px">This order was never marked delivered — no inventory was ever decremented, so restock options are disabled.</div>' : ''}
    ${_refundWindowWarningHtml(order)}

    <div class="table-wrap" style="margin-bottom:14px">
      <table>
        <thead>
          <tr><th>Product</th><th>Format</th><th class="text-right">Original</th><th class="text-right">Refunded</th><th class="text-right" style="width:110px">Refund Qty</th><th class="text-right">Unit</th><th class="text-right">Line</th><th style="width:80px">Restock</th></tr>
        </thead>
        <tbody>
          ${refundable.map(i => {
            const origQty = parseInt(i.Quantity || '0');
            const already = alreadyByItem[i.ID] || 0;
            const remaining = Math.max(0, origQty - already);
            const unit = parseFloat(i.UnitPrice || 0);
            const canRestock = isDelivered && !!i.InventoryID;
            const isKeg = (i.Format || '').toLowerCase().includes('keg');
            return `<tr data-item-id="${esc(i.ID)}" data-taxable="${i.Taxable === 'true' ? '1' : '0'}" data-unit="${unit.toFixed(2)}" data-inv-id="${esc(i.InventoryID || '')}" data-keg="${isKeg ? '1' : '0'}">
              <td class="fw-600">${esc(i.ProductName)}</td>
              <td>${esc(i.Format || '—')}</td>
              <td class="text-right">${origQty}</td>
              <td class="text-right">${already || '—'}</td>
              <td class="text-right">
                <input type="number" class="form-control refund-qty" min="0" max="${remaining}" value="0"
                  ${remaining === 0 ? 'disabled' : ''}
                  style="width:90px;text-align:right"
                  oninput="_refundRecomputeTotals()" />
              </td>
              <td class="text-right">$${unit.toFixed(2)}</td>
              <td class="text-right refund-line-total">$0.00</td>
              <td class="text-center">
                ${canRestock
                  ? `<input type="checkbox" class="refund-restock" checked title="Add ${esc(i.ProductName)} back to inventory" />`
                  : '<span class="text-muted text-sm">—</span>'}
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>

    <div id="f-refund-keg-warning" class="info-banner warn" style="display:none;margin-bottom:12px">
      ⚠️ Kegs on this order haven't been fully returned yet. Refunding here reverses the sale but does <strong>not</strong> reconcile the keg deposit — record the return via <em>Keg Returns</em> if the customer is bringing the kegs back.
    </div>

    <div class="form-row">
      <div class="form-group">
        <label>Reason <span class="required">*</span></label>
        <select id="f-refund-reason" class="form-control">
          ${REFUND_REASONS.map(r => `<option value="${r}">${r}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Method <span class="required">*</span></label>
        <select id="f-refund-method" class="form-control" onchange="_refundToggleMethodHints()">
          ${REFUND_METHODS.map(m => `<option value="${m}"${m === 'Cash' ? ' selected' : ''}>${m}</option>`).join('')}
        </select>
      </div>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label>Reference <span id="f-refund-reference-req" class="text-muted text-sm">(check # / transaction id)</span></label>
        <input type="text" id="f-refund-reference" class="form-control" placeholder="" />
      </div>
      <div class="form-group">
        <label>Refund Date</label>
        <input type="date" id="f-refund-date" class="form-control" value="${today()}" />
      </div>
    </div>

    <div class="form-group">
      <label>Notes</label>
      <textarea id="f-refund-notes" class="form-control" rows="2" placeholder="Optional context"></textarea>
    </div>

    <div id="f-refund-method-hint" class="text-sm text-muted" style="margin-bottom:10px"></div>

    <hr class="form-divider" />
    <div class="text-right fw-600" style="font-size:16px">
      Subtotal: <span id="f-refund-subtotal">$0.00</span>
      · Tax: <span id="f-refund-tax">$0.00</span>
      · <span style="font-size:18px">Total: <span id="f-refund-total">$0.00</span></span>
    </div>
    <p class="text-sm text-muted" style="margin-top:8px">
      A ${(order.QboPaymentId ? 'RefundReceipt' : (order.QboInvoiceId ? 'CreditMemo' : 'refund'))} will be pushed to QuickBooks after saving.
    </p>
  `;

  // Keep the outstanding-keg lookup available to _refundRecomputeTotals,
  // which is invoked from oninput handlers with no closure over this scope.
  window._refundOutstandingKegs = outstandingKegInvIds;

  modal.open('Issue Refund', html, async () => {
    await submitRefund(orderId);
  }, 'Issue Refund');
  // Compute initial totals + method hint after DOM insertion; also disable
  // the submit button if the refund-window override is showing but unchecked.
  setTimeout(() => {
    _refundRecomputeTotals();
    _refundToggleMethodHints();
    _refundToggleOverrideButton();
  }, 0);
}

function _refundCollectItems() {
  const rows = Array.from(document.querySelectorAll('#modal-body tr[data-item-id]'));
  return rows.map(tr => {
    const qty = parseInt(tr.querySelector('.refund-qty').value || '0');
    const restockCb = tr.querySelector('.refund-restock');
    return {
      orderItemId: tr.dataset.itemId,
      quantity: qty,
      unitPrice: parseFloat(tr.dataset.unit),
      taxable: tr.dataset.taxable === '1',
      restock: !!(restockCb && restockCb.checked),
      isKeg: tr.dataset.keg === '1',
      invId: tr.dataset.invId,
    };
  }).filter(x => x.quantity > 0);
}

function _refundRecomputeTotals() {
  const rate = typeof getTaxRate === 'function' ? getTaxRate() : 0;
  let subtotal = 0, tax = 0;
  let anyOutstandingKegRefunded = false;
  const outstanding = window._refundOutstandingKegs || new Set();
  const rows = Array.from(document.querySelectorAll('#modal-body tr[data-item-id]'));
  for (const tr of rows) {
    const qty = parseInt(tr.querySelector('.refund-qty').value || '0');
    const unit = parseFloat(tr.dataset.unit || '0');
    const line = qty * unit;
    tr.querySelector('.refund-line-total').textContent = '$' + line.toFixed(2);
    subtotal += line;
    if (tr.dataset.taxable === '1') tax += line * rate;
    if (qty > 0 && tr.dataset.keg === '1' && outstanding.has(tr.dataset.invId)) {
      anyOutstandingKegRefunded = true;
    }
  }
  const $ = id => document.getElementById(id);
  if ($('f-refund-subtotal')) $('f-refund-subtotal').textContent = '$' + subtotal.toFixed(2);
  if ($('f-refund-tax'))      $('f-refund-tax').textContent      = '$' + tax.toFixed(2);
  if ($('f-refund-total'))    $('f-refund-total').textContent    = '$' + (subtotal + tax).toFixed(2);
  const warn = $('f-refund-keg-warning');
  if (warn) warn.style.display = anyOutstandingKegRefunded ? '' : 'none';
}

function _refundToggleMethodHints() {
  const method = val('f-refund-method');
  const hint = document.getElementById('f-refund-method-hint');
  const refReq = document.getElementById('f-refund-reference-req');
  if (!hint) return;
  const isCard = method === 'Credit Card' || method === 'ACH';
  const isStoreCredit = method === 'Store Credit';
  if (isCard) {
    hint.innerHTML = 'A RefundReceipt will be created in QuickBooks. For QBO Payments card/ACH refunds, verify the money movement in QuickBooks — some card refunds still need to be initiated from the Payments dashboard.';
    hint.className = 'text-sm text-muted';
  } else if (isStoreCredit) {
    hint.innerHTML = 'A matching account credit will be created automatically and appear on the account\'s credit balance.';
    hint.className = 'text-sm text-muted';
  } else {
    hint.textContent = '';
    hint.className = 'text-sm text-muted';
  }
  if (refReq) {
    refReq.textContent = method === 'Check' ? '(check # — required)' : method === 'Credit Card' || method === 'ACH' ? '(transaction id)' : '(optional)';
  }
}

async function submitRefund(orderId) {
  const items = _refundCollectItems();
  if (items.length === 0) { toast('Enter a quantity on at least one line', 'error'); return; }

  const method = val('f-refund-method');
  const reason = val('f-refund-reason');
  const reference = val('f-refund-reference').trim();
  const notes = val('f-refund-notes').trim();
  const refundDate = val('f-refund-date') || today();

  if (method === 'Check' && !reference) { toast('Check number is required for check refunds', 'error'); return; }

  const rate = typeof getTaxRate === 'function' ? getTaxRate() : 0;
  let subtotal = 0, tax = 0;
  for (const it of items) {
    const line = it.quantity * it.unitPrice;
    subtotal += line;
    if (it.taxable) tax += line * rate;
  }

  try {
    await api.post('/api/refunds', {
      orderId, refundDate, method, reference, reason, notes,
      restockInventory: items.some(i => i.restock),
      items: items.map(i => ({
        orderItemId: i.orderItemId, quantity: i.quantity, unitPrice: i.unitPrice, restock: i.restock,
      })),
      amount: subtotal.toFixed(2),
      taxAmount: tax.toFixed(2),
      depositAmount: '0',
    });
    modal.close();
    toast(`Refund of $${(subtotal + tax).toFixed(2)} recorded`);
    // Reload whichever view we're in so the new refund shows.
    if (state.view === 'account-profile') loadAccountProfile(state.accountProfileId);
    else if (state.view === 'orders')     loadOrders();
  } catch (err) {
    toast('Failed to record refund: ' + err.message, 'error');
  }
}

// Derived refund status label ('Refunded' if sum(refunds) covers the order
// total, 'Partially Refunded' otherwise). Empty string when nothing has
// been refunded. Uses the RefundedTotal/RefundCount fields the /api/orders
// enrichment adds. Callers render it as a small muted line under the
// amount so the primary Status badge (Paid/Pending/etc.) stays authoritative.
function refundStatusLabel(order) {
  const refunded = parseFloat(order.RefundedTotal || '0');
  if (refunded <= 0) return '';
  const orderTotal = parseFloat(order.OrderAmount || 0) + parseFloat(order.TaxAmount || 0) + parseFloat(order.DepositAmount || 0);
  return refunded + 0.005 >= orderTotal ? 'Refunded' : 'Partially Refunded';
}

function refundStatusBadgeHtml(order) {
  const label = refundStatusLabel(order);
  if (!label) return '';
  const cls = label === 'Refunded' ? 'badge-danger' : 'badge-neutral';
  return ` <span class="badge ${cls}" title="Refunded $${parseFloat(order.RefundedTotal || 0).toFixed(2)}">${label}</span>`;
}

// Rendered into the #order-refunds-slot inside the View Order modal.
function renderRefundListHtml(refunds) {
  if (!refunds || refunds.length === 0) return '<p class="text-sm text-muted">No refunds on this order yet.</p>';
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Date</th><th>Method</th><th>Reason</th><th>Reference</th><th>Staff</th><th>QBO</th><th class="text-right">Total</th></tr></thead>
        <tbody>
          ${refunds.map(r => `<tr>
            <td>${formatDate(r.RefundDate) || '—'}</td>
            <td>${esc(r.Method)}</td>
            <td>${esc(r.Reason)}</td>
            <td class="text-sm">${esc(r.Reference || '—')}</td>
            <td class="text-sm">${esc(r.StaffName || '—')}</td>
            <td>${_refundQboBadgeHtml(r)}</td>
            <td class="text-right fw-600">$${parseFloat(r.TotalAmount || 0).toFixed(2)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

// Render a soft-warning banner + override checkbox when the order is older
// than the configured refund window (defaults to 90 days). Empty string if
// the order is within window — no visual noise for the common case.
function _refundWindowWarningHtml(order) {
  const windowDays = parseInt(state.settings && state.settings.refundWindowDays) || 90;
  if (windowDays <= 0) return '';
  const orderDate = (order.OrderDate || '').substring(0, 10);
  if (!orderDate) return '';
  const ageDays = Math.floor((Date.now() - new Date(orderDate + 'T00:00:00').getTime()) / 86400000);
  if (ageDays <= windowDays) return '';
  return `
    <div class="info-banner warn" style="margin-bottom:12px">
      ⚠️ This order is <strong>${ageDays} days old</strong> — beyond the ${windowDays}-day standard refund window.
      Confirm below to proceed.
      <label style="display:block;margin-top:6px;font-weight:600;cursor:pointer">
        <input type="checkbox" id="f-refund-override-window" onchange="_refundToggleOverrideButton()" />
        I understand this order is outside the standard refund window
      </label>
    </div>`;
}

// Enable/disable the modal's confirm button based on the override checkbox.
function _refundToggleOverrideButton() {
  const cb = document.getElementById('f-refund-override-window');
  const btn = document.getElementById('modal-submit-btn');
  if (!btn) return;
  if (!cb) return; // no warning present → nothing to toggle
  btn.disabled = !cb.checked;
}

function _refundQboBadgeHtml(refund) {
  const s = refund.QboSyncStatus || '';
  if (s === 'synced')   return `<span class="badge badge-success" title="${esc(refund.QboRefundType || 'Synced')} ${esc(refund.QboRefundId || '')}">Synced</span>`;
  if (s === 'disabled') return '<span class="badge badge-neutral" title="QuickBooks is not connected">Off</span>';
  if (s === 'failed')   return `<span class="badge badge-danger" title="${esc(refund.QboSyncError || 'Sync failed')}">Failed</span>${canIssueRefunds() ? ` <button class="btn btn-ghost btn-sm" onclick="retryRefundQboSync('${esc(refund.ID)}')">Retry</button>` : ''}`;
  return '<span class="badge badge-neutral">Pending</span>';
}

async function retryRefundQboSync(refundId) {
  const slot = document.getElementById('order-refunds-slot');
  if (slot) slot.innerHTML = '<p class="text-sm text-muted">Retrying QuickBooks sync…</p>';
  try {
    const updated = await api.post(`/api/refunds/${encodeURIComponent(refundId)}/sync`);
    if (updated.QboSyncStatus === 'synced') toast('QuickBooks sync succeeded');
    else if (updated.QboSyncStatus === 'failed') toast('QuickBooks sync failed: ' + (updated.QboSyncError || 'unknown'), 'error');
    // Reload the list for the current order (derived from the refund).
    if (updated.OrderID) loadOrderRefundsIntoSlot(updated.OrderID);
  } catch (err) {
    toast('Retry failed: ' + err.message, 'error');
  }
}

async function loadOrderRefundsIntoSlot(orderId) {
  const slot = document.getElementById('order-refunds-slot');
  if (!slot) return;
  try {
    const refunds = await api.get(`/api/refunds?orderId=${encodeURIComponent(orderId)}`);
    slot.innerHTML = renderRefundListHtml(refunds);
  } catch (err) {
    slot.innerHTML = `<p class="text-sm text-danger">Failed to load refunds: ${esc(err.message)}</p>`;
  }
}
