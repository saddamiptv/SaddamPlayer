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
from typing import Dict, Any, Optional

import database as db
import security

PORT = int(os.environ.get("PORT", 8080))
PUBLIC_DIR = os.path.join(os.path.dirname(__file__), "public")


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

    # Helper: Send JSON response
    def send_json(self, status_code: int, data: Any, cookies: Optional[Dict[str, str]] = None):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
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

    # Helper: Extract session token from Cookie or Bearer header
    def get_auth_token(self) -> Optional[str]:
        # Check Authorization header: Bearer <token>
        auth_header = self.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            return auth_header[7:].strip()

        # Check Cookie header: saddam_session=<token>
        cookie_header = self.headers.get("Cookie", "")
        if cookie_header:
            cookies = [c.strip() for c in cookie_header.split(";")]
            for c in cookies:
                if c.startswith("saddam_session="):
                    return c.split("=", 1)[1].strip()

        return None

    # Helper: Authenticate Web Device Session
    def authenticate_device(self) -> Optional[Dict[str, Any]]:
        token = self.get_auth_token()
        if not token:
            return None
        return db.validate_session_token(token)

    # Helper: Authenticate Admin Session
    def authenticate_admin(self) -> bool:
        auth_header = self.headers.get("X-Admin-Key", "")
        if not auth_header:
            token = self.get_auth_token()
            auth_header = token or ""
        # Accept default admin token or key
        return auth_header == "saddam_admin_secret_token_2026"

    # ================= HTTP GET Routing =================
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        # 1. API: Web Device Info
        if path == "/api/web/me":
            device = self.authenticate_device()
            if not device:
                return self.send_json(401, {"success": False, "error": "الجلسة غير صالحة أو منتهية"})
            return self.send_json(200, {
                "success": True,
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
                }
            })

        # 2. API: Web Device Sources
        if path == "/api/web/sources":
            device = self.authenticate_device()
            if not device:
                return self.send_json(401, {"success": False, "error": "غير مصرح"})
            sources = db.get_device_sources(device["id"])
            return self.send_json(200, {"success": True, "sources": sources})

        # 3. API: Web Android Sync Preview
        if path == "/api/web/sync-preview":
            device = self.authenticate_device()
            if not device:
                return self.send_json(401, {"success": False, "error": "غير مصرح"})
            sources = db.get_device_sources(device["id"], only_enabled=True)
            return self.send_json(200, {
                "success": True,
                "device_id": device["id"],
                "sync_version": device["sync_version"],
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
                # check if there's any active session
                cursor.execute("SELECT token FROM device_sessions WHERE device_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY id DESC LIMIT 1", (dev["id"], int(time.time())))
                active_sess = cursor.fetchone()
                return self.send_json(200, {
                    "paired": active_sess is not None,
                    "device_status": dev["status"],
                    "sync_version": dev["sync_version"],
                    "token": active_sess["token"] if active_sess else None
                })

        if path == "/api/v1/devices/sources":
            device = self.authenticate_device()
            if not device:
                return self.send_json(401, {"error": "الجلسة غير صالحة أو غير مأذونة"})
            sources = db.get_device_sources(device["id"], only_enabled=True)
            return self.send_json(200, {
                "device_id": device["id"],
                "sync_version": device["sync_version"],
                "sources": sources
            })

        if path == "/api/v1/devices/sync":
            device = self.authenticate_device()
            if not device:
                return self.send_json(401, {"error": "الجلسة غير صالحة"})
            return self.send_json(200, {
                "device_id": device["id"],
                "sync_version": device["sync_version"],
                "status": "synchronized",
                "timestamp": int(time.time())
            })

        # 5. API: Admin Dashboard Stats
        if path == "/api/v1/admin/stats":
            if not self.authenticate_admin():
                return self.send_json(403, {"error": "تصريح المشرف مطلوب"})
            stats = db.get_admin_stats()
            return self.send_json(200, {"success": True, "data": stats})

        # 6. Static files
        self.serve_static(path)

    # ================= HTTP POST Routing =================
    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        body = self.parse_json_body()

        # 1. Web Device Pairing (SDP Section 4)
        if path == "/api/web/pair":
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

            # Success
            security.reset_rate_limit(rate_key)
            token = db.create_device_session(device["id"])
            db.log_audit("device_session", str(device["id"]), "pairing_successful", "device", str(device["id"]))

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

        # 2. Web Device: Add IPTV Source (SDP Section 7.2 & 7.3)
        if path == "/api/web/sources":
            device = self.authenticate_device()
            if not device:
                return self.send_json(401, {"success": False, "error": "غير مصرح"})

            name = body.get("name", "").strip()
            server_url = body.get("server_url", "").strip()
            if not name or not server_url:
                return self.send_json(400, {"success": False, "error": "اسم المصدر والرابط مطلوبان"})

            # SSRF Protection Check
            is_safe, msg = security.is_ssrf_safe_url(server_url)
            if not is_safe:
                return self.send_json(400, {"success": False, "error": msg})

            new_source = db.add_iptv_source(device["id"], body)
            return self.send_json(201, {"success": True, "source": new_source})

        # 3. Web Device: Test IPTV Source
        if path.startswith("/api/web/sources/") and path.endswith("/test"):
            device = self.authenticate_device()
            if not device:
                return self.send_json(401, {"success": False, "error": "غير مصرح"})

            source_id = int(path.split("/")[4])
            with db.get_db() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT * FROM iptv_sources WHERE id = ? AND device_id = ?", (source_id, device["id"]))
                source = cursor.fetchone()

            if not source:
                return self.send_json(404, {"success": False, "error": "المصدر غير موجود"})

            target_url = source["server_url"]
            is_safe, msg = security.is_ssrf_safe_url(target_url)
            if not is_safe:
                db.update_source_status(source_id, "unavailable", msg)
                return self.send_json(200, {"success": False, "status": "unavailable", "message": msg})

            # Perform probe request safely with 4-second timeout
            test_status = "working"
            error_code = ""
            message = "تم الاتصال بالمصدر بنجاح والقائمة صالحة"

            try:
                req = urllib.request.Request(
                    target_url,
                    headers={"User-Agent": "SADDAM-IPTV-Player/1.1 (Android TV)"}
                )
                with urllib.request.urlopen(req, timeout=4) as resp:
                    code = resp.getcode()
                    if code >= 400:
                        test_status = "connection_failed"
                        error_code = f"HTTP {code}"
                        message = f"أرجع الخادم رمز خطأ: {code}"
            except urllib.error.HTTPError as e:
                if e.code in (401, 403):
                    test_status = "auth_failed"
                    error_code = f"HTTP {e.code}"
                    message = "بيانات الدخول غير صحيحة أو غير مصرح بالوصول"
                else:
                    test_status = "connection_failed"
                    error_code = f"HTTP {e.code}"
                    message = f"فشل الاتصال بالخادم: {e.reason}"
            except Exception as e:
                # If network test fails (e.g. offline/demo mock), give informative status
                test_status = "connection_failed"
                error_code = "TIMEOUT_OR_UNREACHABLE"
                message = f"تعذر الاتصال بالخادم: {str(e)}"

            db.update_source_status(source_id, test_status, error_code)
            return self.send_json(200, {
                "success": test_status == "working",
                "status": test_status,
                "error_code": error_code,
                "message": message,
                "last_tested_at": int(time.time())
            })

        # 4. Web Device: Toggle Source
        if path.startswith("/api/web/sources/") and path.endswith("/toggle"):
            device = self.authenticate_device()
            if not device:
                return self.send_json(401, {"success": False, "error": "غير مصرح"})
            source_id = int(path.split("/")[4])
            enabled = body.get("enabled", True)
            ok = db.toggle_iptv_source(source_id, device["id"], enabled)
            return self.send_json(200, {"success": ok})

        # 5. Web Device: Revoke Session (Logout)
        if path == "/api/web/session/revoke":
            token = self.get_auth_token()
            if token:
                db.revoke_session(token)
            return self.send_json(200, {"success": True, "message": "تم إنهاء الجلسة بنجاح"})

        # 6. Web Device: Unlink Device (SDP Section 5.4)
        if path == "/api/web/device/unlink":
            device = self.authenticate_device()
            if not device:
                return self.send_json(401, {"success": False, "error": "غير مصرح"})
            db.unlink_device(device["id"])
            return self.send_json(200, {"success": True, "message": "تم إلغاء ربط الجهاز بنجاح"})

        # 7. Android App: Register Device (SDP Section 10)
        if path == "/api/v1/devices/register":
            mac = body.get("mac")
            if not mac:
                return self.send_json(400, {"error": "رمز الجهاز (MAC) مطلوب"})
            label = body.get("label", "Android TV Device")
            platform = body.get("platform", "Android")
            app_version = body.get("app_version", "1.3.0")
            client_pin = body.get("pin")
            dev = db.register_or_get_device(mac, label, platform, app_version)
            if client_pin and len(str(client_pin).strip()) == 6 and str(client_pin).strip().isdigit():
                pin = db.set_device_pin(dev["id"], str(client_pin).strip(), expiry_minutes=1440)
            else:
                pin = db.create_or_rotate_pin(dev["id"])
            return self.send_json(201, {
                "device_id": dev["id"],
                "device_code": dev["device_code"],
                "pairing_pin": pin,
                "pin_expires_minutes": 1440
            })

        # 8. Android App: Diagnostics
        if path == "/api/v1/devices/diagnostics":
            device = self.authenticate_device()
            if device:
                diag_data = body.get("diagnostics", {})
                db.log_audit("device", str(device["id"]), "diagnostics_reported", "diagnostics", "", diag_data)
            return self.send_json(200, {"status": "received"})

        # 9. Admin Login
        if path == "/api/v1/admin/login":
            username = body.get("username", "").strip()
            password = body.get("password", "").strip()
            if (username == "Saddam2026" and password == "Saddam@1991") or (username == "admin" and password == "SaddamAdmin2026!"):
                return self.send_json(200, {
                    "success": True,
                    "token": "saddam_admin_secret_token_2026",
                    "admin": {"username": username}
                })
            return self.send_json(401, {"success": False, "error": "اسم المستخدم أو كلمة المرور غير صحيحة"})

        # 10. Admin: Rotate Device PIN
        if path.startswith("/api/v1/admin/devices/") and path.endswith("/rotate-pin"):
            if not self.authenticate_admin():
                return self.send_json(403, {"error": "تصريح المشرف مطلوب"})
            device_id = int(path.split("/")[5])
            new_pin = db.create_or_rotate_pin(device_id)
            return self.send_json(200, {"success": True, "new_pin": new_pin})

        # 11. Admin: Create Device
        if path == "/api/v1/admin/devices/create":
            if not self.authenticate_admin():
                return self.send_json(403, {"error": "تصريح المشرف مطلوب"})
            mac = body.get("mac")
            label = body.get("label", "جهاز جديد")
            platform = body.get("platform", "Android TV")
            dev = db.register_or_get_device(mac, label, platform)
            pin = db.create_or_rotate_pin(dev["id"])
            return self.send_json(201, {"success": True, "device": dev, "pin": pin})

        self.send_json(404, {"error": "المسار غير موجود"})

    # ================= HTTP PUT Routing =================
    def do_PUT(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        body = self.parse_json_body()

        if path.startswith("/api/web/sources/"):
            device = self.authenticate_device()
            if not device:
                return self.send_json(401, {"success": False, "error": "غير مصرح"})
            source_id = int(path.split("/")[4])
            res = db.update_iptv_source(source_id, device["id"], body)
            if res:
                return self.send_json(200, {"success": True, "source": res})
            return self.send_json(404, {"success": False, "error": "تعذر تحديث المصدر"})

        self.send_json(404, {"error": "المسار غير موجود"})

    # ================= HTTP DELETE Routing =================
    def do_DELETE(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path.startswith("/api/web/sources/"):
            device = self.authenticate_device()
            if not device:
                return self.send_json(401, {"success": False, "error": "غير مصرح"})
            source_id = int(path.split("/")[4])
            ok = db.delete_iptv_source(source_id, device["id"])
            if ok:
                return self.send_json(200, {"success": True, "message": "تم حذف المصدر بنجاح"})
            return self.send_json(404, {"success": False, "error": "المصدر غير موجود"})

        self.send_json(404, {"error": "المسار غير موجود"})

    # ================= Static File Serving =================
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
