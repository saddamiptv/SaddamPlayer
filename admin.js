/**
 * SADDAM IPTV - Complete Admin Dashboard & Security Client
 * Strict compliance with SADDAM_IPTV_Complete_Admin_Dashboard_and_Security_SPD:
 * - Admin Authentication: Powered exclusively by the two approved administrator accounts (Drexx0301, Saddam1991)
 * - Access Flow: Login -> Admin Dashboard directly (no intermediate device-pairing or MAC/PIN requirement)
 * - Complete Management: Users/Devices, Playlists (All Devices), Device Activity, Synchronization, Audit Logs, Security Settings
 * - Real Backend Data: Zero mock records, zero placeholders
 * - High-performance vanilla JavaScript optimized for fast loading and old devices
 */

// Application State
const State = {
  currentAdmin: null,
  activeTab: 'overview',
  devices: {
    page: 1,
    limit: 10,
    total: 0,
    search: '',
    status: '',
    data: []
  },
  playlists: {
    page: 1,
    limit: 15,
    total: 0,
    search: '',
    type: 'all',
    status: 'all',
    data: []
  },
  audit: {
    page: 1,
    limit: 15,
    total: 0,
    search: '',
    data: []
  },
  devicesListCache: [],
  currentViewingDeviceId: null,
  currentPinValue: '',
  confirmActionCallback: null
};

// ================= Security & Utility Helpers =================

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(epochOrIso) {
  if (!epochOrIso) return '—';
  let date;
  if (typeof epochOrIso === 'number') {
    date = new Date(epochOrIso * 1000);
  } else {
    date = new Date(epochOrIso);
  }
  if (isNaN(date.getTime())) return '—';

  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

function formatRelativeTime(epochOrIso) {
  if (!epochOrIso) return 'غير متصل بعد';
  let ts;
  if (typeof epochOrIso === 'number') {
    ts = epochOrIso * 1000;
  } else {
    ts = new Date(epochOrIso).getTime();
  }
  if (isNaN(ts) || ts <= 0) return 'غير متصل بعد';

  const now = Date.now();
  const diffSec = Math.floor((now - ts) / 1000);
  if (diffSec < 60) return 'منذ لحظات';
  if (diffSec < 3600) return `منذ ${Math.floor(diffSec / 60)} دقيقة`;
  if (diffSec < 86400) return `منذ ${Math.floor(diffSec / 3600)} ساعة`;
  return formatDate(epochOrIso);
}

function maskUrlSecret(url) {
  if (!url) return '—';
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
    // If not a standard URL, mask password query if present
    return url.replace(/([?&]password=)[^&]*/gi, '$1••••••••');
  }
}

function debounce(fn, delay = 350) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

function showAlert(elementId, message, type = 'error', autoHideMs = 5000) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.className = `alert-box alert-${type}`;
  el.textContent = message;
  el.classList.remove('hidden');
  if (autoHideMs > 0) {
    setTimeout(() => {
      if (el.textContent === message) el.classList.add('hidden');
    }, autoHideMs);
  }
}

function hideAlert(elementId) {
  const el = document.getElementById(elementId);
  if (el) el.classList.add('hidden');
}

// Global Toast Feedback
function showToast(message, type = 'success') {
  let toast = document.getElementById('globalAdminToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'globalAdminToast';
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
  } else if (type === 'warning') {
    toast.style.background = 'var(--warning, #f59e0b)';
    toast.style.color = '#ffffff';
    toast.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <span>${escapeHtml(message)}</span>`;
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

// ================= DOM Initialization =================

document.addEventListener('DOMContentLoaded', () => {
  initAuthUI();
  initSidebarTabs();
  initDeviceManagementEvents();
  initPlaylistManagementEvents();
  initActivitySyncAuditEvents();
  initSecurityTabEvents();
  initModalsEvents();

  // Check initial admin session
  checkAdminSession();
});

// ================= 1. Authentication & Session =================

function initAuthUI() {
  const loginForm = document.getElementById('unifiedLoginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', handleAdminLogin);
  }

  const togglePasswordBtn = document.getElementById('togglePasswordBtn');
  if (togglePasswordBtn) {
    togglePasswordBtn.addEventListener('click', () => {
      const passInput = document.getElementById('passwordInput');
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

  const logoutBtn = document.getElementById('btnAdminLogout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', handleAdminLogout);
  }
}

async function checkAdminSession() {
  try {
    const res = await fetch('/api/v1/auth/status', { credentials: 'same-origin' });
    const data = await res.json();
    if (data.authenticated && data.admin) {
      setAuthenticatedAdmin(data.admin);
      showDashboardView();
      switchTab('overview');
    } else {
      setUnauthenticated();
    }
  } catch (e) {
    console.error('Session check failed:', e);
    setUnauthenticated();
  }
}

function setAuthenticatedAdmin(admin) {
  State.currentAdmin = admin;
  const badge = document.getElementById('adminSlotBadge');
  const badgeText = document.getElementById('adminSlotText');
  const logoutBtn = document.getElementById('btnAdminLogout');

  if (badge && badgeText) {
    badgeText.textContent = `مشرف ${admin.slot}: ${admin.username}`;
    badge.classList.remove('hidden');
  }
  if (logoutBtn) {
    logoutBtn.classList.remove('hidden');
  }
}

function setUnauthenticated() {
  State.currentAdmin = null;
  const badge = document.getElementById('adminSlotBadge');
  const logoutBtn = document.getElementById('btnAdminLogout');
  if (badge) badge.classList.add('hidden');
  if (logoutBtn) logoutBtn.classList.add('hidden');
  showLoginView();
}

function showLoginView() {
  const loginView = document.getElementById('loginView');
  const dashView = document.getElementById('dashboardView');
  if (loginView) loginView.classList.remove('hidden');
  if (dashView) dashView.classList.add('hidden');
}

function showDashboardView() {
  const loginView = document.getElementById('loginView');
  const dashView = document.getElementById('dashboardView');
  if (loginView) loginView.classList.add('hidden');
  if (dashView) dashView.classList.remove('hidden');
}

async function handleAdminLogin(e) {
  e.preventDefault();
  hideAlert('loginAlert');

  const usernameInput = document.getElementById('usernameInput');
  const passwordInput = document.getElementById('passwordInput');
  const submitBtn = document.getElementById('btnLoginSubmit');
  const btnText = document.getElementById('loginBtnText');

  const username = usernameInput?.value.trim();
  const password = passwordInput?.value.trim();

  if (!username || !password) {
    showAlert('loginAlert', 'يرجى إدخال اسم المستخدم وكلمة المرور', 'error');
    return;
  }

  submitBtn.disabled = true;
  if (btnText) btnText.textContent = 'جاري التحقق والدخول...';

  try {
    const res = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      credentials: 'same-origin'
    });

    const data = await res.json();
    if (res.ok && data.success && data.admin) {
      setAuthenticatedAdmin(data.admin);
      showDashboardView();
      switchTab('overview');
      if (passwordInput) passwordInput.value = '';
      showToast(`مرحباً بك، المشرف ${data.admin.username}`, 'success');
    } else {
      showAlert('loginAlert', data.error || 'اسم المستخدم أو كلمة المرور غير صحيحة', 'error');
    }
  } catch (err) {
    console.error('Login error:', err);
    showAlert('loginAlert', 'فشل الاتصال بالخادم. يرجى التحقق من الشبكة والمحاولة مجدداً.', 'error');
  } finally {
    submitBtn.disabled = false;
    if (btnText) btnText.textContent = 'الدخول إلى لوحة الإدارة';
  }
}

async function handleAdminLogout() {
  showConfirmModal('تسجيل الخروج', 'هل أنت متأكد من رغبتك في إنهاء الجلسة الإدارية الحالية والخروج؟', async () => {
    try {
      await fetch('/api/v1/auth/logout', {
        method: 'POST',
        credentials: 'same-origin'
      });
    } catch (e) {
      console.warn('Logout API call failed:', e);
    }
    setUnauthenticated();
    showToast('تم إنهاء الجلسة الإدارية بنجاح', 'info');
  });
}

// ================= 2. Sidebar Navigation & Tabs =================

function initSidebarTabs() {
  const navItems = document.querySelectorAll('.sidebar-nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const tab = item.getAttribute('data-tab');
      if (tab) switchTab(tab);
    });
  });

  const btnRefreshOverview = document.getElementById('btnRefreshOverview');
  if (btnRefreshOverview) {
    btnRefreshOverview.addEventListener('click', () => loadOverviewData());
  }
}

window.switchTab = function (tabName, filterVal) {
  State.activeTab = tabName;

  // Update sidebar active status
  document.querySelectorAll('.sidebar-nav-item').forEach(item => {
    if (item.getAttribute('data-tab') === tabName) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  // Switch tab pane visibility
  const tabPanes = {
    overview: 'tabOverview',
    devices: 'tabDevices',
    playlists: 'tabPlaylists',
    activity: 'tabActivity',
    sync: 'tabSync',
    audit: 'tabAudit',
    security: 'tabSecurity'
  };

  Object.values(tabPanes).forEach(paneId => {
    const pane = document.getElementById(paneId);
    if (pane) pane.classList.add('hidden');
  });

  const targetPane = document.getElementById(tabPanes[tabName]);
  if (targetPane) targetPane.classList.remove('hidden');

  // Trigger relevant data loader
  if (tabName === 'overview') {
    loadOverviewData();
  } else if (tabName === 'devices') {
    if (filterVal) {
      const statusSelect = document.getElementById('deviceStatusFilter');
      if (statusSelect) statusSelect.value = filterVal;
      State.devices.status = filterVal;
    }
    loadDevicesData(1);
  } else if (tabName === 'playlists') {
    loadPlaylistsData(1);
  } else if (tabName === 'activity') {
    loadActivityData();
  } else if (tabName === 'sync') {
    loadSyncData();
  } else if (tabName === 'audit') {
    loadAuditData(1);
  } else if (tabName === 'security') {
    loadSecurityData();
  }
};

// ================= 3. Tab 1: Overview =================

async function loadOverviewData() {
  try {
    const res = await fetch('/api/v1/admin/stats', { credentials: 'same-origin' });
    if (res.status === 401) {
      setUnauthenticated();
      return;
    }
    const json = await res.json();
    if (!json.success || !json.data) return;

    const stats = json.data;
    document.getElementById('statTotalDevices').textContent = stats.total_devices || 0;
    document.getElementById('statActiveDevices').textContent = stats.active_devices || 0;
    document.getElementById('statTotalPlaylists').textContent = stats.total_sources || 0;
    document.getElementById('statActiveSessions').textContent = stats.active_sessions || 0;

    // Render Recent Audit Logs
    const tbody = document.getElementById('overviewRecentLogs');
    if (!tbody) return;

    if (!stats.recent_logs || stats.recent_logs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-dim); padding: 24px;">لا توجد عمليات مسجلة حديثاً</td></tr>`;
      return;
    }

    tbody.innerHTML = stats.recent_logs.map(log => {
      let actorDisplay = log.actor_type === 'admin' ? `<span class="badge badge-purple">مشرف #${log.actor_id}</span>` : `<span class="badge badge-gray">${escapeHtml(log.actor_type)}</span>`;
      let detailsText = '';
      if (typeof log.details === 'object' && log.details !== null) {
        detailsText = JSON.stringify(log.details);
      } else {
        detailsText = String(log.details || '');
      }
      return `
        <tr>
          <td>${actorDisplay}</td>
          <td><strong style="color: var(--primary);">${escapeHtml(log.action)}</strong></td>
          <td><code>${escapeHtml(log.target_type)} / ${escapeHtml(log.target_id)}</code></td>
          <td style="max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-muted);" title="${escapeHtml(detailsText)}">
            ${escapeHtml(detailsText)}
          </td>
          <td style="color: var(--text-dim); font-size: 0.85rem;">${formatDate(log.created_at)}</td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    console.error('Failed to load overview data:', err);
  }
}

// ================= 4. Tab 2: Devices Management =================

function initDeviceManagementEvents() {
  const searchInput = document.getElementById('deviceSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', debounce((e) => {
      State.devices.search = e.target.value.trim();
      loadDevicesData(1);
    }, 400));
  }

  const statusFilter = document.getElementById('deviceStatusFilter');
  if (statusFilter) {
    statusFilter.addEventListener('change', (e) => {
      State.devices.status = e.target.value;
      loadDevicesData(1);
    });
  }

  const refreshBtn = document.getElementById('btnRefreshDevices');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => loadDevicesData(State.devices.page));
  }

  const btnOpenCreate = document.getElementById('btnOpenCreateDeviceModal');
  if (btnOpenCreate) {
    btnOpenCreate.addEventListener('click', openCreateDeviceModal);
  }
}

async function loadDevicesData(page = 1) {
  State.devices.page = page;
  const tbody = document.getElementById('devicesTableBody');
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-dim); padding: 30px;">جاري تحميل الأجهزة...</td></tr>`;
  }

  try {
    const query = new URLSearchParams({
      page: State.devices.page,
      limit: State.devices.limit,
      search: State.devices.search,
      status: State.devices.status
    });

    const res = await fetch(`/api/v1/admin/devices?${query.toString()}`, { credentials: 'same-origin' });
    if (res.status === 401) {
      setUnauthenticated();
      return;
    }
    const json = await res.json();
    if (!json.success || !json.data) throw new Error(json.error || 'فشل تحميل بيانات الأجهزة');

    const result = json.data;
    State.devices.data = result.devices || [];
    State.devices.total = result.total || 0;

    renderDevicesTable(State.devices.data);
    renderPagination(
      'devicesPaginationText',
      'devicesPaginationControls',
      State.devices.page,
      State.devices.limit,
      State.devices.total,
      'loadDevicesData'
    );

  } catch (err) {
    console.error('Error loading devices:', err);
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--danger); padding: 24px;">تعذر تحميل بيانات الأجهزة: ${escapeHtml(err.message)}</td></tr>`;
    }
  }
}

function renderDevicesTable(devices) {
  const tbody = document.getElementById('devicesTableBody');
  if (!tbody) return;

  if (devices.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-dim); padding: 40px;">لا توجد أجهزة مطابقة للمعايير المحددة</td></tr>`;
    return;
  }

  tbody.innerHTML = devices.map(dev => {
    const isActive = dev.status === 'active';
    const statusBadge = isActive
      ? `<span class="badge badge-green"><i class="fa-solid fa-circle-check"></i> نشط</span>`
      : `<span class="badge badge-gray"><i class="fa-solid fa-ban"></i> معطل</span>`;

    const platformBadge = `<span class="badge badge-purple">${escapeHtml(dev.platform || 'Android')}</span>`;
    const lastSeenText = formatRelativeTime(dev.last_seen || dev.updated_at);
    const createdAtText = formatDate(dev.created_at);

    return `
      <tr>
        <td>
          <div style="font-weight: 700; color: #fff; display: flex; align-items: center; gap: 6px;">
            <span>${escapeHtml(dev.label || 'جهاز بدون تسمية')}</span>
            <button class="action-btn" title="تعديل التسمية" onclick="openEditDeviceModal(${dev.id}, '${escapeHtml(dev.label || '')}')">
              <i class="fa-solid fa-pencil" style="font-size: 0.75rem;"></i>
            </button>
          </div>
          <div style="font-size: 0.78rem; color: var(--text-dim);">معرف: #${dev.id}</div>
        </td>
        <td>
          <div style="display: flex; align-items: center; gap: 8px;">
            <code class="code-style">${escapeHtml(dev.mac_address)}</code>
            <button class="action-btn" title="نسخ كود MAC" onclick="copyTextToClipboard('${escapeHtml(dev.mac_address)}')">
              <i class="fa-regular fa-copy"></i>
            </button>
          </div>
        </td>
        <td>${statusBadge}</td>
        <td>
          <span class="badge badge-blue">
            <i class="fa-solid fa-satellite-dish"></i> ${dev.sources_count || 0} قوائم
          </span>
        </td>
        <td>${platformBadge}</td>
        <td style="color: var(--text-muted); font-size: 0.85rem;">${lastSeenText}</td>
        <td style="color: var(--text-dim); font-size: 0.85rem;">${createdAtText}</td>
        <td>
          <div style="display: flex; gap: 6px; justify-content: center; align-items: center;">
            <button class="action-btn" title="عرض التفاصيل والقوائم" onclick="openDeviceDetailsModal(${dev.id})">
              <i class="fa-solid fa-eye" style="color: var(--primary);"></i>
            </button>
            <button class="action-btn" title="إضافة قائمة لهذا الجهاز" onclick="openAddSourceModalForDevice(${dev.id})">
              <i class="fa-solid fa-plus-circle" style="color: var(--success);"></i>
            </button>
            <button class="action-btn" title="عرض أو تغيير PIN" onclick="openViewPinModal(${dev.id})">
              <i class="fa-solid fa-key" style="color: var(--warning);"></i>
            </button>
            <button class="action-btn" title="${isActive ? 'تعطيل الجهاز' : 'تفعيل الجهاز'}" onclick="toggleDeviceStatus(${dev.id}, '${isActive ? 'disabled' : 'active'}')">
              <i class="fa-solid ${isActive ? 'fa-toggle-on text-success' : 'fa-toggle-off text-muted'}"></i>
            </button>
            <button class="action-btn" title="حذف الجهاز نهائياً" onclick="confirmDeleteDevice(${dev.id}, '${escapeHtml(dev.label || dev.mac_address)}')">
              <i class="fa-solid fa-trash-can" style="color: var(--danger);"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function toggleDeviceStatus(deviceId, newStatus) {
  try {
    const res = await fetch(`/api/v1/admin/devices/${deviceId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
      credentials: 'same-origin'
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(`تم ${newStatus === 'active' ? 'تفعيل' : 'تعطيل'} الجهاز بنجاح`, 'success');
      loadDevicesData(State.devices.page);
    } else {
      showToast(data.error || 'فشل تحديث حالة الجهاز', 'error');
    }
  } catch (e) {
    showToast('تعذر تغيير حالة الجهاز: خطأ في الاتصال', 'error');
  }
}

function confirmDeleteDevice(deviceId, deviceLabel) {
  showConfirmModal(
    'حذف الجهاز وقوائمه نهائياً',
    `تحذير أمني: هل أنت متأكد من حذف الجهاز (${escapeHtml(deviceLabel)})؟ سيؤدي ذلك أيضاً لحذف جميع قوائم التشغيل والرموز المرتبطة به فوراً.`,
    async () => {
      try {
        const res = await fetch(`/api/v1/admin/devices/${deviceId}/delete`, {
          method: 'POST',
          credentials: 'same-origin'
        });
        const data = await res.json();
        if (res.ok && data.success) {
          showToast('تم حذف الجهاز وكافة اشتراكاته بنجاح', 'success');
          loadDevicesData(State.devices.page);
        } else {
          showToast(data.error || 'فشل حذف الجهاز', 'error');
        }
      } catch (e) {
        showToast('تعذر حذف الجهاز', 'error');
      }
    }
  );
}

// ================= 5. Tab 3: Playlists Management (All Devices) =================

function initPlaylistManagementEvents() {
  const searchInput = document.getElementById('playlistSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', debounce((e) => {
      State.playlists.search = e.target.value.trim();
      loadPlaylistsData(1);
    }, 400));
  }

  const typeFilter = document.getElementById('playlistTypeFilter');
  if (typeFilter) {
    typeFilter.addEventListener('change', (e) => {
      State.playlists.type = e.target.value;
      loadPlaylistsData(1);
    });
  }

  const statusFilter = document.getElementById('playlistStatusFilter');
  if (statusFilter) {
    statusFilter.addEventListener('change', (e) => {
      State.playlists.status = e.target.value;
      loadPlaylistsData(1);
    });
  }

  const refreshBtn = document.getElementById('btnRefreshPlaylists');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => loadPlaylistsData(State.playlists.page));
  }

  const openAddBtn = document.getElementById('btnOpenAddPlaylistModal');
  if (openAddBtn) {
    openAddBtn.addEventListener('click', () => openAddSourceModal());
  }
}

async function loadPlaylistsData(page = 1) {
  State.playlists.page = page;
  const tbody = document.getElementById('allPlaylistsTableBody');
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-dim); padding: 30px;">جاري تحميل قوائم التشغيل...</td></tr>`;
  }

  try {
    const query = new URLSearchParams({
      page: State.playlists.page,
      limit: State.playlists.limit,
      search: State.playlists.search,
      type: State.playlists.type,
      status: State.playlists.status
    });

    const res = await fetch(`/api/v1/admin/sources?${query.toString()}`, { credentials: 'same-origin' });
    if (res.status === 401) {
      setUnauthenticated();
      return;
    }
    const json = await res.json();
    if (!json.success || !json.data) throw new Error(json.error || 'فشل استرجاع قوائم التشغيل');

    const result = json.data;
    State.playlists.data = result.sources || [];
    State.playlists.total = result.total || 0;

    renderPlaylistsTable(State.playlists.data);
    renderPagination(
      'playlistsPaginationText',
      'playlistsPaginationControls',
      State.playlists.page,
      State.playlists.limit,
      State.playlists.total,
      'loadPlaylistsData'
    );

  } catch (err) {
    console.error('Error loading playlists:', err);
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--danger); padding: 24px;">تعذر تحميل قوائم التشغيل: ${escapeHtml(err.message)}</td></tr>`;
    }
  }
}

function renderPlaylistsTable(sources) {
  const tbody = document.getElementById('allPlaylistsTableBody');
  if (!tbody) return;

  if (sources.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-dim); padding: 40px;">لا توجد قوائم تشغيل مطابقة</td></tr>`;
    return;
  }

  tbody.innerHTML = sources.map(src => {
    const isEnabled = Boolean(src.is_active);
    const typeBadge = src.source_type === 'xtream'
      ? `<span class="badge badge-purple"><i class="fa-solid fa-server"></i> Xtream</span>`
      : `<span class="badge badge-blue"><i class="fa-solid fa-file-lines"></i> M3U</span>`;

    let opStatusBadge = `<span class="badge badge-gray">غير مفحوص</span>`;
    if (src.status === 'working') {
      opStatusBadge = `<span class="badge badge-green" title="${escapeHtml(src.error_code || 'يعمل')}"><i class="fa-solid fa-circle-check"></i> يعمل بنجاح</span>`;
    } else if (src.status === 'connection_failed') {
      opStatusBadge = `<span class="badge badge-red" title="${escapeHtml(src.error_code || 'فشل الاتصال')}"><i class="fa-solid fa-circle-xmark"></i> فشل الاتصال</span>`;
    } else if (src.status === 'auth_failed') {
      opStatusBadge = `<span class="badge badge-red" title="بيانات غير صحيحة"><i class="fa-solid fa-key"></i> خطأ دخول</span>`;
    }

    const maskedUrl = maskUrlSecret(src.server_url);
    const lastCheckText = formatRelativeTime(src.last_checked_at);

    return `
      <tr>
        <td>
          <div style="font-weight: 700; color: #fff;">${escapeHtml(src.name)}</div>
          <div style="font-size: 0.75rem; color: var(--text-dim);">#${src.id}</div>
        </td>
        <td>
          <div style="font-size: 0.85rem; font-weight: 600; color: var(--primary);">${escapeHtml(src.device_label || 'جهاز #' + src.device_id)}</div>
          <code class="code-style" style="font-size: 0.75rem;">${escapeHtml(src.device_mac || '')}</code>
        </td>
        <td>${typeBadge}</td>
        <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-code); font-size: 0.8rem; color: var(--text-muted);" title="${escapeHtml(maskedUrl)}">
          ${escapeHtml(maskedUrl)}
        </td>
        <td>${opStatusBadge}</td>
        <td>
          <button class="action-btn" title="${isEnabled ? 'تعطيل القائمة' : 'تفعيل القائمة'}" onclick="togglePlaylistEnabled(${src.id}, ${!isEnabled})">
            <i class="fa-solid ${isEnabled ? 'fa-toggle-on text-success' : 'fa-toggle-off text-muted'}"></i>
          </button>
        </td>
        <td style="font-size: 0.82rem; color: var(--text-muted);">${lastCheckText}</td>
        <td>
          <div style="display: flex; gap: 6px; justify-content: center;">
            <button class="action-btn" id="btnTestSrc_${src.id}" title="فحص الاتصال فوراً" onclick="testPlaylistConnection(${src.id})">
              <i class="fa-solid fa-stethoscope" style="color: var(--primary);"></i>
            </button>
            <button class="action-btn" title="تعديل القائمة" onclick="openEditSourceModal(${src.id})">
              <i class="fa-solid fa-pen-to-square" style="color: var(--warning);"></i>
            </button>
            <button class="action-btn" title="حذف القائمة" onclick="confirmDeletePlaylist(${src.id}, '${escapeHtml(src.name)}')">
              <i class="fa-solid fa-trash-can" style="color: var(--danger);"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function togglePlaylistEnabled(sourceId, newEnabledState) {
  try {
    const res = await fetch(`/api/v1/admin/sources/${sourceId}/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: newEnabledState }),
      credentials: 'same-origin'
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(`تم ${newEnabledState ? 'تفعيل' : 'إيقاف'} قائمة التشغيل بنجاح`, 'success');
      loadPlaylistsData(State.playlists.page);
    } else {
      showToast('فشل تعديل حالة القائمة', 'error');
    }
  } catch (e) {
    showToast('خطأ في الاتصال', 'error');
  }
}

async function testPlaylistConnection(sourceId) {
  const btn = document.getElementById(`btnTestSrc_${sourceId}`);
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin" style="color: var(--primary);"></i>`;
  }

  try {
    const res = await fetch(`/api/v1/admin/sources/${sourceId}/test`, {
      method: 'POST',
      credentials: 'same-origin'
    });
    const data = await res.json();
    if (data.status === 'working') {
      showToast(`نجح الفحص: ${data.message || 'المصدر يعمل بكفاءة'}`, 'success');
    } else {
      showToast(`تنبيه: ${data.message || 'فشل الاتصال بالمصدر'}`, 'warning');
    }
    loadPlaylistsData(State.playlists.page);
  } catch (e) {
    showToast('تعذر فحص المصدر: خطأ في الاتصال', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-stethoscope" style="color: var(--primary);"></i>`;
    }
  }
}

function confirmDeletePlaylist(sourceId, sourceName) {
  showConfirmModal('حذف قائمة التشغيل', `هل أنت متأكد من حذف القائمة (${escapeHtml(sourceName)})؟ لن يتمكن المشترك من الوصول إليها بعد الحذف.`, async () => {
    try {
      const res = await fetch(`/api/v1/admin/sources/${sourceId}/delete`, {
        method: 'POST',
        credentials: 'same-origin'
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast('تم حذف قائمة التشغيل بنجاح', 'success');
        loadPlaylistsData(State.playlists.page);
      } else {
        showToast(data.error || 'فشل حذف القائمة', 'error');
      }
    } catch (e) {
      showToast('خطأ أثناء حذف القائمة', 'error');
    }
  });
}

// ================= 6. Tab 4: Device Activity =================

async function loadActivityData() {
  const tbody = document.getElementById('activityTableBody');
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-dim); padding: 30px;">جاري تحميل النشاط...</td></tr>`;
  }

  try {
    const res = await fetch('/api/v1/admin/devices?limit=50', { credentials: 'same-origin' });
    if (res.status === 401) {
      setUnauthenticated();
      return;
    }
    const json = await res.json();
    if (!json.success || !json.data) throw new Error('فشل جلب بيانات النشاط');

    const devices = json.data.devices || [];
    if (devices.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-dim); padding: 30px;">لا توجد أجهزة مسجلة</td></tr>`;
      return;
    }

    tbody.innerHTML = devices.map(dev => {
      const isActive = dev.status === 'active';
      return `
        <tr>
          <td><strong style="color: #fff;">${escapeHtml(dev.label || 'جهاز بدون اسم')}</strong></td>
          <td><code class="code-style">${escapeHtml(dev.mac_address)}</code></td>
          <td><span class="badge badge-purple">${escapeHtml(dev.app_version || 'v1.5.0')}</span></td>
          <td><span class="badge badge-gray">${escapeHtml(dev.platform || 'Android TV')}</span></td>
          <td><code>v${dev.sync_version || 1}</code></td>
          <td>
            <span class="badge ${isActive ? 'badge-green' : 'badge-gray'}">
              ${isActive ? 'نشط ومصرح' : 'معطل'}
            </span>
          </td>
          <td style="color: var(--text-muted); font-size: 0.85rem;">
            ${formatRelativeTime(dev.last_seen || dev.updated_at)}
          </td>
        </tr>
      `;
    }).join('');

  } catch (e) {
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--danger); padding: 24px;">تعذر تحميل النشاط</td></tr>`;
    }
  }
}

// ================= 7. Tab 5: Synchronization =================

async function loadSyncData() {
  const tbody = document.getElementById('syncTableBody');
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-dim); padding: 30px;">جاري تحميل بيانات المزامنة...</td></tr>`;
  }

  try {
    const res = await fetch('/api/v1/admin/devices?limit=50', { credentials: 'same-origin' });
    if (res.status === 401) {
      setUnauthenticated();
      return;
    }
    const json = await res.json();
    if (!json.success || !json.data) throw new Error('فشل جلب أجهزة المزامنة');

    const devices = json.data.devices || [];
    if (devices.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-dim); padding: 30px;">لا توجد أجهزة لإجراء المزامنة</td></tr>`;
      return;
    }

    tbody.innerHTML = devices.map(dev => {
      return `
        <tr>
          <td><strong style="color: #fff;">${escapeHtml(dev.label || 'جهاز بدون اسم')}</strong></td>
          <td><code class="code-style">${escapeHtml(dev.mac_address)}</code></td>
          <td><span class="badge badge-blue">إصدار المزامنة: v${dev.sync_version || 1}</span></td>
          <td><span class="badge badge-gray">${dev.sources_count || 0} قوائم</span></td>
          <td><span class="badge ${dev.status === 'active' ? 'badge-green' : 'badge-gray'}">${dev.status === 'active' ? 'نشط' : 'معطل'}</span></td>
          <td style="color: var(--text-dim); font-size: 0.85rem;">${formatDate(dev.updated_at || dev.created_at)}</td>
          <td style="text-align: center;">
            <button class="btn btn-secondary btn-sm" id="btnSyncDevice_${dev.id}" onclick="triggerDeviceSync(${dev.id})">
              <i class="fa-solid fa-rotate"></i>
              <span>إرسال مزامنة فورية</span>
            </button>
          </td>
        </tr>
      `;
    }).join('');

  } catch (e) {
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--danger); padding: 24px;">تعذر تحميل بيانات المزامنة</td></tr>`;
    }
  }
}

async function triggerDeviceSync(deviceId) {
  const btn = document.getElementById(`btnSyncDevice_${deviceId}`);
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>جاري المزامنة...</span>`;
  }

  try {
    const res = await fetch(`/api/v1/admin/devices/${deviceId}/sync`, {
      method: 'POST',
      credentials: 'same-origin'
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(`تم إرسال أمر المزامنة بنجاح (الإصدار الجديد: v${data.sync_version})`, 'success');
      loadSyncData();
    } else {
      showToast(data.error || 'فشلت المزامنة', 'error');
    }
  } catch (e) {
    showToast('خطأ أثناء إرسال أمر المزامنة', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-rotate"></i> <span>إرسال مزامنة فورية</span>`;
    }
  }
}

// ================= 8. Tab 6: Audit Logs =================

function initActivitySyncAuditEvents() {
  const btnRefreshActivity = document.getElementById('btnRefreshActivity');
  if (btnRefreshActivity) btnRefreshActivity.addEventListener('click', loadActivityData);

  const btnRefreshSync = document.getElementById('btnRefreshSync');
  if (btnRefreshSync) btnRefreshSync.addEventListener('click', loadSyncData);

  const btnRefreshAudit = document.getElementById('btnRefreshAudit');
  if (btnRefreshAudit) btnRefreshAudit.addEventListener('click', () => loadAuditData(State.audit.page));

  const auditSearch = document.getElementById('auditSearchInput');
  if (auditSearch) {
    auditSearch.addEventListener('input', debounce((e) => {
      State.audit.search = e.target.value.trim();
      loadAuditData(1);
    }, 400));
  }
}

async function loadAuditData(page = 1) {
  State.audit.page = page;
  const tbody = document.getElementById('auditTableBody');
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-dim); padding: 30px;">جاري تحميل سجل العمليات...</td></tr>`;
  }

  try {
    const query = new URLSearchParams({
      page: State.audit.page,
      limit: State.audit.limit,
      search: State.audit.search
    });

    const res = await fetch(`/api/v1/admin/audit-logs?${query.toString()}`, { credentials: 'same-origin' });
    if (res.status === 401) {
      setUnauthenticated();
      return;
    }
    const json = await res.json();
    if (!json.success || !json.data) throw new Error('فشل جلب سجل العمليات');

    const result = json.data;
    State.audit.data = result.logs || [];
    State.audit.total = result.total || 0;

    renderAuditTable(State.audit.data);
    renderPagination(
      'auditPaginationText',
      'auditPaginationControls',
      State.audit.page,
      State.audit.limit,
      State.audit.total,
      'loadAuditData'
    );

  } catch (err) {
    console.error('Error loading audit logs:', err);
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--danger); padding: 24px;">تعذر تحميل السجل: ${escapeHtml(err.message)}</td></tr>`;
    }
  }
}

function renderAuditTable(logs) {
  const tbody = document.getElementById('auditTableBody');
  if (!tbody) return;

  if (logs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-dim); padding: 30px;">لا توجد عمليات مسجلة</td></tr>`;
    return;
  }

  tbody.innerHTML = logs.map(log => {
    let detailsText = '';
    if (typeof log.details === 'object' && log.details !== null) {
      detailsText = JSON.stringify(log.details);
    } else {
      detailsText = String(log.details || '');
    }

    return `
      <tr>
        <td style="color: var(--text-dim);">#${log.id}</td>
        <td>
          <span class="badge ${log.actor_type === 'admin' ? 'badge-purple' : 'badge-gray'}">
            ${escapeHtml(log.actor_type)} #${escapeHtml(log.actor_id)}
          </span>
        </td>
        <td><strong style="color: var(--primary);">${escapeHtml(log.action)}</strong></td>
        <td><code>${escapeHtml(log.target_type)} / ${escapeHtml(log.target_id)}</code></td>
        <td style="max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-muted); font-size: 0.82rem;" title="${escapeHtml(detailsText)}">
          ${escapeHtml(detailsText)}
        </td>
        <td style="color: var(--text-dim); font-size: 0.85rem;">${formatDate(log.created_at)}</td>
      </tr>
    `;
  }).join('');
}

// ================= 9. Tab 7: Security Settings =================

function initSecurityTabEvents() {
  const changeForm = document.getElementById('changePasswordForm');
  if (changeForm) {
    changeForm.addEventListener('submit', handleChangePasswordSubmit);
  }
}

async function loadSecurityData() {
  const container = document.getElementById('adminSlotsContainer');
  if (!container) return;

  try {
    const res = await fetch('/api/v1/auth/accounts-overview', { credentials: 'same-origin' });
    const json = await res.json();
    if (!json.success || !json.slots) return;

    container.innerHTML = json.slots.map(slot => {
      const isCurrentAdmin = State.currentAdmin && State.currentAdmin.slot === slot.slot;
      return `
        <div style="background: var(--bg-card); border: 1px solid ${isCurrentAdmin ? 'var(--primary)' : 'var(--border-color)'}; border-radius: var(--border-radius-sm); padding: 14px 16px; display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <div style="width: 40px; height: 40px; border-radius: 8px; background: ${isCurrentAdmin ? 'rgba(99, 102, 241, 0.15)' : 'var(--bg-glass)'}; color: ${isCurrentAdmin ? 'var(--primary)' : 'var(--text-muted)'}; display: flex; align-items: center; justify-content: center; font-size: 1.1rem;">
              <i class="fa-solid fa-user-shield"></i>
            </div>
            <div>
              <div style="font-weight: 700; color: #fff; font-size: 0.95rem;">
                المشرف (Slot ${slot.slot}): <span style="color: var(--primary);">${escapeHtml(slot.username)}</span>
                ${isCurrentAdmin ? '<span class="badge badge-green" style="margin-right: 6px;">حسابك النشط</span>' : ''}
              </div>
              <div style="font-size: 0.8rem; color: var(--text-dim);">
                الحالة: ${slot.configured ? '<span style="color: var(--success);">مهيأ ومؤمن بنجاح</span>' : '<span style="color: var(--warning);">غير مهيأ</span>'}
              </div>
            </div>
          </div>
          <span class="badge badge-gray" style="font-size: 0.75rem;">ثابت (Strict Slot)</span>
        </div>
      `;
    }).join('');

  } catch (e) {
    console.error('Failed to load accounts overview:', e);
  }
}

async function handleChangePasswordSubmit(e) {
  e.preventDefault();
  hideAlert('changePasswordAlert');

  const curPasswordInput = document.getElementById('curPassword');
  const newPasswordInput = document.getElementById('newPassword');
  const confirmPasswordInput = document.getElementById('confirmPassword');
  const submitBtn = document.getElementById('btnChangePasswordSubmit');

  const current_password = curPasswordInput.value.trim();
  const new_password = newPasswordInput.value.trim();
  const confirm = confirmPasswordInput.value.trim();

  if (!current_password || !new_password || !confirm) {
    showAlert('changePasswordAlert', 'جميع حقول كلمة المرور مطلوبة', 'error');
    return;
  }

  if (new_password.length < 8) {
    showAlert('changePasswordAlert', 'يجب ألا تقل كلمة المرور الجديدة عن 8 أحرف', 'error');
    return;
  }

  if (new_password !== confirm) {
    showAlert('changePasswordAlert', 'كلمتا المرور غير متطابقتين', 'error');
    return;
  }

  submitBtn.disabled = true;

  try {
    const res = await fetch('/api/v1/admin/update-credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password, new_password }),
      credentials: 'same-origin'
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showAlert('changePasswordAlert', 'تم حفظ كلمة المرور الجديدة بنجاح وتم تجديد جلستك الإدارية.', 'success');
      curPasswordInput.value = '';
      newPasswordInput.value = '';
      confirmPasswordInput.value = '';
      showToast('تم تحديث كلمة المرور بنجاح', 'success');
    } else {
      showAlert('changePasswordAlert', data.error || 'فشل تحديث كلمة المرور', 'error');
    }
  } catch (err) {
    showAlert('changePasswordAlert', 'تعذر الاتصال بالخادم لحفظ كلمة المرور', 'error');
  } finally {
    submitBtn.disabled = false;
  }
}

// ================= 10. Modals Management =================

function initModalsEvents() {
  // Create Device Form
  const createDevForm = document.getElementById('createDeviceForm');
  if (createDevForm) {
    createDevForm.addEventListener('submit', handleCreateDeviceSubmit);
  }

  // MAC Auto-formatter in Create Modal
  const newMacInput = document.getElementById('newDeviceMac');
  if (newMacInput) {
    newMacInput.addEventListener('input', (e) => {
      let val = e.target.value.toUpperCase().replace(/[^A-F0-9]/g, '');
      if (val.length > 12) val = val.substring(0, 12);
      let formatted = val.match(/.{1,2}/g)?.join(':') || val;
      e.target.value = formatted;
    });
  }

  // Add Source Form
  const addSrcForm = document.getElementById('addSourceForm');
  if (addSrcForm) {
    addSrcForm.addEventListener('submit', handleAddSourceSubmit);
  }

  // Edit Source Form
  const editSrcForm = document.getElementById('editSourceForm');
  if (editSrcForm) {
    editSrcForm.addEventListener('submit', handleEditSourceSubmit);
  }

  // Edit Device Form
  const editDevForm = document.getElementById('editDeviceForm');
  if (editDevForm) {
    editDevForm.addEventListener('submit', handleEditDeviceSubmit);
  }

  // View PIN Copy & Rotate actions
  const btnCopyPin = document.getElementById('btnCopyPinModal');
  if (btnCopyPin) {
    btnCopyPin.addEventListener('click', () => {
      if (State.currentPinValue) {
        copyTextToClipboard(State.currentPinValue);
        showToast('تم نسخ كود PIN إلى الحافظة', 'success');
      }
    });
  }

  const btnRotatePin = document.getElementById('btnRotatePinAction');
  if (btnRotatePin) {
    btnRotatePin.addEventListener('click', handleRotatePinInModal);
  }

  // Confirm Modal Action
  const btnConfirmAction = document.getElementById('btnConfirmModalAction');
  if (btnConfirmAction) {
    btnConfirmAction.addEventListener('click', () => {
      if (State.confirmActionCallback) {
        State.confirmActionCallback();
      }
      closeConfirmModal();
    });
  }
}

// Modal 1: Create Device
window.openCreateDeviceModal = function () {
  hideAlert('createDeviceAlert');
  const form = document.getElementById('createDeviceForm');
  if (form) form.reset();
  const modal = document.getElementById('createDeviceModal');
  if (modal) modal.classList.remove('hidden');
};

window.closeCreateDeviceModal = function () {
  const modal = document.getElementById('createDeviceModal');
  if (modal) modal.classList.add('hidden');
};

async function handleCreateDeviceSubmit(e) {
  e.preventDefault();
  hideAlert('createDeviceAlert');

  const macInput = document.getElementById('newDeviceMac');
  const labelInput = document.getElementById('newDeviceLabel');
  const platformSelect = document.getElementById('newDevicePlatform');
  const submitBtn = document.getElementById('btnCreateDeviceSubmit');

  const mac = macInput.value.trim().toUpperCase();
  const label = labelInput.value.trim();
  const platform = platformSelect.value;

  if (!mac || !label) {
    showAlert('createDeviceAlert', 'يرجى إدخال عنوان MAC واسم الجهاز', 'error');
    return;
  }

  submitBtn.disabled = true;

  try {
    const res = await fetch('/api/v1/admin/devices/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mac, label, platform }),
      credentials: 'same-origin'
    });

    const data = await res.json();
    if (res.ok && data.success && data.device) {
      closeCreateDeviceModal();
      showToast(`تم تسجيل الجهاز بنجاح! كود PIN: ${data.pin}`, 'success');
      loadDevicesData(1);
      // Automatically show the generated PIN modal
      openViewPinModalWithPin(data.device.id, data.pin);
    } else {
      showAlert('createDeviceAlert', data.error || 'فشل تسجيل الجهاز', 'error');
    }
  } catch (err) {
    showAlert('createDeviceAlert', 'خطأ في الاتصال بالخادم', 'error');
  } finally {
    submitBtn.disabled = false;
  }
}

// Modal 2: Add Playlist / Source
window.openAddSourceModal = async function () {
  hideAlert('addSourceAlert');
  const form = document.getElementById('addSourceForm');
  if (form) form.reset();
  handleAddSourceTypeChange();

  await populateDevicesDropdown('addSourceDeviceId');

  const modal = document.getElementById('addSourceModal');
  if (modal) modal.classList.remove('hidden');
};

window.openAddSourceModalForDevice = async function (deviceId) {
  await openAddSourceModal();
  const select = document.getElementById('addSourceDeviceId');
  if (select) select.value = String(deviceId);
};

window.closeAddSourceModal = function () {
  const modal = document.getElementById('addSourceModal');
  if (modal) modal.classList.add('hidden');
};

window.handleAddSourceTypeChange = function () {
  const type = document.getElementById('addSourceType')?.value;
  const xtreamFields = document.getElementById('addXtreamFields');
  if (xtreamFields) {
    if (type === 'xtream') {
      xtreamFields.classList.remove('hidden');
    } else {
      xtreamFields.classList.add('hidden');
    }
  }
};

async function populateDevicesDropdown(selectId) {
  const select = document.getElementById(selectId);
  if (!select) return;

  select.innerHTML = `<option value="">جاري تحميل الأجهزة...</option>`;

  try {
    const res = await fetch('/api/v1/admin/devices?limit=100', { credentials: 'same-origin' });
    const json = await res.json();
    if (json.success && json.data && json.data.devices) {
      State.devicesListCache = json.data.devices;
      if (State.devicesListCache.length === 0) {
        select.innerHTML = `<option value="">لا توجد أجهزة مسجلة بعد</option>`;
      } else {
        select.innerHTML = `<option value="">اختر الجهاز المستهدف...</option>` +
          State.devicesListCache.map(dev => `
            <option value="${dev.id}">
              ${escapeHtml(dev.label || 'جهاز')} (${escapeHtml(dev.mac_address)})
            </option>
          `).join('');
      }
    }
  } catch (e) {
    select.innerHTML = `<option value="">تعذر تحميل الأجهزة</option>`;
  }
}

async function handleAddSourceSubmit(e) {
  e.preventDefault();
  hideAlert('addSourceAlert');

  const deviceId = document.getElementById('addSourceDeviceId')?.value;
  const name = document.getElementById('addSourceName')?.value.trim();
  const sourceType = document.getElementById('addSourceType')?.value;
  const serverUrl = document.getElementById('addSourceUrl')?.value.trim();
  const username = document.getElementById('addSourceUser')?.value.trim();
  const password = document.getElementById('addSourcePass')?.value.trim();
  const submitBtn = document.getElementById('btnAddSourceSubmit');

  if (!deviceId || !name || !serverUrl) {
    showAlert('addSourceAlert', 'يرجى تحديد الجهاز وإدخال اسم القائمة ورابط السيرفر', 'error');
    return;
  }

  submitBtn.disabled = true;

  try {
    const payload = {
      name,
      source_type: sourceType,
      server_url: serverUrl,
      username: sourceType === 'xtream' ? username : '',
      password: sourceType === 'xtream' ? password : ''
    };

    const res = await fetch(`/api/v1/admin/devices/${deviceId}/sources`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'same-origin'
    });

    const data = await res.json();
    if (res.ok && data.success) {
      closeAddSourceModal();
      showToast('تمت إضافة قائمة التشغيل للجهاز بنجاح', 'success');
      loadPlaylistsData(1);
      loadDevicesData(State.devices.page);
    } else {
      showAlert('addSourceAlert', data.error || 'فشلت إضافة قائمة التشغيل', 'error');
    }
  } catch (err) {
    showAlert('addSourceAlert', 'تعذر الاتصال بالخادم', 'error');
  } finally {
    submitBtn.disabled = false;
  }
}

// Modal 3: Edit Playlist / Source
window.openEditSourceModal = function (sourceId) {
  hideAlert('editSourceAlert');
  const src = State.playlists.data.find(s => s.id === sourceId);
  if (!src) {
    showToast('تعذر العثور على بيانات المصدر', 'error');
    return;
  }

  document.getElementById('editSourceId').value = src.id;
  document.getElementById('editSourceName').value = src.name || '';
  document.getElementById('editSourceType').value = src.source_type || 'm3u';
  document.getElementById('editSourceUrl').value = src.server_url || '';
  document.getElementById('editSourceUser').value = src.username || '';
  document.getElementById('editSourcePass').value = '';
  document.getElementById('editSourceEnabled').checked = Boolean(src.is_active);

  handleEditSourceTypeChange();

  const modal = document.getElementById('editSourceModal');
  if (modal) modal.classList.remove('hidden');
};

window.closeEditSourceModal = function () {
  const modal = document.getElementById('editSourceModal');
  if (modal) modal.classList.add('hidden');
};

window.handleEditSourceTypeChange = function () {
  const type = document.getElementById('editSourceType')?.value;
  const xtreamFields = document.getElementById('editXtreamFields');
  if (xtreamFields) {
    if (type === 'xtream') {
      xtreamFields.classList.remove('hidden');
    } else {
      xtreamFields.classList.add('hidden');
    }
  }
};

async function handleEditSourceSubmit(e) {
  e.preventDefault();
  hideAlert('editSourceAlert');

  const sourceId = document.getElementById('editSourceId').value;
  const name = document.getElementById('editSourceName').value.trim();
  const sourceType = document.getElementById('editSourceType').value;
  const serverUrl = document.getElementById('editSourceUrl').value.trim();
  const username = document.getElementById('editSourceUser').value.trim();
  const password = document.getElementById('editSourcePass').value.trim();
  const enabled = document.getElementById('editSourceEnabled').checked;
  const submitBtn = document.getElementById('btnEditSourceSubmit');

  if (!name || !serverUrl) {
    showAlert('editSourceAlert', 'اسم القائمة ورابط السيرفر مطلوبان', 'error');
    return;
  }

  submitBtn.disabled = true;

  try {
    const payload = {
      name,
      source_type: sourceType,
      server_url: serverUrl,
      username: sourceType === 'xtream' ? username : '',
      enabled: enabled
    };
    if (password) {
      payload.password = password;
    }

    const res = await fetch(`/api/v1/admin/sources/${sourceId}/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'same-origin'
    });

    const data = await res.json();
    if (res.ok && data.success) {
      closeEditSourceModal();
      showToast('تم حفظ تعديلات قائمة التشغيل بنجاح', 'success');
      loadPlaylistsData(State.playlists.page);
    } else {
      showAlert('editSourceAlert', data.error || 'فشل تعديل القائمة', 'error');
    }
  } catch (err) {
    showAlert('editSourceAlert', 'تعذر حفظ التعديلات', 'error');
  } finally {
    submitBtn.disabled = false;
  }
}

// Modal 4: Device Full Details & Playlists Drawer
window.openDeviceDetailsModal = async function (deviceId) {
  const modal = document.getElementById('deviceDetailsModal');
  const container = document.getElementById('deviceDetailsContent');
  if (!modal || !container) return;

  container.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--text-dim);"><i class="fa-solid fa-spinner fa-spin fa-2x"></i><p style="margin-top: 10px;">جاري تحميل تفاصيل الجهاز...</p></div>`;
  modal.classList.remove('hidden');

  try {
    const res = await fetch(`/api/v1/admin/devices/${deviceId}`, { credentials: 'same-origin' });
    const json = await res.json();
    if (!json.success || !json.device) throw new Error(json.error || 'تعذر تحميل بيانات الجهاز');

    const dev = json.device;
    const sources = dev.sources || [];

    container.innerHTML = `
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; margin-bottom: 20px;">
        <div class="stat-card" style="padding: 14px;">
          <div style="font-size: 0.8rem; color: var(--text-dim);">اسم الجهاز</div>
          <div style="font-size: 1.1rem; font-weight: 700; color: #fff;">${escapeHtml(dev.label || 'جهاز بدون اسم')}</div>
          <div style="font-size: 0.78rem; color: var(--primary);">معرف #${dev.id}</div>
        </div>

        <div class="stat-card" style="padding: 14px;">
          <div style="font-size: 0.8rem; color: var(--text-dim);">عنوان MAC</div>
          <div style="font-size: 1.05rem; font-family: var(--font-code); color: var(--primary);">${escapeHtml(dev.mac_address)}</div>
          <div style="font-size: 0.78rem; color: var(--text-muted);">${escapeHtml(dev.platform || 'Android')}</div>
        </div>

        <div class="stat-card" style="padding: 14px;">
          <div style="font-size: 0.8rem; color: var(--text-dim);">الحالة والمزامنة</div>
          <div style="display: flex; gap: 8px; margin-top: 4px;">
            <span class="badge ${dev.status === 'active' ? 'badge-green' : 'badge-gray'}">${dev.status === 'active' ? 'نشط' : 'معطل'}</span>
            <span class="badge badge-purple">v${dev.sync_version || 1}</span>
          </div>
        </div>
      </div>

      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <h4 style="color: #fff; font-size: 1rem; display: flex; align-items: center; gap: 8px;">
          <i class="fa-solid fa-satellite-dish" style="color: var(--primary);"></i>
          <span>قوائم التشغيل المرتبطة بالجهاز (${sources.length})</span>
        </h4>
        <button class="btn btn-primary btn-sm" onclick="closeDeviceDetailsModal(); openAddSourceModalForDevice(${dev.id})">
          <i class="fa-solid fa-plus-circle"></i>
          <span>إضافة قائمة</span>
        </button>
      </div>

      ${sources.length === 0 ? `
        <div style="text-align: center; padding: 30px; background: var(--bg-card); border-radius: var(--border-radius-sm); color: var(--text-dim);">
          لا توجد أي قائمة تشغيل مرتبطة بهذا الجهاز حالياً
        </div>
      ` : `
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>اسم القائمة</th>
                <th>النوع</th>
                <th>رابط السيرفر (محمي)</th>
                <th>الحالة التشغيلية</th>
                <th>الحالة</th>
                <th>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              ${sources.map(s => `
                <tr>
                  <td><strong style="color: #fff;">${escapeHtml(s.name)}</strong></td>
                  <td><span class="badge ${s.source_type === 'xtream' ? 'badge-purple' : 'badge-blue'}">${escapeHtml(s.source_type)}</span></td>
                  <td style="max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-code); font-size: 0.8rem;">
                    ${escapeHtml(maskUrlSecret(s.server_url))}
                  </td>
                  <td>
                    <span class="badge ${s.status === 'working' ? 'badge-green' : 'badge-gray'}">
                      ${s.status === 'working' ? 'يعمل' : (s.status || 'غير مفحوص')}
                    </span>
                  </td>
                  <td>
                    <span class="badge ${s.is_active ? 'badge-green' : 'badge-gray'}">
                      ${s.is_active ? 'مفعلة' : 'معطلة'}
                    </span>
                  </td>
                  <td>
                    <button class="action-btn" title="حذف" onclick="confirmDeletePlaylist(${s.id}, '${escapeHtml(s.name)}')">
                      <i class="fa-solid fa-trash-can" style="color: var(--danger);"></i>
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `}
    `;

  } catch (err) {
    container.innerHTML = `<div style="text-align: center; padding: 30px; color: var(--danger);">${escapeHtml(err.message)}</div>`;
  }
};

window.closeDeviceDetailsModal = function () {
  const modal = document.getElementById('deviceDetailsModal');
  if (modal) modal.classList.add('hidden');
};

// Modal 5: Edit Device Label
window.openEditDeviceModal = function (deviceId, currentLabel) {
  document.getElementById('editDeviceId').value = deviceId;
  document.getElementById('editDeviceLabelInput').value = currentLabel;
  const modal = document.getElementById('editDeviceModal');
  if (modal) modal.classList.remove('hidden');
};

window.closeEditDeviceModal = function () {
  const modal = document.getElementById('editDeviceModal');
  if (modal) modal.classList.add('hidden');
};

async function handleEditDeviceSubmit(e) {
  e.preventDefault();
  const deviceId = document.getElementById('editDeviceId').value;
  const label = document.getElementById('editDeviceLabelInput').value.trim();

  if (!label) return;

  try {
    const res = await fetch(`/api/v1/admin/devices/${deviceId}/label`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label }),
      credentials: 'same-origin'
    });

    const data = await res.json();
    if (res.ok && data.success) {
      closeEditDeviceModal();
      showToast('تم تحديث اسم الجهاز بنجاح', 'success');
      loadDevicesData(State.devices.page);
    } else {
      showToast(data.error || 'فشل تحديث التسمية', 'error');
    }
  } catch (err) {
    showToast('تعذر تحديث اسم الجهاز', 'error');
  }
}

// Modal 6: View / Rotate PIN
window.openViewPinModal = async function (deviceId) {
  State.currentViewingDeviceId = deviceId;
  const modal = document.getElementById('viewPinModal');
  const box = document.getElementById('pinDisplayBox');
  if (!modal || !box) return;

  box.textContent = 'جاري الجلب...';
  modal.classList.remove('hidden');

  try {
    const res = await fetch(`/api/v1/admin/devices/${deviceId}`, { credentials: 'same-origin' });
    const json = await res.json();
    if (json.success && json.device) {
      // If server rotated or provides pin, show it. If not, prompt to rotate
      if (json.device.pin) {
        State.currentPinValue = json.device.pin;
        box.textContent = json.device.pin;
      } else {
        box.textContent = 'انقر لتدوير / توليد PIN';
      }
    }
  } catch (e) {
    box.textContent = 'خطأ';
  }
};

function openViewPinModalWithPin(deviceId, pin) {
  State.currentViewingDeviceId = deviceId;
  State.currentPinValue = pin;
  const modal = document.getElementById('viewPinModal');
  const box = document.getElementById('pinDisplayBox');
  if (modal && box) {
    box.textContent = pin;
    modal.classList.remove('hidden');
  }
}

window.closeViewPinModal = function () {
  const modal = document.getElementById('viewPinModal');
  if (modal) modal.classList.add('hidden');
  State.currentViewingDeviceId = null;
  State.currentPinValue = '';
};

async function handleRotatePinInModal() {
  if (!State.currentViewingDeviceId) return;
  const box = document.getElementById('pinDisplayBox');
  const btn = document.getElementById('btnRotatePinAction');

  if (btn) btn.disabled = true;
  box.textContent = '...توليد';

  try {
    const res = await fetch(`/api/v1/admin/devices/${State.currentViewingDeviceId}/rotate-pin`, {
      method: 'POST',
      credentials: 'same-origin'
    });
    const data = await res.json();
    if (res.ok && data.success && data.new_pin) {
      State.currentPinValue = data.new_pin;
      box.textContent = data.new_pin;
      showToast('تم توليد كود PIN جديد للجهاز بنجاح', 'success');
    } else {
      box.textContent = 'فشل';
      showToast('فشل توليد رمز PIN جديد', 'error');
    }
  } catch (e) {
    box.textContent = 'خطأ';
    showToast('خطأ أثناء تدوير PIN', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// Modal 7: Generic Confirmation Modal
window.showConfirmModal = function (title, message, callback) {
  const modal = document.getElementById('confirmModal');
  const titleEl = document.getElementById('confirmModalTitle');
  const msgEl = document.getElementById('confirmModalMessage');

  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = message;

  State.confirmActionCallback = callback;
  if (modal) modal.classList.remove('hidden');
};

window.closeConfirmModal = function () {
  const modal = document.getElementById('confirmModal');
  if (modal) modal.classList.add('hidden');
  State.confirmActionCallback = null;
};

// ================= 11. Pagination Rendering Helper =================

function renderPagination(textElementId, controlsElementId, currentPage, limit, totalRecords, fetchFunctionName) {
  const textEl = document.getElementById(textElementId);
  const controlsEl = document.getElementById(controlsElementId);
  if (!textEl || !controlsEl) return;

  const totalPages = Math.ceil(totalRecords / limit) || 1;
  const startItem = totalRecords === 0 ? 0 : (currentPage - 1) * limit + 1;
  const endItem = Math.min(currentPage * limit, totalRecords);

  textEl.textContent = `عرض ${startItem}-${endItem} من إجمالي ${totalRecords}`;

  if (totalPages <= 1) {
    controlsEl.innerHTML = '';
    return;
  }

  let html = '';
  // Prev button
  html += `
    <button class="pagination-btn" ${currentPage <= 1 ? 'disabled' : ''} onclick="${fetchFunctionName}(${currentPage - 1})" title="الصفحة السابقة">
      <i class="fa-solid fa-chevron-right"></i>
    </button>
  `;

  // Page Numbers
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || (p >= currentPage - 1 && p <= currentPage + 1)) {
      html += `
        <button class="pagination-btn ${p === currentPage ? 'active' : ''}" onclick="${fetchFunctionName}(${p})">
          ${p}
        </button>
      `;
    } else if (p === currentPage - 2 || p === currentPage + 2) {
      html += `<span style="color: var(--text-dim); padding: 0 4px;">...</span>`;
    }
  }

  // Next button
  html += `
    <button class="pagination-btn" ${currentPage >= totalPages ? 'disabled' : ''} onclick="${fetchFunctionName}(${currentPage + 1})" title="الصفحة التالية">
      <i class="fa-solid fa-chevron-left"></i>
    </button>
  `;

  controlsEl.innerHTML = html;
}

// Clipboard copy helper
window.copyTextToClipboard = function (text) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text);
  } else {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      document.execCommand('copy');
    } catch (e) {
      console.warn('Copy execCommand failed:', e);
    }
    document.body.removeChild(textArea);
  }
  showToast('تم النسخ إلى الحافظة', 'success');
};
