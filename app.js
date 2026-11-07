/**
 * SADDAM IPTV - Client Application Logic (Portal, Auth Gate, Device Pairing & Playlist Management)
 * Strict compliance with SADDAM_IPTV_Website_Pairing_Fixes_SPD:
 * - Gated Entry Screen: Login required before any internal page or API is accessible.
 * - Portal Home: Shows two distinct options: "إقران جهاز (Pair Device)" and "لوحة الإدارة (Admin Panel)".
 * - Direct Seamless Navigation: Moving between Portal, Pairing, and Admin Panel requires NO re-authentication.
 * - Non-persistent Session: Session cookie without Max-Age/Expires; NO tokens in localStorage/sessionStorage.
 * - Device Pairing: Requires both valid MAC Address and Device Key (PIN).
 * - High-performance vanilla JavaScript optimized for fast loading and old devices.
 */

// Configuration & API Base
const API_BASE = window.SADDAM_API_BASE || '';

// In-Memory Application State (Strictly NO credentials in localStorage/sessionStorage)
const state = {
  admin: null,
  device: null,
  devices: [],
  sources: [],
  currentEditingSourceId: null
};

// ================= DOM Initialization =================
document.addEventListener('DOMContentLoaded', () => {
  initAuthUI();
  initPortalNavigation();
  initPairingUI();
  initDashboardUI();
  initSourceModals();

  // Check session status on page load
  checkSessionStatus();
});

// ================= 1. Authentication & Session Gate (SPD Section 2 & 4) =================

function initAuthUI() {
  const loginForm = document.getElementById('mainLoginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', handleLoginSubmit);
  }

  const togglePasswordBtn = document.getElementById('toggleLoginPassword');
  if (togglePasswordBtn) {
    togglePasswordBtn.addEventListener('click', () => {
      const passInput = document.getElementById('loginPassword');
      const eyeIcon = document.getElementById('loginPasswordEye');
      if (passInput && eyeIcon) {
        if (passInput.type === 'password') {
          passInput.type = 'text';
          eyeIcon.className = 'fa-solid fa-eye-slash';
        } else {
          passInput.type = 'password';
          eyeIcon.className = 'fa-solid fa-eye';
        }
      }
    });
  }

  const logoutBtn = document.getElementById('btnLogout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', handleLogout);
  }
}

async function checkSessionStatus() {
  try {
    const res = await fetch(`${API_BASE}/api/v1/auth/status`, {
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    });
    const data = await res.json();

    if (res.ok && data.authenticated && data.admin) {
      state.admin = data.admin;
      updateHeaderForAuthenticatedAdmin();

      // Check active device & load all unexpired account playlists
      await checkActiveDeviceSession();
    } else {
      setUnauthenticatedState();
    }
  } catch (err) {
    console.error('Session check error:', err);
    setUnauthenticatedState();
  }
}

async function checkActiveDeviceSession() {
  try {
    const res = await fetch(`${API_BASE}/api/web/me`, {
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    });
    const data = await res.json();
    if (res.ok && data.success) {
      if (data.device) {
        state.device = data.device;
      }
      if (data.devices) {
        state.devices = data.devices;
      }
    }
  } catch (e) {
    console.warn('Failed to load active device session:', e);
  }

  // Core business rule: All unexpired playlists belong to the account and remain accessible.
  await loadSources();

  const hash = window.location.hash.replace('#', '');
  if (hash === 'pairing') {
    showView('pairing');
  } else if (hash === 'portal') {
    showView('portal');
  } else {
    // If the account has playlists or paired devices, show dashboard directly so playlists are immediately displayed
    if (state.sources.length > 0 || state.device) {
      showView('dashboard');
    } else {
      showView('portal');
    }
  }
}

function updateHeaderForAuthenticatedAdmin() {
  const adminBadge = document.getElementById('adminUserBadge');
  const adminText = document.getElementById('adminUserText');
  const btnHeaderPlaylists = document.getElementById('btnHeaderPlaylists');
  const adminAccessBtn = document.getElementById('btnAdminAccess');
  const logoutBtn = document.getElementById('btnLogout');

  if (adminBadge && adminText && state.admin) {
    adminText.textContent = `مشرف ${state.admin.slot}: ${state.admin.username}`;
    adminBadge.classList.remove('hidden');
  }
  if (btnHeaderPlaylists) btnHeaderPlaylists.classList.remove('hidden');
  if (adminAccessBtn) adminAccessBtn.classList.remove('hidden');
  if (logoutBtn) logoutBtn.classList.remove('hidden');
}

function setUnauthenticatedState() {
  state.admin = null;
  state.device = null;
  state.devices = [];
  state.sources = [];

  const adminBadge = document.getElementById('adminUserBadge');
  const headerDeviceBadge = document.getElementById('headerDeviceBadge');
  const btnHeaderPortal = document.getElementById('btnHeaderPortal');
  const btnHeaderPlaylists = document.getElementById('btnHeaderPlaylists');
  const adminAccessBtn = document.getElementById('btnAdminAccess');
  const logoutBtn = document.getElementById('btnLogout');

  if (adminBadge) adminBadge.classList.add('hidden');
  if (headerDeviceBadge) headerDeviceBadge.classList.add('hidden');
  if (btnHeaderPortal) btnHeaderPortal.classList.add('hidden');
  if (btnHeaderPlaylists) btnHeaderPlaylists.classList.add('hidden');
  if (adminAccessBtn) adminAccessBtn.classList.add('hidden');
  if (logoutBtn) logoutBtn.classList.add('hidden');

  showView('login');
}

async function handleLoginSubmit(e) {
  e.preventDefault();
  hideAlert('loginAlert');

  const usernameInput = document.getElementById('loginUsername');
  const passwordInput = document.getElementById('loginPassword');
  const submitBtn = document.getElementById('btnLoginSubmit');
  const btnText = document.getElementById('btnLoginText');

  const username = usernameInput?.value.trim();
  const password = passwordInput?.value.trim();

  if (!username || !password) {
    showAlert('loginAlert', 'يرجى إدخال اسم المستخدم وكلمة المرور', 'danger');
    return;
  }

  submitBtn.disabled = true;
  if (btnText) btnText.textContent = 'جارٍ التحقق والدخول...';

  try {
    const res = await fetch(`${API_BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      credentials: 'same-origin'
    });

    const data = await res.json();
    if (res.ok && data.success && data.admin) {
      state.admin = data.admin;
      updateHeaderForAuthenticatedAdmin();
      if (passwordInput) passwordInput.value = '';
      await checkActiveDeviceSession();
      showToast(`مرحباً بك، المشرف ${data.admin.username}`, 'success');
    } else {
      showAlert('loginAlert', data.error || 'اسم المستخدم أو كلمة المرور غير صحيحة', 'danger');
    }
  } catch (err) {
    console.error('Login error:', err);
    showAlert('loginAlert', 'تعذر الاتصال بالخادم. يرجى التأكد من تشغيل السيرفر والمحاولة مجدداً.', 'danger');
  } finally {
    submitBtn.disabled = false;
    if (btnText) btnText.textContent = 'تسجيل الدخول';
  }
}

async function handleLogout() {
  if (!confirm('هل أنت متأكد من رغبتك في تسجيل الخروج وإنهاء الجلسة؟')) return;

  try {
    await fetch(`${API_BASE}/api/v1/auth/logout`, {
      method: 'POST',
      credentials: 'same-origin'
    });
  } catch (e) {
    console.warn('Logout API call failed:', e);
  }

  setUnauthenticatedState();
  showToast('تم تسجيل الخروج وإنهاء الجلسة بنجاح', 'info');
}

// ================= 2. Portal Navigation & View Switcher (SPD Section 3) =================

function initPortalNavigation() {
  const cardPair = document.getElementById('cardPairDevice');
  const btnOpenPair = document.getElementById('btnOpenPairingView');
  if (cardPair) {
    cardPair.addEventListener('click', (e) => {
      e.preventDefault();
      showView('pairing');
    });
  }
  if (btnOpenPair) {
    btnOpenPair.addEventListener('click', (e) => {
      e.stopPropagation();
      showView('pairing');
    });
  }

  const cardPlaylists = document.getElementById('cardPlaylists');
  const btnOpenPlaylists = document.getElementById('btnOpenPlaylistsView');
  if (cardPlaylists) {
    cardPlaylists.addEventListener('click', (e) => {
      e.preventDefault();
      showView('dashboard');
    });
  }
  if (btnOpenPlaylists) {
    btnOpenPlaylists.addEventListener('click', (e) => {
      e.stopPropagation();
      showView('dashboard');
    });
  }

  const btnHeaderPortal = document.getElementById('btnHeaderPortal');
  if (btnHeaderPortal) {
    btnHeaderPortal.addEventListener('click', () => {
      showView('portal');
    });
  }

  const btnHeaderPlaylists = document.getElementById('btnHeaderPlaylists');
  if (btnHeaderPlaylists) {
    btnHeaderPlaylists.addEventListener('click', () => {
      showView('dashboard');
    });
  }

  const btnBackPairing = document.getElementById('btnBackToPortalFromPairing');
  if (btnBackPairing) {
    btnBackPairing.addEventListener('click', () => {
      showView('portal');
    });
  }

  const btnBackDash = document.getElementById('btnBackToPortalFromDash');
  if (btnBackDash) {
    btnBackDash.addEventListener('click', () => {
      showView('portal');
    });
  }

  const brandLink = document.getElementById('brandHomeLink');
  if (brandLink) {
    brandLink.addEventListener('click', (e) => {
      e.preventDefault();
      if (state.admin) {
        showView('portal');
      } else {
        showView('login');
      }
    });
  }
}

function showView(viewName) {
  const loginSection = document.getElementById('loginSection');
  const portalSection = document.getElementById('portalSection');
  const pairingSection = document.getElementById('pairingSection');
  const dashboardSection = document.getElementById('dashboardSection');
  const btnHeaderPortal = document.getElementById('btnHeaderPortal');
  const btnHeaderPlaylists = document.getElementById('btnHeaderPlaylists');
  const headerDeviceBadge = document.getElementById('headerDeviceBadge');

  // Hide all sections first
  if (loginSection) loginSection.classList.add('hidden');
  if (portalSection) portalSection.classList.add('hidden');
  if (pairingSection) pairingSection.classList.add('hidden');
  if (dashboardSection) dashboardSection.classList.add('hidden');

  if (viewName === 'login') {
    if (loginSection) loginSection.classList.remove('hidden');
    if (btnHeaderPortal) btnHeaderPortal.classList.add('hidden');
    if (btnHeaderPlaylists) btnHeaderPlaylists.classList.add('hidden');
    if (headerDeviceBadge) headerDeviceBadge.classList.add('hidden');
    window.location.hash = '';
  } else if (viewName === 'portal') {
    if (portalSection) portalSection.classList.remove('hidden');
    if (btnHeaderPortal) btnHeaderPortal.classList.add('hidden');
    if (btnHeaderPlaylists) btnHeaderPlaylists.classList.remove('hidden');
    if (state.device && headerDeviceBadge) {
      headerDeviceBadge.classList.remove('hidden');
    }
    window.location.hash = 'portal';
  } else if (viewName === 'pairing') {
    if (pairingSection) pairingSection.classList.remove('hidden');
    if (btnHeaderPortal) btnHeaderPortal.classList.remove('hidden');
    if (btnHeaderPlaylists) btnHeaderPlaylists.classList.remove('hidden');
    hideAlert('pairingAlert');
    window.location.hash = 'pairing';
  } else if (viewName === 'dashboard') {
    if (dashboardSection) dashboardSection.classList.remove('hidden');
    if (btnHeaderPortal) btnHeaderPortal.classList.remove('hidden');
    if (btnHeaderPlaylists) btnHeaderPlaylists.classList.remove('hidden');
    if (state.device && headerDeviceBadge) {
      headerDeviceBadge.classList.remove('hidden');
    }
    updateDeviceDashboardUI();
    window.location.hash = 'dashboard';
  }
}

// ================= 3. Device Pairing UI (SPD Section 3.1 & 5) =================

function initPairingUI() {
  const macInput = document.getElementById('macInput');
  if (macInput) {
    macInput.addEventListener('input', (e) => {
      let val = e.target.value.toUpperCase().replace(/[^A-F0-9]/g, '');
      if (val.length > 12) val = val.substring(0, 12);
      let formatted = val.match(/.{1,2}/g)?.join(':') || val;
      e.target.value = formatted;
    });
  }

  const pinInput = document.getElementById('pinInput');
  if (pinInput) {
    pinInput.addEventListener('input', (e) => {
      e.target.value = e.target.value.replace(/[^0-9]/g, '').slice(0, 6);
    });
  }

  const togglePin = document.getElementById('togglePinVisibility');
  if (togglePin) {
    togglePin.addEventListener('click', () => {
      const isPass = pinInput.type === 'password';
      pinInput.type = isPass ? 'text' : 'password';
      const eye = document.getElementById('pinEyeIcon');
      if (eye) {
        eye.className = isPass ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
      }
    });
  }

  const pairingForm = document.getElementById('pairingForm');
  if (pairingForm) {
    pairingForm.addEventListener('submit', handleDevicePairingSubmit);
  }

  // Help Modal
  const helpModal = document.getElementById('modalHelp');
  document.querySelectorAll('.open-help-modal').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      helpModal?.classList.remove('hidden');
    });
  });
  const closeHelp = document.getElementById('closeHelpModal');
  if (closeHelp) {
    closeHelp.addEventListener('click', () => {
      helpModal?.classList.add('hidden');
    });
  }
}

async function handleDevicePairingSubmit(e) {
  e.preventDefault();
  hideAlert('pairingAlert');

  const macInput = document.getElementById('macInput');
  const pinInput = document.getElementById('pinInput');
  const btnPair = document.getElementById('btnPair');
  const btnPairText = document.getElementById('btnPairText');

  const mac = macInput?.value.trim();
  const pin = pinInput?.value.trim();

  if (!mac || !pin) {
    showAlert('pairingAlert', 'يرجى إدخال عنوان MAC ومفتاح الجهاز PIN معاً.', 'danger');
    return;
  }

  if (pin.length !== 6) {
    showAlert('pairingAlert', 'رمز PIN يجب أن يتكون من 6 أرقام.', 'danger');
    return;
  }

  btnPair.disabled = true;
  if (btnPairText) btnPairText.textContent = 'جارٍ التحقق من الجهاز...';

  try {
    const res = await fetch(`${API_BASE}/api/web/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mac, pin }),
      credentials: 'same-origin'
    });

    const data = await res.json();
    if (res.ok && data.success && data.device) {
      state.device = data.device;
      showToast('تم التحقق وإقران الجهاز بنجاح!', 'success');
      showView('dashboard');
      await loadSources();
    } else {
      showAlert('pairingAlert', data.error || 'تعذر التحقق من الرموز. راجع القيم في تطبيق SADDAM IPTV وحاول مجدداً.', 'danger');
    }
  } catch (err) {
    console.error('Pairing error:', err);
    showAlert('pairingAlert', 'تعذر الاتصال بالخادم لإتمام عملية الإقران.', 'danger');
  } finally {
    btnPair.disabled = false;
    if (btnPairText) btnPairText.textContent = 'التحقق وإقران الجهاز';
  }
}

// ================= 4. Paired Device Dashboard & Playlists Management (SPD Section 3.1 & 6) =================

function initDashboardUI() {
  const btnUnlink = document.getElementById('btnUnlink');
  if (btnUnlink) {
    btnUnlink.addEventListener('click', handleUnlinkDevice);
  }

  const btnPairNewFromDash = document.getElementById('btnPairNewFromDash');
  if (btnPairNewFromDash) {
    btnPairNewFromDash.addEventListener('click', () => {
      showView('pairing');
    });
  }

  const searchInput = document.getElementById('sourceSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', renderSources);
  }

  const filterSelect = document.getElementById('sourceFilterSelect');
  if (filterSelect) {
    filterSelect.addEventListener('change', renderSources);
  }
}

function updateDeviceDashboardUI() {
  const labelEl = document.getElementById('deviceLabel');
  const macFullEl = document.getElementById('deviceMacFull');
  const macMaskedEl = document.getElementById('deviceMacMasked');
  const platformEl = document.getElementById('devicePlatform');
  const syncVersionEl = document.getElementById('deviceSyncVersion');

  if (state.device) {
    const devCount = state.devices && state.devices.length ? state.devices.length : 1;
    if (labelEl) labelEl.textContent = state.device.device_label || state.device.label || 'جهاز المشترك';
    if (macFullEl) macFullEl.textContent = `${state.device.device_code || state.device.mac || '-'} (${devCount} أجهزة مقترنة)`;
    if (macMaskedEl) macMaskedEl.textContent = state.device.device_code_masked || state.device.device_code || state.device.mac || '-';
    if (platformEl) platformEl.textContent = state.device.platform || 'Android';
    if (syncVersionEl) syncVersionEl.textContent = `v${state.device.sync_version || 1}`;
  } else {
    if (labelEl) labelEl.textContent = state.admin ? `قوائم حساب: ${state.admin.username}` : 'قوائم الحساب';
    if (macFullEl) macFullEl.textContent = 'جميع الأجهزة المقترنة بحسابك';
    if (macMaskedEl) macMaskedEl.textContent = '';
    if (platformEl) platformEl.textContent = 'All Devices';
    if (syncVersionEl) syncVersionEl.textContent = 'v1';
  }
}

async function loadSources() {
  try {
    const res = await fetch(`${API_BASE}/api/web/sources`, {
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    });
    const data = await res.json();
    if (res.ok && data.success) {
      state.sources = data.sources || [];
      renderSources();
      updateSourcesStats();
    }
  } catch (err) {
    console.error('Failed to load device sources:', err);
  }
}

function updateSourcesStats() {
  const totalEl = document.getElementById('statTotalSources');
  const activeEl = document.getElementById('statActiveSources');
  const workingEl = document.getElementById('statWorkingSources');

  const total = state.sources.length;
  const active = state.sources.filter(s => (s.is_enabled || s.enabled) && !s.is_expired && s.status !== 'expired').length;
  const working = state.sources.filter(s => s.status === 'working' && !s.is_expired).length;

  if (totalEl) totalEl.textContent = total;
  if (activeEl) activeEl.textContent = active;
  if (workingEl) workingEl.textContent = working;
}

function renderSources() {
  const container = document.getElementById('sourcesContainer');
  if (!container) return;

  const searchQuery = document.getElementById('sourceSearchInput')?.value.trim().toLowerCase() || '';
  const filterVal = document.getElementById('sourceFilterSelect')?.value || 'all';

  let filtered = state.sources.filter(s => {
    const matchesSearch = !searchQuery || s.name.toLowerCase().includes(searchQuery) || (s.server_url && s.server_url.toLowerCase().includes(searchQuery));
    const isEnabled = Boolean(s.is_enabled ?? s.enabled);
    const isExpired = Boolean(s.is_expired || s.status === 'expired');
    if (!matchesSearch) return false;
    if (filterVal === 'active') return isEnabled && !isExpired;
    if (filterVal === 'expired') return isExpired;
    if (filterVal === 'disabled') return !isEnabled;
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px 20px; color: var(--text-muted); background: var(--bg-card); border-radius: var(--border-radius-sm); border: 1px dashed var(--border-color);">
        <i class="fa-solid fa-satellite-dish fa-3x" style="color: var(--text-dim); margin-bottom: 12px; display: block;"></i>
        <h3 style="font-size: 1.1rem; color: #fff; margin-bottom: 6px;">لا توجد قوائم تشغيل مضافة لحسابك</h3>
        <p style="font-size: 0.88rem; margin-bottom: 16px;">لم تتم إضافة قوائم بعد. انقر على «إضافة قائمة جديدة» لبدء إضافة مصادر البث وربطها بأجهزتك.</p>
        <button class="btn btn-primary btn-sm" onclick="openAddSourceModal()">
          <i class="fa-solid fa-plus"></i> إضافة أول قائمة
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(src => {
    const isEnabled = Boolean(src.is_enabled ?? src.enabled);
    const isExpired = Boolean(src.is_expired || src.status === 'expired');
    const isXtream = src.source_type === 'xtream';
    const typeBadge = isXtream
      ? `<span class="badge badge-purple"><i class="fa-solid fa-server"></i> Xtream</span>`
      : `<span class="badge badge-blue"><i class="fa-solid fa-file-lines"></i> M3U</span>`;

    let statusBadge = `<span class="badge badge-gray">غير مفحوص</span>`;
    if (isExpired) {
      statusBadge = `<span class="badge badge-red"><i class="fa-solid fa-clock"></i> منتهية الصلاحية</span>`;
    } else if (src.status === 'working') {
      statusBadge = `<span class="badge badge-green"><i class="fa-solid fa-circle-check"></i> يعمل بنجاح</span>`;
    } else if (src.status === 'connection_failed') {
      statusBadge = `<span class="badge badge-red"><i class="fa-solid fa-circle-xmark"></i> فشل الاتصال</span>`;
    }

    const maskedUrl = maskUrlCredentials(src.server_url);

    let expMeta = '';
    if (src.expires_at) {
      expMeta = `<span>الصلاحية: <strong style="color: ${isExpired ? 'var(--danger)' : 'var(--text-muted)'};">${escapeHtml(String(src.expires_at))}</strong></span>`;
    }

    return `
      <div class="playlist-card-item">
        <div class="playlist-card-info">
          <div class="playlist-card-title-row">
            <span class="playlist-card-title">${escapeHtml(src.name)}</span>
            ${typeBadge}
            ${statusBadge}
          </div>
          <div class="playlist-card-meta">
            <span class="playlist-card-url" title="${escapeHtml(maskedUrl)}">${escapeHtml(maskedUrl)}</span>
            <span>الحالة: <strong style="color: ${isEnabled && !isExpired ? 'var(--success)' : 'var(--text-dim)'};">${isEnabled ? (isExpired ? 'منتهية' : 'مفعلة') : 'معطلة'}</strong></span>
            ${expMeta}
          </div>
        </div>

        <div class="playlist-card-actions">
          <button class="action-btn" id="btnTestWebSrc_${src.id}" title="فحص الاتصال فوراً" onclick="testSourceConnection(${src.id})">
            <i class="fa-solid fa-stethoscope" style="color: var(--primary);"></i>
          </button>
          <button class="action-btn" title="تعديل القائمة" onclick="openEditSourceModal(${src.id})">
            <i class="fa-solid fa-pen-to-square" style="color: var(--warning);"></i>
          </button>
          <button class="action-btn danger" title="حذف القائمة" onclick="deleteSource(${src.id}, '${escapeHtml(src.name)}')">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

async function handleUnlinkDevice() {
  try {
    await fetch(`${API_BASE}/api/web/unlink`, {
      method: 'POST',
      credentials: 'same-origin'
    });
  } catch (e) {}

  state.device = null;
  state.sources = [];
  const headerDeviceBadge = document.getElementById('headerDeviceBadge');
  if (headerDeviceBadge) headerDeviceBadge.classList.add('hidden');
  showView('portal');
  showToast('تم إلغاء ربط الجهاز من هذه الجلسة بنجاح', 'info');
}

async function testSourceConnection(sourceId) {
  const btn = document.getElementById(`btnTestWebSrc_${sourceId}`);
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin" style="color: var(--primary);"></i>`;
  }

  try {
    const res = await fetch(`${API_BASE}/api/web/sources/${sourceId}/test`, {
      method: 'POST',
      credentials: 'same-origin'
    });
    const data = await res.json();
    if (data.status === 'working') {
      showToast(`نجح الفحص: ${data.message || 'المصدر يعمل بكفاءة'}`, 'success');
    } else {
      showToast(`تنبيه: ${data.message || 'فشل الاتصال بالمصدر'}`, 'warning');
    }
    await loadSources();
  } catch (e) {
    showToast('خطأ في الاتصال بالسيرفر أثناء الفحص', 'danger');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-stethoscope" style="color: var(--primary);"></i>`;
    }
  }
}

async function deleteSource(sourceId, sourceName) {
  if (!confirm(`هل أنت متأكد من حذف قائمة التشغيل «${sourceName}»؟ لن يتمكن هذا الجهاز من الوصول إليها بعد الحذف.`)) return;

  try {
    const res = await fetch(`${API_BASE}/api/web/sources/${sourceId}`, {
      method: 'DELETE',
      credentials: 'same-origin'
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast('تم حذف قائمة التشغيل بنجاح', 'success');
      await loadSources();
    } else {
      showToast(data.error || 'فشل حذف القائمة', 'danger');
    }
  } catch (e) {
    showToast('تعذر حذف القائمة', 'danger');
  }
}

// ================= 5. Add / Edit Source Modal =================

function initSourceModals() {
  const btnOpenAdd = document.getElementById('btnOpenAddSource');
  if (btnOpenAdd) {
    btnOpenAdd.addEventListener('click', openAddSourceModal);
  }

  const closeBtn = document.getElementById('closeSourceModal');
  const cancelBtn = document.getElementById('cancelSourceModalBtn');
  const modal = document.getElementById('modalSource');

  if (closeBtn) closeBtn.addEventListener('click', () => modal?.classList.add('hidden'));
  if (cancelBtn) cancelBtn.addEventListener('click', () => modal?.classList.add('hidden'));

  const tabM3u = document.getElementById('tabOptionM3u');
  const tabXtream = document.getElementById('tabOptionXtream');
  if (tabM3u && tabXtream) {
    tabM3u.addEventListener('click', () => setSourceModalType('m3u'));
    tabXtream.addEventListener('click', () => setSourceModalType('xtream'));
  }

  const form = document.getElementById('sourceForm');
  if (form) {
    form.addEventListener('submit', handleSaveSourceForm);
  }
}

let activeSourceTypeInModal = 'm3u';

window.openAddSourceModal = function () {
  state.currentEditingSourceId = null;
  hideAlert('modalSourceAlert');

  const titleEl = document.getElementById('sourceModalTitle');
  if (titleEl) titleEl.textContent = 'إضافة قائمة تشغيل جديدة للحساب';

  const form = document.getElementById('sourceForm');
  if (form) form.reset();

  const expInput = document.getElementById('sourceExpiresAtInput');
  if (expInput) expInput.value = '';

  setSourceModalType('m3u');
  document.getElementById('modalSource')?.classList.remove('hidden');
};

window.openEditSourceModal = function (sourceId) {
  state.currentEditingSourceId = sourceId;
  hideAlert('modalSourceAlert');

  const src = state.sources.find(s => s.id === sourceId);
  if (!src) return;

  const titleEl = document.getElementById('sourceModalTitle');
  if (titleEl) titleEl.textContent = `تعديل قائمة: ${src.name}`;

  document.getElementById('sourceNameInput').value = src.name || '';
  const type = src.source_type || 'm3u';
  setSourceModalType(type);

  if (type === 'xtream') {
    document.getElementById('xtreamServerInput').value = src.server_url || '';
    document.getElementById('xtreamUserInput').value = src.username || '';
    document.getElementById('xtreamPassInput').value = '';
  } else {
    document.getElementById('sourceUrlInput').value = src.server_url || '';
  }

  const expInput = document.getElementById('sourceExpiresAtInput');
  if (expInput) {
    if (src.expires_at) {
      try {
        let val = String(src.expires_at).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
          expInput.value = val;
        } else if (/^\d+$/.test(val)) {
          let ts = parseInt(val);
          if (ts < 10000000000) ts *= 1000;
          let d = new Date(ts);
          expInput.value = d.toISOString().split('T')[0];
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

  document.getElementById('modalSource')?.classList.remove('hidden');
};

function setSourceModalType(type) {
  activeSourceTypeInModal = type;
  const tabM3u = document.getElementById('tabOptionM3u');
  const tabXtream = document.getElementById('tabOptionXtream');
  const m3uFields = document.getElementById('m3uFields');
  const xtreamFields = document.getElementById('xtreamFields');

  if (type === 'm3u') {
    tabM3u?.style.setProperty('border-color', 'var(--primary)');
    tabXtream?.style.removeProperty('border-color');
    m3uFields?.classList.remove('hidden');
    xtreamFields?.classList.add('hidden');
  } else {
    tabXtream?.style.setProperty('border-color', 'var(--primary)');
    tabM3u?.style.removeProperty('border-color');
    m3uFields?.classList.add('hidden');
    xtreamFields?.classList.remove('hidden');
  }
}

async function handleSaveSourceForm(e) {
  e.preventDefault();
  hideAlert('modalSourceAlert');

  const name = document.getElementById('sourceNameInput')?.value.trim();
  const submitBtn = document.getElementById('btnSaveSource');

  let server_url = '';
  let username = '';
  let password = '';

  if (activeSourceTypeInModal === 'xtream') {
    server_url = document.getElementById('xtreamServerInput')?.value.trim();
    username = document.getElementById('xtreamUserInput')?.value.trim();
    password = document.getElementById('xtreamPassInput')?.value.trim();
  } else {
    server_url = document.getElementById('sourceUrlInput')?.value.trim();
  }

  if (!name || !server_url) {
    showAlert('modalSourceAlert', 'يرجى إدخال اسم القائمة ورابط السيرفر.', 'danger');
    return;
  }

  submitBtn.disabled = true;

  try {
    const payload = {
      name,
      source_type: activeSourceTypeInModal,
      server_url,
      username: activeSourceTypeInModal === 'xtream' ? username : '',
      enabled: 1
    };
    if (password) {
      payload.password = password;
    }

    const expDateVal = document.getElementById('sourceExpiresAtInput')?.value;
    if (expDateVal) {
      payload.expires_at = expDateVal;
    }

    const isEdit = Boolean(state.currentEditingSourceId);
    const url = isEdit
      ? `${API_BASE}/api/web/sources/${state.currentEditingSourceId}`
      : `${API_BASE}/api/web/sources`;
    const method = isEdit ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'same-origin'
    });

    const data = await res.json();
    if (res.ok && data.success) {
      document.getElementById('modalSource')?.classList.add('hidden');
      showToast(isEdit ? 'تم حفظ التعديلات بنجاح' : 'تمت إضافة القائمة بنجاح', 'success');
      await loadSources();
    } else {
      showAlert('modalSourceAlert', data.error || 'فشل حفظ القائمة', 'danger');
    }
  } catch (err) {
    showAlert('modalSourceAlert', 'تعذر حفظ القائمة: خطأ في الاتصال بالخادم', 'danger');
  } finally {
    submitBtn.disabled = false;
  }
}

// ================= Utility Helpers =================

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function maskUrlCredentials(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    if (u.searchParams.has('password')) {
      u.searchParams.set('password', '••••••••');
    }
    if (u.password) {
      u.password = '••••••••';
    }
    return u.toString();
  } catch (e) {
    return url.replace(/([?&]password=)[^&]*/gi, '$1••••••••');
  }
}

function showAlert(elementId, message, type = 'danger') {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.className = `alert-box ${type}`;
  el.innerHTML = `<span>${escapeHtml(message)}</span>`;
  el.classList.remove('hidden');
}

function hideAlert(elementId) {
  const el = document.getElementById(elementId);
  if (el) el.classList.add('hidden');
}

function showToast(message, type = 'success') {
  let toast = document.getElementById('globalToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'globalToast';
    toast.style.position = 'fixed';
    toast.style.bottom = '24px';
    toast.style.left = '24px';
    toast.style.zIndex = '99999';
    toast.style.padding = '12px 20px';
    toast.style.borderRadius = '8px';
    toast.style.fontSize = '0.92rem';
    toast.style.fontWeight = '600';
    toast.style.boxShadow = '0 10px 25px rgba(0,0,0,0.4)';
    toast.style.transition = 'all 0.3s ease';
    toast.style.display = 'flex';
    toast.style.alignItems = 'center';
    toast.style.gap = '10px';
    document.body.appendChild(toast);
  }

  if (type === 'success') {
    toast.style.background = 'var(--success, #10b981)';
    toast.style.color = '#ffffff';
    toast.innerHTML = `<i class="fa-solid fa-circle-check"></i> <span>${escapeHtml(message)}</span>`;
  } else if (type === 'info') {
    toast.style.background = 'var(--primary, #6366f1)';
    toast.style.color = '#ffffff';
    toast.innerHTML = `<i class="fa-solid fa-circle-info"></i> <span>${escapeHtml(message)}</span>`;
  } else {
    toast.style.background = 'var(--danger, #ef4444)';
    toast.style.color = '#ffffff';
    toast.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> <span>${escapeHtml(message)}</span>`;
  }

  toast.style.opacity = '1';
  toast.style.transform = 'translateY(0)';

  clearTimeout(toast.dismissTimer);
  toast.dismissTimer = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(12px)';
  }, 4000);
}
