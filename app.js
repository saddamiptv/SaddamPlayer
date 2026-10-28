/**
 * SADDAM IPTV - Client Application Logic
 * Strict adherence to SDP v1.1
 * Direct Pairing -> Session -> Source Management -> Android Sync
 */

// Configuration & API Base
const API_BASE = window.SADDAM_API_BASE || 
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
    ? '' 
    : 'https://saddamplayer.onrender.com');

// Application State
const state = {
  token: localStorage.getItem('saddam_session_token') || null,
  device: null,
  sources: [],
  syncPreview: null,
  activeTab: 'overview',
  currentEditingSourceId: null
};

// DOM Elements Cache
const DOM = {};

document.addEventListener('DOMContentLoaded', () => {
  cacheDOMElements();
  bindEvents();
  checkExistingSession();
});

function cacheDOMElements() {
  DOM.pairingSection = document.getElementById('pairingSection');
  DOM.dashboardSection = document.getElementById('dashboardSection');
  DOM.macInput = document.getElementById('macInput');
  DOM.pinInput = document.getElementById('pinInput');
  DOM.togglePinVisibility = document.getElementById('togglePinVisibility');
  DOM.pairingForm = document.getElementById('pairingForm');
  DOM.btnPair = document.getElementById('btnPair');
  DOM.pairingAlert = document.getElementById('pairingAlert');
  DOM.demoFillBtn = document.getElementById('demoFillBtn');

  // Header & Device elements
  DOM.headerDeviceBadge = document.getElementById('headerDeviceBadge');
  DOM.deviceLabel = document.getElementById('deviceLabel');
  DOM.deviceMacMasked = document.getElementById('deviceMacMasked');
  DOM.devicePlatform = document.getElementById('devicePlatform');
  DOM.deviceSyncVersion = document.getElementById('deviceSyncVersion');
  DOM.btnLogout = document.getElementById('btnLogout');
  DOM.btnUnlink = document.getElementById('btnUnlink');

  // Overview Stats
  DOM.statTotalSources = document.getElementById('statTotalSources');
  DOM.statActiveSources = document.getElementById('statActiveSources');
  DOM.statWorkingSources = document.getElementById('statWorkingSources');
  DOM.statSyncState = document.getElementById('statSyncState');

  // Sources
  DOM.sourcesContainer = document.getElementById('sourcesContainer');
  DOM.btnOpenAddSource = document.getElementById('btnOpenAddSource');
  DOM.sourceSearchInput = document.getElementById('sourceSearchInput');
  DOM.sourceFilterSelect = document.getElementById('sourceFilterSelect');

  // Modals
  DOM.modalHelp = document.getElementById('modalHelp');
  DOM.modalSource = document.getElementById('modalSource');
  DOM.modalDelete = document.getElementById('modalDelete');
  DOM.modalUnlink = document.getElementById('modalUnlink');
  DOM.modalPrivacy = document.getElementById('modalPrivacy');

  // Add/Edit Source Form
  DOM.sourceForm = document.getElementById('sourceForm');
  DOM.sourceModalTitle = document.getElementById('sourceModalTitle');
  DOM.tabOptionM3u = document.getElementById('tabOptionM3u');
  DOM.tabOptionXtream = document.getElementById('tabOptionXtream');
  DOM.m3uFields = document.getElementById('m3uFields');
  DOM.xtreamFields = document.getElementById('xtreamFields');
  DOM.sourceNameInput = document.getElementById('sourceNameInput');
  DOM.sourceUrlInput = document.getElementById('sourceUrlInput');
  DOM.sourceDescInput = document.getElementById('sourceDescInput');
  DOM.sourceEnabledCheckbox = document.getElementById('sourceEnabledCheckbox');
  DOM.xtreamServerInput = document.getElementById('xtreamServerInput');
  DOM.xtreamUserInput = document.getElementById('xtreamUserInput');
  DOM.xtreamPassInput = document.getElementById('xtreamPassInput');

  // Sync tab
  DOM.syncPayloadViewer = document.getElementById('syncPayloadViewer');
  DOM.btnRefreshSyncPreview = document.getElementById('btnRefreshSyncPreview');
}

function bindEvents() {
  // MAC Input formatter
  if (DOM.macInput) {
    DOM.macInput.addEventListener('input', (e) => {
      let val = e.target.value.toUpperCase().replace(/[^A-F0-9]/g, '');
      if (val.length > 12) val = val.substring(0, 12);
      let formatted = val.match(/.{1,2}/g)?.join(':') || val;
      e.target.value = formatted;
    });
  }

  // PIN Input filter (strictly 6 digits)
  if (DOM.pinInput) {
    DOM.pinInput.addEventListener('input', (e) => {
      e.target.value = e.target.value.replace(/[^0-9]/g, '').slice(0, 6);
    });
  }

  // Toggle PIN visibility
  if (DOM.togglePinVisibility) {
    DOM.togglePinVisibility.addEventListener('click', () => {
      const isPassword = DOM.pinInput.type === 'password';
      DOM.pinInput.type = isPassword ? 'text' : 'password';
      DOM.togglePinVisibility.innerHTML = isPassword ? '<i class="fa-solid fa-eye-slash"></i>' : '<i class="fa-solid fa-eye"></i>';
    });
  }

  // Demo Credentials Fill
  if (DOM.demoFillBtn) {
    DOM.demoFillBtn.addEventListener('click', () => {
      DOM.macInput.value = 'AA:BB:CC:11:22:33';
      DOM.pinInput.value = '123456';
      showAlert(DOM.pairingAlert, 'تم تعبئة بيانات الجهاز التجريبي. اضغط على «ربط الجهاز والمتابعة».', 'info');
    });
  }

  // Pairing Form Submit
  if (DOM.pairingForm) {
    DOM.pairingForm.addEventListener('submit', handlePairing);
  }

  // Logout / Revoke
  if (DOM.btnLogout) {
    DOM.btnLogout.addEventListener('click', handleLogout);
  }

  // Unlink Device
  if (DOM.btnUnlink) {
    DOM.btnUnlink.addEventListener('click', () => openModal(DOM.modalUnlink));
  }
  const btnConfirmUnlink = document.getElementById('btnConfirmUnlink');
  if (btnConfirmUnlink) {
    btnConfirmUnlink.addEventListener('click', handleUnlink);
  }

  // Tabs Switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      switchTab(target);
    });
  });

  // Help Modal triggers
  document.querySelectorAll('.open-help-modal').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      openModal(DOM.modalHelp);
    });
  });

  // Privacy Modal triggers
  document.querySelectorAll('.open-privacy-modal').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      openModal(DOM.modalPrivacy);
    });
  });

  // Modal Closers
  document.querySelectorAll('.modal-close-trigger').forEach(btn => {
    btn.addEventListener('click', () => closeModal());
  });

  // Add Source Modal Trigger
  if (DOM.btnOpenAddSource) {
    DOM.btnOpenAddSource.addEventListener('click', () => {
      openAddSourceModal();
    });
  }

  // Source Type Switcher in modal
  if (DOM.tabOptionM3u && DOM.tabOptionXtream) {
    DOM.tabOptionM3u.addEventListener('click', () => setSourceModalType('m3u'));
    DOM.tabOptionXtream.addEventListener('click', () => setSourceModalType('xtream'));
  }

  // Source Form Save
  if (DOM.sourceForm) {
    DOM.sourceForm.addEventListener('submit', handleSaveSource);
  }

  // Search & Filter Sources
  if (DOM.sourceSearchInput) {
    DOM.sourceSearchInput.addEventListener('input', renderSources);
  }
  if (DOM.sourceFilterSelect) {
    DOM.sourceFilterSelect.addEventListener('change', renderSources);
  }

  // Sync Refresh
  if (DOM.btnRefreshSyncPreview) {
    DOM.btnRefreshSyncPreview.addEventListener('click', loadSyncPreview);
  }
}

// ==========================================================================
// Authentication & Session Management
// ==========================================================================

async function checkExistingSession() {
  if (!state.token) {
    showPairingView();
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/web/me`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await res.json();
    if (res.ok && data.success) {
      state.device = data.device;
      showDashboardView();
      await loadSources();
      await loadSyncPreview();
    } else {
      clearSession();
      showPairingView();
    }
  } catch (err) {
    console.error('Session check failed', err);
    showPairingView();
  }
}

async function handlePairing(e) {
  e.preventDefault();
  const mac = DOM.macInput.value.trim();
  const pin = DOM.pinInput.value.trim();

  if (!mac || !pin) {
    showAlert(DOM.pairingAlert, 'يرجى إدخال كل من MAC Code و PIN المكون من 6 أرقام.', 'danger');
    return;
  }

  if (pin.length !== 6) {
    showAlert(DOM.pairingAlert, 'رمز PIN يجب أن يتكون من 6 أرقام بالضبط.', 'danger');
    return;
  }

  setButtonLoading(DOM.btnPair, true, 'جارٍ التحقق من الرموز...');

  try {
    const res = await fetch(`${API_BASE}/api/web/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mac, pin })
    });
    
    let data;
    try {
      data = await res.json();
    } catch (parseError) {
      data = null;
    }

    if (res.ok && data && data.success) {
      state.token = data.token;
      state.device = data.device;
      localStorage.setItem('saddam_session_token', data.token);
      hideAlert(DOM.pairingAlert);
      showDashboardView();
      await loadDeviceProfile();
      await loadSources();
      await loadSyncPreview();
    } else {
      const errorMsg = (data && data.error) 
        ? data.error 
        : `تعذر الاتصال بالخادم (رمز الخطأ: ${res.status}).`;
      showAlert(DOM.pairingAlert, errorMsg, 'danger');
    }
  } catch (err) {
    console.error('Pairing fetch error:', err);
    if (window.location.protocol === 'file:') {
      showAlert(DOM.pairingAlert, 'تنبيه: لا يمكن الاتصال بالخادم عند فتح الصفحة كملف محلي (file://). يرجى رفع مجلد Publish إلى GitHub Pages أو تشغيل خادم محلي.', 'danger');
    } else {
      showAlert(DOM.pairingAlert, 'حدث خطأ أثناء الاتصال بالخادم. يرجى التأكد من تشغيل الخادم والاتصال بالإنترنت.', 'danger');
    }
  } finally {
    setButtonLoading(DOM.btnPair, false, 'ربط الجهاز والمتابعة <i class="fa-solid fa-arrow-left"></i>');
  }
}

async function handleLogout() {
  try {
    await fetch(`${API_BASE}/api/web/session/revoke`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
  } catch (e) {}
  clearSession();
  showPairingView();
}

async function handleUnlink() {
  const btn = document.getElementById('btnConfirmUnlink');
  setButtonLoading(btn, true, 'جارٍ إلغاء الربط...');
  try {
    const res = await fetch(`${API_BASE}/api/web/device/unlink`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (res.ok) {
      closeModal();
      clearSession();
      showPairingView();
      showAlert(DOM.pairingAlert, 'تم إلغاء ربط الجهاز بنجاح. يمكنك ربطه مجددًا في أي وقت.', 'success');
    }
  } catch (err) {
    alert('تعذر إلغاء الربط، حاول مجددًا.');
  } finally {
    setButtonLoading(btn, false, 'تأكيد إلغاء الربط');
  }
}

function clearSession() {
  state.token = null;
  state.device = null;
  state.sources = [];
  localStorage.removeItem('saddam_session_token');
}

function showPairingView() {
  DOM.pairingSection.classList.remove('hidden');
  DOM.dashboardSection.classList.add('hidden');
  DOM.headerDeviceBadge.classList.add('hidden');
  DOM.btnLogout.classList.add('hidden');
}

function showDashboardView() {
  DOM.pairingSection.classList.add('hidden');
  DOM.dashboardSection.classList.remove('hidden');
  DOM.headerDeviceBadge.classList.remove('hidden');
  DOM.btnLogout.classList.remove('hidden');
}

// ==========================================================================
// Device Profile & Sources
// ==========================================================================

async function loadDeviceProfile() {
  try {
    const res = await fetch(`${API_BASE}/api/web/me`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await res.json();
    if (res.ok && data.success) {
      state.device = data.device;
      updateDeviceHeaderUI();
    }
  } catch (e) {}
}

function updateDeviceHeaderUI() {
  if (!state.device) return;
  DOM.deviceLabel.textContent = state.device.device_label || 'جهاز Android TV';
  DOM.deviceMacMasked.textContent = state.device.device_code_masked || '';
  DOM.devicePlatform.textContent = `${state.device.platform} (تطبيق v${state.device.app_version})`;
  if (DOM.deviceSyncVersion) {
    DOM.deviceSyncVersion.textContent = `v${state.device.sync_version}`;
  }
}

async function loadSources() {
  try {
    const res = await fetch(`${API_BASE}/api/web/sources`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await res.json();
    if (res.ok && data.success) {
      state.sources = data.sources;
      renderSources();
      updateStats();
    }
  } catch (err) {
    console.error('Error fetching sources:', err);
  }
}

function updateStats() {
  const total = state.sources.length;
  const active = state.sources.filter(s => s.enabled === 1).length;
  const working = state.sources.filter(s => s.status === 'working').length;

  if (DOM.statTotalSources) DOM.statTotalSources.textContent = total;
  if (DOM.statActiveSources) DOM.statActiveSources.textContent = active;
  if (DOM.statWorkingSources) DOM.statWorkingSources.textContent = working;
  if (DOM.statSyncState) {
    DOM.statSyncState.textContent = total === 0 ? 'لا توجد مصادر' : 'متزامن (v' + (state.device?.sync_version || 1) + ')';
  }
}

function renderSources() {
  const container = DOM.sourcesContainer;
  if (!container) return;

  const searchTerm = (DOM.sourceSearchInput?.value || '').toLowerCase().trim();
  const filterType = DOM.sourceFilterSelect?.value || 'all';

  const filtered = state.sources.filter(source => {
    const matchSearch = source.name.toLowerCase().includes(searchTerm) || source.server_url.toLowerCase().includes(searchTerm);
    const matchType = (filterType === 'all') || (source.source_type === filterType);
    return matchSearch && matchType;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 50px 20px; background: rgba(13, 20, 38, 0.4); border-radius: 16px; border: 1px dashed rgba(255,255,255,0.1);">
        <i class="fa-solid fa-satellite-dish" style="font-size: 3rem; color: var(--primary); margin-bottom: 16px; opacity: 0.6;"></i>
        <h3 style="font-size: 1.2rem; margin-bottom: 8px;">لا توجد مصادر IPTV حالياً</h3>
        <p style="color: var(--text-muted); font-size: 0.9rem; margin-bottom: 20px;">قم بإضافة روابط M3U أو خوادم Xtream لربطها وتزامنها مع جهازك.</p>
        <button class="btn btn-primary" onclick="openAddSourceModal()">
          <i class="fa-solid fa-plus"></i> إضافة مصدر جديد
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(source => {
    const statusInfo = getStatusInfo(source.status);
    const isChecked = source.enabled === 1 ? 'checked' : '';
    const maskedUrl = source.server_url.length > 38 ? source.server_url.substring(0, 38) + '...' : source.server_url;
    const timeFormatted = source.last_tested_at ? new Date(source.last_tested_at * 1000).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : 'لم يتم';

    return `
      <div class="source-card" id="source-card-${source.id}">
        <div>
          <div class="source-card-top">
            <span class="source-type-badge ${source.source_type}">${source.source_type === 'xtream' ? 'Xtream API' : 'M3U / M3U8'}</span>
            <div class="status-pill ${source.status}">
              ${statusInfo.icon}
              <span>${statusInfo.label}</span>
            </div>
          </div>
          <h4 class="source-name">${escapeHtml(source.name)}</h4>
          <div class="source-url-text" title="${escapeHtml(source.server_url)}">
            <i class="fa-solid fa-link" style="margin-left: 6px; color: var(--primary);"></i>${escapeHtml(maskedUrl)}
          </div>
          ${source.description ? `<p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 12px;">${escapeHtml(source.description)}</p>` : ''}
          <div style="font-size: 0.78rem; color: var(--text-dim); margin-bottom: 14px;">
            <i class="fa-regular fa-clock" style="margin-left: 4px;"></i> آخر فحص: ${timeFormatted}
          </div>
        </div>

        <div class="source-card-bottom">
          <label class="switch-label">
            <div class="switch">
              <input type="checkbox" ${isChecked} onchange="toggleSourceEnabled(${source.id}, this.checked)">
              <span class="slider"></span>
            </div>
            <span>${source.enabled ? 'مفعّل للتطبيق' : 'معطّل'}</span>
          </label>

          <div style="display: flex; gap: 6px;">
            <button class="btn btn-secondary btn-icon" title="فحص المصدر" onclick="testSourceConnection(${source.id})">
              <i class="fa-solid fa-vial" id="test-icon-${source.id}"></i>
            </button>
            <button class="btn btn-secondary btn-icon" title="تعديل" onclick="openEditSourceModal(${source.id})">
              <i class="fa-solid fa-pen-to-square"></i>
            </button>
            <button class="btn btn-danger btn-icon" title="حذف المصدر" onclick="openDeleteSourceModal(${source.id}, '${escapeHtml(source.name)}')">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function getStatusInfo(status) {
  switch (status) {
    case 'working':
      return { label: 'يعمل بكفاءة', icon: '<i class="fa-solid fa-circle-check" style="color: var(--success);"></i>' };
    case 'connection_failed':
      return { label: 'فشل الاتصال', icon: '<i class="fa-solid fa-circle-xmark" style="color: var(--danger);"></i>' };
    case 'auth_failed':
      return { label: 'خطأ في بيانات الدخول', icon: '<i class="fa-solid fa-triangle-exclamation" style="color: var(--warning);"></i>' };
    case 'unavailable':
      return { label: 'المصدر غير متاح', icon: '<i class="fa-solid fa-ban" style="color: var(--danger);"></i>' };
    default:
      return { label: 'لم يتم الاختبار', icon: '<i class="fa-solid fa-circle-question" style="color: var(--text-muted);"></i>' };
  }
}

// ==========================================================================
// IPTV Source CRUD Actions
// ==========================================================================

function openAddSourceModal() {
  state.currentEditingSourceId = null;
  DOM.sourceModalTitle.textContent = 'إضافة مصدر IPTV جديد';
  DOM.sourceForm.reset();
  DOM.sourceEnabledCheckbox.checked = true;
  setSourceModalType('m3u');
  openModal(DOM.modalSource);
}

function openEditSourceModal(id) {
  const source = state.sources.find(s => s.id === id);
  if (!source) return;

  state.currentEditingSourceId = id;
  DOM.sourceModalTitle.textContent = 'تعديل مصدر IPTV';
  DOM.sourceNameInput.value = source.name;
  DOM.sourceDescInput.value = source.description || '';
  DOM.sourceEnabledCheckbox.checked = source.enabled === 1;

  if (source.source_type === 'xtream') {
    setSourceModalType('xtream');
    DOM.xtreamServerInput.value = source.server_url;
    DOM.xtreamUserInput.value = source.username || '';
    DOM.xtreamPassInput.value = '';
    DOM.xtreamPassInput.placeholder = 'اتركه فارغاً للاحتفاظ بكلمة المرور الحالية';
  } else {
    setSourceModalType('m3u');
    DOM.sourceUrlInput.value = source.server_url;
  }

  openModal(DOM.modalSource);
}

function setSourceModalType(type) {
  if (type === 'm3u') {
    DOM.tabOptionM3u.classList.add('active');
    DOM.tabOptionXtream.classList.remove('active');
    DOM.m3uFields.classList.remove('hidden');
    DOM.xtreamFields.classList.add('hidden');
    DOM.sourceUrlInput.required = true;
    DOM.xtreamServerInput.required = false;
    DOM.xtreamUserInput.required = false;
  } else {
    DOM.tabOptionM3u.classList.remove('active');
    DOM.tabOptionXtream.classList.add('active');
    DOM.m3uFields.classList.add('hidden');
    DOM.xtreamFields.classList.remove('hidden');
    DOM.sourceUrlInput.required = false;
    DOM.xtreamServerInput.required = true;
    DOM.xtreamUserInput.required = true;
  }
}

async function handleSaveSource(e) {
  e.preventDefault();
  const btn = document.getElementById('btnSaveSource');
  setButtonLoading(btn, true, 'جارٍ الحفظ...');

  const isXtream = DOM.tabOptionXtream.classList.contains('active');
  const payload = {
    name: DOM.sourceNameInput.value.trim(),
    source_type: isXtream ? 'xtream' : 'm3u',
    server_url: isXtream ? DOM.xtreamServerInput.value.trim() : DOM.sourceUrlInput.value.trim(),
    username: isXtream ? DOM.xtreamUserInput.value.trim() : '',
    password: isXtream ? DOM.xtreamPassInput.value.trim() : '',
    description: DOM.sourceDescInput.value.trim(),
    enabled: DOM.sourceEnabledCheckbox.checked
  };

  const isEdit = state.currentEditingSourceId !== null;
  const url = isEdit ? `${API_BASE}/api/web/sources/${state.currentEditingSourceId}` : `${API_BASE}/api/web/sources`;
  const method = isEdit ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (res.ok && data.success) {
      closeModal();
      await loadSources();
      await loadDeviceProfile();
      await loadSyncPreview();
    } else {
      alert(data.error || 'تعذر حفظ المصدر، راجع الرابط والبيانات.');
    }
  } catch (err) {
    alert('حدث خطأ في الاتصال بالخادم.');
  } finally {
    setButtonLoading(btn, false, 'حفظ المصدر');
  }
}

async function toggleSourceEnabled(id, enabled) {
  try {
    const res = await fetch(`${API_BASE}/api/web/sources/${id}/toggle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ enabled })
    });
    if (res.ok) {
      const src = state.sources.find(s => s.id === id);
      if (src) src.enabled = enabled ? 1 : 0;
      updateStats();
      await loadDeviceProfile();
      await loadSyncPreview();
    }
  } catch (e) {}
}

async function testSourceConnection(id) {
  const icon = document.getElementById(`test-icon-${id}`);
  if (icon) {
    icon.className = 'fa-solid fa-spinner fa-spin';
  }

  try {
    const res = await fetch(`${API_BASE}/api/web/sources/${id}/test`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await res.json();

    if (res.ok) {
      const src = state.sources.find(s => s.id === id);
      if (src) {
        src.status = data.status;
        src.last_tested_at = data.last_tested_at;
      }
      renderSources();
      updateStats();
    }
  } catch (err) {
    console.error('Test error:', err);
  } finally {
    if (icon) {
      icon.className = 'fa-solid fa-vial';
    }
  }
}

function openDeleteSourceModal(id, name) {
  const modalText = document.getElementById('deleteSourceNameText');
  if (modalText) modalText.textContent = name;
  const btn = document.getElementById('btnConfirmDeleteSource');
  if (btn) {
    btn.onclick = async () => {
      setButtonLoading(btn, true, 'جارٍ الحذف...');
      try {
        const res = await fetch(`${API_BASE}/api/web/sources/${id}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${state.token}` }
        });
        if (res.ok) {
          closeModal();
          await loadSources();
          await loadDeviceProfile();
          await loadSyncPreview();
        }
      } catch (e) {
        alert('تعذر حذف المصدر.');
      } finally {
        setButtonLoading(btn, false, 'تأكيد الحذف');
      }
    };
  }
  openModal(DOM.modalDelete);
}

// ==========================================================================
// Android App Sync Preview & Integration
// ==========================================================================

async function loadSyncPreview() {
  if (!DOM.syncPayloadViewer || !state.token) return;
  DOM.syncPayloadViewer.textContent = 'جارٍ جلب حزمة المزامنة الخاصة بجهاز Android...';

  try {
    const res = await fetch(`${API_BASE}/api/web/sync-preview`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await res.json();
    if (res.ok && data.success) {
      state.syncPreview = data;
      DOM.syncPayloadViewer.textContent = JSON.stringify(data, null, 2);
    } else {
      DOM.syncPayloadViewer.textContent = '// تعذر جلب حزمة المزامنة';
    }
  } catch (e) {
    DOM.syncPayloadViewer.textContent = '// خطأ في الاتصال بالخادم';
  }
}

// ==========================================================================
// Tabs & Modal Helpers
// ==========================================================================

function switchTab(tabName) {
  state.activeTab = tabName;
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-content-panel').forEach(panel => {
    panel.classList.toggle('hidden', panel.id !== `tabPanel-${tabName}`);
  });

  if (tabName === 'sync') {
    loadSyncPreview();
  }
}

function openModal(modalEl) {
  if (!modalEl) return;
  modalEl.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
  document.body.style.overflow = '';
}

function showAlert(el, msg, type = 'danger') {
  if (!el) return;
  el.className = `alert-box ${type}`;
  el.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> <span>${msg}</span>`;
  el.classList.remove('hidden');
}

function hideAlert(el) {
  if (!el) return;
  el.classList.add('hidden');
}

function setButtonLoading(btn, isLoading, text) {
  if (!btn) return;
  btn.disabled = isLoading;
  btn.innerHTML = isLoading ? `<i class="fa-solid fa-spinner fa-spin"></i> ${text}` : text;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
}
