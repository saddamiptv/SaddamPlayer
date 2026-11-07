"""
SADDAM IPTV - Backend Server
Supports:
- Web Device Pairing & Management Portal
- REST API for SADDAM IPTV Android Application (v1)
- Admin Management API
- Static Asset Serving (HTML, CSS, JS, Images)
- Strict compliance with SDP v1.1 Specifications
"""

import http.server
import socketserver
import json
import urllib.parse
import urllib.request
import os
import sys
import mimetypes
import time
import ssl
from typing import Dict, Any, Optional, Tuple

import database as db
import security

PORT = int(os.environ.get("PORT", 8080))
BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def probe_xtream_account(base_url: str, username: str, password: str, timeout: int = 8) -> Tuple[str, str, str]:
    """
    Probes an Xtream Codes server using player_api.php with credentials.
    Returns: (status, error_code, message)
      status: 'working' | 'auth_failed' | 'unavailable' | 'connection_failed'
    """
    try:
        parsed = urllib.parse.urlparse(base_url.strip())
        clean_base = f"{parsed.scheme}://{parsed.netloc}".rstrip("/")
        api_url = f"{clean_base}/player_api.php?username={urllib.parse.quote(username)}&password={urllib.parse.quote(password)}"

        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

        req = urllib.request.Request(
            api_url,
            headers={
                "User-Agent": "okhttp/4.9.2",
                "Accept": "*/*",
                "Connection": "close"
            }
        )
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            if resp.getcode() == 200:
                raw_bytes = resp.read(65536)
                try:
                    data = json.loads(raw_bytes.decode("utf-8", errors="ignore"))
                    user_info = data.get("user_info", {})
                    auth = user_info.get("auth")
                    acc_status = str(user_info.get("status", "")).strip().lower()

                    if auth == 1 or auth == "1" or auth is True:
                        if acc_status in ("expired", "banned", "disabled"):
                            return "unavailable", f"STATUS_{acc_status.upper()}", f"حساب Xtream غير نشط: الحالة ({acc_status})"

                        exp = user_info.get("exp_date")
                        msg = "تم التحقق من بيانات الدخول بنجاح والخادم يعمل بكفاءة"
                        if exp and str(exp).isdigit() and int(exp) > 0:
                            try:
                                exp_str = time.strftime('%Y-%m-%d', time.localtime(int(exp)))
                                msg += f" (صالح حتى {exp_str})"
                            except Exception:
                                pass
                        return "working", "", msg
                    else:
                        return "auth_failed", "INVALID_CREDENTIALS", "بيانات الدخول غير صحيحة (اسم المستخدم أو كلمة المرور)"
                except Exception:
                    if len(raw_bytes) > 20:
                        return "working", "", "تم الاتصال بالخادم بنجاح واستقبال البيانات"
                    return "connection_failed", "INVALID_RESPONSE", "استجابة الخادم غير متوافقة مع واجهة Xtream"
            return "connection_failed", f"HTTP {resp.getcode()}", f"أرجع الخادم رمز: {resp.getcode()}"
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            return "auth_failed", f"HTTP {e.code}", "بيانات الدخول غير صحيحة أو تم رفض الاتصال بالخادم"
        return "connection_failed", f"HTTP {e.code}", f"أرجع الخادم رمز خطأ: {e.code}"
    except Exception as e:
        return "connection_failed", "TIMEOUT_OR_UNREACHABLE", f"تعذر الاتصال بالخادم: {str(e)}"


def probe_iptv_source(source: dict) -> Tuple[str, str, str]:
    """
    Intelligently probes any IPTV source (Xtream, M3U, M3U8, or hybrid).
    Returns (status, error_code, message)
    """
    source_type = (source.get("source_type") or "m3u").lower()
    server_url = (source.get("server_url") or "").strip()
    username = (source.get("username") or "").strip()
    password = (source.get("password_encrypted") or "").strip()

    is_xtream = (source_type == "xtream")

    # If it's an Xtream source or has username/password explicitly:
    if is_xtream or (username and password and not (server_url.endswith(".m3u") or server_url.endswith(".m3u8"))):
        return probe_xtream_account(server_url, username, password)

    # For M3U source: check URL safety first
    is_safe, msg = security.is_ssrf_safe_url(server_url)
    if not is_safe:
        return "unavailable", "SSRF_BLOCKED", msg

    # Probe M3U directly with IPTV-compatible User-Agent and unverified SSL
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    req = urllib.request.Request(
        server_url,
        headers={
            "User-Agent": "okhttp/4.9.2",
            "Accept": "*/*",
            "Connection": "close"
        }
    )

    try:
        with urllib.request.urlopen(req, timeout=7, context=ctx) as resp:
            code = resp.getcode()
            if code == 200:
                head = resp.read(4096).decode("utf-8", errors="ignore")
                if "#EXTM3U" in head or "#EXTINF" in head or len(head) > 20:
                    return "working", "", "تم الاتصال بالمصدر بنجاح والقائمة صالحة"
                return "working", "", "تم الاتصال بالرابط بنجاح"
            elif code >= 400:
                # Check if it was an Xtream URL before failing
                parsed = urllib.parse.urlparse(server_url)
                qs = urllib.parse.parse_qs(parsed.query)
                if "username" in qs and "password" in qs:
                    u = qs["username"][0].strip()
                    p = qs["password"][0].strip()
                    base = f"{parsed.scheme}://{parsed.netloc}"
                    res_status, res_err, res_msg = probe_xtream_account(base, u, p)
                    if res_status == "working":
                        return "working", "", "تم الاتصال بالخادم بنجاح والتحقق من الحساب عبر Xtream API"
                    return res_status, res_err, res_msg
                return "connection_failed", f"HTTP {code}", f"أرجع الخادم رمز خطأ: {code}"
    except urllib.error.HTTPError as e:
        # Check if URL contains Xtream credentials (e.g. get.php where download is blocked with 885/403)
        parsed = urllib.parse.urlparse(server_url)
        qs = urllib.parse.parse_qs(parsed.query)
        if "username" in qs and "password" in qs:
            u = qs["username"][0].strip()
            p = qs["password"][0].strip()
            base = f"{parsed.scheme}://{parsed.netloc}"
            res_status, res_err, res_msg = probe_xtream_account(base, u, p)
            if res_status == "working":
                return "working", "", "تم الاتصال بالخادم بنجاح والتحقق من الحساب عبر Xtream API"
            return res_status, res_err, res_msg

        if e.code in (401, 403):
            return "auth_failed", f"HTTP {e.code}", "الرابط يتطلب مصادقة أو بيانات دخول صالحة"
        return "connection_failed", f"HTTP {e.code}", f"فشل الاتصال بالرابط (رمز: {e.code})"
    except Exception as e:
        # Check if URL contains Xtream credentials
        parsed = urllib.parse.urlparse(server_url)
        qs = urllib.parse.parse_qs(parsed.query)
        if "username" in qs and "password" in qs:
            u = qs["username"][0].strip()
            p = qs["password"][0].strip()
            base = f"{parsed.scheme}://{parsed.netloc}"
            res_status, res_err, res_msg = probe_xtream_account(base, u, p)
            if res_status == "working":
                return "working", "", "تم الاتصال بالخادم بنجاح والتحقق من الحساب عبر Xtream API"
            return res_status, res_err, res_msg
        return "connection_failed", "TIMEOUT_OR_UNREACHABLE", f"تعذر الاتصال بالرابط: {str(e)}"


class SaddamIPTVHandler(http.server.BaseHTTPRequestHandler):
    server_version = "SaddamIPTVServer/1.1"

    def end_headers(self):
        # Security headers as specified in SDP v1.1
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("X-XSS-Protection", "1; mode=block")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        # CORS Headers (for GitHub Pages / remote clients)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
        self.send_header("Access-Control-Max-Age", "86400")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    # Helper: Send JSON response with mandatory security headers
    def send_json(self, status_code: int, data: Any, cookies: Optional[Dict[str, str]] = None):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        if cookies:
            for k, v in cookies.items():
                self.send_header("Set-Cookie", f"{k}={v}; Path=/; HttpOnly; SameSite=Lax")
        self.end_headers()
        self.wfile.write(body)

    # Helper: Parse JSON body
    def parse_json_body(self) -> Dict[str, Any]:
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            if content_length <= 0:
                return {}
            raw_data = self.rfile.read(content_length).decode("utf-8")
            return json.loads(raw_data)
        except Exception:
            return {}

    # Helper: Extract device session token
    def get_auth_token(self) -> Optional[str]:
        auth_header = self.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            return auth_header[7:].strip()

        cookie_header = self.headers.get("Cookie", "")
        if cookie_header:
            cookies = [c.strip() for c in cookie_header.split(";")]
            for c in cookies:
                if c.startswith("saddam_session="):
                    return c.split("=", 1)[1].strip()

        return None

    # Helper: Extract Admin Session token
    def get_admin_session_token(self) -> Optional[str]:
        cookie_header = self.headers.get("Cookie", "")
        if cookie_header:
            cookies = [c.strip() for c in cookie_header.split(";")]
            for c in cookies:
                if c.startswith("saddam_admin_session="):
                    return c.split("=", 1)[1].strip()

        session_hdr = self.headers.get("X-Admin-Session", "").strip()
        if session_hdr:
            return session_hdr

        auth_header = self.headers.get("Authorization", "").strip()
        if auth_header.startswith("Bearer "):
            return auth_header[7:].strip()

        admin_key_hdr = self.headers.get("X-Admin-Key", "").strip()
        if admin_key_hdr:
            return admin_key_hdr

        return None

    # Helper: Authenticate Web Device Session
    def authenticate_device(self) -> Optional[Dict[str, Any]]:
        token = self.get_auth_token()
        if not token:
            return None
        return db.validate_session_token(token)

    # Helper: Authenticate Administrator Session (Server-enforced, expiring, revocable)
    def authenticate_admin(self) -> Optional[Dict[str, Any]]:
        token = self.get_admin_session_token()
        if not token:
            return None
        return db.validate_admin_session(token)

    # ================= HTTP GET Routing =================
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        # 1. API: Web Device & Account Info
        if path == "/api/web/me":
            admin_sess = self.authenticate_admin()
            device = self.authenticate_device()
            if not admin_sess and not device:
                return self.send_json(401, {"success": False, "error": "الجلسة غير صالحة أو منتهية"})

            account_devices = db.get_account_devices(admin_sess["slot"]) if admin_sess else []
            if not device and account_devices:
                device = account_devices[0]

            return self.send_json(200, {
                "success": True,
                "admin": {
                    "slot": admin_sess["slot"],
                    "username": admin_sess["username"]
                } if admin_sess else None,
                "device": {
                    "id": device["id"],
                    "device_code": device["device_code"],
                    "device_code_masked": security.mask_mac(device["device_code"]),
                    "device_label": device["device_label"],
                    "platform": device["platform"],
                    "app_version": device["app_version"],
                    "status": device["status"],
                    "sync_version": device["sync_version"],
                    "last_seen_at": device["last_seen_at"],
                    "session_expires_at": device.get("session_expires_at")
                } if device else None,
                "devices": [
                    {
                        "id": d["id"],
                        "device_code": d["device_code"],
                        "device_code_masked": security.mask_mac(d["device_code"]),
                        "device_label": d["device_label"],
                        "platform": d["platform"],
                        "status": d["status"]
                    } for d in account_devices
                ]
            })

        # 2. API: Web Device & Account Sources
        if path == "/api/web/sources":
            admin_sess = self.authenticate_admin()
            device = self.authenticate_device()
            if not admin_sess and not device:
                return self.send_json(401, {"success": False, "error": "غير مصرح"})

            if admin_sess:
                # Core business rule: A playlist belongs to the user's account, not to a specific device.
                sources = db.get_account_sources(admin_sess["slot"])
            elif device:
                sources = db.get_device_sources(device["id"])
            else:
                sources = []

            return self.send_json(200, {"success": True, "sources": sources})

        # 3. API: Web Android Sync Preview
        if path == "/api/web/sync-preview":
            admin_sess = self.authenticate_admin()
            device = self.authenticate_device()
            if not admin_sess and not device:
                return self.send_json(401, {"success": False, "error": "غير مصرح"})

            if admin_sess:
                sources = db.get_account_sources(admin_sess["slot"], only_enabled=True, mask_password=False)
                dev_id = device["id"] if device else None
                sync_ver = device["sync_version"] if device else 1
            else:
                sources = db.get_device_sources(device["id"], only_enabled=True, mask_password=False)
                dev_id = device["id"]
                sync_ver = device["sync_version"]

            return self.send_json(200, {
                "success": True,
                "device_id": dev_id,
                "sync_version": sync_ver,
                "active_sources_count": len(sources),
                "payload": [
                    {
                        "id": s["id"],
                        "name": s["name"],
                        "source_type": s["source_type"],
                        "server_url": s["server_url"],
                        "has_credentials": bool(s.get("username"))
                    } for s in sources
                ]
            })

        # 4. API: Android App Routes (SDP Section 10)
        if path == "/api/v1/devices/pairing-status":
            mac = query.get("mac", [""])[0]
            clean_mac = security.normalize_mac(mac)
            if not clean_mac:
                return self.send_json(400, {"error": "رمز الجهاز (MAC) مطلوب"})
            with db.get_db() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT id, status, sync_version FROM devices WHERE device_code = ?", (clean_mac,))
                dev = cursor.fetchone()
                if not dev:
                    # Return 200 with paired=False so Android app displays clean state without HTTP 404 error
                    return self.send_json(200, {
                        "paired": False,
                        "device_status": "not_registered",
                        "sync_version": 1,
                        "token": None
                    })
                # Check active session safely
                has_active = False
                token_val = None
                try:
                    cursor.execute("""
                        SELECT id, token FROM device_sessions
                        WHERE device_id = ? AND revoked_at IS NULL
                        ORDER BY id DESC LIMIT 1
                    """, (dev["id"],))
                    active_sess = cursor.fetchone()
                    if active_sess:
                        has_active = True
                        token_val = active_sess["token"] if "token" in active_sess.keys() else None
                except Exception:
                    cursor.execute("""
                        SELECT id FROM device_sessions
                        WHERE device_id = ? AND revoked_at IS NULL
                        ORDER BY id DESC LIMIT 1
                    """, (dev["id"],))
                    active_sess = cursor.fetchone()
                    has_active = active_sess is not None

                # Also verify if device has sources registered
                cursor.execute("SELECT COUNT(*) FROM iptv_sources WHERE device_id = ? AND enabled = 1", (dev["id"],))
                src_count = cursor.fetchone()[0]
                if src_count > 0:
                    has_active = True
                    if not token_val:
                        token_val = db.create_device_session(dev["id"])

                return self.send_json(200, {
                    "paired": has_active,
                    "device_status": dev["status"],
                    "sync_version": dev["sync_version"],
                    "token": token_val
                })

        if path in ("/api/v1/devices/sources", "/api/v1/devices/playlists"):
            req_mac = self.headers.get("X-Device-MAC") or query.get("mac", [""])[0]
            req_key = self.headers.get("X-Device-Key") or query.get("key", [""])[0] or query.get("pin", [""])[0]

            clean_mac = security.normalize_mac(req_mac) if req_mac else ""
            clean_pin = str(req_key).strip() if req_key else ""

            device = None
            if clean_mac and clean_pin:
                device = db.verify_device_credentials(clean_mac, clean_pin)
            elif not clean_mac and not clean_pin:
                device = self.authenticate_device()

            if not device:
                return self.send_json(401, {
                    "success": False,
                    "error": "بيانات اعتماد الجهاز غير صحيحة أو غير مصرح بها",
                    "device_id": None,
                    "sync_version": 1,
                    "sources": [],
                    "playlists": []
                })

            if device.get("status") in ("disabled", "suspended", "blocked"):
                return self.send_json(403, {
                    "success": False,
                    "device_id": device["id"],
                    "status": device["status"],
                    "error": "تم إيقاف هذا الجهاز من قبل إدارة النظام",
                    "sources": [],
                    "playlists": []
                })

            # Strictly return ONLY sources added for THIS specific device
            sources = db.get_device_sources(device["id"], only_enabled=False, mask_password=False)
            playlists = []
            for s in sources:
                status = "active"
                if s.get("status") in ("expired", "STATUS_EXPIRED") or (s.get("last_error_code") and "EXPIRED" in str(s.get("last_error_code")).upper()):
                    status = "expired"
                elif not s.get("enabled"):
                    status = "disabled"
                elif s.get("expires_at"):
                    try:
                        exp_val = s["expires_at"]
                        if str(exp_val).isdigit():
                            exp_ts = int(exp_val)
                            if exp_ts < 10000000000:
                                exp_ts *= 1000
                            if time.time() * 1000 > exp_ts:
                                status = "expired"
                    except Exception:
                        pass

                playlists.append({
                    "id": s["id"],
                    "name": s["name"],
                    "source_type": s["source_type"],
                    "server_url": s["server_url"],
                    "username": s.get("username"),
                    "password": s.get("password") or s.get("password_encrypted"),
                    "status": status,
                    "is_enabled": bool(s.get("enabled", 1)),
                    "expires_at": s.get("expires_at"),
                    "created_at": s.get("created_at")
                })

            enabled_sources = [s for s in sources if s.get("enabled", 1)]
            return self.send_json(200, {
                "success": True,
                "device_id": device["id"],
                "sync_version": device["sync_version"],
                "sources": enabled_sources,
                "playlists": playlists
            })

        if path == "/api/v1/devices/sync":
            req_mac = self.headers.get("X-Device-MAC") or query.get("mac", [""])[0]
            req_key = self.headers.get("X-Device-Key") or query.get("key", [""])[0] or query.get("pin", [""])[0]
            clean_mac = security.normalize_mac(req_mac) if req_mac else ""
            clean_pin = str(req_key).strip() if req_key else ""

            device = None
            if clean_mac and clean_pin:
                device = db.verify_device_credentials(clean_mac, clean_pin)
            elif not clean_mac and not clean_pin:
                device = self.authenticate_device()

            if not device:
                return self.send_json(401, {
                    "success": False,
                    "error": "بيانات اعتماد الجهاز غير صحيحة أو غير مصرح بها"
                })

            return self.send_json(200, {
                "device_id": device["id"],
                "sync_version": device["sync_version"],
                "status": "synchronized",
                "timestamp": int(time.time())
            })

        # 5. API: Auth Status & Accounts Overview (SPD Sec 4 & 5)
        if path == "/api/v1/auth/status":
            admin_sess = self.authenticate_admin()
            is_configured = db.is_any_admin_configured()
            slots = db.get_admin_slots_status()
            return self.send_json(200, {
                "success": True,
                "authenticated": admin_sess is not None,
                "admin": {
                    "slot": admin_sess["slot"],
                    "username": admin_sess["username"]
                } if admin_sess else None,
                "setup_needed": not is_configured,
                "slots": slots
            })

        if path == "/api/v1/auth/accounts-overview":
            return self.send_json(200, {
                "success": True,
                "slots": db.get_admin_slots_status(),
                "setup_needed": not db.is_any_admin_configured()
            })

        # 6. API: Admin Dashboard Stats (SPD Sec 7.1)
        if path == "/api/v1/admin/stats":
            admin_sess = self.authenticate_admin()
            if not admin_sess:
                return self.send_json(401, {"success": False, "error": "تصريح المشرف مطلوب. يرجى تسجيل الدخول أولاً."})
            stats = db.get_admin_stats()
            return self.send_json(200, {"success": True, "data": stats, "admin": {"slot": admin_sess["slot"], "username": admin_sess["username"]}})

        # 7. API: Admin Paginated Devices & Users (SPD Sec 7.1 - Fast on old devices)
        if path == "/api/v1/admin/devices":
            if not self.authenticate_admin():
                return self.send_json(401, {"success": False, "error": "غير مصرح"})
            search = query.get("search", [""])[0]
            status_filter = query.get("status", [""])[0]
            page = int(query.get("page", ["1"])[0])
            limit = int(query.get("limit", ["10"])[0])
            sort_by = query.get("sort_by", ["newest"])[0]
            result = db.get_devices_paginated(search, status_filter, page, limit, sort_by)
            return self.send_json(200, {"success": True, "data": result})

        # 8. API: Admin Device Full Details & Playlists (SPD Sec 7.1 & 7.2)
        if path.startswith("/api/v1/admin/devices/") and not path.endswith(("/rotate-pin", "/status", "/label", "/delete", "/sources")):
            if not self.authenticate_admin():
                return self.send_json(401, {"success": False, "error": "غير مصرح"})
            try:
                device_id = int(path.split("/")[5])
                dev = db.get_device_full_details(device_id)
                if not dev:
                    return self.send_json(404, {"success": False, "error": "الجهاز غير موجود"})
                return self.send_json(200, {"success": True, "device": dev})
            except Exception as e:
                return self.send_json(400, {"success": False, "error": f"معرف الجهاز غير صالح: {str(e)}"})

        # 9. API: Admin Paginated Audit Logs (SPD Sec 10)
        if path == "/api/v1/admin/audit-logs":
            if not self.authenticate_admin():
                return self.send_json(401, {"success": False, "error": "غير مصرح"})
            search = query.get("search", [""])[0]
            page = int(query.get("page", ["1"])[0])
            limit = int(query.get("limit", ["15"])[0])
            result = db.get_audit_logs_paginated(search, page, limit)
            return self.send_json(200, {"success": True, "data": result})

        # 9b. API: Admin Paginated Playlists Across All Devices (SPD Sec 3.3)
        if path == "/api/v1/admin/sources":
            if not self.authenticate_admin():
                return self.send_json(401, {"success": False, "error": "غير مصرح"})
            search = query.get("search", [""])[0]
            source_type = query.get("type", [""])[0]
            status = query.get("status", [""])[0]
            page = int(query.get("page", ["1"])[0])
            limit = int(query.get("limit", ["15"])[0])
            result = db.get_all_sources_paginated(search, source_type, status, page, limit)
            return self.send_json(200, {"success": True, "data": result})

        # 10. Static files
        self.serve_static(path)

    # ================= HTTP POST Routing =================
    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        body = self.parse_json_body()

        # 1. Web Device Pairing (Gated by Admin Session per SPD Section 2 & 3)
        if path == "/api/web/pair":
            admin_sess = self.authenticate_admin()
            if not admin_sess:
                return self.send_json(401, {
                    "success": False,
                    "error": "غير مصرح. يرجى تسجيل الدخول إلى الموقع بحساب المشرف أولاً للوصول إلى ربط الأجهزة."
                })

            mac = body.get("mac", "").strip()
            pin = body.get("pin", "").strip()
            client_ip = self.client_address[0]
            rate_key = f"{client_ip}:{security.normalize_mac(mac)}"

            # Rate limiting check
            allowed, retry_after = security.check_rate_limit(rate_key)
            if not allowed:
                return self.send_json(429, {
                    "success": False,
                    "error": f"تم تجاوز الحد الأقصى للمحاولات. يرجى الانتظار {retry_after} ثانية والمحاولة مجددًا."
                })

            # Format check
            if not mac or not pin or len(pin) != 6 or not pin.isdigit():
                security.record_failed_attempt(rate_key)
                return self.send_json(400, {
                    "success": False,
                    "error": "تعذر التحقق من الرموز. راجع القيم في التطبيق وحاول مجددًا."
                })

            # Verification
            device = db.verify_device_credentials(mac, pin)
            if not device:
                security.record_failed_attempt(rate_key)
                db.log_audit("system", client_ip, "pairing_failed", "device_code", security.mask_mac(mac))
                return self.send_json(401, {
                    "success": False,
                    "error": "تعذر التحقق من الرموز. راجع القيم في تطبيق SADDAM IPTV وحاول مجددًا."
                })

            if device.get("status") in ("disabled", "suspended", "blocked"):
                return self.send_json(403, {
                    "success": False,
                    "error": "هذا الجهاز موقوف أو معطل حالياً من قبل إدارة النظام."
                })

            # Success - link device to admin account, reactivate, and preserve all existing playlists
            security.reset_rate_limit(rate_key)
            db.link_device_to_account(device["id"], admin_sess["slot"])
            token = db.create_device_session(device["id"])
            db.log_audit("admin", str(admin_sess["slot"]), "device_paired", "device", str(device["id"]), {"mac": device["device_code"]})

            return self.send_json(200, {
                "success": True,
                "token": token,
                "device": {
                    "id": device["id"],
                    "device_code_masked": security.mask_mac(device["device_code"]),
                    "device_label": device["device_label"],
                    "platform": device["platform"]
                }
            }, cookies={"saddam_session": token})

        # 2. Web Device / Account: Add IPTV Source (SDP Section 7.2 & 7.3)
        if path == "/api/web/sources":
            admin_sess = self.authenticate_admin()
            device = self.authenticate_device()
            if not admin_sess and not device:
                return self.send_json(401, {"success": False, "error": "غير مصرح"})

            name = body.get("name", "").strip()
            server_url = body.get("server_url", "").strip()
            if not name or not server_url:
                return self.send_json(400, {"success": False, "error": "اسم المصدر والرابط مطلوبان"})

            # SSRF Protection Check
            is_safe, msg = security.is_ssrf_safe_url(server_url)
            if not is_safe:
                return self.send_json(400, {"success": False, "error": msg})

            dev_id = device["id"] if device else None
            slot = admin_sess["slot"] if admin_sess else (device.get("account_slot") or 1)

            new_source = db.add_iptv_source(dev_id, body, account_slot=slot)
            return self.send_json(201, {"success": True, "source": new_source})

        # 3. Web Device / Account: Test IPTV Source
        if path.startswith("/api/web/sources/") and path.endswith("/test"):
            admin_sess = self.authenticate_admin()
            device = self.authenticate_device()
            if not admin_sess and not device:
                return self.send_json(401, {"success": False, "error": "غير مصرح"})

            source_id = int(path.split("/")[4])
            with db.get_db() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT * FROM iptv_sources WHERE id = ?", (source_id,))
                source = cursor.fetchone()

            if not source:
                return self.send_json(404, {"success": False, "error": "المصدر غير موجود"})

            source_dict = dict(source)
            test_status, error_code, message = probe_iptv_source(source_dict)

            # If credentials were detected in M3U URL, auto-save them to DB so the Android client can also use Xtream API
            if source_dict.get("source_type") == "m3u" and not source_dict.get("username"):
                try:
                    parsed_qs = urllib.parse.parse_qs(urllib.parse.urlparse(source_dict["server_url"]).query)
                    if "username" in parsed_qs and "password" in parsed_qs:
                        with db.get_db() as conn:
                            conn.execute(
                                "UPDATE iptv_sources SET username = ?, password_encrypted = ? WHERE id = ?",
                                (parsed_qs["username"][0].strip(), parsed_qs["password"][0].strip(), source_id)
                            )
                            conn.commit()
                except Exception:
                    pass

            db.update_source_status(source_id, test_status, error_code)
            return self.send_json(200, {
                "success": test_status == "working",
                "status": test_status,
                "error_code": error_code,
                "message": message,
                "last_tested_at": int(time.time())
            })

        # 4. Web Device / Account: Toggle Source
        if path.startswith("/api/web/sources/") and path.endswith("/toggle"):
            admin_sess = self.authenticate_admin()
            device = self.authenticate_device()
            if not admin_sess and not device:
                return self.send_json(401, {"success": False, "error": "غير مصرح"})
            source_id = int(path.split("/")[4])
            enabled = body.get("enabled", True)
            dev_id = device["id"] if device else None
            slot = admin_sess["slot"] if admin_sess else None
            ok = db.toggle_iptv_source(source_id, dev_id, account_slot=slot, enabled=enabled)
            return self.send_json(200, {"success": ok})

        # 5. Web Device: Revoke Session (Logout)
        if path == "/api/web/session/revoke":
            token = self.get_auth_token()
            if token:
                db.revoke_session(token)
            return self.send_json(200, {"success": True, "message": "تم إنهاء الجلسة بنجاح"})

        # 6. Web Device: Unlink Device (SDP Section 5.4)
        if path in ("/api/web/device/unlink", "/api/web/unlink"):
            device = self.authenticate_device()
            if not device:
                admin_sess = self.authenticate_admin()
                if not admin_sess:
                    return self.send_json(401, {"success": False, "error": "غير مصرح"})
            if device:
                db.unlink_device(device["id"])
            return self.send_json(200, {
                "success": True,
                "message": "تم إلغاء ربط الجهاز بنجاح"
            }, cookies={"saddam_session": "deleted; Max-Age=0"})

        # 7. Android App: Register Device (SDP Section 10)
        if path == "/api/v1/devices/register":
            mac = body.get("mac")
            if not mac:
                return self.send_json(400, {"error": "رمز الجهاز (MAC) مطلوب"})
            label = body.get("label", "Android TV Device")
            platform = body.get("platform", "Android")
            app_version = body.get("app_version", "1.4.0")
            client_pin = body.get("pin")
            dev = db.register_or_get_device(mac, label, platform, app_version)
            if client_pin and len(str(client_pin).strip()) == 6 and str(client_pin).strip().isdigit():
                pin = db.set_device_pin(dev["id"], str(client_pin).strip(), expiry_minutes=52560000)
            else:
                pin = db.create_or_rotate_pin(dev["id"])
            return self.send_json(201, {
                "device_id": dev["id"],
                "device_code": dev["device_code"],
                "pairing_pin": pin,
                "pin_expires_minutes": None
            })

        # 7b. Android App: Sync Playlists with Exact MAC and Device Key (SPD Section 5 & 6)
        if path in ("/api/v1/devices/playlists", "/api/v1/devices/sync-playlists", "/api/v1/devices/sources"):
            mac = body.get("mac_address") or body.get("mac") or self.headers.get("X-Device-MAC", "")
            key = body.get("device_key") or body.get("key") or body.get("pin") or self.headers.get("X-Device-Key", "")
            clean_mac = security.normalize_mac(mac)
            clean_pin = str(key).strip()

            if not clean_mac or not clean_pin:
                return self.send_json(400, {
                    "success": False,
                    "error": "رمز الجهاز (MAC) ومفتاح الجهاز (Device Key) مطلوبان معاً.",
                    "playlists": []
                })

            device = db.verify_device_credentials(clean_mac, clean_pin)
            if not device:
                # Generic timing-safe error without revealing whether MAC or Key was incorrect (SPD Section 5)
                return self.send_json(401, {
                    "success": False,
                    "error": "بيانات اعتماد الجهاز غير صحيحة أو غير مسجلة",
                    "playlists": []
                })

            if device.get("status") in ("disabled", "suspended", "blocked"):
                return self.send_json(403, {
                    "success": False,
                    "error": "تم إيقاف هذا الجهاز من قبل إدارة النظام",
                    "playlists": []
                })

            # Retrieve all sources registered for THIS specific device
            sources = db.get_device_sources(device["id"], only_enabled=False, mask_password=False)
            playlists = []
            for s in sources:
                status = "active"
                if s.get("status") in ("expired", "STATUS_EXPIRED") or (s.get("last_error_code") and "EXPIRED" in str(s.get("last_error_code")).upper()):
                    status = "expired"
                elif not s.get("enabled"):
                    status = "disabled"
                elif s.get("expires_at"):
                    try:
                        exp_val = s["expires_at"]
                        if str(exp_val).isdigit():
                            exp_ts = int(exp_val)
                            if exp_ts < 10000000000:
                                exp_ts *= 1000
                            if time.time() * 1000 > exp_ts:
                                status = "expired"
                    except Exception:
                        pass

                playlists.append({
                    "id": s["id"],
                    "name": s["name"],
                    "source_type": s["source_type"],
                    "server_url": s["server_url"],
                    "username": s.get("username"),
                    "password": s.get("password") or s.get("password_encrypted"),
                    "status": status,
                    "is_enabled": bool(s.get("enabled", 1)),
                    "expires_at": s.get("expires_at"),
                    "created_at": s.get("created_at")
                })

            return self.send_json(200, {
                "success": True,
                "device_id": device["id"],
                "sync_version": device["sync_version"],
                "playlists": playlists,
                "sources": [s for s in sources if s.get("enabled", 1)]
            })

        # 8. Android App: Diagnostics
        if path == "/api/v1/devices/diagnostics":
            device = self.authenticate_device()
            if device:
                diag_data = body.get("diagnostics", {})
                db.log_audit("device", str(device["id"]), "diagnostics_reported", "diagnostics", "", diag_data)
            return self.send_json(200, {"status": "received"})

        # 9. Admin Login (SPD Sec 4 & 5 - Real PBKDF2 authentication, Rate Limited)
        if path in ("/api/v1/auth/login", "/api/v1/admin/login"):
            username = body.get("username", "").strip()
            password = body.get("password", "").strip()
            client_ip = self.client_address[0]
            rate_key = f"admin_login:{client_ip}:{username}"

            # Rate Limiting (5 attempts / 5 mins)
            allowed, retry_after = security.check_admin_rate_limit(rate_key)
            if not allowed:
                return self.send_json(429, {
                    "success": False,
                    "error": f"تم تجاوز الحد الأقصى للمحاولات. يرجى الانتظار {retry_after} ثانية والمحاولة مجدداً."
                })

            if not username or not password:
                security.record_admin_failed_attempt(rate_key)
                return self.send_json(400, {"success": False, "error": "اسم المستخدم وكلمة المرور مطلوبان"})

            # Check if system has any configured admin accounts
            if not db.is_any_admin_configured():
                return self.send_json(403, {
                    "success": False,
                    "setup_needed": True,
                    "error": "نظام إدارة SADDAM IPTV بانتظار تهيئة الحسابات الإدارية (الحساب 1 والحساب 2 غير مهيئين). يرجى ضبط الحسابات في ملف الإعدادات أو عبر سطر الأوامر."
                })

            # Verify credentials with timing-safe PBKDF2
            admin_account = db.verify_admin_credentials(username, password)
            if not admin_account:
                security.record_admin_failed_attempt(rate_key)
                db.log_audit("system", client_ip, "admin_login_failed", "admin_account", "", {"username": username})
                return self.send_json(401, {
                    "success": False,
                    "error": "اسم المستخدم أو كلمة المرور غير صحيحة"
                })

            # Success
            security.reset_admin_rate_limit(rate_key)
            token = db.create_admin_session(admin_account["slot"], admin_account["username"], client_ip)
            return self.send_json(200, {
                "success": True,
                "token": token,
                "admin": {
                    "slot": admin_account["slot"],
                    "username": admin_account["username"]
                }
            }, cookies={"saddam_admin_session": token})

        # 9b. Admin Logout (SPD Sec 6)
        if path in ("/api/v1/auth/logout", "/api/v1/admin/logout"):
            token = self.get_admin_session_token()
            if token:
                db.revoke_admin_session(token)
            return self.send_json(200, {
                "success": True,
                "message": "تم تسجيل الخروج بنجاح"
            }, cookies={"saddam_admin_session": "deleted; Max-Age=0"})

        # 9c. Admin Account Update (SPD Sec 9 - Password update with current password check)
        if path in ("/api/v1/auth/update-account", "/api/v1/admin/update-credentials"):
            admin_sess = self.authenticate_admin()
            if not admin_sess:
                return self.send_json(401, {"success": False, "error": "غير مصرح"})

            current_pwd = body.get("current_password", "").strip()
            new_user = body.get("new_username", "").strip() or admin_sess["username"]
            new_pwd = body.get("new_password", "").strip()

            if not current_pwd or not new_pwd:
                return self.send_json(400, {"success": False, "error": "كلمة المرور الحالية وكلمة المرور الجديدة مطلوبتان"})

            # Verify current password
            cur_acc = db.verify_admin_credentials(admin_sess["username"], current_pwd)
            if not cur_acc or cur_acc["slot"] != admin_sess["slot"]:
                return self.send_json(400, {"success": False, "error": "كلمة المرور الحالية غير صحيحة"})

            if len(new_pwd) < 8:
                return self.send_json(400, {"success": False, "error": "يجب ألا تقل كلمة المرور الجديدة عن 8 أحرف"})

            ok = db.update_admin_credentials(admin_sess["slot"], new_user, new_pwd)
            if ok:
                # Create fresh session for this slot
                new_token = db.create_admin_session(admin_sess["slot"], new_user, self.client_address[0])
                return self.send_json(200, {
                    "success": True,
                    "token": new_token,
                    "admin": {"slot": admin_sess["slot"], "username": new_user},
                    "message": "تم تحديث بيانات الحساب الإداري بنجاح"
                }, cookies={"saddam_admin_session": new_token})
            return self.send_json(500, {"success": False, "error": "فشل تحديث الحساب"})

        # 10. Admin: Rotate Device PIN
        if path.startswith("/api/v1/admin/devices/") and path.endswith("/rotate-pin"):
            if not self.authenticate_admin():
                return self.send_json(401, {"error": "تصريح المشرف مطلوب"})
            device_id = int(path.split("/")[5])
            new_pin = db.create_or_rotate_pin(device_id)
            return self.send_json(200, {"success": True, "new_pin": new_pin})

        # 10_sync. Admin: Trigger Device Synchronization (SPD Sec 3.5)
        if path.startswith("/api/v1/admin/devices/") and path.endswith("/sync"):
            admin_sess = self.authenticate_admin()
            if not admin_sess:
                return self.send_json(401, {"success": False, "error": "تصريح المشرف مطلوب"})
            device_id = int(path.split("/")[5])
            sync_res = db.admin_sync_device(device_id)
            if sync_res:
                db.log_audit("admin", str(admin_sess["slot"]), "device_sync_triggered", "device", str(device_id), sync_res)
                return self.send_json(200, {
                    "success": True,
                    "message": "تم إرسال طلب المزامنة للجهاز بنجاح",
                    "sync_version": sync_res["sync_version"],
                    "synced_at": sync_res["synced_at"]
                })
            return self.send_json(404, {"success": False, "error": "الجهاز غير موجود"})

        # 10b. Admin: Identify & Connect Device via MAC & Device Key (SPD Sec 7)
        if path in ("/api/v1/admin/devices/connect", "/api/v1/admin/devices/identify", "/api/v1/admin/devices/load"):
            admin_sess = self.authenticate_admin()
            if not admin_sess:
                return self.send_json(401, {"success": False, "error": "تصريح المشرف مطلوب. يرجى تسجيل الدخول أولاً."})
            mac = body.get("mac_address") or body.get("mac", "")
            key = body.get("device_key") or body.get("key") or body.get("pin", "")
            clean_mac = security.normalize_mac(mac)
            clean_pin = str(key).strip()

            if not clean_mac or not clean_pin:
                return self.send_json(400, {
                    "success": False,
                    "error": "يرجى إدخال عنوان MAC ومفتاح الجهاز (Device Key) معاً."
                })

            device = db.verify_device_credentials(clean_mac, clean_pin)
            if not device:
                db.log_audit("admin", str(admin_sess["slot"]), "device_connect_failed", "device_code", security.mask_mac(clean_mac))
                return self.send_json(401, {
                    "success": False,
                    "error": "تعذر التحقق من الجهاز. تأكد من صحة عنوان MAC ومفتاح الجهاز (Device Key)."
                })

            if device.get("status") in ("disabled", "suspended", "blocked"):
                return self.send_json(403, {
                    "success": False,
                    "error": "هذا الجهاز موقوف أو معطل حالياً من قبل إدارة النظام."
                })

            # Retrieve only playlists associated with this exact device
            sources = db.get_device_sources(device["id"], only_enabled=False, mask_password=False)
            playlists = []
            for s in sources:
                playlists.append({
                    "id": s["id"],
                    "device_id": s["device_id"],
                    "name": s["name"],
                    "source_type": s["source_type"],
                    "server_url": s["server_url"],
                    "username": s.get("username", ""),
                    "description": s.get("description", ""),
                    "status": s.get("status", "untested"),
                    "enabled": bool(s.get("enabled", 1)),
                    "expires_at": s.get("expires_at"),
                    "last_tested_at": s.get("last_tested_at"),
                    "created_at": s.get("created_at")
                })

            db.log_audit("admin", str(admin_sess["slot"]), "device_connected", "device", str(device["id"]), {
                "mac": security.mask_mac(clean_mac)
            })

            return self.send_json(200, {
                "success": True,
                "device": {
                    "id": device["id"],
                    "mac": device["device_code"],
                    "label": device.get("device_label", "Android TV Device"),
                    "platform": device.get("platform", "Android"),
                    "status": device.get("status", "active"),
                    "sync_version": device.get("sync_version", 1),
                    "last_seen_at": device.get("last_seen_at")
                },
                "playlists": playlists
            })

        # 11. Admin: Create Device
        if path == "/api/v1/admin/devices/create":
            if not self.authenticate_admin():
                return self.send_json(401, {"error": "تصريح المشرف مطلوب"})
            mac = body.get("mac")
            label = body.get("label", "جهاز جديد")
            platform = body.get("platform", "Android TV")
            dev = db.register_or_get_device(mac, label, platform)
            pin = db.create_or_rotate_pin(dev["id"])
            return self.send_json(201, {"success": True, "device": dev, "pin": pin})

        # 11b. Admin: Add Playlist/Source to Device (SPD Sec 7.2)
        if path.startswith("/api/v1/admin/devices/") and path.endswith("/sources"):
            if not self.authenticate_admin():
                return self.send_json(401, {"error": "تصريح المشرف مطلوب"})
            device_id = int(path.split("/")[5])
            server_url = body.get("server_url", "").strip()
            name = body.get("name", "").strip()
            if not server_url or not name:
                return self.send_json(400, {"success": False, "error": "اسم المصدر ورابط السيرفر مطلوبان"})

            is_safe, msg = security.is_ssrf_safe_url(server_url)
            if not is_safe:
                return self.send_json(400, {"success": False, "error": msg})

            new_src = db.admin_add_source_to_device(device_id, body)
            return self.send_json(201, {"success": True, "source": new_src})

        # 11c. Admin: Toggle Source Enabled State
        if path.startswith("/api/v1/admin/sources/") and path.endswith("/toggle"):
            if not self.authenticate_admin():
                return self.send_json(401, {"error": "تصريح المشرف مطلوب"})
            source_id = int(path.split("/")[5])
            enabled = body.get("enabled", True)
            ok = db.admin_toggle_source(source_id, enabled)
            return self.send_json(200, {"success": ok})

        # 11d. Admin: Test Source Connectivity
        if path.startswith("/api/v1/admin/sources/") and path.endswith("/test"):
            if not self.authenticate_admin():
                return self.send_json(401, {"error": "تصريح المشرف مطلوب"})
            source_id = int(path.split("/")[5])
            with db.get_db() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT * FROM iptv_sources WHERE id = ?", (source_id,))
                src = cursor.fetchone()
            if not src:
                return self.send_json(404, {"success": False, "error": "المصدر غير موجود"})
            src_dict = dict(src)
            test_status, error_code, message = probe_iptv_source(src_dict)
            db.update_source_status(source_id, test_status, error_code)
            return self.send_json(200, {
                "success": test_status == "working",
                "status": test_status,
                "error_code": error_code,
                "message": message,
                "last_tested_at": int(time.time())
            })

        # 11e. Admin: Delete Source (POST alternative)
        if path.startswith("/api/v1/admin/sources/") and path.endswith("/delete"):
            if not self.authenticate_admin():
                return self.send_json(401, {"error": "تصريح المشرف مطلوب"})
            source_id = int(path.split("/")[5])
            ok = db.admin_delete_source(source_id)
            if ok:
                return self.send_json(200, {"success": True, "message": "تم حذف المصدر بنجاح"})
            return self.send_json(404, {"error": "المصدر غير موجود"})

        # 11f. Admin: Update/Edit Source (SPD Sec 8.6)
        if path.startswith("/api/v1/admin/sources/") and path.endswith("/update"):
            admin_sess = self.authenticate_admin()
            if not admin_sess:
                return self.send_json(401, {"success": False, "error": "تصريح المشرف مطلوب"})
            source_id = int(path.split("/")[5])
            server_url = body.get("server_url", "").strip()
            name = body.get("name", "").strip()
            if not server_url or not name:
                return self.send_json(400, {"success": False, "error": "اسم المصدر ورابط السيرفر مطلوبان"})

            is_safe, msg = security.is_ssrf_safe_url(server_url)
            if not is_safe:
                return self.send_json(400, {"success": False, "error": msg})

            updated_src = db.admin_update_source(source_id, body)
            if updated_src:
                db.log_audit("admin", str(admin_sess["slot"]), "source_updated", "source", str(source_id), {"name": name})
                return self.send_json(200, {"success": True, "source": updated_src})
            return self.send_json(404, {"success": False, "error": "تعذر تحديث المصدر أو المصدر غير موجود"})

        # 12. Admin: Change Device Status (Active / Disabled / Suspended)
        if path.startswith("/api/v1/admin/devices/") and path.endswith("/status"):
            if not self.authenticate_admin():
                return self.send_json(401, {"error": "تصريح المشرف مطلوب"})
            parts = path.split("/")
            device_id = int(parts[5])
            new_status = body.get("status", "").strip().lower()
            if new_status not in ("active", "disabled", "suspended"):
                return self.send_json(400, {"error": "الحالة المحددة غير صالحة (active, disabled, suspended)"})
            ok = db.set_device_status(device_id, new_status)
            if ok:
                return self.send_json(200, {"success": True, "message": f"تم تغيير حالة الجهاز إلى {new_status}", "status": new_status})
            return self.send_json(404, {"error": "الجهاز غير موجود"})

        # 13. Admin: Update Device Label
        if path.startswith("/api/v1/admin/devices/") and path.endswith("/label"):
            if not self.authenticate_admin():
                return self.send_json(401, {"error": "تصريح المشرف مطلوب"})
            parts = path.split("/")
            device_id = int(parts[5])
            label = body.get("label", "").strip()
            ok = db.update_device_label(device_id, label)
            if ok:
                return self.send_json(200, {"success": True, "message": "تم تحديث اسم الجهاز بنجاح"})
            return self.send_json(404, {"error": "الجهاز غير موجود"})

        # 14. Admin: Delete Device (POST alternative)
        if path.startswith("/api/v1/admin/devices/") and path.endswith("/delete"):
            if not self.authenticate_admin():
                return self.send_json(401, {"error": "تصريح المشرف مطلوب"})
            parts = path.split("/")
            device_id = int(parts[5])
            ok = db.delete_device(device_id)
            if ok:
                return self.send_json(200, {"success": True, "message": "تم حذف الجهاز وجميع مصادره بنجاح"})
            return self.send_json(404, {"error": "الجهاز غير موجود"})

        # 15. Admin: Clear All Audit Logs
        if path in ("/api/v1/admin/audit-logs/clear", "/api/v1/admin/audit-logs"):
            if not self.authenticate_admin():
                return self.send_json(401, {"error": "تصريح المشرف مطلوب"})
            db.clear_all_audit_logs()
            return self.send_json(200, {"success": True, "message": "تم مسح سجل التدقيق بالكامل بنجاح"})

        # 16. Admin: Delete Single Audit Log
        if path.startswith("/api/v1/admin/audit-logs/") and path.endswith("/delete"):
            if not self.authenticate_admin():
                return self.send_json(401, {"error": "تصريح المشرف مطلوب"})
            parts = path.split("/")
            log_id = int(parts[5])
            ok = db.delete_audit_log(log_id)
            if ok:
                return self.send_json(200, {"success": True, "message": "تم حذف السجل المحدد بنجاح"})
            return self.send_json(404, {"error": "السجل غير موجود"})

        self.send_json(404, {"error": "المسار غير موجود"})

    # ================= HTTP PUT Routing =================
    def do_PUT(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        body = self.parse_json_body()

        if path.startswith("/api/web/sources/"):
            admin_sess = self.authenticate_admin()
            device = self.authenticate_device()
            if not admin_sess and not device:
                return self.send_json(401, {"success": False, "error": "غير مصرح"})
            source_id = int(path.split("/")[4])
            dev_id = device["id"] if device else None
            slot = admin_sess["slot"] if admin_sess else None
            res = db.update_iptv_source(source_id, dev_id, body, account_slot=slot)
            if res:
                return self.send_json(200, {"success": True, "source": res})
            return self.send_json(404, {"success": False, "error": "تعذر تحديث المصدر"})

        if path.startswith("/api/v1/admin/sources/"):
            admin_sess = self.authenticate_admin()
            if not admin_sess:
                return self.send_json(401, {"success": False, "error": "تصريح المشرف مطلوب"})
            source_id = int(path.split("/")[5])
            server_url = body.get("server_url", "").strip()
            name = body.get("name", "").strip()
            if not server_url or not name:
                return self.send_json(400, {"success": False, "error": "اسم المصدر ورابط السيرفر مطلوبان"})
            is_safe, msg = security.is_ssrf_safe_url(server_url)
            if not is_safe:
                return self.send_json(400, {"success": False, "error": msg})
            res = db.admin_update_source(source_id, body)
            if res:
                db.log_audit("admin", str(admin_sess["slot"]), "source_updated", "source", str(source_id), {"name": name})
                return self.send_json(200, {"success": True, "source": res})
            return self.send_json(404, {"success": False, "error": "تعذر تحديث المصدر أو المصدر غير موجود"})

        self.send_json(404, {"error": "المسار غير موجود"})

    # ================= HTTP DELETE Routing =================
    def do_DELETE(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path.startswith("/api/web/sources/"):
            admin_sess = self.authenticate_admin()
            device = self.authenticate_device()
            if not admin_sess and not device:
                return self.send_json(401, {"success": False, "error": "غير مصرح"})
            source_id = int(path.split("/")[4])
            dev_id = device["id"] if device else None
            slot = admin_sess["slot"] if admin_sess else None
            ok = db.delete_iptv_source(source_id, dev_id, account_slot=slot)
            if ok:
                return self.send_json(200, {"success": True, "message": "تم حذف المصدر بنجاح"})
            return self.send_json(404, {"success": False, "error": "المصدر غير موجود"})

        # Admin: Delete Source
        if path.startswith("/api/v1/admin/sources/"):
            if not self.authenticate_admin():
                return self.send_json(401, {"error": "تصريح المشرف مطلوب"})
            source_id = int(path.split("/")[5])
            ok = db.admin_delete_source(source_id)
            if ok:
                return self.send_json(200, {"success": True, "message": "تم حذف المصدر بنجاح"})
            return self.send_json(404, {"error": "المصدر غير موجود"})

        # Admin: Delete Device
        if path.startswith("/api/v1/admin/devices/"):
            if not self.authenticate_admin():
                return self.send_json(401, {"error": "تصريح المشرف مطلوب"})
            device_id = int(path.split("/")[5])
            ok = db.delete_device(device_id)
            if ok:
                return self.send_json(200, {"success": True, "message": "تم حذف الجهاز بنجاح"})
            return self.send_json(404, {"error": "الجهاز غير موجود"})

        # Admin: Clear Audit Logs
        if path in ("/api/v1/admin/audit-logs", "/api/v1/admin/audit-logs/clear"):
            if not self.authenticate_admin():
                return self.send_json(401, {"error": "تصريح المشرف مطلوب"})
            db.clear_all_audit_logs()
            return self.send_json(200, {"success": True, "message": "تم مسح سجل التدقيق بنجاح"})

        # Admin: Delete Single Audit Log
        if path.startswith("/api/v1/admin/audit-logs/"):
            if not self.authenticate_admin():
                return self.send_json(401, {"error": "تصريح المشرف مطلوب"})
            log_id = int(path.split("/")[5])
            ok = db.delete_audit_log(log_id)
            if ok:
                return self.send_json(200, {"success": True, "message": "تم حذف السجل بنجاح"})
            return self.send_json(404, {"error": "السجل غير موجود"})

        self.send_json(404, {"error": "المسار غير موجود"})

    # ================= Static File Serving with Security Hardening =================
    def serve_static(self, path: str):
        base_dir = os.path.dirname(os.path.abspath(__file__))
        candidate_dirs = [
            os.path.join(base_dir, "public"),
            os.path.join(base_dir, "Publish"),
            base_dir
        ]
        target_dir = base_dir
        for d in candidate_dirs:
            if os.path.isdir(d) and os.path.isfile(os.path.join(d, "index.html")):
                target_dir = d
                break

        if path in ("/", ""):
            file_name = "index.html"
        elif path in ("/admin", "/admin/"):
            file_name = "admin.html"
        else:
            file_name = path.lstrip("/")

        # Security check: Block direct access to database, python code, config, logs, or dotfiles
        clean_name = os.path.basename(file_name).lower()
        parts = [p.lower() for p in file_name.replace("\\", "/").split("/")]
        if "deletion" in parts:
            return self.send_json(403, {"error": "الوصول إلى هذا المجلد محظور"})
        _, ext = os.path.splitext(clean_name)
        forbidden_extensions = {".py", ".db", ".json", ".sqlite", ".sqlite3", ".env", ".log", ".sh", ".bat", ".md"}
        forbidden_names = {"admin_config.json", "requirements.txt", "saddam_iptv.db"}
        if ext in forbidden_extensions or clean_name in forbidden_names or clean_name.startswith("."):
            return self.send_json(403, {"error": "الوصول إلى هذا الملف محظور"})

        file_path = None
        for d in [target_dir] + candidate_dirs:
            candidate_path = os.path.abspath(os.path.join(d, file_name))
            if os.path.isfile(candidate_path):
                file_path = candidate_path
                target_dir = d
                break

        if not file_path and not path.startswith("/api"):
            fallback = os.path.abspath(os.path.join(target_dir, "index.html"))
            if os.path.isfile(fallback):
                file_path = fallback

        if not file_path or not os.path.isfile(file_path):
            self.send_response(404)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("X-Frame-Options", "DENY")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "الملف المطلوب غير موجود", "path": path}, ensure_ascii=False).encode("utf-8"))
            return

        mime_type, _ = mimetypes.guess_type(file_path)
        if not mime_type:
            mime_type = "application/octet-stream"
        if file_path.endswith(".css"):
            mime_type = "text/css; charset=utf-8"
        elif file_path.endswith(".js"):
            mime_type = "application/javascript; charset=utf-8"
        elif file_path.endswith(".html"):
            mime_type = "text/html; charset=utf-8"

        try:
            with open(file_path, "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_header("Content-Type", mime_type)
            self.send_header("Content-Length", str(len(content)))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
            self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
            self.send_header("Content-Security-Policy", "default-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com https://cdnjs.cloudflare.com; img-src 'self' data: https:; font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com; connect-src 'self' https://saddamplayer.onrender.com; frame-ancestors 'none';")
            self.end_headers()
            self.wfile.write(content)
        except Exception as e:
            self.send_response(500)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}, ensure_ascii=False).encode("utf-8"))


def run(port=PORT):
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    db.init_db()
    server_address = ("0.0.0.0", port)
    httpd = socketserver.ThreadingTCPServer(server_address, SaddamIPTVHandler)
    print("==================================================")
    print(f"[+] SADDAM IPTV Official Portal running on:")
    print(f"    -> http://localhost:{port}")
    print(f"    -> Admin Panel: http://localhost:{port}/admin")
    print(f"    -> Android API: http://localhost:{port}/api/v1/devices")
    print("==================================================")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
        httpd.server_close()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else PORT
    run(port)
