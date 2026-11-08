/**
 * SADDAM IPTV - Main Client Application Logic (English LTR)
 * Strictly follows IPTV_Website_Full_Regeneration_Google_Antigravity specification:
 * - Gated login screen for unauthenticated visitors.
 * - Post-login Home view with exactly two primary cards: "Pair Devices" and "Admin Page".
 * - Device Pairing: Formats canonical MAC address, calls backend to generate 6-digit Device KEY.
 * - Displays 6-digit key with leading zeros preserved, once-only warning, and copy button.
 * - Lists registered devices with status, block/unblock, key reset, and unpair actions.
 * - Playlists belong to account: pairing/unpairing devices never affects playlists.
 */

// Application State
const appState = {
  authenticated: false,
  admin: null,
  devices: [],
  currentResetDeviceId: null,
  currentUnpairDeviceId: null
};

// ================= Initialization =================
document.addEventListener('DOMContentLoaded', () => {
  initAuthUI();
  initHomeNavigation();
  initPairingUI();
  initModals();
  checkSession();
});

// ================= 1. Authentication & Session =================
function initAuthUI() {
  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', handleLogin);
  }

  const togglePasswordBtn = document.getElementById('togglePasswordBtn');
  if (togglePasswordBtn) {
    togglePasswordBtn.addEventListener('click', () => {
      const passInput = document.getElementById('loginPassword');
      const icon = document.getElementById('togglePasswordIcon');
      if (passInput && icon) {
        if (passInput.type === 'password') {
          passInput.type = 'text';
          icon.className = 'fa-solid fa-eye-slash';
        } else {
          passInput.type = 'password';
          icon.className = 'fa-solid fa-eye';
        }
      }
    });
  }

  const btnLogout = document.getElementById('btnHeaderLogout');
  if (btnLogout) {
    btnLogout.addEventListener('click', handleLogout);
  }
}

async function checkSession() {
  try {
    const res = await fetch('/api/v1/auth/me', {
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    });
    const data = await res.json();

    if (res.ok && data.success && data.admin) {
      setAuthenticatedState(data.admin);
    } else {
      setUnauthenticatedState();
    }
  } catch (err) {
    setUnauthenticatedState();
  }
}

function setAuthenticatedState(admin) {
  appState.authenticated = true;
  appState.admin = admin;

  // Update Header UI
  const userBadge = document.getElementById('userBadge');
  const userNameText = document.getElementById('userNameText');
  const btnHeaderLogout = document.getElementById('btnHeaderLogout');
  const btnHeaderAdmin = document.getElementById('btnHeaderAdmin');
  const welcomeUserName = document.getElementById('welcomeUserName');

  if (userBadge) userBadge.classList.remove('hidden');
  if (userNameText) userNameText.textContent = admin.username || 'Admin';
  if (welcomeUserName) welcomeUserName.textContent = admin.username || 'Admin';
  if (btnHeaderLogout) btnHeaderLogout.classList.remove('hidden');
  if (btnHeaderAdmin) btnHeaderAdmin.classList.remove('hidden');

  // Show Home View
  showView('home');
}

function setUnauthenticatedState() {
  appState.authenticated = false;
  appState.admin = null;

  // Reset Header UI
  const userBadge = document.getElementById('userBadge');
  const btnHeaderLogout = document.getElementById('btnHeaderLogout');
  const btnHeaderAdmin = document.getElementById('btnHeaderAdmin');
  const btnHeaderHome = document.getElementById('btnHeaderHome');

  if (userBadge) userBadge.classList.add('hidden');
  if (btnHeaderLogout) btnHeaderLogout.classList.add('hidden');
  if (btnHeaderAdmin) btnHeaderAdmin.classList.add('hidden');
  if (btnHeaderHome) btnHeaderHome.classList.add('hidden');

  // Show Login View
  showView('login');
}

async function handleLogin(e) {
  e.preventDefault();
  const usernameInput = document.getElementById('loginUsername');
  const passwordInput = document.getElementById('loginPassword');
  const alertBox = document.getElementById('loginAlert');
  const submitBtn = document.getElementById('btnLoginSubmit');
  const submitText = document.getElementById('loginBtnText');

  const username = usernameInput ? usernameInput.value.trim() : '';
  const password = passwordInput ? passwordInput.value.trim() : '';

  if (!username || !password) {
    showAlert(alertBox, 'Please enter both username and password.');
    return;
  }

  hideAlert(alertBox);
  if (submitBtn) submitBtn.disabled = true;
  if (submitText) submitText.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Signing In...';

  try {
    const res = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      credentials: 'same-origin',
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();

    if (res.ok && data.success) {
      if (passwordInput) passwordInput.value = '';
      setAuthenticatedState(data.admin);
    } else {
      showAlert(alertBox, data.error || 'Invalid username or password.');
    }
  } catch (err) {
    showAlert(alertBox, 'Connection failed. Please check your network connection.');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
    if (submitText) submitText.innerHTML = 'Sign In';
  }
}

async function handleLogout() {
  try {
    await fetch('/api/v1/auth/logout', {
      method: 'POST',
      credentials: 'same-origin'
    });
  } catch (e) {
    // ignore
  }
  setUnauthenticatedState();
}

// ================= 2. Navigation & Views =================
function initHomeNavigation() {
  const btnOpenPairDevices = document.getElementById('btnOpenPairDevices');
  if (btnOpenPairDevices) {
    btnOpenPairDevices.addEventListener('click', () => {
      showView('pairDevices');
      loadRegisteredDevices();
    });
  }

  const btnBackHome = document.getElementById('btnBackHome');
  if (btnBackHome) {
    btnBackHome.addEventListener('click', () => showView('home'));
  }

  const btnHeaderHome = document.getElementById('btnHeaderHome');
  if (btnHeaderHome) {
    btnHeaderHome.addEventListener('click', () => showView('home'));
  }

  const brandLink = document.getElementById('brandLink');
  if (brandLink) {
    brandLink.addEventListener('click', (e) => {
      e.preventDefault();
      if (appState.authenticated) {
        showView('home');
      } else {
        showView('login');
      }
    });
  }
}

function showView(viewName) {
  const loginView = document.getElementById('loginView');
  const homeView = document.getElementById('homeView');
  const pairDevicesView = document.getElementById('pairDevicesView');
  const btnHeaderHome = document.getElementById('btnHeaderHome');

  if (loginView) loginView.classList.add('hidden');
  if (homeView) homeView.classList.add('hidden');
  if (pairDevicesView) pairDevicesView.classList.add('hidden');
  if (btnHeaderHome) btnHeaderHome.classList.add('hidden');

  if (viewName === 'login') {
    if (loginView) loginView.classList.remove('hidden');
  } else if (viewName === 'home') {
    if (homeView) homeView.classList.remove('hidden');
  } else if (viewName === 'pairDevices') {
    if (pairDevicesView) pairDevicesView.classList.remove('hidden');
    if (btnHeaderHome) btnHeaderHome.classList.remove('hidden');
  }
}

// ================= 3. Device Pairing Workflow =================
function initPairingUI() {
  const macInput = document.getElementById('macAddressInput');
  if (macInput) {
    macInput.addEventListener('input', formatMacInput);
  }

  const pairForm = document.getElementById('pairDeviceForm');
  if (pairForm) {
    pairForm.addEventListener('submit', handlePairDevice);
  }

  const deviceSearchInput = document.getElementById('deviceSearchInput');
  if (deviceSearchInput) {
    deviceSearchInput.addEventListener('input', filterDevicesTable);
  }

  const btnRefreshDevices = document.getElementById('btnRefreshDevices');
  if (btnRefreshDevices) {
    btnRefreshDevices.addEventListener('click', loadRegisteredDevices);
  }
}

function formatMacInput(e) {
  let val = e.target.value.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  if (val.length > 12) val = val.substring(0, 12);
  const parts = [];
  for (let i = 0; i < val.length; i += 2) {
    parts.push(val.substring(i, i + 2));
  }
  e.target.value = parts.join(':');
}

async function handlePairDevice(e) {
  e.preventDefault();
  const macInput = document.getElementById('macAddressInput');
  const labelInput = document.getElementById('deviceLabelInput');
  const notesInput = document.getElementById('deviceNotesInput');
  const alertBox = document.getElementById('pairAlert');
  const submitBtn = document.getElementById('btnPairSubmit');
  const submitText = document.getElementById('pairSubmitText');

  const mac = macInput ? macInput.value.trim() : '';
  const label = labelInput ? labelInput.value.trim() : '';
  const notes = notesInput ? notesInput.value.trim() : '';

  if (!mac || mac.length !== 17 || !/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i.test(mac)) {
    showAlert(alertBox, 'Please enter a valid 6-octet MAC address (e.g. 00:1A:79:AB:CD:EF).');
    return;
  }

  hideAlert(alertBox);
  if (submitBtn) submitBtn.disabled = true;
  if (submitText) submitText.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Pairing...';

  try {
    const res = await fetch('/api/v1/devices', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      credentials: 'same-origin',
      body: JSON.stringify({
        mac_address: mac,
        label: label || 'Player Device',
        notes: notes
      })
    });

    const data = await res.json();

    if (res.ok && data.success) {
      // Clear form
      if (macInput) macInput.value = '';
      if (labelInput) labelInput.value = '';
      if (notesInput) notesInput.value = '';

      // Present success modal with 6-digit Device KEY
      const keyStr = String(data.device_key || data.pairing_pin || '');
      showPairSuccessModal({
        deviceName: data.device ? data.device.device_label : label || 'Player Device',
        mac: data.device ? data.device.device_code : mac,
        deviceKey: keyStr
      });

      // Reload devices table
      loadRegisteredDevices();
    } else {
      showAlert(alertBox, data.error || 'Failed to pair device.');
    }
  } catch (err) {
    showAlert(alertBox, 'Network error. Please try again.');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
    if (submitText) submitText.innerHTML = 'Pair Device';
  }
}

async function loadRegisteredDevices() {
  const tbody = document.getElementById('devicesTableBody');
  const countBadge = document.getElementById('deviceCountBadge');

  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-state">
          <i class="fa-solid fa-spinner fa-spin"></i>
          <p>Loading registered devices...</p>
        </td>
      </tr>
    `;
  }

  try {
    const res = await fetch('/api/v1/devices', {
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    });
    const result = await res.json();

    if (res.ok && result.success) {
      let devices = [];
      if (Array.isArray(result.devices)) {
        devices = result.devices;
      } else if (result.data && Array.isArray(result.data.devices)) {
        devices = result.data.devices;
      }
      appState.devices = devices;
      if (countBadge) countBadge.textContent = String(devices.length);
      renderDevicesTable(devices);
    } else {
      if (tbody) {
        tbody.innerHTML = `
          <tr>
            <td colspan="6" class="empty-state text-center">
              <i class="fa-solid fa-triangle-exclamation" style="color: var(--danger);"></i>
              <p>Failed to load devices.</p>
            </td>
          </tr>
        `;
      }
    }
  } catch (err) {
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="empty-state text-center">
            <i class="fa-solid fa-circle-exclamation"></i>
            <p>Connection error loading devices.</p>
          </td>
        </tr>
      `;
    }
  }
}

function renderDevicesTable(devices) {
  const tbody = document.getElementById('devicesTableBody');
  if (!tbody) return;

  if (!devices || devices.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-state">
          <i class="fa-solid fa-tv"></i>
          <p>No devices registered yet. Use the form on the left to pair your first device.</p>
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

    const registeredDate = d.created_at ? formatDate(d.created_at) : '-';
    const lastSeenDate = d.last_seen_at ? formatDate(d.last_seen_at) : '<span style="color: var(--text-dim);">Never</span>';

    return `
      <tr>
        <td><strong>${escapeHtml(d.device_label || d.label || 'Player Device')}</strong></td>
        <td><span class="code-font" style="font-weight: 600;">${escapeHtml(d.device_code || d.mac || '-')}</span></td>
        <td>${statusBadge}</td>
        <td>${registeredDate}</td>
        <td>${lastSeenDate}</td>
        <td style="text-align: right; white-space: nowrap;">
          <button type="button" class="btn btn-secondary btn-sm" onclick="promptResetKey(${d.id}, '${escapeJs(d.device_label || 'Device')}', '${escapeJs(d.device_code || '')}')" title="Reset Device KEY">
            <i class="fa-solid fa-key"></i>
            <span>Reset Key</span>
          </button>
          <button type="button" class="btn ${isBlocked ? 'btn-success' : 'btn-secondary'} btn-sm" onclick="toggleDeviceBlock(${d.id}, ${isBlocked})" title="${isBlocked ? 'Unblock device' : 'Block device'}">
            <i class="fa-solid ${isBlocked ? 'fa-lock-open' : 'fa-ban'}"></i>
            <span>${isBlocked ? 'Unblock' : 'Block'}</span>
          </button>
          <button type="button" class="btn btn-danger btn-sm" onclick="promptUnpairDevice(${d.id}, '${escapeJs(d.device_label || 'Device')}', '${escapeJs(d.device_code || '')}')" title="Unpair Device">
            <i class="fa-solid fa-trash"></i>
            <span>Unpair</span>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function filterDevicesTable() {
  const query = (document.getElementById('deviceSearchInput')?.value || '').toLowerCase();
  if (!query) {
    renderDevicesTable(appState.devices);
    return;
  }
  const filtered = appState.devices.filter(d => {
    const name = (d.device_label || d.label || '').toLowerCase();
    const mac = (d.device_code || d.mac || '').toLowerCase();
    return name.includes(query) || mac.includes(query);
  });
  renderDevicesTable(filtered);
}

// ================= 4. Modals and Actions =================
function initModals() {
  // Pair Success Modal
  const btnClosePairSuccessModal = document.getElementById('btnClosePairSuccessModal');
  const btnDonePairSuccess = document.getElementById('btnDonePairSuccess');
  if (btnClosePairSuccessModal) btnClosePairSuccessModal.addEventListener('click', closePairSuccessModal);
  if (btnDonePairSuccess) btnDonePairSuccess.addEventListener('click', closePairSuccessModal);

  const btnCopyDeviceKey = document.getElementById('btnCopyDeviceKey');
  if (btnCopyDeviceKey) {
    btnCopyDeviceKey.addEventListener('click', () => {
      const keyElem = document.getElementById('modalSuccessDeviceKey');
      if (keyElem) {
        copyToClipboard(keyElem.textContent.trim(), 'btnCopyText');
      }
    });
  }

  // Reset Key Modal
  const btnCloseResetKeyModal = document.getElementById('btnCloseResetKeyModal');
  const btnCancelResetKey = document.getElementById('btnCancelResetKey');
  const btnConfirmResetKey = document.getElementById('btnConfirmResetKey');
  const btnCloseResetResult = document.getElementById('btnCloseResetResult');
  const btnCopyNewDeviceKey = document.getElementById('btnCopyNewDeviceKey');

  if (btnCloseResetKeyModal) btnCloseResetKeyModal.addEventListener('click', closeResetKeyModal);
  if (btnCancelResetKey) btnCancelResetKey.addEventListener('click', closeResetKeyModal);
  if (btnCloseResetResult) btnCloseResetResult.addEventListener('click', closeResetKeyModal);
  if (btnConfirmResetKey) btnConfirmResetKey.addEventListener('click', executeResetKey);

  if (btnCopyNewDeviceKey) {
    btnCopyNewDeviceKey.addEventListener('click', () => {
      const keyElem = document.getElementById('modalNewDeviceKey');
      if (keyElem) {
        copyToClipboard(keyElem.textContent.trim(), 'btnCopyNewKeyText');
      }
    });
  }

  // Unpair Modal
  const btnCloseUnpairModal = document.getElementById('btnCloseUnpairModal');
  const btnCancelUnpair = document.getElementById('btnCancelUnpair');
  const btnConfirmUnpair = document.getElementById('btnConfirmUnpair');

  if (btnCloseUnpairModal) btnCloseUnpairModal.addEventListener('click', closeUnpairModal);
  if (btnCancelUnpair) btnCancelUnpair.addEventListener('click', closeUnpairModal);
  if (btnConfirmUnpair) btnConfirmUnpair.addEventListener('click', executeUnpairDevice);
}

function showPairSuccessModal({ deviceName, mac, deviceKey }) {
  const modal = document.getElementById('pairSuccessModal');
  const nameElem = document.getElementById('modalSuccessDeviceName');
  const macElem = document.getElementById('modalSuccessMac');
  const keyElem = document.getElementById('modalSuccessDeviceKey');
  const copyBtnText = document.getElementById('btnCopyText');

  if (nameElem) nameElem.textContent = deviceName;
  if (macElem) macElem.textContent = mac;
  if (keyElem) keyElem.textContent = deviceKey;
  if (copyBtnText) copyBtnText.textContent = 'Copy Device KEY';

  if (modal) modal.classList.add('open');
}

function closePairSuccessModal() {
  const modal = document.getElementById('pairSuccessModal');
  if (modal) modal.classList.remove('open');
}

// Reset Key Action
window.promptResetKey = function(deviceId, deviceName, mac) {
  appState.currentResetDeviceId = deviceId;
  const modal = document.getElementById('resetKeyModal');
  const nameElem = document.getElementById('resetTargetDeviceName');
  const macElem = document.getElementById('resetTargetMac');
  const confirmView = document.getElementById('resetKeyConfirmView');
  const resultView = document.getElementById('resetKeyResultView');
  const btnCancel = document.getElementById('btnCancelResetKey');
  const btnConfirm = document.getElementById('btnConfirmResetKey');
  const btnClose = document.getElementById('btnCloseResetResult');

  if (nameElem) nameElem.textContent = deviceName;
  if (macElem) macElem.textContent = mac;
  if (confirmView) confirmView.classList.remove('hidden');
  if (resultView) resultView.classList.add('hidden');
  if (btnCancel) btnCancel.classList.remove('hidden');
  if (btnConfirm) btnConfirm.classList.remove('hidden');
  if (btnClose) btnClose.classList.add('hidden');

  if (modal) modal.classList.add('open');
};

async function executeResetKey() {
  const deviceId = appState.currentResetDeviceId;
  if (!deviceId) return;

  const btnConfirm = document.getElementById('btnConfirmResetKey');
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
      const confirmView = document.getElementById('resetKeyConfirmView');
      const resultView = document.getElementById('resetKeyResultView');
      const btnCancel = document.getElementById('btnCancelResetKey');
      const btnClose = document.getElementById('btnCloseResetResult');
      const keyElem = document.getElementById('modalNewDeviceKey');
      const copyText = document.getElementById('btnCopyNewKeyText');

      if (confirmView) confirmView.classList.add('hidden');
      if (resultView) resultView.classList.remove('hidden');
      if (btnCancel) btnCancel.classList.add('hidden');
      if (btnConfirm) btnConfirm.classList.add('hidden');
      if (btnClose) btnClose.classList.remove('hidden');
      if (keyElem) keyElem.textContent = String(data.device_key || data.new_pin || '');
      if (copyText) copyText.textContent = 'Copy Device KEY';

      loadRegisteredDevices();
    } else {
      alert(data.error || 'Failed to reset Device KEY.');
      closeResetKeyModal();
    }
  } catch (err) {
    alert('Connection error resetting Device KEY.');
    closeResetKeyModal();
  } finally {
    if (btnConfirm) {
      btnConfirm.disabled = false;
      btnConfirm.innerHTML = 'Confirm Reset';
    }
  }
}

function closeResetKeyModal() {
  const modal = document.getElementById('resetKeyModal');
  if (modal) modal.classList.remove('open');
  appState.currentResetDeviceId = null;
}

// Block / Unblock Action
window.toggleDeviceBlock = async function(deviceId, isCurrentlyBlocked) {
  const action = isCurrentlyBlocked ? 'unblock' : 'block';
  try {
    const res = await fetch(`/api/v1/devices/${deviceId}/${action}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    });
    const data = await res.json();
    if (res.ok && data.success) {
      loadRegisteredDevices();
    } else {
      alert(data.error || `Failed to ${action} device.`);
    }
  } catch (err) {
    alert(`Connection error trying to ${action} device.`);
  }
};

// Unpair Action
window.promptUnpairDevice = function(deviceId, deviceName, mac) {
  appState.currentUnpairDeviceId = deviceId;
  const modal = document.getElementById('unpairModal');
  const nameElem = document.getElementById('unpairTargetDeviceName');
  const macElem = document.getElementById('unpairTargetMac');

  if (nameElem) nameElem.textContent = deviceName;
  if (macElem) macElem.textContent = mac;
  if (modal) modal.classList.add('open');
};

async function executeUnpairDevice() {
  const deviceId = appState.currentUnpairDeviceId;
  if (!deviceId) return;

  const btnConfirm = document.getElementById('btnConfirmUnpair');
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
      closeUnpairModal();
      loadRegisteredDevices();
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

function closeUnpairModal() {
  const modal = document.getElementById('unpairModal');
  if (modal) modal.classList.remove('open');
  appState.currentUnpairDeviceId = null;
}

// ================= Helpers =================
function showAlert(el, msg) {
  if (!el) return;
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
  } catch (e) {
    // ignore
  }
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
