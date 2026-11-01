/**
 * SADDAM IPTV - Administration Website: Device & Playlist Management
 * Strict compliance with SADDAM_IPTV_Admin_Device_Playlist_Management_SPD:
 * - Admin Authentication: Powered exclusively by the two approved administrator accounts (Drexx0301, Saddam1991)
 * - Required primary flow: Login -> Device Identification (MAC + Device Key) -> Device Playlists Management
 * - Users listing strictly hidden / removed from admin UI
 * - Password reset section strictly removed from website UI and navigation
 * - Never persist Device Key in plaintext browser storage (localStorage, sessionStorage, cookies)
 * - Bound to validated device context
 * - High-performance vanilla JavaScript (optimized for old devices)
 */

// Application State
let currentAdmin = null;
let currentDevice = null;
let currentPlaylists = [];
let isConnecting = false;

// ================= DOM Initialization =================
document.addEventListener('DOMContentLoaded', () => {
  // Bind Login Form
  const loginForm = document.getElementById('unifiedLoginForm');
  if (loginForm) loginForm.addEventListener('submit', handleAdminLogin);

  // Bind Login Password Visibility Toggle
  const togglePassBtn = document.getElementById('togglePasswordBtn');
  if (togglePassBtn) togglePassBtn.addEventListener('click', toggleLoginPasswordVisibility);

  // Bind Admin Logout Button
  const logoutBtn = document.getElementById('btnAdminLogout');
  if (logoutBtn) logoutBtn.addEventListener('click', handleAdminLogout);

  // Bind Brand Home Link
  const brandHomeLink = document.getElementById('brandHomeLink');
  if (brandHomeLink) {
    brandHomeLink.addEventListener('click', (e) => {
      e.preventDefault();
      if (currentAdmin) {
        if (currentDevice) {
          showPlaylistManagementView(currentDevice, currentPlaylists);
        } else {
          showDeviceIdentificationView();
        }
      } else {
        showLoginView();
      }
    });
  }

  // Bind Device Identification Form
  const devIdForm = document.getElementById('deviceIdentificationForm');
  if (devIdForm) devIdForm.addEventListener('submit', handleConnectDevice);

  // Bind Clear Device Form Button
  const clearDevBtn = document.getElementById('btnClearDeviceForm');
  if (clearDevBtn) clearDevBtn.addEventListener('click', handleClearDeviceForm);

  // Bind Device Key Visibility Toggle
  const toggleKeyBtn = document.getElementById('toggleKeyVisibilityBtn');
  if (toggleKeyBtn) toggleKeyBtn.addEventListener('click', toggleDeviceKeyVisibility);

  // Bind MAC Address Input Formatter
  const macInput = document.getElementById('macAddressInput');
  if (macInput) {
    macInput.addEventListener('input', (e) => {
      let val = e.target.value.toUpperCase().replace(/[^A-F0-9]/g, '');
      if (val.length > 12) val = val.substring(0, 12);
      let formatted = val.match(/.{1,2}/g)?.join(':') || val;
      e.target.value = formatted;
    });
  }

  // Bind Change Device Button
  const changeDevBtn = document.getElementById('btnChangeDevice');
  if (changeDevBtn) changeDevBtn.addEventListener('click', handleChangeDevice);

  // Bind Sync / Refresh Button
  const syncBtn = document.getElementById('btnSyncPlaylists');
  if (syncBtn) syncBtn.addEventListener('click', handleSyncPlaylists);

  // Bind Open Add Source Modal Button
  const openAddBtn = document.getElementById('btnOpenAddSourceModal');
  if (openAddBtn) openAddBtn.addEventListener('click', openAddSourceModal);

  // Bind Add Source Form
  const addSrcForm = document.getElementById('addSourceForm');
  if (addSrcForm) addSrcForm.addEventListener('submit', handleSubmittingAddSource);

  // Bind Edit Source Form
  const editSrcForm = document.getElementById('editSourceForm');
  if (editSrcForm) editSrcForm.addEventListener('submit', handleSubmittingEditSource);

  // Bind Copy MAC Button
  const copyMacBtn = document.getElementById('btnCopyMac');
  if (copyMacBtn) copyMacBtn.addEventListener('click', copyDeviceMac);

  // Check initial authentication status
  checkAuthStatus();
});

// ================= Utilities =================
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttr(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/'/g, "\\'");
}

function sanitizeServerUrl(urlStr) {
  if (!urlStr) return '';
  try {
    const parsed = new URL(urlStr);
    // Strip password from userInfo and sensitive query params
    let portPart = (parsed.port && parsed.port !== '80' && parsed.port !== '443') ? `:${parsed.port}` : '';
    let host = parsed.hostname + portPart;
    let path = parsed.pathname || '';
    if (path.length > 30) path = path.substring(0, 27) + '...';
    return `${parsed.protocol}//${host}${path}`;
  } catch (e) {
    // Basic regex sanitization if not valid full URL
    return urlStr.replace(/password=[^&]*/gi, 'password=••••••');
  }
}

function toggleLoginPasswordVisibility() {
  const passInput = document.getElementById('passwordInput');
  const icon = document.getElementById('togglePasswordIcon');
  if (passInput.type === 'password') {
    passInput.type = 'text';
    icon.className = 'fa-solid fa-eye-slash';
  } else {
    passInput.type = 'password';
    icon.className = 'fa-solid fa-eye';
  }
}

function toggleDeviceKeyVisibility() {
  const keyInput = document.getElementById('deviceKeyInput');
  const icon = document.getElementById('toggleKeyIcon');
  if (keyInput.type === 'password') {
    keyInput.type = 'text';
    icon.className = 'fa-solid fa-eye-slash';
  } else {
    keyInput.type = 'password';
    icon.className = 'fa-solid fa-eye';
  }
}

// ================= View Navigation Controllers =================
function showLoginView() {
  document.getElementById('loginView').classList.remove('hidden');
  document.getElementById('deviceIdentificationView').classList.add('hidden');
  document.getElementById('playlistManagementView').classList.add('hidden');
  document.getElementById('btnAdminLogout').classList.add('hidden');
  document.getElementById('adminSlotBadge').classList.add('hidden');
  currentAdmin = null;
  currentDevice = null;
  currentPlaylists = [];
}

function showDeviceIdentificationView() {
  document.getElementById('loginView').classList.add('hidden');
  document.getElementById('deviceIdentificationView').classList.remove('hidden');
  document.getElementById('playlistManagementView').classList.add('hidden');
  document.getElementById('btnAdminLogout').classList.remove('hidden');
  
  if (currentAdmin) {
    const badge = document.getElementById('adminSlotBadge');
    badge.classList.remove('hidden');
    document.getElementById('adminSlotText').textContent = `${currentAdmin.username} (Slot ${currentAdmin.slot})`;
  }

  // Clear device context to prevent accidental operations against previous device
  currentDevice = null;
  currentPlaylists = [];
  
  // Clear sensitive device key from memory and input field
  const keyInput = document.getElementById('deviceKeyInput');
  if (keyInput) keyInput.value = '';

  const alertBox = document.getElementById('deviceAlert');
  if (alertBox) alertBox.classList.add('hidden');

  // Focus MAC input
  setTimeout(() => {
    const macInput = document.getElementById('macAddressInput');
    if (macInput) macInput.focus();
  }, 100);
}

function showPlaylistManagementView(device, playlists) {
  document.getElementById('loginView').classList.add('hidden');
  document.getElementById('deviceIdentificationView').classList.add('hidden');
  document.getElementById('playlistManagementView').classList.remove('hidden');
  document.getElementById('btnAdminLogout').classList.remove('hidden');

  if (currentAdmin) {
    const badge = document.getElementById('adminSlotBadge');
    badge.classList.remove('hidden');
    document.getElementById('adminSlotText').textContent = `${currentAdmin.username} (Slot ${currentAdmin.slot})`;
  }

  currentDevice = device;
  currentPlaylists = playlists || [];

  // Clear sensitive device key from input
  const keyInput = document.getElementById('deviceKeyInput');
  if (keyInput) keyInput.value = '';

  // Update Device Info Banner
  document.getElementById('currentDeviceMac').textContent = device.mac || device.device_code || '--:--:--:--:--:--';
  document.getElementById('currentDevicePlatform').textContent = `${device.platform || 'Android TV'} - ${device.label || 'جهاز المشترك'}`;
  document.getElementById('currentDeviceSync').textContent = `v${device.sync_version || 1}`;

  const statusBadge = document.getElementById('currentDeviceStatusBadge');
  if (device.status === 'active') {
    statusBadge.className = 'badge badge-success';
    statusBadge.textContent = 'نشط';
  } else {
    statusBadge.className = 'badge badge-danger';
    statusBadge.textContent = 'موقوف / معطل';
  }

  // Render Playlists
  renderPlaylists(currentPlaylists);
}

// ================= Authentication (SPD Sec 4) =================
async function checkAuthStatus() {
  try {
    const res = await fetch('/api/v1/auth/status', {
      headers: { 'Accept': 'application/json' }
    });
    const data = await res.json();

    if (data.authenticated && data.admin) {
      currentAdmin = data.admin;
      if (currentDevice) {
        showPlaylistManagementView(currentDevice, currentPlaylists);
      } else {
        showDeviceIdentificationView();
      }
    } else {
      showLoginView();
    }
  } catch (err) {
    showLoginView();
  }
}

async function handleAdminLogin(e) {
  e.preventDefault();
  const username = document.getElementById('usernameInput')?.value.trim();
  const password = document.getElementById('passwordInput')?.value.trim();
  const alertEl = document.getElementById('loginAlert');
  const btnSubmit = document.getElementById('btnLoginSubmit');
  const btnText = document.getElementById('loginBtnText');

  if (!username || !password) {
    alertEl.className = 'alert-box danger';
    alertEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <span>يرجى إدخال اسم المستخدم وكلمة المرور.</span>`;
    alertEl.classList.remove('hidden');
    return;
  }

  btnSubmit.disabled = true;
  btnText.textContent = 'جارٍ التحقق من الحساب...';
  alertEl.classList.add('hidden');

  try {
    const res = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();

    if (res.ok && data.success) {
      currentAdmin = data.admin;
      document.getElementById('passwordInput').value = '';
      showDeviceIdentificationView();
    } else {
      alertEl.className = 'alert-box danger';
      alertEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <span>${escapeHtml(data.error || 'تعذر التحقق من البيانات. راجع اسم المستخدم وكلمة المرور.')}</span>`;
      alertEl.classList.remove('hidden');
    }
  } catch (err) {
    alertEl.className = 'alert-box danger';
    alertEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <span>حدث خطأ في الاتصال بالخادم. يرجى المحاولة مجددًا.</span>`;
    alertEl.classList.remove('hidden');
  } finally {
    btnSubmit.disabled = false;
    btnText.textContent = 'تسجيل الدخول للموقع';
  }
}

async function handleAdminLogout() {
  try {
    await fetch('/api/v1/auth/logout', { method: 'POST' });
  } catch (err) {
    console.error('Logout failed:', err);
  }
  showLoginView();
}

// ================= Screen A: Device Identification (SPD Sec 7) =================
async function handleConnectDevice(e) {
  e.preventDefault();
  if (isConnecting) return;

  const mac = document.getElementById('macAddressInput')?.value.trim();
  const deviceKey = document.getElementById('deviceKeyInput')?.value.trim();
  const alertEl = document.getElementById('deviceAlert');
  const btnConnect = document.getElementById('btnConnectDevice');
  const btnText = document.getElementById('connectBtnText');
  const btnIcon = document.getElementById('connectBtnIcon');

  alertEl.classList.add('hidden');

  if (!mac || !deviceKey) {
    alertEl.className = 'alert-box danger';
    alertEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <span>يرجى إدخال عنوان MAC ومفتاح الجهاز (Device Key) معاً.</span>`;
    alertEl.classList.remove('hidden');
    return;
  }

  isConnecting = true;
  btnConnect.disabled = true;
  btnText.textContent = 'جارٍ التحقق والاتصال...';
  btnIcon.className = 'fa-solid fa-spinner fa-spin';

  try {
    const res = await fetch('/api/v1/admin/devices/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mac_address: mac, device_key: deviceKey })
    });
    const data = await res.json();

    if (res.ok && data.success) {
      // Valid device -> Display Device Playlist Management
      showPlaylistManagementView(data.device, data.playlists);
    } else {
      alertEl.className = 'alert-box danger';
      alertEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <span>${escapeHtml(data.error || 'تعذر التحقق من الجهاز. تأكد من صحة عنوان MAC ومفتاح الجهاز.')}</span>`;
      alertEl.classList.remove('hidden');
    }
  } catch (err) {
    alertEl.className = 'alert-box danger';
    alertEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <span>فشل الاتصال بالخادم. تحقق من الشبكة وحاول مجددًا.</span>`;
    alertEl.classList.remove('hidden');
  } finally {
    isConnecting = false;
    btnConnect.disabled = false;
    btnText.textContent = 'اتصال وتحميل قوائم الجهاز';
    btnIcon.className = 'fa-solid fa-link';
  }
}

function handleClearDeviceForm() {
  const macInput = document.getElementById('macAddressInput');
  const keyInput = document.getElementById('deviceKeyInput');
  const alertEl = document.getElementById('deviceAlert');
  if (macInput) macInput.value = '';
  if (keyInput) keyInput.value = '';
  if (alertEl) alertEl.classList.add('hidden');
  if (macInput) macInput.focus();
}

function handleChangeDevice() {
  // Clear previous device context safely and return to Screen A
  showDeviceIdentificationView();
}

// ================= Screen B: Device Playlist Management (SPD Sec 8) =================
function renderPlaylists(playlists) {
  const grid = document.getElementById('playlistsGrid');
  const emptyState = document.getElementById('emptyPlaylistsState');
  const totalCountEl = document.getElementById('playlistsTotalCount');
  const activeCountEl = document.getElementById('playlistsActiveCount');
  const disabledCountEl = document.getElementById('playlistsDisabledCount');

  const total = (playlists || []).length;
  let activeCount = 0;
  let disabledCount = 0;

  playlists.forEach(p => {
    if (p.enabled && p.status !== 'expired' && p.status !== 'disabled') {
      activeCount++;
    } else {
      disabledCount++;
    }
  });

  totalCountEl.textContent = total;
  activeCountEl.textContent = activeCount;
  disabledCountEl.textContent = disabledCount;

  if (total === 0) {
    grid.innerHTML = '';
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');

  grid.innerHTML = playlists.map(s => {
    const isWorking = (s.status === 'working' || s.status === 'active');
    const isFailed = (s.status === 'connection_failed' || s.status === 'auth_failed');
    const isExpired = (s.status === 'expired');
    const isUntested = (s.status === 'untested');
    const isEnabled = Boolean(s.enabled);

    let statusBadge = '';
    if (!isEnabled) {
      statusBadge = `<span class="badge badge-warning"><i class="fa-solid fa-pause"></i> معطلة</span>`;
    } else if (isExpired) {
      statusBadge = `<span class="badge badge-danger"><i class="fa-solid fa-clock"></i> منتهية الصلاحية</span>`;
    } else if (isWorking) {
      statusBadge = `<span class="badge badge-success"><i class="fa-solid fa-circle-check"></i> متصل / سليم</span>`;
    } else if (isFailed) {
      statusBadge = `<span class="badge badge-danger"><i class="fa-solid fa-triangle-exclamation"></i> خطأ في الاتصال</span>`;
    } else {
      statusBadge = `<span class="badge badge-info"><i class="fa-solid fa-clock"></i> قيد الفحص</span>`;
    }

    const typeBadge = (s.source_type === 'xtream')
      ? `<span class="badge badge-info" style="font-size: 0.75rem;">Xtream Codes API</span>`
      : `<span class="badge badge-info" style="font-size: 0.75rem;">M3U / M3U8</span>`;

    const sanitizedUrl = sanitizeServerUrl(s.server_url);

    const toggleBtnText = isEnabled ? 'إيقاف' : 'تفعيل';
    const toggleBtnIcon = isEnabled ? 'fa-pause' : 'fa-play';
    const toggleBtnClass = isEnabled ? 'btn-secondary' : 'btn-success';

    return `
      <div class="playlist-card-item" id="sourceCard-${s.id}">
        <div class="playlist-card-info">
          <div class="playlist-card-title-row">
            <span class="playlist-card-title">${escapeHtml(s.name)}</span>
            ${typeBadge}
            ${statusBadge}
          </div>
          <div class="playlist-card-meta">
            <span><i class="fa-solid fa-server" style="color: var(--text-dim);"></i> <span class="playlist-card-url" title="${escapeHtml(sanitizedUrl)}">${escapeHtml(sanitizedUrl)}</span></span>
            ${s.username ? `<span><i class="fa-solid fa-user" style="color: var(--text-dim);"></i> <strong class="latin-code" style="color: #fff;">${escapeHtml(s.username)}</strong></span>` : ''}
          </div>
        </div>

        <div class="playlist-card-actions">
          <button class="btn btn-secondary btn-sm" onclick="testPlaylistSource(${s.id})" title="فحص الاتصال بالسيرفر">
            <i class="fa-solid fa-plug"></i>
            <span>فحص الاتصال</span>
          </button>

          <button class="btn btn-secondary btn-sm" onclick="openEditSourceModal(${s.id})" title="تعديل بيانات القائمة">
            <i class="fa-solid fa-pen-to-square"></i>
            <span>تعديل</span>
          </button>

          <button class="btn ${toggleBtnClass} btn-sm" onclick="togglePlaylistSource(${s.id}, ${!isEnabled})" title="${toggleBtnText} هذه القائمة">
            <i class="fa-solid ${toggleBtnIcon}"></i>
            <span>${toggleBtnText}</span>
          </button>

          <button class="btn btn-danger btn-sm" onclick="deletePlaylistSource(${s.id}, '${escapeAttr(s.name)}')" title="حذف القائمة">
            <i class="fa-solid fa-trash-can"></i>
            <span>حذف</span>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

async function handleSyncPlaylists() {
  if (!currentDevice) return;
  const syncIcon = document.getElementById('syncIcon');
  if (syncIcon) syncIcon.classList.add('fa-spin');

  try {
    const res = await fetch(`/api/v1/admin/devices/${currentDevice.id}`);
    const data = await res.json();

    if (res.ok && data.success && data.device) {
      currentDevice = data.device;
      currentPlaylists = data.device.sources || [];
      document.getElementById('currentDeviceSync').textContent = `v${currentDevice.sync_version || 1}`;
      renderPlaylists(currentPlaylists);
    }
  } catch (err) {
    console.error('Failed to sync playlists:', err);
  } finally {
    if (syncIcon) syncIcon.classList.remove('fa-spin');
  }
}

// ================= Add Source Workflow (SPD Sec 8.5) =================
function openAddSourceModal() {
  if (!currentDevice) return;
  document.getElementById('addSourceName').value = '';
  document.getElementById('addSourceUrl').value = '';
  document.getElementById('addSourceUser').value = '';
  document.getElementById('addSourcePass').value = '';
  document.getElementById('addSourceType').value = 'm3u';
  handleAddSourceTypeChange();
  document.getElementById('addSourceAlert').classList.add('hidden');
  document.getElementById('addSourceModal').classList.remove('hidden');
}

function closeAddSourceModal() {
  document.getElementById('addSourceModal').classList.add('hidden');
}

function handleAddSourceTypeChange() {
  const type = document.getElementById('addSourceType').value;
  const xtreamRow = document.getElementById('addXtreamFields');
  if (type === 'xtream') {
    xtreamRow.classList.remove('hidden');
  } else {
    xtreamRow.classList.add('hidden');
  }
}

async function handleSubmittingAddSource(e) {
  e.preventDefault();
  if (!currentDevice) return;

  const name = document.getElementById('addSourceName')?.value.trim();
  const source_type = document.getElementById('addSourceType')?.value;
  const server_url = document.getElementById('addSourceUrl')?.value.trim();
  const username = document.getElementById('addSourceUser')?.value.trim();
  const password = document.getElementById('addSourcePass')?.value.trim();
  const alertEl = document.getElementById('addSourceAlert');
  const btnSubmit = document.getElementById('btnAddSourceSubmit');

  if (!name || !server_url) {
    alertEl.className = 'alert-box danger';
    alertEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <span>يرجى إدخال اسم القائمة ورابط السيرفر.</span>`;
    alertEl.classList.remove('hidden');
    return;
  }

  btnSubmit.disabled = true;

  try {
    const res = await fetch(`/api/v1/admin/devices/${currentDevice.id}/sources`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, source_type, server_url, username, password })
    });
    const data = await res.json();

    if (res.ok && data.success) {
      closeAddSourceModal();
      handleSyncPlaylists();
      showPlaylistsAlert('success', 'تمت إضافة قائمة التشغيل إلى الجهاز بنجاح!');
    } else {
      alertEl.className = 'alert-box danger';
      alertEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <span>${escapeHtml(data.error || 'تعذر إضافة القائمة.')}</span>`;
      alertEl.classList.remove('hidden');
    }
  } catch (err) {
    alertEl.className = 'alert-box danger';
    alertEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <span>خطأ في الاتصال بالخادم.</span>`;
    alertEl.classList.remove('hidden');
  } finally {
    btnSubmit.disabled = false;
  }
}

// ================= Edit Source Workflow (SPD Sec 8.6) =================
function openEditSourceModal(sourceId) {
  const src = currentPlaylists.find(p => p.id === sourceId);
  if (!src) return;

  document.getElementById('editSourceId').value = src.id;
  document.getElementById('editSourceName').value = src.name || '';
  document.getElementById('editSourceType').value = src.source_type || 'm3u';
  document.getElementById('editSourceUrl').value = src.server_url || '';
  document.getElementById('editSourceUser').value = src.username || '';
  document.getElementById('editSourcePass').value = '';
  document.getElementById('editSourcePass').placeholder = 'اترك فارغاً للإبقاء على كلمة المرور الحالية';
  document.getElementById('editSourceEnabled').checked = Boolean(src.enabled);

  handleEditSourceTypeChange();
  document.getElementById('editSourceAlert').classList.add('hidden');
  document.getElementById('editSourceModal').classList.remove('hidden');
}

function closeEditSourceModal() {
  document.getElementById('editSourceModal').classList.add('hidden');
}

function handleEditSourceTypeChange() {
  const type = document.getElementById('editSourceType').value;
  const xtreamRow = document.getElementById('editXtreamFields');
  if (type === 'xtream') {
    xtreamRow.classList.remove('hidden');
  } else {
    xtreamRow.classList.add('hidden');
  }
}

async function handleSubmittingEditSource(e) {
  e.preventDefault();
  const sourceId = document.getElementById('editSourceId')?.value;
  const name = document.getElementById('editSourceName')?.value.trim();
  const source_type = document.getElementById('editSourceType')?.value;
  const server_url = document.getElementById('editSourceUrl')?.value.trim();
  const username = document.getElementById('editSourceUser')?.value.trim();
  const password = document.getElementById('editSourcePass')?.value.trim();
  const enabled = document.getElementById('editSourceEnabled')?.checked;
  const alertEl = document.getElementById('editSourceAlert');
  const btnSubmit = document.getElementById('btnEditSourceSubmit');

  if (!name || !server_url) {
    alertEl.className = 'alert-box danger';
    alertEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <span>يرجى إدخال اسم القائمة ورابط السيرفر.</span>`;
    alertEl.classList.remove('hidden');
    return;
  }

  btnSubmit.disabled = true;

  try {
    const payload = { name, source_type, server_url, username, enabled };
    if (password) payload.password = password;

    const res = await fetch(`/api/v1/admin/sources/${sourceId}/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (res.ok && data.success) {
      closeEditSourceModal();
      handleSyncPlaylists();
      showPlaylistsAlert('success', 'تم حفظ التعديلات بنجاح!');
    } else {
      alertEl.className = 'alert-box danger';
      alertEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <span>${escapeHtml(data.error || 'تعذر تعديل القائمة.')}</span>`;
      alertEl.classList.remove('hidden');
    }
  } catch (err) {
    alertEl.className = 'alert-box danger';
    alertEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <span>خطأ في الاتصال بالخادم.</span>`;
    alertEl.classList.remove('hidden');
  } finally {
    btnSubmit.disabled = false;
  }
}

// ================= Delete Source Workflow (SPD Sec 8.7) =================
async function deletePlaylistSource(sourceId, name) {
  if (!confirm(`هل أنت متأكد من حذف قائمة التشغيل "${name}" من هذا الجهاز نهائياً؟\nسيتم إلغاء ربط القائمة بالجهاز فوراً.`)) {
    return;
  }

  try {
    const res = await fetch(`/api/v1/admin/sources/${sourceId}`, { method: 'DELETE' });
    const data = await res.json();

    if (res.ok && data.success) {
      handleSyncPlaylists();
      showPlaylistsAlert('success', `تم حذف قائمة التشغيل "${name}" بنجاح.`);
    } else {
      alert(data.error || 'تعذر حذف القائمة.');
    }
  } catch (err) {
    alert('حدث خطأ أثناء محاولة حذف القائمة.');
  }
}

// ================= Toggle Source State =================
async function togglePlaylistSource(sourceId, enable) {
  try {
    const res = await fetch(`/api/v1/admin/sources/${sourceId}/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: enable })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      handleSyncPlaylists();
    }
  } catch (err) {
    console.error('Failed to toggle source:', err);
  }
}

// ================= Test Source Connectivity =================
async function testPlaylistSource(sourceId) {
  const card = document.getElementById(`sourceCard-${sourceId}`);
  if (!card) return;

  const btn = card.querySelector('button[onclick*="testPlaylistSource"]');
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>جارٍ الفحص...</span>`;
  }

  try {
    const res = await fetch(`/api/v1/admin/sources/${sourceId}/test`, { method: 'POST' });
    const data = await res.json();

    let msg = `نتيجة فحص الاتصال بالسيرفر:\n\nالحالة: ${data.status}\nالتفاصيل: ${data.message || 'تم فحص الاتصال'}`;
    alert(msg);
    handleSyncPlaylists();
  } catch (err) {
    alert('تعذر إجراء فحص الاتصال بالسيرفر.');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }
}

// ================= Helper Alert =================
function showPlaylistsAlert(type, message) {
  const alertEl = document.getElementById('playlistsAlert');
  if (!alertEl) return;
  alertEl.className = `alert-box ${type}`;
  alertEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> <span>${escapeHtml(message)}</span>`;
  alertEl.classList.remove('hidden');
  setTimeout(() => {
    alertEl.classList.add('hidden');
  }, 4500);
}

// ================= Copy MAC =================
function copyDeviceMac() {
  if (!currentDevice || !currentDevice.mac) return;
  navigator.clipboard.writeText(currentDevice.mac).then(() => {
    const btn = document.getElementById('btnCopyMac');
    if (btn) {
      const orig = btn.innerHTML;
      btn.innerHTML = `<i class="fa-solid fa-check" style="color: var(--success);"></i>`;
      setTimeout(() => { btn.innerHTML = orig; }, 1500);
    }
  }).catch(() => {});
}
