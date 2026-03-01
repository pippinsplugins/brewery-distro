'use strict';

// ── Products View (location-independent catalog) ─────────────────

let _productsCache = [];
let _prodSort = { col: 'Name', dir: 'asc' };

function productForm(product = {}) {
  return `
    <div class="form-row">
      <div class="form-group">
        <label>Name <span class="required">*</span></label>
        <input class="form-control" id="f-name" value="${esc(product.Name)}" placeholder="e.g. Cascade IPA" />
      </div>
      <div class="form-group">
        <label>Style</label>
        <select class="form-control" id="f-style">
          <option value="">-- Select --</option>
          ${STYLES.map(s => `<option value="${s}" ${product.Style === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>ABV (%)</label>
        <input class="form-control" id="f-abv" type="number" step="0.1" min="0" max="20" value="${esc(product.ABV)}" placeholder="e.g. 6.5" />
      </div>
      <div class="form-group">
        <label>Format / Package</label>
        <select class="form-control" id="f-format">
          <option value="">-- Select --</option>
          ${FORMATS.map(f => `<option value="${f}" ${product.Format === f ? 'selected' : ''}>${f}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Price per Unit ($)</label>
        <input class="form-control" id="f-price" type="number" step="0.01" min="0" value="${esc(product.PricePerUnit)}" placeholder="0.00" />
      </div>
      <div class="form-group">
        <label>Keg Deposit ($)</label>
        <input class="form-control" id="f-deposit" type="number" step="0.01" min="0" value="${esc(product.DepositAmount)}" placeholder="0.00" />
      </div>
    </div>
    <div class="form-group">
      <label>Notes</label>
      <textarea class="form-control" id="f-notes" rows="2">${esc(product.Notes)}</textarea>
    </div>`;
}

async function loadProducts() {
  _paginationReset('products');
  showLoading();
  _productsCache = await api.get('/api/products');
  renderProducts();
}

function sortProducts(col) {
  _paginationReset('products');
  if (_prodSort.col === col) {
    _prodSort.dir = _prodSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    _prodSort.col = col;
    _prodSort.dir = 'asc';
  }
  renderProducts();
}

function renderProducts() {
  const items = _productsCache;
  const _focused = document.activeElement?.id;
  const search = (document.getElementById('prod-search') || {}).value || '';

  let filtered = items;
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(p =>
      (p.Name || '').toLowerCase().includes(q) ||
      (p.Style || '').toLowerCase().includes(q) ||
      (p.Format || '').toLowerCase().includes(q)
    );
  }

  // Sort
  const { col, dir } = _prodSort;
  filtered = [...filtered].sort((a, b) => {
    let av, bv;
    if (col === 'Name')       { av = (a.Name || '').toLowerCase();           bv = (b.Name || '').toLowerCase(); }
    else if (col === 'Style') { av = (a.Style || '').toLowerCase();          bv = (b.Style || '').toLowerCase(); }
    else if (col === 'ABV')   { av = parseFloat(a.ABV || 0);                 bv = parseFloat(b.ABV || 0); }
    else if (col === 'Format'){ av = (a.Format || '').toLowerCase();         bv = (b.Format || '').toLowerCase(); }
    else if (col === 'Price') { av = parseFloat(a.PricePerUnit || 0);        bv = parseFloat(b.PricePerUnit || 0); }
    else if (col === 'Deposit') { av = parseFloat(a.DepositAmount || 0);     bv = parseFloat(b.DepositAmount || 0); }
    if (av < bv) return dir === 'asc' ? -1 : 1;
    if (av > bv) return dir === 'asc' ? 1 : -1;
    return 0;
  });

  const pg = paginate(filtered, 'products');

  const th = (label, colKey) => {
    const active = _prodSort.col === colKey;
    const arrow = active ? (_prodSort.dir === 'asc' ? ' ▲' : ' ▼') : '';
    return `<th class="sortable-th${active ? ' sorted' : ''}" onclick="sortProducts('${colKey}')">${label}${arrow}</th>`;
  };

  setContent(`
    <div class="view-header">
      <div>
        <h2>Products</h2>
        <p class="subtitle">${items.length} product${items.length !== 1 ? 's' : ''} — shared across all locations</p>
      </div>
      <div class="view-header-actions">
        <button class="btn btn-primary" onclick="openAddProduct()">+ Add Product</button>
      </div>
    </div>
    <div class="filter-bar">
      <input type="search" id="prod-search" placeholder="Search products..." value="${esc(search)}" oninput="_paginationReset('products'); renderProducts()" />
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            ${th('Name', 'Name')}${th('Style', 'Style')}${th('ABV', 'ABV')}${th('Format', 'Format')}
            ${th('Price/Unit', 'Price')}${th('Deposit', 'Deposit')}<th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${pg.total === 0 ? `<tr><td colspan="7" class="empty-state">No products found. Add your first product!</td></tr>` :
            pg.rows.map(p => `<tr>
              <td class="fw-600"><span class="td-link" onclick="openEditProduct('${esc(p.ID)}')">${esc(p.Name)}</span></td>
              <td>${esc(p.Style) || '—'}</td>
              <td>${p.ABV ? esc(p.ABV) + '%' : '—'}</td>
              <td>${esc(p.Format) || '—'}</td>
              <td>${p.PricePerUnit ? '$' + esc(p.PricePerUnit) : '—'}</td>
              <td>${p.DepositAmount ? '$' + esc(p.DepositAmount) : '—'}</td>
              <td class="td-actions">
                <button class="btn btn-ghost btn-sm" onclick="openEditProduct('${esc(p.ID)}')">Edit</button>
                <button class="btn btn-ghost btn-sm text-danger" data-name="${esc(p.Name)}" onclick="deleteProduct('${esc(p.ID)}', this.dataset.name)">Delete</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${pg.total > 0 ? paginationControls('products', pg, 'renderProducts') : ''}`);
  if (_focused === 'prod-search') refocusSearch('prod-search');
}

function openAddProduct() {
  modal.open('Add Product', productForm(), async () => {
    const name = val('f-name');
    if (!name) { toast('Name is required', 'error'); return; }
    await api.post('/api/products', {
      Name: name,
      Style: val('f-style'),
      ABV: val('f-abv'),
      Format: val('f-format'),
      PricePerUnit: val('f-price'),
      DepositAmount: val('f-deposit'),
      Notes: val('f-notes'),
    });
    modal.close();
    toast('Product created at all locations');
    loadProducts();
  });
}

function openEditProduct(id) {
  const product = _productsCache.find(p => p.ID === id);
  if (!product) return;
  modal.open('Edit Product', productForm(product), async () => {
    const name = val('f-name');
    if (!name) { toast('Name is required', 'error'); return; }
    await api.put(`/api/products/${id}`, {
      Name: name,
      Style: val('f-style'),
      ABV: val('f-abv'),
      Format: val('f-format'),
      PricePerUnit: val('f-price'),
      DepositAmount: val('f-deposit'),
      Notes: val('f-notes'),
    });
    modal.close();
    toast('Product updated');
    loadProducts();
  });
}

function deleteProduct(id, name) {
  modal.confirm('Delete Product', `Delete "${name}" from all locations? This cannot be undone. Products with stock remaining cannot be deleted.`, async () => {
    try {
      await api.del(`/api/products/${id}`);
      modal.close();
      toast('Product deleted');
      loadProducts();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}
