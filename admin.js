/**
 * SADDAM IPTV - Administration Dashboard Logic (English LTR)
 * Full regeneration strictly following specification:
 * - Device Management: List, search, block/unblock, reset 6-digit key, unpair (safe from playlists).
 * - Playlist Management: CRUD for M3U and Xtream, connectivity testing, expiration tracking.
 * - Account & Access: Display Slot 1 & Slot 2 status without secret exposure, update credentials.
 * - Audit Logs: Inspect security events.
 * - Playlists belong to account: Device actions NEVER delete or modify playlists.
 */

// Administration State
const adminState = {
  admin: null,
  devices: [],
  playlists: [],
  auditLogs: [],
  activeTab: 'tabDevices',
  currentResetDeviceId: null,
  currentUnpairDeviceId: null,
  currentDeletePlaylistId: null
};

// ================= Initialization =================
document.addEventListener('DOMContentLoaded', () => {
  initAdminAuth();
  initTabs();
  initDevicesTab();
  initPlaylistsTab();
  initAccountsTab();
  initAuditTab();
  initModals();

  // Verify Admin Session
  checkAdminSession();
});

// ================= 1. Authentication Check =================
function initAdminAuth() {
  const btnLogout = document.getElementById('btnAdminLogout');
  if (btnLogout) {
    btnLogout.addEventListener('click', handleAdminLogout);
  }
}

async function checkAdminSession() {
  try {
    const res = await fetch('/api/v1/auth/me', {
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    });
    const data = await res.json();

    if (res.ok && data.success && data.admin) {
      adminState.admin = data.admin;
      const adminUsernameText = document.getElementById('adminUsernameText');
      if (adminUsernameText) {
        adminUsernameText.textContent = data.admin.username || 'Admin';
      }

      // Load initial data
      loadAdminDevices();
      loadAdminPlaylists();
      loadAccountOverview();
      loadAuditLogs();
    } else {
      window.location.href = 'index.html';
    }
  } catch (err) {
    window.location.href = 'index.html';
  }
}

async function handleAdminLogout() {
  try {
    await fetch('/api/v1/auth/logout', {
      method: 'POST',
      credentials: 'same-origin'
    });
  } catch (e) {
    // ignore
  }
  window.location.href = 'index.html';
}

// ================= 2. Tabs Navigation =================
function initTabs() {
  const tabButtons = document.querySelectorAll('.tab-btn');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      switchTab(targetTab);
    });
  });
}

function switchTab(tabId) {
  adminState.activeTab = tabId;

  // Update tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    if (btn.getAttribute('data-tab') === tabId) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Update tab panes
  document.querySelectorAll('.tab-pane').forEach(pane => {
    if (pane.id === tabId) {
      pane.classList.add('active');
    } else {
      pane.classList.remove('active');
    }
  });

  // Refresh data for active tab
  if (tabId === 'tabDevices') loadAdminDevices();
  else if (tabId === 'tabPlaylists') loadAdminPlaylists();
  else if (tabId === 'tabAccounts') loadAccountOverview();
  else if (tabId === 'tabAudit') loadAuditLogs();
}

// ================= 3. Devices Management Tab =================
function initDevicesTab() {
  const searchInput = document.getElementById('adminDeviceSearchInput');
  const statusFilter = document.getElementById('adminDeviceStatusFilter');
  const btnRefresh = document.getElementById('btnAdminRefreshDevices');

  if (searchInput) searchInput.addEventListener('input', filterAdminDevices);
  if (statusFilter) statusFilter.addEventListener('change', filterAdminDevices);
  if (btnRefresh) btnRefresh.addEventListener('click', loadAdminDevices);
}

async function loadAdminDevices() {
  const tbody = document.getElementById('adminDevicesTableBody');
  const countBadge = document.getElementById('devicesCountBadge');

  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="empty-state">
          <i class="fa-solid fa-spinner fa-spin"></i>
          <p>Loading registered devices...</p>
        </td>
      </tr>
    `;
  }

  try {
    const res = await fetch('/api/v1/admin/devices', {
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    });
    const result = await res.json();

    if (res.ok && result.success) {
      let list = [];
      if (Array.isArray(result.devices)) {
        list = result.devices;
      } else if (result.data && Array.isArray(result.data.devices)) {
        list = result.data.devices;
      }
      adminState.devices = list;
      if (countBadge) countBadge.textContent = String(list.length);
      renderAdminDevices(list);
    } else {
      if (tbody) {
        tbody.innerHTML = `
          <tr>
            <td colspan="8" class="empty-state">
              <i class="fa-solid fa-triangle-exclamation" style="color: var(--danger);"></i>
              <p>Failed to load devices: ${escapeHtml(result.error || 'Server error')}</p>
            </td>
          </tr>
        `;
      }
    }
  } catch (err) {
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" class="empty-state">
            <i class="fa-solid fa-triangle-exclamation" style="color: var(--danger);"></i>
            <p>Connection error loading devices.</p>
          </td>
        </tr>
      `;
    }
  }
}

function renderAdminDevices(devices) {
  const tbody = document.getElementById('adminDevicesTableBody');
  if (!tbody) return;

  if (!devices || devices.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="empty-state">
          <i class="fa-solid fa-tv"></i>
          <p>No registered devices match the filter.</p>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = devices.map(d => {
    const isBlocked = d.status === 'blocked' || d.status === 'disabled';
    const statusBadge = isBlocked
      ? '<span class="badge badge-danger">Blocked</span>'
      : '<span class="badge badge-success">Active</span>';

    const registered = d.created_at ? formatDate(d.created_at) : '-';
    const lastSeen = d.last_seen_at ? formatDate(d.last_seen_at) : '<span style="color: var(--text-dim);">Never</span>';

    return `
      <tr>
        <td><strong>${escapeHtml(d.device_label || d.label || 'Player Device')}</strong></td>
        <td><span class="code-font" style="font-weight: 600;">${escapeHtml(d.device_code || d.mac || '-')}</span></td>
        <td><span class="badge badge-dim">${escapeHtml(d.platform || 'Android')}</span></td>
        <td>${statusBadge}</td>
        <td>v${d.sync_version || 1}</td>
        <td>${registered}</td>
        <td>${lastSeen}</td>
        <td style="text-align: right; white-space: nowrap;">
          <button type="button" class="btn btn-secondary btn-sm" onclick="promptAdminResetKey(${d.id}, '${escapeJs(d.device_label || 'Device')}', '${escapeJs(d.device_code || '')}')" title="Reset Device KEY">
            <i class="fa-solid fa-key"></i>
            <span>Reset Key</span>
          </button>
          <button type="button" class="btn ${isBlocked ? 'btn-success' : 'btn-secondary'} btn-sm" onclick="adminToggleBlock(${d.id}, ${isBlocked})" title="${isBlocked ? 'Unblock device' : 'Block device'}">
            <i class="fa-solid ${isBlocked ? 'fa-lock-open' : 'fa-ban'}"></i>
            <span>${isBlocked ? 'Unblock' : 'Block'}</span>
          </button>
          <button type="button" class="btn btn-danger btn-sm" onclick="promptAdminUnpair(${d.id}, '${escapeJs(d.device_label || 'Device')}', '${escapeJs(d.device_code || '')}')" title="Unpair Device">
            <i class="fa-solid fa-trash"></i>
            <span>Unpair</span>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function filterAdminDevices() {
  const query = (document.getElementById('adminDeviceSearchInput')?.value || '').toLowerCase();
  const statusFilter = document.getElementById('adminDeviceStatusFilter')?.value || '';

  const filtered = adminState.devices.filter(d => {
    const name = (d.device_label || d.label || '').toLowerCase();
    const mac = (d.device_code || d.mac || '').toLowerCase();
    const matchesSearch = !query || name.includes(query) || mac.includes(query);

    let matchesStatus = true;
    if (statusFilter === 'active') {
      matchesStatus = d.status === 'active';
    } else if (statusFilter === 'blocked') {
      matchesStatus = d.status === 'blocked' || d.status === 'disabled';
    }

    return matchesSearch && matchesStatus;
  });

  renderAdminDevices(filtered);
}

// Reset Key
window.promptAdminResetKey = function(deviceId, name, mac) {
  adminState.currentResetDeviceId = deviceId;
  const modal = document.getElementById('adminResetKeyModal');
  const nameElem = document.getElementById('adminResetTargetName');
  const macElem = document.getElementById('adminResetTargetMac');
  const confirmView = document.getElementById('adminResetConfirmView');
  const resultView = document.getElementById('adminResetResultView');
  const btnCancel = document.getElementById('btnCancelAdminReset');
  const btnConfirm = document.getElementById('btnConfirmAdminReset');
  const btnDone = document.getElementById('btnDoneAdminReset');

  if (nameElem) nameElem.textContent = name;
  if (macElem) macElem.textContent = mac;
  if (confirmView) confirmView.classList.remove('hidden');
  if (resultView) resultView.classList.add('hidden');
  if (btnCancel) btnCancel.classList.remove('hidden');
  if (btnConfirm) btnConfirm.classList.remove('hidden');
  if (btnDone) btnDone.classList.add('hidden');

  if (modal) modal.classList.add('open');
};

async function executeAdminResetKey() {
  const deviceId = adminState.currentResetDeviceId;
  if (!deviceId) return;

  const btnConfirm = document.getElementById('btnConfirmAdminReset');
  if (btnConfirm) {
    btnConfirm.disabled = true;
    btnConfirm.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Resetting...';
  }

  try {
    const res = await fetch(`/api/v1/devices/${deviceId}/reset-key`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    });
    const data = await res.json();

    if (res.ok && data.success) {
      const confirmView = document.getElementById('adminResetConfirmView');
      const resultView = document.getElementById('adminResetResultView');
      const btnCancel = document.getElementById('btnCancelAdminReset');
      const btnDone = document.getElementById('btnDoneAdminReset');
      const keyElem = document.getElementById('adminModalNewKey');
      const copyText = document.getElementById('btnCopyAdminNewKeyText');

      if (confirmView) confirmView.classList.add('hidden');
      if (resultView) resultView.classList.remove('hidden');
      if (btnCancel) btnCancel.classList.add('hidden');
      if (btnConfirm) btnConfirm.classList.add('hidden');
      if (btnDone) btnDone.classList.remove('hidden');
      if (keyElem) keyElem.textContent = String(data.device_key || data.new_pin || '');
      if (copyText) copyText.textContent = 'Copy Device KEY';

      loadAdminDevices();
    } else {
      alert(data.error || 'Failed to reset key.');
      closeAdminResetModal();
    }
  } catch (err) {
    alert('Connection error resetting key.');
    closeAdminResetModal();
  } finally {
    if (btnConfirm) {
      btnConfirm.disabled = false;
      btnConfirm.innerHTML = 'Confirm Reset';
    }
  }
}

function closeAdminResetModal() {
  const modal = document.getElementById('adminResetKeyModal');
  if (modal) modal.classList.remove('open');
  adminState.currentResetDeviceId = null;
}

// Block / Unblock
window.adminToggleBlock = async function(deviceId, isCurrentlyBlocked) {
  const action = isCurrentlyBlocked ? 'unblock' : 'block';
  try {
    const res = await fetch(`/api/v1/devices/${deviceId}/${action}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    });
    const data = await res.json();
    if (res.ok && data.success) {
      loadAdminDevices();
    } else {
      alert(data.error || `Failed to ${action} device.`);
    }
  } catch (err) {
    alert(`Connection error trying to ${action} device.`);
  }
};

// Unpair
window.promptAdminUnpair = function(deviceId, name, mac) {
  adminState.currentUnpairDeviceId = deviceId;
  const modal = document.getElementById('adminUnpairModal');
  const nameElem = document.getElementById('adminUnpairTargetName');
  const macElem = document.getElementById('adminUnpairTargetMac');

  if (nameElem) nameElem.textContent = name;
  if (macElem) macElem.textContent = mac;
  if (modal) modal.classList.add('open');
};

async function executeAdminUnpair() {
  const deviceId = adminState.currentUnpairDeviceId;
  if (!deviceId) return;

  const btnConfirm = document.getElementById('btnConfirmAdminUnpair');
  if (btnConfirm) {
    btnConfirm.disabled = true;
    btnConfirm.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Unpairing...';
  }

  try {
    const res = await fetch(`/api/v1/devices/${deviceId}`, {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    });
    const data = await res.json();

    if (res.ok && data.success) {
      closeAdminUnpairModal();
      loadAdminDevices();
    } else {
      alert(data.error || 'Failed to unpair device.');
    }
  } catch (err) {
    alert('Connection error unpairing device.');
  } finally {
    if (btnConfirm) {
      btnConfirm.disabled = false;
      btnConfirm.innerHTML = 'Unpair Device';
    }
  }
}

function closeAdminUnpairModal() {
  const modal = document.getElementById('adminUnpairModal');
  if (modal) modal.classList.remove('open');
  adminState.currentUnpairDeviceId = null;
}

// ================= 4. Playlist Management Tab =================
function initPlaylistsTab() {
  const btnOpenAdd = document.getElementById('btnOpenAddPlaylist');
  const btnRefresh = document.getElementById('btnRefreshPlaylists');
  const searchInput = document.getElementById('playlistSearchInput');
  const typeFilter = document.getElementById('playlistTypeFilter');
  const statusFilter = document.getElementById('playlistStatusFilter');

  if (btnOpenAdd) btnOpenAdd.addEventListener('click', openAddPlaylistModal);
  if (btnRefresh) btnRefresh.addEventListener('click', loadAdminPlaylists);
  if (searchInput) searchInput.addEventListener('input', filterPlaylists);
  if (typeFilter) typeFilter.addEventListener('change', filterPlaylists);
  if (statusFilter) statusFilter.addEventListener('change', filterPlaylists);

  // Type change in modal form
  const typeSelect = document.getElementById('playlistTypeSelect');
  if (typeSelect) {
    typeSelect.addEventListener('change', () => {
      togglePlaylistFormType(typeSelect.value);
    });
  }

  // Save button in modal
  const btnSave = document.getElementById('btnSavePlaylist');
  if (btnSave) btnSave.addEventListener('click', handleSavePlaylist);

  // Connectivity test button in modal
  const btnTest = document.getElementById('btnTestPlaylistConnectivity');
  if (btnTest) btnTest.addEventListener('click', handleModalTestConnectivity);
}

function togglePlaylistFormType(type) {
  const groupM3u = document.getElementById('groupM3uFields');
  const groupXtream = document.getElementById('groupXtreamFields');
  if (type === 'xtream') {
    if (groupM3u) groupM3u.classList.add('hidden');
    if (groupXtream) groupXtream.classList.remove('hidden');
  } else {
    if (groupM3u) groupM3u.classList.remove('hidden');
    if (groupXtream) groupXtream.classList.add('hidden');
  }
}

async function loadAdminPlaylists() {
  const tbody = document.getElementById('playlistsTableBody');
  const countBadge = document.getElementById('playlistsCountBadge');

  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="empty-state">
          <i class="fa-solid fa-spinner fa-spin"></i>
          <p>Loading playlists...</p>
        </td>
      </tr>
    `;
  }

  try {
    const res = await fetch('/api/v1/playlists', {
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    });
    const result = await res.json();

    if (res.ok && result.success) {
      let list = [];
      if (Array.isArray(result.playlists)) {
        list = result.playlists;
      } else if (Array.isArray(result.sources)) {
        list = result.sources;
      } else if (result.data && Array.isArray(result.data.sources)) {
        list = result.data.sources;
      }
      adminState.playlists = list;
      if (countBadge) countBadge.textContent = String(list.length);
      renderPlaylists(list);
    } else {
      if (tbody) {
        tbody.innerHTML = `
          <tr>
            <td colspan="7" class="empty-state">
              <i class="fa-solid fa-triangle-exclamation" style="color: var(--danger);"></i>
              <p>Failed to load playlists: ${escapeHtml(result.error || 'Server error')}</p>
            </td>
          </tr>
        `;
      }
    }
  } catch (err) {
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="empty-state">
            <i class="fa-solid fa-triangle-exclamation" style="color: var(--danger);"></i>
            <p>Connection error loading playlists.</p>
          </td>
        </tr>
      `;
    }
  }
}

function renderPlaylists(playlists) {
  const tbody = document.getElementById('playlistsTableBody');
  if (!tbody) return;

  if (!playlists || playlists.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="empty-state">
          <i class="fa-solid fa-satellite-dish"></i>
          <p>No playlists found. Click "Add Playlist" to create one.</p>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = playlists.map(p => {
    const isM3u = p.source_type === 'm3u';
    const typeBadge = isM3u
      ? '<span class="badge badge-info">M3U</span>'
      : '<span class="badge" style="background: rgba(139, 92, 246, 0.15); color: #c4b5fd; border: 1px solid rgba(139, 92, 246, 0.35);">Xtream</span>';

    // Check expiration status
    let isExpired = false;
    let expFormatted = 'Never';
    if (p.expires_at) {
      try {
        let ts = typeof p.expires_at === 'number' ? p.expires_at : parseInt(p.expires_at, 10);
        if (ts && !isNaN(ts)) {
          if (ts < 10000000000) ts *= 1000;
          isExpired = Date.now() > ts;
          expFormatted = new Date(ts).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
        } else {
          expFormatted = String(p.expires_at);
        }
      } catch (e) {
        expFormatted = String(p.expires_at);
      }
    }

    const expBadge = isExpired
      ? `<span class="badge badge-danger">Expired (${expFormatted})</span>`
      : (p.expires_at ? `<span class="badge badge-success">${expFormatted}</span>` : '<span style="color: var(--text-dim);">No Expiry</span>');

    // Connectivity status
    let connStatusBadge = '<span class="badge badge-dim">Untested</span>';
    if (p.status === 'working') {
      connStatusBadge = '<span class="badge badge-success"><i class="fa-solid fa-check"></i> Working</span>';
    } else if (p.status === 'failed' || p.status === 'error') {
      connStatusBadge = '<span class="badge badge-danger"><i class="fa-solid fa-xmark"></i> Failed</span>';
    }

    const isEnabled = p.enabled !== 0 && p.enabled !== false && p.is_enabled !== false;

    // Mask URL for security display
    const displayUrl = p.server_url || '-';

    return `
      <tr>
        <td><strong>${escapeHtml(p.name)}</strong></td>
        <td>${typeBadge}</td>
        <td><span class="code-font" style="font-size: 0.82rem; color: var(--text-muted);">${escapeHtml(displayUrl.length > 40 ? displayUrl.substring(0, 40) + '...' : displayUrl)}</span></td>
        <td>${expBadge}</td>
        <td id="statusCell_${p.id}">${connStatusBadge}</td>
        <td>
          <button type="button" class="btn btn-sm ${isEnabled ? 'btn-success' : 'btn-outline'}" onclick="togglePlaylistEnabled(${p.id}, ${isEnabled})" title="${isEnabled ? 'Disable playlist' : 'Enable playlist'}">
            <i class="fa-solid ${isEnabled ? 'fa-toggle-on' : 'fa-toggle-off'}"></i>
            <span>${isEnabled ? 'Active' : 'Off'}</span>
          </button>
        </td>
        <td style="text-align: right; white-space: nowrap;">
          <button type="button" class="btn btn-secondary btn-sm" onclick="testPlaylistRow(${p.id})" id="btnTestRow_${p.id}" title="Test Connectivity">
            <i class="fa-solid fa-vial"></i>
            <span>Test</span>
          </button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="openEditPlaylistModal(${p.id})" title="Edit Playlist">
            <i class="fa-solid fa-pen-to-square"></i>
            <span>Edit</span>
          </button>
          <button type="button" class="btn btn-danger btn-sm" onclick="promptDeletePlaylist(${p.id}, '${escapeJs(p.name)}')" title="Delete Playlist">
            <i class="fa-solid fa-trash"></i>
            <span>Delete</span>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function filterPlaylists() {
  const query = (document.getElementById('playlistSearchInput')?.value || '').toLowerCase();
  const typeFilter = document.getElementById('playlistTypeFilter')?.value || '';
  const statusFilter = document.getElementById('playlistStatusFilter')?.value || '';

  const filtered = adminState.playlists.filter(p => {
    const name = (p.name || '').toLowerCase();
    const url = (p.server_url || '').toLowerCase();
    const matchesSearch = !query || name.includes(query) || url.includes(query);

    let matchesType = true;
    if (typeFilter) {
      matchesType = (p.source_type || '').toLowerCase() === typeFilter;
    }

    let matchesStatus = true;
    if (statusFilter === 'active') {
      matchesStatus = p.status !== 'expired' && !isPlaylistDateExpired(p.expires_at);
    } else if (statusFilter === 'expired') {
      matchesStatus = p.status === 'expired' || isPlaylistDateExpired(p.expires_at);
    }

    return matchesSearch && matchesType && matchesStatus;
  });

  renderPlaylists(filtered);
}

function isPlaylistDateExpired(exp) {
  if (!exp) return false;
  try {
    let ts = typeof exp === 'number' ? exp : parseInt(exp, 10);
    if (ts && !isNaN(ts)) {
      if (ts < 10000000000) ts *= 1000;
      return Date.now() > ts;
    }
  } catch (e) {}
  return false;
}

// Playlist Form & Modal
function openAddPlaylistModal() {
  const modal = document.getElementById('playlistModal');
  const title = document.getElementById('playlistModalTitle');
  const editId = document.getElementById('playlistEditId');
  const nameInput = document.getElementById('playlistNameInput');
  const typeSelect = document.getElementById('playlistTypeSelect');
  const m3uInput = document.getElementById('playlistM3uUrlInput');
  const serverInput = document.getElementById('playlistServerUrlInput');
  const userInput = document.getElementById('playlistUsernameInput');
  const passInput = document.getElementById('playlistPasswordInput');
  const expInput = document.getElementById('playlistExpiresAtInput');
  const alertBox = document.getElementById('playlistModalAlert');

  if (title) title.innerHTML = '<i class="fa-solid fa-satellite-dish" style="color: var(--primary);"></i> <span>Add New Playlist</span>';
  if (editId) editId.value = '';
  if (nameInput) nameInput.value = '';
  if (typeSelect) typeSelect.value = 'm3u';
  if (m3uInput) m3uInput.value = '';
  if (serverInput) serverInput.value = '';
  if (userInput) userInput.value = '';
  if (passInput) passInput.value = '';
  if (expInput) expInput.value = '';
  hideAlert(alertBox);

  togglePlaylistFormType('m3u');
  if (modal) modal.classList.add('open');
}

window.openEditPlaylistModal = function(id) {
  const item = adminState.playlists.find(p => p.id === id);
  if (!item) return;

  const modal = document.getElementById('playlistModal');
  const title = document.getElementById('playlistModalTitle');
  const editId = document.getElementById('playlistEditId');
  const nameInput = document.getElementById('playlistNameInput');
  const typeSelect = document.getElementById('playlistTypeSelect');
  const m3uInput = document.getElementById('playlistM3uUrlInput');
  const serverInput = document.getElementById('playlistServerUrlInput');
  const userInput = document.getElementById('playlistUsernameInput');
  const passInput = document.getElementById('playlistPasswordInput');
  const expInput = document.getElementById('playlistExpiresAtInput');
  const alertBox = document.getElementById('playlistModalAlert');

  if (title) title.innerHTML = '<i class="fa-solid fa-pen-to-square" style="color: var(--primary);"></i> <span>Edit Playlist</span>';
  if (editId) editId.value = String(item.id);
  if (nameInput) nameInput.value = item.name || '';
  if (typeSelect) typeSelect.value = item.source_type || 'm3u';

  if (item.source_type === 'xtream') {
    if (serverInput) serverInput.value = item.server_url || '';
    if (userInput) userInput.value = item.username || '';
    if (passInput) passInput.value = item.password || '';
    if (m3uInput) m3uInput.value = '';
    togglePlaylistFormType('xtream');
  } else {
    if (m3uInput) m3uInput.value = item.server_url || '';
    if (serverInput) serverInput.value = '';
    if (userInput) userInput.value = '';
    if (passInput) passInput.value = '';
    togglePlaylistFormType('m3u');
  }

  // Expiration date
  if (expInput) {
    if (item.expires_at) {
      try {
        let ts = typeof item.expires_at === 'number' ? item.expires_at : parseInt(item.expires_at, 10);
        if (ts && !isNaN(ts)) {
          if (ts < 10000000000) ts *= 1000;
          expInput.value = new Date(ts).toISOString().split('T')[0];
        } else {
          expInput.value = '';
        }
      } catch (e) {
        expInput.value = '';
      }
    } else {
      expInput.value = '';
    }
  }

  hideAlert(alertBox);
  if (modal) modal.classList.add('open');
};

async function handleSavePlaylist() {
  const editId = document.getElementById('playlistEditId')?.value;
  const name = document.getElementById('playlistNameInput')?.value.trim();
  const type = document.getElementById('playlistTypeSelect')?.value;
  const alertBox = document.getElementById('playlistModalAlert');
  const btnSave = document.getElementById('btnSavePlaylist');

  let serverUrl = '';
  let username = '';
  let password = '';

  if (type === 'xtream') {
    serverUrl = document.getElementById('playlistServerUrlInput')?.value.trim() || '';
    username = document.getElementById('playlistUsernameInput')?.value.trim() || '';
    password = document.getElementById('playlistPasswordInput')?.value.trim() || '';
  } else {
    serverUrl = document.getElementById('playlistM3uUrlInput')?.value.trim() || '';
  }

  const expDate = document.getElementById('playlistExpiresAtInput')?.value;
  let expiresAtTimestamp = null;
  if (expDate) {
    try {
      expiresAtTimestamp = Math.floor(new Date(expDate).getTime() / 1000);
    } catch (e) {}
  }

  if (!name || !serverUrl) {
    showAlert(alertBox, 'Please provide both playlist name and URL.');
    return;
  }

  hideAlert(alertBox);
  if (btnSave) {
    btnSave.disabled = true;
    btnSave.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
  }

  const payload = {
    name,
    source_type: type,
    server_url: serverUrl,
    username,
    password,
    expires_at: expiresAtTimestamp
  };

  try {
    let url = '/api/v1/playlists';
    let method = 'POST';

    if (editId) {
      url = `/api/v1/playlists/${editId}/update`;
    }

    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      credentials: 'same-origin',
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (res.ok && data.success) {
      closePlaylistModal();
      loadAdminPlaylists();
    } else {
      showAlert(alertBox, data.error || 'Failed to save playlist.');
    }
  } catch (err) {
    showAlert(alertBox, 'Connection error saving playlist.');
  } finally {
    if (btnSave) {
      btnSave.disabled = false;
      btnSave.innerHTML = 'Save Playlist';
    }
  }
}

async function handleModalTestConnectivity() {
  const type = document.getElementById('playlistTypeSelect')?.value;
  let serverUrl = type === 'xtream'
    ? document.getElementById('playlistServerUrlInput')?.value.trim()
    : document.getElementById('playlistM3uUrlInput')?.value.trim();

  const alertBox = document.getElementById('playlistModalAlert');
  const btnTest = document.getElementById('btnTestPlaylistConnectivity');

  if (!serverUrl) {
    showAlert(alertBox, 'Please enter a server or stream URL before testing.');
    return;
  }

  if (btnTest) {
    btnTest.disabled = true;
    btnTest.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Testing...';
  }

  // If editing an existing playlist, call the backend test endpoint
  const editId = document.getElementById('playlistEditId')?.value;
  if (editId) {
    try {
      const res = await fetch(`/api/v1/playlists/${editId}/test`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Accept': 'application/json' }
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showSuccessAlert(alertBox, `Connectivity successful! ${data.message || 'Stream reachable.'}`);
      } else {
        showAlert(alertBox, `Connectivity failed: ${data.message || data.error || 'Host unreachable'}`);
      }
    } catch (e) {
      showAlert(alertBox, 'Failed to test stream endpoint.');
    } finally {
      if (btnTest) {
        btnTest.disabled = false;
        btnTest.innerHTML = '<i class="fa-solid fa-vial"></i> <span>Test Connectivity</span>';
      }
    }
  } else {
    // For new unsaved playlist, advise saving first
    showAlert(alertBox, 'Save the playlist first to perform full server-side connectivity verification.');
    if (btnTest) {
      btnTest.disabled = false;
      btnTest.innerHTML = '<i class="fa-solid fa-vial"></i> <span>Test Connectivity</span>';
    }
  }
}

window.testPlaylistRow = async function(id) {
  const btn = document.getElementById(`btnTestRow_${id}`);
  const statusCell = document.getElementById(`statusCell_${id}`);

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
  }
  if (statusCell) {
    statusCell.innerHTML = '<span class="badge badge-dim"><i class="fa-solid fa-spinner fa-spin"></i> Testing...</span>';
  }

  try {
    const res = await fetch(`/api/v1/playlists/${id}/test`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    });
    const data = await res.json();

    if (res.ok && data.success) {
      if (statusCell) {
        statusCell.innerHTML = '<span class="badge badge-success"><i class="fa-solid fa-check"></i> Working</span>';
      }
    } else {
      if (statusCell) {
        statusCell.innerHTML = `<span class="badge badge-danger" title="${escapeHtml(data.message || data.error || '')}"><i class="fa-solid fa-xmark"></i> Failed</span>`;
      }
    }
  } catch (err) {
    if (statusCell) {
      statusCell.innerHTML = '<span class="badge badge-danger"><i class="fa-solid fa-xmark"></i> Error</span>';
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-vial"></i> <span>Test</span>';
    }
  }
};

window.togglePlaylistEnabled = async function(id, isCurrentlyEnabled) {
  try {
    const res = await fetch(`/api/v1/playlists/${id}/toggle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      credentials: 'same-origin',
      body: JSON.stringify({ enabled: !isCurrentlyEnabled })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      loadAdminPlaylists();
    } else {
      alert(data.error || 'Failed to toggle playlist state.');
    }
  } catch (err) {
    alert('Connection error toggling playlist.');
  }
};

window.promptDeletePlaylist = function(id, name) {
  adminState.currentDeletePlaylistId = id;
  const modal = document.getElementById('deletePlaylistModal');
  const nameElem = document.getElementById('deleteTargetPlaylistName');
  if (nameElem) nameElem.textContent = name;
  if (modal) modal.classList.add('open');
};

async function executeDeletePlaylist() {
  const id = adminState.currentDeletePlaylistId;
  if (!id) return;

  const btnConfirm = document.getElementById('btnConfirmDeletePlaylist');
  if (btnConfirm) {
    btnConfirm.disabled = true;
    btnConfirm.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Deleting...';
  }

  try {
    const res = await fetch(`/api/v1/playlists/${id}`, {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    });
    const data = await res.json();

    if (res.ok && data.success) {
      closeDeletePlaylistModal();
      loadAdminPlaylists();
    } else {
      alert(data.error || 'Failed to delete playlist.');
    }
  } catch (err) {
    alert('Connection error deleting playlist.');
  } finally {
    if (btnConfirm) {
      btnConfirm.disabled = false;
      btnConfirm.innerHTML = 'Delete Playlist';
    }
  }
}

function closePlaylistModal() {
  const modal = document.getElementById('playlistModal');
  if (modal) modal.classList.remove('open');
}

function closeDeletePlaylistModal() {
  const modal = document.getElementById('deletePlaylistModal');
  if (modal) modal.classList.remove('open');
  adminState.currentDeletePlaylistId = null;
}

// ================= 5. Account & Access Tab =================
function initAccountsTab() {
  const updateForm = document.getElementById('updateAccountForm');
  if (updateForm) {
    updateForm.addEventListener('submit', handleUpdateAccount);
  }
}

async function loadAccountOverview() {
  try {
    const res = await fetch('/api/v1/auth/accounts-overview', {
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    });
    const data = await res.json();
    if (res.ok && data.success && data.slots) {
      const slot1 = data.slots.slot_1;
      const slot2 = data.slots.slot_2;

      if (slot1) {
        const u1 = document.getElementById('slot1UsernameText');
        const b1 = document.getElementById('slot1StatusBadge');
        if (u1 && slot1.username) u1.textContent = slot1.username;
        if (b1) {
          b1.className = slot1.configured ? 'badge badge-success' : 'badge badge-danger';
          b1.textContent = slot1.configured ? 'Configured' : 'Unconfigured';
        }
      }

      if (slot2) {
        const u2 = document.getElementById('slot2UsernameText');
        const b2 = document.getElementById('slot2StatusBadge');
        if (u2 && slot2.username) u2.textContent = slot2.username;
        if (b2) {
          b2.className = slot2.configured ? 'badge badge-success' : 'badge badge-danger';
          b2.textContent = slot2.configured ? 'Configured' : 'Unconfigured';
        }
      }
    }
  } catch (e) {
    // ignore
  }
}

async function handleUpdateAccount(e) {
  e.preventDefault();
  const curPass = document.getElementById('currentPasswordInput')?.value.trim();
  const newUser = document.getElementById('newUsernameInput')?.value.trim();
  const newPass = document.getElementById('newPasswordInput')?.value.trim();
  const confirmPass = document.getElementById('confirmPasswordInput')?.value.trim();
  const alertBox = document.getElementById('accountUpdateAlert');
  const btnSubmit = document.getElementById('btnUpdateAccountSubmit');

  if (!curPass || !newPass) {
    showAlert(alertBox, 'Current password and new password are required.');
    return;
  }

  if (newPass.length < 8) {
    showAlert(alertBox, 'New password must be at least 8 characters long.');
    return;
  }

  if (newPass !== confirmPass) {
    showAlert(alertBox, 'New password and confirmation do not match.');
    return;
  }

  hideAlert(alertBox);
  if (btnSubmit) {
    btnSubmit.disabled = true;
    btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
  }

  try {
    const res = await fetch('/api/v1/auth/update-account', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      credentials: 'same-origin',
      body: JSON.stringify({
        current_password: curPass,
        new_username: newUser,
        new_password: newPass
      })
    });
    const data = await res.json();

    if (res.ok && data.success) {
      showSuccessAlert(alertBox, data.message || 'Credentials updated successfully.');
      document.getElementById('currentPasswordInput').value = '';
      document.getElementById('newPasswordInput').value = '';
      document.getElementById('confirmPasswordInput').value = '';
      if (data.admin && data.admin.username) {
        const adminUsernameText = document.getElementById('adminUsernameText');
        if (adminUsernameText) adminUsernameText.textContent = data.admin.username;
      }
      loadAccountOverview();
    } else {
      showAlert(alertBox, data.error || 'Failed to update credentials.');
    }
  } catch (err) {
    showAlert(alertBox, 'Connection error updating account.');
  } finally {
    if (btnSubmit) {
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = '<i class="fa-solid fa-check"></i> <span>Save Changes</span>';
    }
  }
}

// ================= 6. Audit Activity Tab =================
function initAuditTab() {
  const searchInput = document.getElementById('auditSearchInput');
  const btnRefresh = document.getElementById('btnRefreshAudit');
  if (searchInput) searchInput.addEventListener('input', filterAuditLogs);
  if (btnRefresh) btnRefresh.addEventListener('click', loadAuditLogs);
}

async function loadAuditLogs() {
  const tbody = document.getElementById('auditTableBody');
  const countBadge = document.getElementById('auditCountBadge');

  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-state">
          <i class="fa-solid fa-spinner fa-spin"></i>
          <p>Loading audit activity logs...</p>
        </td>
      </tr>
    `;
  }

  try {
    const res = await fetch('/api/v1/admin/audit-logs?limit=50', {
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    });
    const result = await res.json();

    if (res.ok && result.success && result.data) {
      const logs = result.data.logs || [];
      adminState.auditLogs = logs;
      if (countBadge) countBadge.textContent = String(logs.length);
      renderAuditLogs(logs);
    } else {
      if (tbody) {
        tbody.innerHTML = `
          <tr>
            <td colspan="6" class="empty-state">
              <i class="fa-solid fa-triangle-exclamation" style="color: var(--danger);"></i>
              <p>Failed to load audit logs.</p>
            </td>
          </tr>
        `;
      }
    }
  } catch (err) {
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="empty-state">
            <i class="fa-solid fa-triangle-exclamation" style="color: var(--danger);"></i>
            <p>Connection error loading audit logs.</p>
          </td>
        </tr>
      `;
    }
  }
}

function renderAuditLogs(logs) {
  const tbody = document.getElementById('auditTableBody');
  if (!tbody) return;

  if (!logs || logs.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-state">
          <i class="fa-solid fa-clock-rotate-left"></i>
          <p>No audit activity records found.</p>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = logs.map(l => {
    let detailsStr = '-';
    if (l.details_json) {
      try {
        const parsed = typeof l.details_json === 'string' ? JSON.parse(l.details_json) : l.details_json;
        detailsStr = Object.entries(parsed).map(([k, v]) => `${k}: ${v}`).join(', ');
      } catch (e) {
        detailsStr = String(l.details_json);
      }
    }

    return `
      <tr>
        <td style="white-space: nowrap;">${formatDate(l.created_at)}</td>
        <td><span class="badge badge-dim">${escapeHtml(l.actor_type)}:${escapeHtml(l.actor_id)}</span></td>
        <td><strong>${escapeHtml(l.action)}</strong></td>
        <td>${escapeHtml(l.target_type || '-')}</td>
        <td><span class="code-font" style="font-size: 0.82rem;">${escapeHtml(l.target_id || '-')}</span></td>
        <td style="font-size: 0.8rem; color: var(--text-dim); max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(detailsStr)}</td>
      </tr>
    `;
  }).join('');
}

function filterAuditLogs() {
  const query = (document.getElementById('auditSearchInput')?.value || '').toLowerCase();
  if (!query) {
    renderAuditLogs(adminState.auditLogs);
    return;
  }
  const filtered = adminState.auditLogs.filter(l => {
    const act = (l.action || '').toLowerCase();
    const actor = (l.actor_id || '').toLowerCase();
    const target = (l.target_id || '').toLowerCase();
    const details = (l.details_json || '').toLowerCase();
    return act.includes(query) || actor.includes(query) || target.includes(query) || details.includes(query);
  });
  renderAuditLogs(filtered);
}

// ================= 7. Modal Listeners =================
function initModals() {
  // Playlist Modal
  const btnClosePlaylist = document.getElementById('btnClosePlaylistModal');
  const btnCancelPlaylist = document.getElementById('btnCancelPlaylist');
  if (btnClosePlaylist) btnClosePlaylist.addEventListener('click', closePlaylistModal);
  if (btnCancelPlaylist) btnCancelPlaylist.addEventListener('click', closePlaylistModal);

  // Delete Playlist Modal
  const btnCloseDelete = document.getElementById('btnCloseDeletePlaylistModal');
  const btnCancelDelete = document.getElementById('btnCancelDeletePlaylist');
  const btnConfirmDelete = document.getElementById('btnConfirmDeletePlaylist');
  if (btnCloseDelete) btnCloseDelete.addEventListener('click', closeDeletePlaylistModal);
  if (btnCancelDelete) btnCancelDelete.addEventListener('click', closeDeletePlaylistModal);
  if (btnConfirmDelete) btnConfirmDelete.addEventListener('click', executeDeletePlaylist);

  // Reset Key Modal
  const btnCloseReset = document.getElementById('btnCloseAdminResetModal');
  const btnCancelReset = document.getElementById('btnCancelAdminReset');
  const btnConfirmReset = document.getElementById('btnConfirmAdminReset');
  const btnDoneReset = document.getElementById('btnDoneAdminReset');
  const btnCopyKey = document.getElementById('btnCopyAdminNewKey');

  if (btnCloseReset) btnCloseReset.addEventListener('click', closeAdminResetModal);
  if (btnCancelReset) btnCancelReset.addEventListener('click', closeAdminResetModal);
  if (btnDoneReset) btnDoneReset.addEventListener('click', closeAdminResetModal);
  if (btnConfirmReset) btnConfirmReset.addEventListener('click', executeAdminResetKey);

  if (btnCopyKey) {
    btnCopyKey.addEventListener('click', () => {
      const keyElem = document.getElementById('adminModalNewKey');
      if (keyElem) {
        copyToClipboard(keyElem.textContent.trim(), 'btnCopyAdminNewKeyText');
      }
    });
  }

  // Unpair Modal
  const btnCloseUnpair = document.getElementById('btnCloseAdminUnpairModal');
  const btnCancelUnpair = document.getElementById('btnCancelAdminUnpair');
  const btnConfirmUnpair = document.getElementById('btnConfirmAdminUnpair');

  if (btnCloseUnpair) btnCloseUnpair.addEventListener('click', closeAdminUnpairModal);
  if (btnCancelUnpair) btnCancelUnpair.addEventListener('click', closeAdminUnpairModal);
  if (btnConfirmUnpair) btnConfirmUnpair.addEventListener('click', executeAdminUnpair);
}

// ================= Helpers =================
function showAlert(el, msg) {
  if (!el) return;
  el.className = 'alert-box alert-danger';
  el.textContent = msg;
  el.classList.remove('hidden');
}

function showSuccessAlert(el, msg) {
  if (!el) return;
  el.className = 'alert-box alert-success';
  el.textContent = msg;
  el.classList.remove('hidden');
}

function hideAlert(el) {
  if (!el) return;
  el.textContent = '';
  el.classList.add('hidden');
}

function copyToClipboard(text, buttonTextId) {
  if (!text) return;
  const btnText = document.getElementById(buttonTextId);
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => {
      if (btnText) {
        const orig = btnText.textContent;
        btnText.textContent = 'Copied!';
        setTimeout(() => { btnText.textContent = orig; }, 2000);
      }
    }).catch(() => fallbackCopy(text, buttonTextId));
  } else {
    fallbackCopy(text, buttonTextId);
  }
}

function fallbackCopy(text, buttonTextId) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    document.execCommand('copy');
    const btnText = document.getElementById(buttonTextId);
    if (btnText) {
      const orig = btnText.textContent;
      btnText.textContent = 'Copied!';
      setTimeout(() => { btnText.textContent = orig; }, 2000);
    }
  } catch (e) {}
  document.body.removeChild(ta);
}

function formatDate(val) {
  if (!val) return '-';
  try {
    let d;
    if (typeof val === 'number') {
      d = new Date(val > 10000000000 ? val : val * 1000);
    } else {
      d = new Date(val);
    }
    if (isNaN(d.getTime())) return String(val);
    return d.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (e) {
    return String(val);
  }
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeJs(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}
