/**
 * SADDAM IPTV - Admin Management Console Logic
 */

const API_BASE = window.SADDAM_API_BASE || 
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
    ? '' 
    : 'https://saddamplayer.onrender.com');

let adminToken = localStorage.getItem('saddam_admin_token') || null;
let allDevices = [];
let allLogs = [];

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('adminLoginForm');
  if (form) form.addEventListener('submit', handleAdminLogin);

  const logoutBtn = document.getElementById('btnAdminLogout');
  if (logoutBtn) logoutBtn.addEventListener('click', handleAdminLogout);

  const createForm = document.getElementById('createDeviceForm');
  if (createForm) createForm.addEventListener('submit', handleCreateDevice);

  if (adminToken) {
    showAdminDashboard();
    loadAdminData();
  }
});

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttr(str) {
  if (!str) return '';
  return String(str).replace(/'/g, "\\'");
}

async function handleAdminLogin(e) {
  e.preventDefault();
  const username = document.getElementById('adminUser').value.trim();
  const password = document.getElementById('adminPass').value.trim();
  const alertEl = document.getElementById('adminLoginAlert');

  try {
    const res = await fetch(`${API_BASE}/api/v1/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();

    if (res.ok && data.success) {
      adminToken = data.token;
      localStorage.setItem('saddam_admin_token', adminToken);
      showAdminDashboard();
      loadAdminData();
    } else {
      alertEl.className = 'alert-box danger';
      alertEl.innerHTML = `<span>${data.error || 'فشل تسجيل الدخول'}</span>`;
      alertEl.classList.remove('hidden');
    }
  } catch (err) {
    alert('تعذر الاتصال بالخادم. يرجى التحقق من تشغيل السيرفر أو الاتصال بالإنترنت.');
  }
}

function handleAdminLogout() {
  adminToken = null;
  localStorage.removeItem('saddam_admin_token');
  document.getElementById('adminLoginSection').classList.remove('hidden');
  document.getElementById('adminDashboardSection').classList.add('hidden');
  document.getElementById('btnAdminLogout').classList.add('hidden');
}

function showAdminDashboard() {
  document.getElementById('adminLoginSection').classList.add('hidden');
  document.getElementById('adminDashboardSection').classList.remove('hidden');
  document.getElementById('btnAdminLogout').classList.remove('hidden');
}

async function loadAdminData() {
  if (!adminToken) return;

  try {
    const res = await fetch(`${API_BASE}/api/v1/admin/stats`, {
      headers: { 'X-Admin-Key': adminToken }
    });
    const data = await res.json();

    if (res.ok && data.success) {
      const stats = data.data;
      allDevices = stats.devices || [];
      allLogs = stats.recent_logs || [];

      // Update counters
      const devEl = document.getElementById('adminStatDevices');
      if (devEl) devEl.textContent = stats.total_devices || 0;

      const actEl = document.getElementById('adminStatActive');
      if (actEl) actEl.textContent = stats.active_devices || 0;

      const disEl = document.getElementById('adminStatDisabled');
      if (disEl) disEl.textContent = stats.disabled_devices || 0;

      const srcEl = document.getElementById('adminStatSources');
      if (srcEl) srcEl.textContent = stats.total_sources || 0;

      const sesEl = document.getElementById('adminStatSessions');
      if (sesEl) sesEl.textContent = stats.active_sessions || 0;

      renderDevicesTable(allDevices);
      renderAuditLogs(allLogs);
    } else if (res.status === 403) {
      handleAdminLogout();
    }
  } catch (err) {
    console.error('Failed to load admin stats:', err);
  }
}

function filterDevicesTable() {
  const query = (document.getElementById('deviceSearchInput')?.value || '').trim().toLowerCase();
  if (!query) {
    renderDevicesTable(allDevices);
    return;
  }
  const filtered = allDevices.filter(d => 
    (d.device_code && d.device_code.toLowerCase().includes(query)) ||
    (d.device_label && d.device_label.toLowerCase().includes(query)) ||
    (String(d.id).includes(query))
  );
  renderDevicesTable(filtered);
}

function renderDevicesTable(devices) {
  const tbody = document.getElementById('devicesTableBody');
  if (!tbody) return;

  if (!devices || devices.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 25px; color: var(--text-dim); font-size: 0.95rem;">لا توجد أجهزة مطابقة</td></tr>';
    return;
  }

  tbody.innerHTML = devices.map(d => {
    const isActive = (d.status === 'active');
    const isSuspended = (d.status === 'disabled' || d.status === 'suspended' || d.status === 'blocked');
    
    let statusBadge = '';
    if (isActive) {
      statusBadge = `<span style="background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); padding: 3px 8px; border-radius: 6px; font-weight: 700; font-size: 0.8rem; display: inline-flex; align-items: center; gap: 4px;"><i class="fa-solid fa-circle-check"></i> نشط</span>`;
    } else if (isSuspended) {
      statusBadge = `<span style="background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); padding: 3px 8px; border-radius: 6px; font-weight: 700; font-size: 0.8rem; display: inline-flex; align-items: center; gap: 4px;"><i class="fa-solid fa-ban"></i> موقوف</span>`;
    } else {
      statusBadge = `<span style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); padding: 3px 8px; border-radius: 6px; font-weight: 700; font-size: 0.8rem;">${escapeHtml(d.status)}</span>`;
    }

    const toggleBtn = isActive
      ? `<button class="btn btn-sm" style="background: rgba(239, 68, 68, 0.18); border: 1px solid rgba(239, 68, 68, 0.4); color: #fca5a5;" onclick="toggleDeviceStatus(${d.id}, 'disabled', '${escapeAttr(d.device_code)}')" title="توقيف الجهاز وتعطيله فورا">
          <i class="fa-solid fa-ban"></i> توقيف
        </button>`
      : `<button class="btn btn-sm" style="background: rgba(16, 185, 129, 0.18); border: 1px solid rgba(16, 185, 129, 0.4); color: #6ee7b7;" onclick="toggleDeviceStatus(${d.id}, 'active', '${escapeAttr(d.device_code)}')" title="إعادة تشغيل وتفعيل الجهاز">
          <i class="fa-solid fa-play"></i> تفعيل
        </button>`;

    return `
      <tr style="border-bottom: 1px solid rgba(255,255,255,0.05); transition: background 0.2s;">
        <td style="padding: 12px;" class="latin-code">#${d.id}</td>
        <td style="padding: 12px;" class="latin-code"><strong style="color: #fff; font-size: 0.95rem;">${escapeHtml(d.device_code)}</strong></td>
        <td style="padding: 12px;">
          <span style="font-weight: 600;">${escapeHtml(d.device_label || 'جهاز')}</span>
          <button onclick="editDeviceLabel(${d.id}, '${escapeAttr(d.device_label || '')}')" style="background: none; border: none; color: var(--text-dim); cursor: pointer; margin-right: 6px;" title="تعديل اسم الجهاز">
            <i class="fa-solid fa-pen-to-square"></i>
          </button>
        </td>
        <td style="padding: 12px; color: var(--text-muted);">${escapeHtml(d.platform || 'Android')} (v${escapeHtml(d.app_version || '1.3.0')})</td>
        <td style="padding: 12px;">
          <span style="background: rgba(99, 102, 241, 0.15); color: #a5b4fc; border: 1px solid rgba(99, 102, 241, 0.3); padding: 3px 8px; border-radius: 6px; font-weight: 700; font-size: 0.8rem;">
            ${d.sources_count || 0} مصادر
          </span>
        </td>
        <td style="padding: 12px;">${statusBadge}</td>
        <td style="padding: 12px;" class="latin-code">v${d.sync_version}</td>
        <td style="padding: 12px; text-align: center;">
          <div style="display: flex; gap: 6px; justify-content: center; align-items: center; flex-wrap: wrap;">
            ${toggleBtn}
            <button class="btn btn-secondary btn-sm" onclick="rotatePin(${d.id})" title="توليد رمز PIN جديد">
              <i class="fa-solid fa-key"></i> PIN
            </button>
            <button class="btn btn-danger btn-sm" onclick="deleteDevice(${d.id}, '${escapeAttr(d.device_code)}')" title="حذف الجهاز نهائيا وجميع مصادره">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function renderAuditLogs(logs) {
  const tbody = document.getElementById('auditLogsBody');
  if (!tbody) return;

  if (!logs || logs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 25px; color: var(--text-dim); font-size: 0.9rem;">لا توجد سجلات تدقيق</td></tr>';
    return;
  }

  tbody.innerHTML = logs.map(l => {
    const timeStr = new Date(l.created_at * 1000).toLocaleString('ar-EG');
    return `
      <tr style="border-bottom: 1px solid rgba(255,255,255,0.05); font-family: var(--font-code);">
        <td style="padding: 10px; color: var(--text-dim); font-size: 0.8rem;">${timeStr}</td>
        <td style="padding: 10px; color: var(--primary); font-weight: 600;">${escapeHtml(l.actor_type)}</td>
        <td style="padding: 10px; font-weight: 700; color: #e2e8f0;">${escapeHtml(l.action)}</td>
        <td style="padding: 10px; color: var(--text-muted);">${escapeHtml(l.target_type)} #${escapeHtml(l.target_id || '')}</td>
        <td style="padding: 10px; color: var(--text-dim); font-size: 0.8rem; max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          ${escapeHtml(l.metadata_redacted || '{}')}
        </td>
        <td style="padding: 10px; text-align: center;">
          <button onclick="deleteAuditLog(${l.id})" style="background: none; border: none; color: #f87171; cursor: pointer; padding: 4px;" title="حذف هذا السجل">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

async function toggleDeviceStatus(deviceId, newStatus, mac) {
  const actionText = (newStatus === 'disabled') ? 'توقيف وتعطيل' : 'إعادة تفعيل';
  const confirmMsg = (newStatus === 'disabled')
    ? `هل أنت متأكد من رغبتك في توقيف وتعطيل الجهاز (${mac})؟\n\n- سيتم إنهاء جميع الجلسات النشطة فوراً.\n- لن يتمكن التطبيق من مزامنة القنوات أو تشغيل البث إلى حين إعادة تفعيله.`
    : `هل أنت متأكد من رغبتك في تفعيل الجهاز (${mac}) مجدداً؟`;

  if (!confirm(confirmMsg)) return;

  try {
    const res = await fetch(`${API_BASE}/api/v1/admin/devices/${deviceId}/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Key': adminToken
      },
      body: JSON.stringify({ status: newStatus })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      alert(`✓ تم ${actionText} الجهاز بنجاح!`);
      loadAdminData();
    } else {
      alert(data.error || 'فشل تحديث حالة الجهاز');
    }
  } catch (e) {
    alert('حدث خطأ أثناء الاتصال بالخادم');
  }
}

async function deleteDevice(deviceId, mac) {
  const confirmMsg = `⚠️ تحذير نهائي:\n\nهل أنت متأكد من حذف الجهاز (${mac}) نهائياً؟\n\nسيؤدي هذا الإجراء إلى مسح الجهاز وجميع مصادر البث (Playlists) وقوائم القنوات التابعة له بشكل لا رجعة فيه!`;
  if (!confirm(confirmMsg)) return;

  try {
    const res = await fetch(`${API_BASE}/api/v1/admin/devices/${deviceId}/delete`, {
      method: 'POST',
      headers: { 'X-Admin-Key': adminToken }
    });
    const data = await res.json();
    if (res.ok && data.success) {
      alert(`✓ تم حذف الجهاز وجميع مصادره بنجاح.`);
      loadAdminData();
    } else {
      alert(data.error || 'تعذر حذف الجهاز');
    }
  } catch (e) {
    alert('حدث خطأ أثناء محاولة حذف الجهاز');
  }
}

async function editDeviceLabel(deviceId, currentLabel) {
  const newLabel = prompt('أدخل الاسم الجديد للجهاز:', currentLabel || '');
  if (newLabel === null) return;
  if (!newLabel.trim()) {
    alert('الاسم لا يمكن أن يكون فارغاً');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/v1/admin/devices/${deviceId}/label`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Key': adminToken
      },
      body: JSON.stringify({ label: newLabel.trim() })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      loadAdminData();
    } else {
      alert(data.error || 'تعذر تحديث اسم الجهاز');
    }
  } catch (e) {
    alert('حدث خطأ أثناء تعديل الاسم');
  }
}

async function rotatePin(deviceId) {
  if (!confirm('هل تريد توليد رمز PIN جديد مكون من 6 أرقام لهذا الجهاز؟')) return;

  try {
    const res = await fetch(`${API_BASE}/api/v1/admin/devices/${deviceId}/rotate-pin`, {
      method: 'POST',
      headers: { 'X-Admin-Key': adminToken }
    });
    const data = await res.json();
    if (res.ok && data.success) {
      alert(`✓ تم توليد رمز PIN جديد بنجاح:\n\nكود PIN الجديد: ${data.new_pin}`);
      loadAdminData();
    } else {
      alert(data.error || 'تعذر توليد PIN');
    }
  } catch (e) {
    alert('حدث خطأ أثناء توليد PIN');
  }
}

async function clearAllAuditLogs() {
  const confirmMsg = `⚠️ تحذير أمني:\n\nهل أنت متأكد من رغبتك في حذف وتفريغ كامل سجل التدقيق والأحداث الحساسة (Audit Logs)؟\n\nلا يمكن استرجاع هذه السجلات بعد مسحها.`;
  if (!confirm(confirmMsg)) return;

  try {
    const res = await fetch(`${API_BASE}/api/v1/admin/audit-logs/clear`, {
      method: 'POST',
      headers: { 'X-Admin-Key': adminToken }
    });
    const data = await res.json();
    if (res.ok && data.success) {
      alert('✓ تم مسح وتفريغ سجل التدقيق بالكامل بنجاح.');
      loadAdminData();
    } else {
      alert(data.error || 'تعذر مسح سجل التدقيق');
    }
  } catch (e) {
    alert('حدث خطأ أثناء مسح السجلات');
  }
}

async function deleteAuditLog(logId) {
  if (!confirm('هل تريد حذف هذا السجل المحدد؟')) return;

  try {
    const res = await fetch(`${API_BASE}/api/v1/admin/audit-logs/${logId}/delete`, {
      method: 'POST',
      headers: { 'X-Admin-Key': adminToken }
    });
    const data = await res.json();
    if (res.ok && data.success) {
      loadAdminData();
    } else {
      alert(data.error || 'تعذر حذف السجل');
    }
  } catch (e) {
    alert('حدث خطأ أثناء حذف السجل');
  }
}

async function handleCreateDevice(e) {
  e.preventDefault();
  const mac = document.getElementById('newDeviceMac').value.trim();
  const label = document.getElementById('newDeviceLabel').value.trim() || 'جهاز جديد';
  const resultEl = document.getElementById('newDeviceResult');

  try {
    const res = await fetch(`${API_BASE}/api/v1/admin/devices/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Key': adminToken
      },
      body: JSON.stringify({ mac, label, platform: 'Android TV' })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      resultEl.classList.remove('hidden');
      resultEl.innerHTML = `
        <div style="background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.3); padding: 14px; border-radius: 10px;">
          ✓ تم تسجيل الجهاز بنجاح!<br>
          رمز MAC Code: <span class="latin-code" style="color: #fff;">${data.device.device_code}</span><br>
          رمز PIN: <span class="latin-code" style="color: var(--primary); font-size: 1.2rem;">${data.pin}</span>
        </div>
      `;
      document.getElementById('newDeviceMac').value = '';
      document.getElementById('newDeviceLabel').value = '';
      loadAdminData();
    } else {
      alert(data.error || 'تعذر إنشاء الجهاز');
    }
  } catch (e) {
    alert('تعذر إنشاء الجهاز');
  }
}
