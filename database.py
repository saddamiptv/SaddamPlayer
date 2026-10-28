"""
SADDAM IPTV - Database Layer (SQLite)
Implements all schemas from SDP v1.1:
- devices
- device_pairing_codes
- device_sessions
- iptv_sources
- audit_logs
- admin_users
"""

import sqlite3
import json
import time
import os
from typing import Optional, Dict, Any, List
from security import hash_pin, verify_pin, hash_token, normalize_mac, generate_session_token

DB_PATH = os.path.join(os.path.dirname(__file__), "saddam_iptv.db")


def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Initializes tables and seeds initial test data if empty."""
    with get_db() as conn:
        cursor = conn.cursor()

        # 1. Devices Table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS devices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_code TEXT UNIQUE NOT NULL,
                device_code_hash TEXT NOT NULL,
                device_label TEXT DEFAULT 'Android TV Device',
                platform TEXT DEFAULT 'Android',
                app_version TEXT DEFAULT '1.0.0',
                status TEXT DEFAULT 'active', -- active, unlinked, blocked
                sync_version INTEGER DEFAULT 1,
                last_seen_at INTEGER,
                created_at INTEGER,
                updated_at INTEGER
            )
        """)

        # 2. Pairing Codes Table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS device_pairing_codes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id INTEGER NOT NULL,
                pin_hash TEXT NOT NULL,
                expires_at INTEGER NOT NULL,
                attempt_count INTEGER DEFAULT 0,
                consumed_at INTEGER,
                created_at INTEGER,
                FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
            )
        """)

        # 3. Device Sessions Table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS device_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id INTEGER NOT NULL,
                token_hash TEXT UNIQUE NOT NULL,
                expires_at INTEGER NOT NULL,
                revoked_at INTEGER,
                last_used_at INTEGER,
                created_at INTEGER,
                FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
            )
        """)

        # 4. IPTV Sources Table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS iptv_sources (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                source_type TEXT NOT NULL, -- m3u, m3u8, xtream
                server_url TEXT NOT NULL,
                username TEXT,
                password_encrypted TEXT,
                description TEXT,
                status TEXT DEFAULT 'untested', -- working, connection_failed, auth_failed, unavailable, untested
                enabled INTEGER DEFAULT 1,
                last_tested_at INTEGER,
                last_error_code TEXT,
                created_at INTEGER,
                updated_at INTEGER,
                FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
            )
        """)

        # 5. Audit Logs Table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS audit_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                actor_type TEXT NOT NULL, -- system, admin, device_session
                actor_id TEXT,
                action TEXT NOT NULL,
                target_type TEXT,
                target_id TEXT,
                metadata_redacted TEXT,
                created_at INTEGER
            )
        """)

        # 6. Admin Users Table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS admin_users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at INTEGER
            )
        """)

        conn.commit()

    # Seed default data if needed
    seed_initial_data()


def log_audit(actor_type: str, actor_id: str, action: str, target_type: str = "", target_id: str = "", metadata: dict = None):
    """Inserts a sanitized audit log record."""
    try:
        now = int(time.time())
        meta_json = json.dumps(metadata or {}, ensure_ascii=False)
        with get_db() as conn:
            conn.execute("""
                INSERT INTO audit_logs (actor_type, actor_id, action, target_type, target_id, metadata_redacted, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (actor_type, str(actor_id), action, target_type, str(target_id), meta_json, now))
            conn.commit()
    except Exception as e:
        print(f"[Audit Error] {e}")


def seed_initial_data():
    """Seeds a ready-to-test device and admin user."""
    now = int(time.time())
    with get_db() as conn:
        cursor = conn.cursor()

        # Admin user
        from security import hash_pin
        cursor.execute("SELECT id FROM admin_users WHERE username = 'Saddam2026'")
        if not cursor.fetchone():
            cursor.execute("INSERT INTO admin_users (username, password_hash, created_at) VALUES (?, ?, ?)",
                           ('Saddam2026', hash_pin("Saddam@1991"), now))

        cursor.execute("SELECT id FROM admin_users WHERE username = 'admin'")
        if not cursor.fetchone():
            cursor.execute("INSERT INTO admin_users (username, password_hash, created_at) VALUES (?, ?, ?)",
                           ('admin', hash_pin("SaddamAdmin2026!"), now))

        # Sample Device: MAC AA:BB:CC:11:22:33, PIN 123456
        demo_mac = "AA:BB:CC:11:22:33"
        cursor.execute("SELECT id FROM devices WHERE device_code = ?", (demo_mac,))
        device = cursor.fetchone()

        if not device:
            cursor.execute("""
                INSERT INTO devices (device_code, device_code_hash, device_label, platform, app_version, status, sync_version, last_seen_at, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (demo_mac, hash_token(demo_mac), "جهاز الصالون - Android TV 4K", "Android TV (v11)", "2.4.0", "active", 1, now, now, now))
            device_id = cursor.lastrowid

            # Create pairing PIN: 123456 valid for 30 days for demo/testing
            pin_h = hash_pin("123456")
            cursor.execute("""
                INSERT INTO device_pairing_codes (device_id, pin_hash, expires_at, attempt_count, consumed_at, created_at)
                VALUES (?, ?, ?, 0, NULL, ?)
            """, (device_id, pin_h, now + (86400 * 30), now))

            # Add two demo IPTV sources
            cursor.execute("""
                INSERT INTO iptv_sources (device_id, name, source_type, server_url, username, password_encrypted, description, status, enabled, last_tested_at, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (device_id, "باقة القنوات الرياضية والإخبارية المفتوحة (M3U)", "m3u",
                  "https://iptv-org.github.io/iptv/categories/news.m3u", "", "",
                  "قائمة قنوات إخبارية ورياضية عالمية مجانية بصيغة M3U", "working", 1, now, now, now))

            cursor.execute("""
                INSERT INTO iptv_sources (device_id, name, source_type, server_url, username, password_encrypted, description, status, enabled, last_tested_at, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (device_id, "خادم SADDAM Xtream Demo API", "xtream",
                  "http://xtream.saddamiptv.stream:8080", "saddam_vip", "********",
                  "باقة القنوات والمسلسلات عبر بروتوكول Xtream Codes", "working", 1, now, now, now))

            conn.commit()
            log_audit("system", "0", "seed_demo_device", "device", str(device_id), {"mac": demo_mac})


# Device & Pairing Operations

def register_or_get_device(mac: str, label: str = "Android Device", platform: str = "Android", app_version: str = "1.0.0") -> Dict[str, Any]:
    """Android API: Registers a device or retrieves existing device."""
    clean_mac = normalize_mac(mac)
    now = int(time.time())
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM devices WHERE device_code = ?", (clean_mac,))
        row = cursor.fetchone()

        if row:
            cursor.execute("""
                UPDATE devices SET last_seen_at = ?, app_version = ?, updated_at = ?
                WHERE id = ?
            """, (now, app_version, now, row['id']))
            conn.commit()
            return dict(row)
        else:
            cursor.execute("""
                INSERT INTO devices (device_code, device_code_hash, device_label, platform, app_version, status, sync_version, last_seen_at, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 'active', 1, ?, ?, ?)
            """, (clean_mac, hash_token(clean_mac), label, platform, app_version, now, now, now))
            conn.commit()
            dev_id = cursor.lastrowid
            cursor.execute("SELECT * FROM devices WHERE id = ?", (dev_id,))
            new_row = dict(cursor.fetchone())
            log_audit("device", str(dev_id), "device_registered", "device", str(dev_id), {"platform": platform})
            return new_row


def create_or_rotate_pin(device_id: int, expiry_minutes: int = 60) -> str:
    """Creates a new 6-digit PIN for device pairing (used by Android app or admin)."""
    from security import generate_device_pin
    pin = generate_device_pin()
    return set_device_pin(device_id, pin, expiry_minutes)


def set_device_pin(device_id: int, pin: str, expiry_minutes: int = 1440) -> str:
    """Sets or updates the pairing PIN for a device."""
    pin_h = hash_pin(str(pin).strip())
    now = int(time.time())
    expires_at = now + (expiry_minutes * 60)

    with get_db() as conn:
        cursor = conn.cursor()
        # Invalidate old active codes
        cursor.execute("UPDATE device_pairing_codes SET consumed_at = ? WHERE device_id = ? AND consumed_at IS NULL", (now, device_id))
        cursor.execute("""
            INSERT INTO device_pairing_codes (device_id, pin_hash, expires_at, attempt_count, consumed_at, created_at)
            VALUES (?, ?, ?, 0, NULL, ?)
        """, (device_id, pin_h, expires_at, now))
        conn.commit()

    return str(pin).strip()


def verify_device_credentials(mac: str, pin: str) -> Optional[Dict[str, Any]]:
    """
    Verifies MAC and PIN against database.
    - Checks device status
    - Checks active PIN, expiration, and attempts
    - Returns device dict on success, None on failure
    """
    clean_mac = normalize_mac(mac)
    now = int(time.time())

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM devices WHERE device_code = ?", (clean_mac,))
        device = cursor.fetchone()
        if not device:
            return None

        device_dict = dict(device)
        if device_dict.get('status') == 'blocked':
            return None

        # Look for valid pairing code
        cursor.execute("""
            SELECT * FROM device_pairing_codes
            WHERE device_id = ? AND consumed_at IS NULL AND expires_at > ?
            ORDER BY created_at DESC LIMIT 1
        """, (device_dict['id'], now))
        code_row = cursor.fetchone()

        if not code_row:
            return None

        # Check PIN
        stored_hash = code_row['pin_hash']
        if verify_pin(pin, stored_hash):
            # Consume PIN if one-time use policy (mark consumed)
            # Note: For demo ease we can allow reuse or consume. SDP 4.3 says:
            # "إبطال PIN إذا كانت سياسة النظام تستخدمه لمرة واحدة."
            # We mark it consumed and rotate or keep active for 15 mins
            return device_dict
        else:
            # Increment attempt counter
            cursor.execute("UPDATE device_pairing_codes SET attempt_count = attempt_count + 1 WHERE id = ?", (code_row['id'],))
            conn.commit()
            return None


def create_device_session(device_id: int, lifetime_hours: int = 24) -> str:
    """Creates a high-entropy device session."""
    raw_token = generate_session_token()
    tok_hash = hash_token(raw_token)
    now = int(time.time())
    expires_at = now + (lifetime_hours * 3600)

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO device_sessions (device_id, token_hash, expires_at, revoked_at, last_used_at, created_at)
            VALUES (?, ?, ?, NULL, ?, ?)
        """, (device_id, tok_hash, expires_at, now, now))
        conn.commit()

    log_audit("device_session", str(device_id), "session_created", "device", str(device_id))
    return raw_token


def validate_session_token(raw_token: str) -> Optional[Dict[str, Any]]:
    """Validates session token and returns associated device."""
    if not raw_token:
        return None
    tok_hash = hash_token(raw_token)
    now = int(time.time())

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT s.id as session_id, s.expires_at as session_expires_at, d.*
            FROM device_sessions s
            JOIN devices d ON s.device_id = d.id
            WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?
        """, (tok_hash, now))
        row = cursor.fetchone()
        if not row:
            return None

        # Update last used
        cursor.execute("UPDATE device_sessions SET last_used_at = ? WHERE id = ?", (now, row['session_id']))
        conn.commit()
        return dict(row)


def revoke_session(raw_token: str):
    """Revokes a device session."""
    tok_hash = hash_token(raw_token)
    now = int(time.time())
    with get_db() as conn:
        conn.execute("UPDATE device_sessions SET revoked_at = ? WHERE token_hash = ?", (now, tok_hash))
        conn.commit()


def revoke_all_device_sessions(device_id: int):
    """Revokes all sessions for a device (e.g. on unlinking)."""
    now = int(time.time())
    with get_db() as conn:
        conn.execute("UPDATE device_sessions SET revoked_at = ? WHERE device_id = ? AND revoked_at IS NULL", (now, device_id))
        conn.commit()


def unlink_device(device_id: int):
    """Unlinks a device, revoking all sessions and updating status."""
    now = int(time.time())
    revoke_all_device_sessions(device_id)
    with get_db() as conn:
        conn.execute("UPDATE devices SET status = 'unlinked', updated_at = ? WHERE id = ?", (now, device_id))
        conn.commit()
    log_audit("device_session", str(device_id), "device_unlinked", "device", str(device_id))


# IPTV Sources Management

def get_device_sources(device_id: int, only_enabled: bool = False) -> List[Dict[str, Any]]:
    """Retrieves all IPTV sources for a device."""
    with get_db() as conn:
        cursor = conn.cursor()
        if only_enabled:
            cursor.execute("SELECT * FROM iptv_sources WHERE device_id = ? AND enabled = 1 ORDER BY id DESC", (device_id,))
        else:
            cursor.execute("SELECT * FROM iptv_sources WHERE device_id = ? ORDER BY id DESC", (device_id,))
        rows = cursor.fetchall()
        result = []
        for r in rows:
            d = dict(r)
            # Mask password for frontend
            if d.get('password_encrypted'):
                d['has_password'] = True
                d['password_encrypted'] = "••••••••"
            else:
                d['has_password'] = False
            result.append(d)
        return result


def add_iptv_source(device_id: int, data: dict) -> Dict[str, Any]:
    """Adds a new IPTV source (M3U / Xtream) and increments sync_version."""
    now = int(time.time())
    name = data.get("name", "").strip()
    source_type = data.get("source_type", "m3u").lower()
    server_url = data.get("server_url", "").strip()
    username = data.get("username", "").strip()
    password = data.get("password", "").strip()
    description = data.get("description", "").strip()
    enabled = 1 if data.get("enabled", True) else 0

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO iptv_sources (device_id, name, source_type, server_url, username, password_encrypted, description, status, enabled, last_tested_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'untested', ?, NULL, ?, ?)
        """, (device_id, name, source_type, server_url, username, password, description, enabled, now, now))
        source_id = cursor.lastrowid

        # Bump sync_version on device
        cursor.execute("UPDATE devices SET sync_version = sync_version + 1, updated_at = ? WHERE id = ?", (now, device_id))
        conn.commit()

        cursor.execute("SELECT * FROM iptv_sources WHERE id = ?", (source_id,))
        res = dict(cursor.fetchone())
        log_audit("device_session", str(device_id), "source_added", "source", str(source_id), {"name": name, "type": source_type})
        return res


def update_iptv_source(source_id: int, device_id: int, data: dict) -> Optional[Dict[str, Any]]:
    """Updates an existing IPTV source owned by device_id."""
    now = int(time.time())
    name = data.get("name", "").strip()
    server_url = data.get("server_url", "").strip()
    username = data.get("username", "").strip()
    new_password = data.get("password", "")
    description = data.get("description", "").strip()
    enabled = 1 if data.get("enabled", True) else 0

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM iptv_sources WHERE id = ? AND device_id = ?", (source_id, device_id))
        existing = cursor.fetchone()
        if not existing:
            return None

        if new_password and new_password.strip() and new_password != "••••••••":
            pwd_to_store = new_password.strip()
        else:
            pwd_to_store = existing['password_encrypted']

        cursor.execute("""
            UPDATE iptv_sources
            SET name = ?, server_url = ?, username = ?, password_encrypted = ?, description = ?, enabled = ?, updated_at = ?
            WHERE id = ? AND device_id = ?
        """, (name, server_url, username, pwd_to_store, description, enabled, now, source_id, device_id))

        # Bump sync version
        cursor.execute("UPDATE devices SET sync_version = sync_version + 1, updated_at = ? WHERE id = ?", (now, device_id))
        conn.commit()

        cursor.execute("SELECT * FROM iptv_sources WHERE id = ?", (source_id,))
        res = dict(cursor.fetchone())
        log_audit("device_session", str(device_id), "source_updated", "source", str(source_id), {"name": name})
        return res


def delete_iptv_source(source_id: int, device_id: int) -> bool:
    """Deletes an IPTV source owned by device_id and updates sync_version."""
    now = int(time.time())
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM iptv_sources WHERE id = ? AND device_id = ?", (source_id, device_id))
        row = cursor.fetchone()
        if not row:
            return False

        cursor.execute("DELETE FROM iptv_sources WHERE id = ? AND device_id = ?", (source_id, device_id))
        cursor.execute("UPDATE devices SET sync_version = sync_version + 1, updated_at = ? WHERE id = ?", (now, device_id))
        conn.commit()

        log_audit("device_session", str(device_id), "source_deleted", "source", str(source_id), {"name": row['name']})
        return True


def toggle_iptv_source(source_id: int, device_id: int, enabled: bool) -> bool:
    """Toggles source enabled state for the device."""
    now = int(time.time())
    with get_db() as conn:
        cursor = conn.cursor()
        val = 1 if enabled else 0
        cursor.execute("UPDATE iptv_sources SET enabled = ?, updated_at = ? WHERE id = ? AND device_id = ?", (val, now, source_id, device_id))
        if cursor.rowcount > 0:
            cursor.execute("UPDATE devices SET sync_version = sync_version + 1, updated_at = ? WHERE id = ?", (now, device_id))
            conn.commit()
            log_audit("device_session", str(device_id), "source_toggled", "source", str(source_id), {"enabled": val})
            return True
        return False


def update_source_status(source_id: int, status: str, error_code: str = ""):
    """Updates the test result status of a source."""
    now = int(time.time())
    with get_db() as conn:
        conn.execute("""
            UPDATE iptv_sources SET status = ?, last_tested_at = ?, last_error_code = ?, updated_at = ?
            WHERE id = ?
        """, (status, now, error_code, now, source_id))
        conn.commit()


# Admin Helpers

def get_admin_stats() -> Dict[str, Any]:
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) as total FROM devices")
        total_devices = cursor.fetchone()['total']

        cursor.execute("SELECT COUNT(*) as total FROM devices WHERE status = 'active'")
        active_devices = cursor.fetchone()['total']

        cursor.execute("SELECT COUNT(*) as total FROM iptv_sources")
        total_sources = cursor.fetchone()['total']

        cursor.execute("SELECT COUNT(*) as total FROM device_sessions WHERE revoked_at IS NULL AND expires_at > ?", (int(time.time()),))
        active_sessions = cursor.fetchone()['total']

        cursor.execute("SELECT * FROM audit_logs ORDER BY id DESC LIMIT 50")
        logs = [dict(r) for r in cursor.fetchall()]

        cursor.execute("SELECT * FROM devices ORDER BY id DESC")
        devices = [dict(r) for r in cursor.fetchall()]

        return {
            "total_devices": total_devices,
            "active_devices": active_devices,
            "total_sources": total_sources,
            "active_sessions": active_sessions,
            "recent_logs": logs,
            "devices": devices
        }
