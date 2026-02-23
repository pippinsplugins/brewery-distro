'use strict';

let _mapInstance = null;
let _mapMarkers = [];
const _geocodeCache = {};

async function geocodeAddress(query) {
  if (_geocodeCache[query]) return _geocodeCache[query];
  try {
    const resp = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`
    );
    const data = await resp.json();
    if (data.length > 0) {
      const result = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
      _geocodeCache[query] = result;
      return result;
    }
  } catch (e) {
    console.warn('Geocode failed for:', query, e.message);
  }
  return null;
}

function buildAddressQuery(acct) {
  const parts = [];
  if (acct.Address) parts.push(acct.Address);
  if (acct.City)    parts.push(acct.City);
  if (acct.State)   parts.push(acct.State);
  if (acct.Zip)     parts.push(acct.Zip);
  return parts.join(', ');
}

function accountPopup(acct) {
  const addr = buildAddressQuery(acct);
  const typeBadge = acct.Type ? `<span class="text-muted text-sm">${esc(acct.Type)}</span>` : '';
  return `
    <div style="min-width:180px">
      <strong>${esc(acct.Name)}</strong> ${typeBadge}<br/>
      ${addr ? `<span class="text-sm">${esc(addr)}</span><br/>` : ''}
      ${acct.Phone ? `<span class="text-sm">${esc(acct.Phone)}</span><br/>` : ''}
      <button class="btn btn-ghost btn-sm" style="margin-top:4px"
        onclick="loadAccountProfile('${esc(acct.ID)}')">View Profile</button>
    </div>`;
}

async function loadMap() {
  if (state.accounts.length === 0) state.accounts = await api.get('/api/accounts');
  const accounts = state.accounts.filter(a => a.Status !== 'Inactive');

  setContent(`
    <div class="content-header">
      <h1>Account Map</h1>
      <div class="header-actions">
        <span id="map-status" class="text-muted text-sm"></span>
      </div>
    </div>
    <div id="map-container" style="height:calc(100vh - 140px);border-radius:8px;overflow:hidden;border:1px solid var(--border)"></div>`);

  // Clean up previous map instance
  if (_mapInstance) {
    _mapInstance.remove();
    _mapInstance = null;
  }
  _mapMarkers = [];

  // Initialize Leaflet map
  _mapInstance = L.map('map-container').setView([39.8283, -98.5795], 5);  // center US
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(_mapInstance);

  // Geocode and place markers
  const statusEl = document.getElementById('map-status');
  const geocodable = accounts.filter(a => buildAddressQuery(a));
  let placed = 0;
  let failed = 0;

  for (let i = 0; i < geocodable.length; i++) {
    const acct = geocodable[i];
    if (statusEl) statusEl.textContent = `Locating accounts... ${i + 1}/${geocodable.length}`;
    const query = buildAddressQuery(acct);
    const wasCached = !!_geocodeCache[query];
    const coords = await geocodeAddress(query);
    if (coords) {
      const marker = L.marker([coords.lat, coords.lng]).addTo(_mapInstance);
      marker.bindPopup(accountPopup(acct));
      _mapMarkers.push(marker);
      placed++;
    } else {
      failed++;
    }
    // Rate-limit Nominatim requests (1 per second policy for uncached)
    if (!wasCached && i < geocodable.length - 1) {
      await new Promise(r => setTimeout(r, 1100));
    }
  }

  // Fit map to markers
  if (_mapMarkers.length > 0) {
    const group = L.featureGroup(_mapMarkers);
    _mapInstance.fitBounds(group.getBounds().pad(0.1));
  }

  if (statusEl) {
    const parts = [`${placed} account${placed !== 1 ? 's' : ''} mapped`];
    if (failed) parts.push(`${failed} could not be located`);
    const noAddr = accounts.length - geocodable.length;
    if (noAddr) parts.push(`${noAddr} missing address`);
    statusEl.textContent = parts.join(' · ');
  }
}
