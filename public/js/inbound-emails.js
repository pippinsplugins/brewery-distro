'use strict';

let _inboundEmailFilter = '';  // '' = all, or a specific status

async function loadInboundEmails() {
  try {
    const pg = _pagination.inboundEmails;
    let url = `/api/inbound-emails?page=${pg.page}&perPage=${pg.perPage}`;
    if (_inboundEmailFilter) url += `&status=${encodeURIComponent(_inboundEmailFilter)}`;
    const data = await api.get(url);
    renderInboundEmailQueue(data.items, data.total);
  } catch (err) {
    toast('Failed to load email queue: ' + err.message, 'error');
  }
}

function renderInboundEmailQueue(emails, total) {
  const statusBadge = (s) => {
    const map = {
      pending: 'badge-neutral',
      parsed: 'badge-info',
      order_created: 'badge-success',
      skipped: 'badge-neutral',
      error: 'badge-danger',
    };
    return `<span class="badge ${map[s] || 'badge-neutral'}">${esc(s)}</span>`;
  };

  const rows = emails.map(e => {
    const date = e.ReceivedAt ? new Date(e.ReceivedAt).toLocaleDateString() : '';
    const time = e.ReceivedAt ? new Date(e.ReceivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    let actions = `<button class="btn btn-ghost btn-sm" onclick="viewInboundEmailDetail('${esc(e.ID)}')">Details</button>`;

    if (e.Status === 'pending' || e.Status === 'error') {
      actions += ` <button class="btn btn-ghost btn-sm" onclick="retryInboundEmail('${esc(e.ID)}')">Parse</button>`;
    }
    if (e.Status === 'parsed' || (e.Status === 'order_created' && e._orderMissing)) {
      actions += ` <button class="btn btn-ghost btn-sm" onclick="resetAndCreateOrder('${esc(e.ID)}')">Create Order</button>`;
    }
    if (e.Status === 'order_created' && e.OrderID && !e._orderMissing) {
      actions += ` <button class="btn btn-ghost btn-sm" onclick="viewEmailOrder('${esc(e.OrderID)}')">View Order</button>`;
    }
    if (e.Status !== 'order_created' && e.Status !== 'skipped') {
      actions += ` <button class="btn btn-ghost btn-sm" onclick="skipInboundEmail('${esc(e.ID)}')">Skip</button>`;
    }
    if (e.Status === 'order_created' && e._orderMissing) {
      actions += ` <button class="btn btn-ghost btn-sm" onclick="skipInboundEmail('${esc(e.ID)}')">Skip</button>`;
    }
    actions += ` <button class="btn btn-ghost btn-sm text-danger" onclick="deleteInboundEmail('${esc(e.ID)}')">Delete</button>`;

    return `<tr>
      <td>${esc(date)}<br><span class="text-sm text-muted">${esc(time)}</span></td>
      <td>${esc(e.FromName || e.From)}</td>
      <td>${esc(e.Subject)}</td>
      <td>${statusBadge(e.Status)}${e._orderMissing ? ' <span class="badge badge-danger" title="Linked order not found">Order missing</span>' : ''}${e.Status === 'parsed' && e._accountMatched === false ? ' <span class="badge badge-warning" title="Account not matched">No account</span>' : ''}</td>
      <td>${actions}</td>
    </tr>`;
  }).join('');

  // Status filter tabs
  const statuses = ['', 'pending', 'parsed', 'order_created', 'skipped', 'error'];
  const labels = { '': 'All', pending: 'Pending', parsed: 'Parsed', order_created: 'Orders Created', skipped: 'Skipped', error: 'Errors' };
  const filterTabs = statuses.map(s =>
    `<button class="btn btn-sm ${_inboundEmailFilter === s ? 'btn-primary' : 'btn-ghost'}" onclick="_setInboundEmailFilter('${s}')">${labels[s]}</button>`
  ).join('');

  // Pagination
  const pg = _pagination.inboundEmails;
  const totalPages = pg.perPage > 0 ? Math.max(1, Math.ceil(total / pg.perPage)) : 1;
  const showStart = total === 0 ? 0 : (pg.page - 1) * pg.perPage + 1;
  const showEnd = total === 0 ? 0 : Math.min(pg.page * pg.perPage, total);

  let pageNav = '';
  if (totalPages > 1) {
    const parts = [];
    if (pg.page > 1) parts.push(`<button class="btn btn-ghost btn-sm" onclick="_inboundEmailPage(${pg.page - 1})">&laquo;</button>`);
    let s = Math.max(1, pg.page - 2);
    let e = Math.min(totalPages, s + 4);
    s = Math.max(1, e - 4);
    if (s > 1) parts.push(`<button class="btn btn-ghost btn-sm" onclick="_inboundEmailPage(1)">1</button>`);
    if (s > 2) parts.push('<span class="pagination-ellipsis">&hellip;</span>');
    for (let i = s; i <= e; i++) {
      parts.push(`<button class="btn btn-sm ${i === pg.page ? 'btn-primary' : 'btn-ghost'}" onclick="_inboundEmailPage(${i})">${i}</button>`);
    }
    if (e < totalPages - 1) parts.push('<span class="pagination-ellipsis">&hellip;</span>');
    if (e < totalPages) parts.push(`<button class="btn btn-ghost btn-sm" onclick="_inboundEmailPage(${totalPages})">${totalPages}</button>`);
    if (pg.page < totalPages) parts.push(`<button class="btn btn-ghost btn-sm" onclick="_inboundEmailPage(${pg.page + 1})">&raquo;</button>`);
    pageNav = `<div class="pagination" style="margin-top:12px;display:flex;gap:4px;align-items:center;justify-content:center">${parts.join('')}</div>`;
  }

  const html = `
    <div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      ${filterTabs}
      <span style="margin-left:auto" class="text-sm text-muted">${showStart}–${showEnd} of ${total}</span>
      <button class="btn btn-sm btn-secondary" onclick="loadInboundEmails()">Refresh</button>
    </div>
    ${emails.length === 0
      ? '<p class="empty-state">No emails found' + (_inboundEmailFilter ? ' with this status' : '') + '.</p>'
      : `<div class="table-wrap"><table class="data-table">
          <thead><tr><th>Date</th><th>From</th><th>Subject</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>`
    }
    ${pageNav}`;

  modal.open('Inbound Email Queue', html);
  const submitBtn = document.getElementById('modal-submit-btn');
  if (submitBtn) submitBtn.style.display = 'none';
}

function _setInboundEmailFilter(status) {
  _inboundEmailFilter = status;
  _pagination.inboundEmails.page = 1;
  loadInboundEmails();
}

function _inboundEmailPage(page) {
  _pagination.inboundEmails.page = page;
  loadInboundEmails();
}

async function viewInboundEmailDetail(id) {
  try {
    const email = await api.get(`/api/inbound-emails/${id}`);
    let parsedHtml = '';

    if (email.ParsedData) {
      try {
        const parsed = JSON.parse(email.ParsedData);
        const confidenceBadge = {
          high: 'badge-success',
          medium: 'badge-warning',
          low: 'badge-danger',
        };
        const senderEmail = email.From ? ((email.From.match(/<([^>]+)>/) || [])[1] || email.From) : '';
        const accountWarning = (email._accountMatched === false)
          ? `<div style="background:var(--warning-bg, #fff3cd);border:1px solid var(--warning-border, #ffc107);padding:8px 12px;border-radius:6px;margin-top:12px;font-size:13px">
              <strong>Account not matched:</strong> No account found for ${senderEmail ? 'sender <strong>' + esc(senderEmail) + '</strong>' : 'this email'}${parsed.accountName ? ' or name "' + esc(parsed.accountName) + '"' : ''}. You can still create a draft order manually.
            </div>`
          : (email._accountMatched && email._accountMatchedName && email._accountMatchedName !== parsed.accountName
            ? `<div class="text-sm text-muted" style="margin-top:4px">Matched to: ${esc(email._accountMatchedName)}</div>`
            : '');

        parsedHtml = `
          <div style="margin-top:16px">
            <h4>Parsed Data <span class="badge ${confidenceBadge[parsed.confidence] || 'badge-neutral'}">${esc(parsed.confidence)} confidence</span></h4>
            ${accountWarning}
            <div class="form-row" style="margin-top:8px">
              <div class="form-group" style="flex:1"><label>Account</label><p>${esc(parsed.accountName || '—')}</p></div>
              <div class="form-group" style="flex:1"><label>Contact</label><p>${esc(parsed.contactName || '—')}</p></div>
              <div class="form-group" style="flex:1"><label>Delivery Date</label><p>${esc(parsed.deliveryDate || '—')}</p></div>
            </div>
            ${parsed.notes ? `<div class="form-group"><label>Notes</label><p>${esc(parsed.notes)}</p></div>` : ''}
            ${parsed.items && parsed.items.length > 0 ? `
              <table class="data-table" style="margin-top:8px">
                <thead><tr><th>Product</th><th>Format</th><th>Qty</th></tr></thead>
                <tbody>${parsed.items.map(i => `<tr>
                  <td>${esc(i.productName)}</td>
                  <td>${esc(i.format || '—')}</td>
                  <td>${esc(String(i.quantity))}</td>
                </tr>`).join('')}</tbody>
              </table>` : '<p class="text-sm text-muted">No items parsed.</p>'}
          </div>`;
      } catch {
        parsedHtml = '<p class="text-sm text-danger" style="margin-top:12px">Failed to display parsed data.</p>';
      }
    }

    const errorHtml = email.Error ? `<div class="text-sm text-danger" style="margin-top:8px">Error: ${esc(email.Error)}</div>` : '';
    const orderMissingHtml = email._orderMissing
      ? `<div style="background:#fde8e8;border:1px solid #e53e3e;padding:8px 12px;border-radius:6px;margin-top:8px;font-size:13px">
          <strong>Order not found:</strong> The linked order no longer exists. Click "Create Order" below to create a new one.
        </div>`
      : '';

    // Build action buttons for the detail view
    let detailActions = '';
    const btns = [];
    if (email.Status === 'pending' || email.Status === 'error') {
      btns.push(`<button class="btn btn-sm btn-secondary" onclick="retryInboundEmail('${esc(email.ID)}')">Parse</button>`);
    }
    if (email.Status === 'parsed' || (email.Status === 'order_created' && email._orderMissing)) {
      btns.push(`<button class="btn btn-sm btn-primary" onclick="resetAndCreateOrder('${esc(email.ID)}')">Create Order</button>`);
    }
    if (email.Status === 'order_created' && email.OrderID && !email._orderMissing) {
      btns.push(`<button class="btn btn-sm btn-secondary" onclick="viewEmailOrder('${esc(email.OrderID)}')">View Order</button>`);
    }
    if (email.Status !== 'order_created' && email.Status !== 'skipped') {
      btns.push(`<button class="btn btn-sm btn-ghost" onclick="skipInboundEmail('${esc(email.ID)}')">Skip</button>`);
    }
    if (email.Status === 'order_created' && email._orderMissing) {
      btns.push(`<button class="btn btn-sm btn-ghost" onclick="skipInboundEmail('${esc(email.ID)}')">Skip</button>`);
    }
    btns.push(`<button class="btn btn-sm btn-ghost" onclick="loadInboundEmails()">Back to Queue</button>`);
    if (btns.length > 0) {
      detailActions = `<div style="margin-top:16px;display:flex;gap:8px">${btns.join('')}</div>`;
    }

    const html = `
      <div class="form-row">
        <div class="form-group" style="flex:1"><label>From</label><p>${esc(email.FromName || email.From)}${email.From ? `<br><span class="text-sm text-muted">${esc(email.From)}</span>` : ''}</p></div>
        <div class="form-group" style="flex:1"><label>Date</label><p>${email.ReceivedAt ? new Date(email.ReceivedAt).toLocaleString() : '—'}</p></div>
      </div>
      <div class="form-group"><label>Subject</label><p>${esc(email.Subject)}</p></div>
      <div class="form-group">
        <label>Body</label>
        <div style="background:var(--bg-secondary);padding:12px;border-radius:6px;max-height:200px;overflow-y:auto;white-space:pre-wrap;font-size:13px">${esc(email.Body)}</div>
      </div>
      ${errorHtml}
      ${orderMissingHtml}
      ${parsedHtml}
      ${detailActions}
    `;

    modal.open('Email Detail', html);
    const submitBtn = document.getElementById('modal-submit-btn');
    if (submitBtn) submitBtn.style.display = 'none';
  } catch (err) {
    toast('Failed to load email: ' + err.message, 'error');
  }
}

async function retryInboundEmail(id) {
  try {
    toast('Parsing email...');
    await api.post(`/api/inbound-emails/${id}/retry`);
    toast('Email parsed successfully');
    loadInboundEmails();
  } catch (err) {
    toast('Parse error: ' + err.message, 'error');
  }
}

async function createOrderFromEmail(id) {
  try {
    toast('Creating draft order...');
    const result = await api.post(`/api/inbound-emails/${id}/create-order`);
    toast('Draft order created');
    loadInboundEmails();
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
}

async function resetAndCreateOrder(id) {
  try {
    // Reset to parsed first (clears stale OrderID if present)
    await api.put(`/api/inbound-emails/${id}/reset`);
    // Now create the order
    await createOrderFromEmail(id);
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
}

async function skipInboundEmail(id) {
  try {
    await api.put(`/api/inbound-emails/${id}/skip`);
    toast('Email marked as skipped');
    loadInboundEmails();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function viewEmailOrder(orderId) {
  modal.close();
  location.hash = 'orders';
  // Wait for orders view to load, then open the order
  const tryOpen = (attempts) => {
    if (attempts <= 0) return;
    if (typeof openEditOrder === 'function' && typeof _ordersCache !== 'undefined' && _ordersCache.length > 0) {
      openEditOrder(orderId);
    } else {
      setTimeout(() => tryOpen(attempts - 1), 200);
    }
  };
  tryOpen(15);
}

async function deleteInboundEmail(id) {
  modal.confirm('Delete Email', 'Delete this email from the queue?', async () => {
    try {
      await api.del(`/api/inbound-emails/${id}`);
      modal.close();
      toast('Email deleted');
      loadInboundEmails();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}
