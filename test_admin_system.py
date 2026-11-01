import urllib.request
import urllib.parse
import json
import http.cookiejar

base_url = 'http://127.0.0.1:8080'

# 1. Test public index.html
req = urllib.request.Request(f'{base_url}/index.html')
with urllib.request.urlopen(req) as resp:
    html = resp.read().decode('utf-8')
    assert 'btnAdminAccess' in html, 'Admin button not found in index.html'
    assert 'pairingSection' in html, 'Pairing section not found in index.html'
print('[PASS] 1. index.html has pairing screen and Admin button')

# 2. Test admin.html
req = urllib.request.Request(f'{base_url}/admin.html')
with urllib.request.urlopen(req) as resp:
    html = resp.read().decode('utf-8')
    assert 'unifiedLoginForm' in html, 'Login form not found in admin.html'
    assert 'tabOverview' in html, 'tabOverview not found in admin.html'
    assert 'tabDevices' in html, 'tabDevices not found in admin.html'
    assert 'tabPlaylists' in html, 'tabPlaylists not found in admin.html'
    assert 'tabActivity' in html, 'tabActivity not found in admin.html'
    assert 'tabSync' in html, 'tabSync not found in admin.html'
    assert 'tabAudit' in html, 'tabAudit not found in admin.html'
    assert 'tabSecurity' in html, 'tabSecurity not found in admin.html'
print('[PASS] 2. admin.html has dedicated login view and all 7 dashboard tabs')

# 3. Test unauthenticated API access returns 401
for path in ['/api/v1/admin/stats', '/api/v1/admin/devices', '/api/v1/admin/sources', '/api/v1/admin/audit-logs']:
    try:
        req = urllib.request.Request(f'{base_url}{path}')
        urllib.request.urlopen(req)
        assert False, f'Expected 401 for {path}'
    except urllib.error.HTTPError as e:
        assert e.code == 401, f'Expected 401 got {e.code} for {path}'
print('[PASS] 3. Unauthenticated access to admin endpoints correctly rejected with 401')

# 4. Test admin login for Slot 1 (Drexx0301)
cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

login_data = json.dumps({'username': 'Drexx0301', 'password': 'Souhaila2014'}).encode('utf-8')
req = urllib.request.Request(f'{base_url}/api/v1/auth/login', data=login_data, headers={'Content-Type': 'application/json'})
with opener.open(req) as resp:
    data = json.loads(resp.read().decode('utf-8'))
    assert data.get('success') is True, f'Login failed: {data}'
    assert data['admin']['username'] == 'Drexx0301', 'Admin username mismatch'
    assert data['admin']['slot'] == 1, 'Admin slot mismatch'
    session_token = data.get('token')
print('[PASS] 4. Login with Drexx0301 succeeded, session token issued')

# 5. Test authenticated calls with Drexx0301
# 5a. Admin Stats
req = urllib.request.Request(f'{base_url}/api/v1/admin/stats')
with opener.open(req) as resp:
    data = json.loads(resp.read().decode('utf-8'))
    assert data['success'] is True
    print(f'   Stats: total_devices={data["data"]["total_devices"]}, sources={data["data"]["total_sources"]}')
print('[PASS] 5a. Authenticated /api/v1/admin/stats succeeded')

# 5b. Admin Devices
req = urllib.request.Request(f'{base_url}/api/v1/admin/devices?page=1&limit=5')
with opener.open(req) as resp:
    data = json.loads(resp.read().decode('utf-8'))
    assert data['success'] is True
    devices = data['data']['devices']
    print(f'   Devices returned: {len(devices)}')
    first_device_id = devices[0]['id'] if devices else None
print('[PASS] 5b. Authenticated /api/v1/admin/devices succeeded')

# 5c. Admin Sources (Playlists across all devices)
req = urllib.request.Request(f'{base_url}/api/v1/admin/sources?page=1&limit=5')
with opener.open(req) as resp:
    data = json.loads(resp.read().decode('utf-8'))
    assert data['success'] is True
    sources = data['data']['sources']
    print(f'   Sources returned: {len(sources)}')
print('[PASS] 5c. Authenticated /api/v1/admin/sources succeeded')

# 5d. Device Sync
if first_device_id:
    req = urllib.request.Request(f'{base_url}/api/v1/admin/devices/{first_device_id}/sync', data=b'{}', headers={'Content-Type': 'application/json'})
    with opener.open(req) as resp:
        data = json.loads(resp.read().decode('utf-8'))
        assert data['success'] is True
        print(f'   Device {first_device_id} synced, new version: {data.get("sync_version")}')
    print('[PASS] 5d. Authenticated device sync trigger succeeded')

# 5e. Audit Logs
req = urllib.request.Request(f'{base_url}/api/v1/admin/audit-logs?page=1&limit=5')
with opener.open(req) as resp:
    data = json.loads(resp.read().decode('utf-8'))
    assert data['success'] is True
    logs = data['data']['logs']
    print(f'   Audit logs count: {len(logs)}')
print('[PASS] 5e. Authenticated /api/v1/admin/audit-logs succeeded')

# 5f. Accounts Overview (Strictly 2 slots)
req = urllib.request.Request(f'{base_url}/api/v1/auth/accounts-overview')
with opener.open(req) as resp:
    data = json.loads(resp.read().decode('utf-8'))
    assert data['success'] is True
    slots = data['slots']
    assert len(slots) == 2, f'Expected 2 slots, got {len(slots)}'
    print(f'   Slots: {[s["username"] for s in slots]}')
print('[PASS] 5f. Accounts overview verified: strictly 2 slots (Drexx0301, Saddam1991)')

# 6. Logout
req = urllib.request.Request(f'{base_url}/api/v1/auth/logout', data=b'{}', headers={'Content-Type': 'application/json'})
with opener.open(req) as resp:
    data = json.loads(resp.read().decode('utf-8'))
    assert data['success'] is True
print('[PASS] 6. Logout succeeded, session revoked')

# Verify session is now invalid
try:
    req = urllib.request.Request(f'{base_url}/api/v1/admin/stats')
    opener.open(req)
    assert False, 'Session should have been revoked'
except urllib.error.HTTPError as e:
    assert e.code == 401
print('[PASS] 7. Session revocation verified (subsequent calls return 401)')

# 8. Test Slot 2 (Saddam1991) login
login_data2 = json.dumps({'username': 'Saddam1991', 'password': 'Saddam@1991'}).encode('utf-8')
req = urllib.request.Request(f'{base_url}/api/v1/auth/login', data=login_data2, headers={'Content-Type': 'application/json'})
with opener.open(req) as resp:
    data = json.loads(resp.read().decode('utf-8'))
    assert data.get('success') is True
    assert data['admin']['username'] == 'Saddam1991'
    assert data['admin']['slot'] == 2
print('[PASS] 8. Login with Saddam1991 (Slot 2) succeeded')

print('\nALL SERVER AND ACCEPTANCE TESTS PASSED SUCCESSFULLY!')

