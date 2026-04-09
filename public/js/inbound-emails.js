'use strict';

async function loadInboundEmails() {
  try {
    const emails = await api.get('/api/inbound-emails');
    renderInboundEmailQueue(emails);
  } catch (err) {
    toast('Failed to load email queue: ' + err.message, 'error');
  }
}

function renderInboundEmailQueue(emails) {
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
    if (e.Status === 'parsed') {
      actions += ` <button class="btn btn-ghost btn-sm" onclick="createOrderFromEmail('${esc(e.ID)}')">Create Order</button>`;
    }
    if (e.Status === 'order_created' && e.OrderID) {
      actions += ` <button class="btn btn-ghost btn-sm" onclick="viewEmailOrder('${esc(e.OrderID)}')">View Order</button>`;
    }
    if (e.Status !== 'order_created' && e.Status !== 'skipped') {
      actions += ` <button class="btn btn-ghost btn-sm" onclick="skipInboundEmail('${esc(e.ID)}')">Skip</button>`;
    }
    actions += ` <button class="btn btn-ghost btn-sm text-danger" onclick="deleteInboundEmail('${esc(e.ID)}')">Delete</button>`;

    return `<tr>
      <td>${esc(date)}<br><span class="text-sm text-muted">${esc(time)}</span></td>
      <td>${esc(e.FromName || e.From)}</td>
      <td>${esc(e.Subject)}</td>
      <td>${statusBadge(e.Status)}</td>
      <td>${actions}</td>
    </tr>`;
  }).join('');

  const html = `
    <div style="margin-bottom:12px;display:flex;justify-content:space-between;align-items:center">
      <p class="text-sm text-muted">${emails.length} email(s) in queue</p>
      <button class="btn btn-sm btn-secondary" onclick="loadInboundEmails()">Refresh</button>
    </div>
    ${emails.length === 0
      ? '<p class="empty-state">No emails in queue. Use "Poll Now" in settings to check for new emails.</p>'
      : `<div class="table-wrap"><table class="data-table">
          <thead><tr><th>Date</th><th>From</th><th>Subject</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>`
    }`;

  modal.open('Inbound Email Queue', html);
  // Hide submit button since this is display-only
  const submitBtn = document.getElementById('modal-submit-btn');
  if (submitBtn) submitBtn.style.display = 'none';
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
        parsedHtml = `
          <div style="margin-top:16px">
            <h4>Parsed Data <span class="badge ${confidenceBadge[parsed.confidence] || 'badge-neutral'}">${esc(parsed.confidence)} confidence</span></h4>
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

    const html = `
      <div class="form-row">
        <div class="form-group" style="flex:1"><label>From</label><p>${esc(email.FromName || email.From)}</p></div>
        <div class="form-group" style="flex:1"><label>Date</label><p>${email.ReceivedAt ? new Date(email.ReceivedAt).toLocaleString() : '—'}</p></div>
      </div>
      <div class="form-group"><label>Subject</label><p>${esc(email.Subject)}</p></div>
      <div class="form-group">
        <label>Body</label>
        <div style="background:var(--bg-secondary);padding:12px;border-radius:6px;max-height:200px;overflow-y:auto;white-space:pre-wrap;font-size:13px">${esc(email.Body)}</div>
      </div>
      ${errorHtml}
      ${parsedHtml}
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
