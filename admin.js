/**
 * SADDAM IPTV - Admin Management Console Logic
 */

const API_BASE = window.SADDAM_API_BASE || 
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
    ? '' 
    : 'https://saddamplayer.onrender.com');
let adminToken = localStorage.getItem('saddam_admin_token') || null;

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
    alert('تعذر الاتصال بالخادم');
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
      document.getElementById('adminStatDevices').textContent = stats.total_devices;
      document.getElementById('adminStatActive').textContent = stats.active_devices;
      document.getElementById('adminStatSources').textContent = stats.total_sources;
      document.getElementById('adminStatSessions').textContent = stats.active_sessions;

      renderDevicesTable(stats.devices);
      renderAuditLogs(stats.recent_logs);
    } else if (res.status === 403) {
      handleAdminLogout();
    }
  } catch (err) {
    console.error('Failed to load admin stats:', err);
  }
}

function renderDevicesTable(devices) {
  const tbody = document.getElementById('devicesTableBody');
  if (!tbody) return;

  if (!devices || devices.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 20px; color: var(--text-dim);">لا توجد أجهزة مسجلة</td></tr>';
    return;
  }

  tbody.innerHTML = devices.map(d => {
    const statusColor = d.status === 'active' ? 'var(--success)' : 'var(--danger)';
    return `
      <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
        <td style="padding: 12px;" class="latin-code">#${d.id}</td>
        <td style="padding: 12px;" class="latin-code"><strong>${d.device_code}</strong></td>
        <td style="padding: 12px;">${d.device_label || 'جهاز'}</td>
        <td style="padding: 12px;">${d.platform} (v${d.app_version})</td>
        <td style="padding: 12px; color: ${statusColor}; font-weight: 700;">${d.status === 'active' ? 'نشط' : 'ملغى الربط'}</td>
        <td style="padding: 12px;" class="latin-code">v${d.sync_version}</td>
        <td style="padding: 12px; text-align: left;">
          <button class="btn btn-secondary btn-sm" onclick="rotatePin(${d.id})" title="توليد رمز PIN جديد لهذا الجهاز">
            <i class="fa-solid fa-key"></i> PIN جديد
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function renderAuditLogs(logs) {
  const tbody = document.getElementById('auditLogsBody');
  if (!tbody) return;

  if (!logs || logs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px; color: var(--text-dim);">لا توجد سجلات تدقيق</td></tr>';
    return;
  }

  tbody.innerHTML = logs.map(l => {
    const timeStr = new Date(l.created_at * 1000).toLocaleString('ar-EG');
    return `
      <tr style="border-bottom: 1px solid rgba(255,255,255,0.05); font-family: var(--font-code);">
        <td style="padding: 10px; color: var(--text-dim);">${timeStr}</td>
        <td style="padding: 10px; color: var(--primary);">${l.actor_type}</td>
        <td style="padding: 10px; font-weight: 700;">${l.action}</td>
        <td style="padding: 10px;">${l.target_type} #${l.target_id || ''}</td>
        <td style="padding: 10px; color: var(--text-muted);">${l.metadata_redacted || '{}'}</td>
      </tr>
    `;
  }).join('');
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
      alert(`تم توليد رمز PIN بنجاح:\n\nكود PIN الجديد: ${data.new_pin}\n(صالح للاستخدام المؤقت)`);
      loadAdminData();
    }
  } catch (e) {
    alert('حدث خطأ');
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
      loadAdminData();
    }
  } catch (e) {
    alert('تعذر إنشاء الجهاز');
  }
}
