'use strict';

// ── Products View (location-independent catalog) ─────────────────

let _productsCache = [];
let _productFormats = {}; // { productId: [{format, pricePerUnit}] }
let _prodSort = { col: 'Name', dir: 'asc' };
let _variationCounter = 0;

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
    </div>
    <hr class="form-divider" />
    <div class="form-section-title">Format Variations</div>
    <div id="variations-wrap"></div>
    <button type="button" class="btn btn-ghost btn-sm" onclick="addVariationRow('', '')" style="margin-top:4px">+ Add Format</button>
    <hr class="form-divider" />
    <div class="form-group">
      <label>Notes</label>
      <textarea class="form-control" id="f-notes" rows="2">${esc(product.Notes)}</textarea>
    </div>`;
}

function addVariationRow(format, price) {
  const wrap = document.getElementById('variations-wrap');
  if (!wrap) return;
  const id = _variationCounter++;
  const div = document.createElement('div');
  div.className = 'variation-row';
  div.id = `var-row-${id}`;
  div.style.cssText = 'display:flex;gap:12px;align-items:flex-end;margin-bottom:8px';
  div.innerHTML = `
    <div class="form-group" style="flex:1;margin-bottom:0">
      <label>Format</label>
      <select class="form-control" id="var-format-${id}">
        <option value="">-- Select --</option>
        ${FORMATS.map(f => `<option value="${f}" ${format === f ? 'selected' : ''}>${f}</option>`).join('')}
      </select>
    </div>
    <div class="form-group" style="flex:1;margin-bottom:0">
      <label>Price ($)</label>
      <input class="form-control" id="var-price-${id}" type="number" step="0.01" min="0" value="${esc(price)}" placeholder="0.00" />
    </div>
    <button type="button" class="btn btn-ghost btn-sm text-danger" onclick="removeVariationRow(this)" style="padding:8px;line-height:1">&times;</button>`;
  wrap.appendChild(div);
}

function removeVariationRow(btn) {
  const row = btn.closest('.variation-row');
  const wrap = document.getElementById('variations-wrap');
  if (wrap && wrap.querySelectorAll('.variation-row').length <= 1) {
    toast('At least one format is required', 'error');
    return;
  }
  if (row) row.remove();
}

function collectVariations() {
  const rows = document.querySelectorAll('#variations-wrap .variation-row');
  const variations = [];
  rows.forEach(row => {
    const select = row.querySelector('select');
    const input = row.querySelector('input[type="number"]');
    if (select && input) {
      variations.push({ format: select.value, pricePerUnit: input.value });
    }
  });
  return variations;
}

async function loadProducts(preservePage = false) {
  if (!preservePage) _paginationReset('products');
  showLoading();
  const [products, inventory] = await Promise.all([
    api.get('/api/products'),
    api.get('/api/inventory'),
  ]);
  _productsCache = products;

  // Build _productFormats map from inventory
  _productFormats = {};
  for (const inv of inventory) {
    if (!inv.ProductID) continue;
    if (!_productFormats[inv.ProductID]) _productFormats[inv.ProductID] = [];
    const fmt = inv.Format || '';
    const price = inv.PricePerUnit || '';
    // Deduplicate by format
    if (!_productFormats[inv.ProductID].some(v => v.format === fmt)) {
      _productFormats[inv.ProductID].push({ format: fmt, pricePerUnit: price });
    }
  }

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

function formatBadges(productId) {
  const vars = _productFormats[productId] || [];
  if (vars.length === 0) return '<span class="text-muted">—</span>';
  return vars.map(v => {
    const fmt = v.format || 'No format';
    const price = v.pricePerUnit ? `$${parseFloat(v.pricePerUnit).toFixed(2)}` : '';
    const label = price ? `${fmt} — ${price}` : fmt;
    return `<span class="badge badge-neutral" style="margin:2px 4px 2px 0">${esc(label)}</span>`;
  }).join('');
}

function renderProducts() {
  const items = _productsCache;
  const _focused = document.activeElement?.id;
  const search = (document.getElementById('prod-search') || {}).value || '';

  let filtered = items;
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(p => {
      if ((p.Name || '').toLowerCase().includes(q)) return true;
      if ((p.Style || '').toLowerCase().includes(q)) return true;
      // Search format badges
      const vars = _productFormats[p.ID] || [];
      return vars.some(v => (v.format || '').toLowerCase().includes(q));
    });
  }

  // Sort
  const { col, dir } = _prodSort;
  filtered = [...filtered].sort((a, b) => {
    let av, bv;
    if (col === 'Name')       { av = (a.Name || '').toLowerCase();           bv = (b.Name || '').toLowerCase(); }
    else if (col === 'Style') { av = (a.Style || '').toLowerCase();          bv = (b.Style || '').toLowerCase(); }
    else if (col === 'ABV')   { av = parseFloat(a.ABV || 0);                 bv = parseFloat(b.ABV || 0); }
    else if (col === 'Formats') {
      const af = (_productFormats[a.ID] || []).map(v => v.format).join(', ').toLowerCase();
      const bf = (_productFormats[b.ID] || []).map(v => v.format).join(', ').toLowerCase();
      av = af; bv = bf;
    }
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
            ${th('Name', 'Name')}${th('Style', 'Style')}${th('ABV', 'ABV')}${th('Formats', 'Formats')}<th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${pg.total === 0 ? `<tr><td colspan="5" class="empty-state">No products found. Add your first product!</td></tr>` :
            pg.rows.map(p => `<tr>
              <td class="fw-600"><span class="td-link" onclick="openEditProduct('${esc(p.ID)}')">${esc(p.Name)}</span></td>
              <td>${esc(p.Style) || '—'}</td>
              <td>${p.ABV ? esc(p.ABV) + '%' : '—'}</td>
              <td>${formatBadges(p.ID)}</td>
              <td class="td-actions">
                <button class="btn btn-ghost btn-sm mobile-actions-toggle" onclick="toggleMobileActions(event)">&#8230;</button>
                <div class="mobile-actions-menu">
                <button class="btn btn-ghost btn-sm" onclick="openEditProduct('${esc(p.ID)}')">Edit</button>
                <button class="btn btn-ghost btn-sm text-danger" data-name="${esc(p.Name)}" onclick="deleteProduct('${esc(p.ID)}', this.dataset.name)">Delete</button>
                </div>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${pg.total > 0 ? paginationControls('products', pg, 'renderProducts') : ''}`);
  if (_focused === 'prod-search') refocusSearch('prod-search');
}

function openAddProduct() {
  _variationCounter = 0;
  modal.open('Add Product', productForm(), async () => {
    const name = val('f-name');
    if (!name) { toast('Name is required', 'error'); return; }
    const variations = collectVariations();
    if (variations.length === 0) { toast('At least one format is required', 'error'); return; }
    await api.post('/api/products', {
      Name: name,
      Style: val('f-style'),
      ABV: val('f-abv'),
      Notes: val('f-notes'),
      variations,
    });
    modal.close();
    toast('Product created at all locations');
    loadProducts();
  });
  // Add one blank variation row after modal opens
  setTimeout(() => addVariationRow('', ''), 0);
}

async function openEditProduct(id) {
  const product = _productsCache.find(p => p.ID === id);
  if (!product) return;
  _variationCounter = 0;

  // Fetch current variations
  let existingVars = [];
  try {
    existingVars = await api.get(`/api/products/${id}/variations`);
  } catch { /* ignore */ }

  modal.open('Edit Product', productForm(product), async () => {
    const name = val('f-name');
    if (!name) { toast('Name is required', 'error'); return; }

    // Update product fields
    await api.put(`/api/products/${id}`, {
      Name: name,
      Style: val('f-style'),
      ABV: val('f-abv'),
      Notes: val('f-notes'),
    });

    // Diff variations: add new ones, remove deleted ones
    const newVars = collectVariations();
    const oldFormats = new Set(existingVars.map(v => v.format));
    const newFormats = new Set(newVars.map(v => v.format));

    // Add new variations
    for (const v of newVars) {
      if (!oldFormats.has(v.format)) {
        try {
          await api.post(`/api/products/${id}/variations`, v);
        } catch (err) {
          toast(`Could not add format "${v.format}": ${err.message}`, 'error');
        }
      }
    }

    // Remove deleted variations
    for (const v of existingVars) {
      if (!newFormats.has(v.format)) {
        try {
          await api.del(`/api/products/${id}/variations/${encodeURIComponent(v.format)}`);
        } catch (err) {
          toast(`Could not remove format "${v.format}": ${err.message}`, 'error');
        }
      }
    }

    // Update price changes on existing variations (update inventory rows directly)
    for (const v of newVars) {
      if (oldFormats.has(v.format)) {
        const old = existingVars.find(ev => ev.format === v.format);
        if (old && old.pricePerUnit !== v.pricePerUnit) {
          // Update price on all inventory rows for this product+format
          for (const loc of old.locations) {
            try {
              await api.put(`/api/inventory/${loc.inventoryId}`, { PricePerUnit: v.pricePerUnit });
            } catch { /* ignore */ }
          }
        }
      }
    }

    modal.close();
    toast('Product updated');
    loadProducts();
  });

  // Populate variation rows after modal opens
  setTimeout(() => {
    if (existingVars.length === 0) {
      addVariationRow('', '');
    } else {
      for (const v of existingVars) {
        addVariationRow(v.format, v.pricePerUnit);
      }
    }
  }, 0);
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
