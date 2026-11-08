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
import urllib.parse
from typing import Optional, Dict, Any, List, Tuple
from security import (
    hash_pin, verify_pin, hash_token, normalize_mac, generate_session_token,
    hash_password, verify_password
)

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
                token TEXT,
                expires_at INTEGER NOT NULL,
                revoked_at INTEGER,
                last_used_at INTEGER,
                created_at INTEGER,
                FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
            )
        """)
        try:
            cursor.execute("ALTER TABLE device_sessions ADD COLUMN token TEXT")
        except Exception:
            pass

        # 4. IPTV Sources Table (Playlists belong to account, device_id is nullable, no cascade delete)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS iptv_sources (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id INTEGER,
                account_slot INTEGER DEFAULT 1,
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
                expires_at TEXT,
                created_at INTEGER,
                updated_at INTEGER
            )
        """)
        try:
            cursor.execute("ALTER TABLE iptv_sources ADD COLUMN expires_at TEXT")
        except Exception:
            pass
        try:
            cursor.execute("ALTER TABLE iptv_sources ADD COLUMN account_slot INTEGER DEFAULT 1")
        except Exception:
            pass
        try:
            # Verify if existing table has device_id NOT NULL and migrate if necessary
            cursor.execute("PRAGMA table_info(iptv_sources)")
            cols = cursor.fetchall()
            dev_col = next((c for c in cols if c[1] == 'device_id'), None)
            if dev_col and dev_col[3] == 1:
                cursor.execute("PRAGMA foreign_keys=OFF")
                cursor.execute("""
                    CREATE TABLE iptv_sources_mig (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        device_id INTEGER,
                        account_slot INTEGER DEFAULT 1,
                        name TEXT NOT NULL,
                        source_type TEXT NOT NULL,
                        server_url TEXT NOT NULL,
                        username TEXT,
                        password_encrypted TEXT,
                        description TEXT,
                        status TEXT DEFAULT 'untested',
                        enabled INTEGER DEFAULT 1,
                        last_tested_at INTEGER,
                        last_error_code TEXT,
                        expires_at TEXT,
                        created_at INTEGER,
                        updated_at INTEGER
                    )
                """)
                cursor.execute("""
                    INSERT INTO iptv_sources_mig SELECT id, device_id, account_slot, name, source_type, server_url, username, password_encrypted, description, status, enabled, last_tested_at, last_error_code, expires_at, created_at, updated_at FROM iptv_sources
                """)
                cursor.execute("DROP TABLE iptv_sources")
                cursor.execute("ALTER TABLE iptv_sources_mig RENAME TO iptv_sources")
                cursor.execute("PRAGMA foreign_keys=ON")
                conn.commit()
        except Exception:
            pass
        try:
            cursor.execute("ALTER TABLE devices ADD COLUMN account_slot INTEGER DEFAULT 1")
        except Exception:
            pass
        try:
            cursor.execute("UPDATE iptv_sources SET account_slot = 1 WHERE account_slot IS NULL")
            cursor.execute("UPDATE devices SET account_slot = 1 WHERE account_slot IS NULL")
        except Exception:
            pass

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

        # 6. Admin Accounts Table (Strictly Slot 1 and Slot 2 only)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS admin_accounts (
                slot INTEGER PRIMARY KEY CHECK (slot IN (1, 2)),
                username TEXT,
                password_hash TEXT,
                salt TEXT,
                is_configured INTEGER DEFAULT 0,
                updated_at INTEGER
            )
        """)

        # Ensure Slots 1 and 2 exist (unconfigured placeholders)
        now_ts = int(time.time())
        cursor.execute("SELECT slot FROM admin_accounts WHERE slot = 1")
        if not cursor.fetchone():
            cursor.execute("INSERT INTO admin_accounts (slot, username, password_hash, salt, is_configured, updated_at) VALUES (1, '', '', '', 0, ?)", (now_ts,))

        cursor.execute("SELECT slot FROM admin_accounts WHERE slot = 2")
        if not cursor.fetchone():
            cursor.execute("INSERT INTO admin_accounts (slot, username, password_hash, salt, is_configured, updated_at) VALUES (2, '', '', '', 0, ?)", (now_ts,))

        # 7. Admin Sessions Table (Server-managed sessions with idle timeout)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS admin_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_slot INTEGER NOT NULL,
                username TEXT NOT NULL,
                token_hash TEXT UNIQUE NOT NULL,
                ip_address TEXT,
                created_at INTEGER NOT NULL,
                last_active_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL,
                revoked_at INTEGER,
                FOREIGN KEY (account_slot) REFERENCES admin_accounts(slot)
            )
        """)

        # Clean up any legacy admin_users table with hardcoded credentials
        try:
            cursor.execute("DROP TABLE IF EXISTS admin_users")
        except Exception:
            pass

        # Playlists belong to the user's account, not to a specific device.
        # NEVER delete unexpired or orphaned sources on startup or device operations.
        try:
            cursor.execute("UPDATE iptv_sources SET account_slot = 1 WHERE account_slot IS NULL")
        except Exception:
            pass

        conn.commit()

    # Synchronize admin account configuration from environment or admin_config.json
    sync_admin_config()

    # Seed demo device if needed
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


def sync_admin_config():
    """
    Syncs admin accounts from environment variables or admin_config.json.
    Does NOT invent credentials. If not set, slots remain empty/unconfigured.
    """
    config_file = os.path.join(os.path.dirname(__file__), "admin_config.json")
    file_cfg = {}
    if os.path.isfile(config_file):
        try:
            with open(config_file, "r", encoding="utf-8") as f:
                file_cfg = json.load(f)
        except Exception as e:
            print(f"[Config Error] Failed to read admin_config.json: {e}")

    now_ts = int(time.time())
    with get_db() as conn:
        cursor = conn.cursor()

        # Slot 1
        env_u1 = os.environ.get("ADMIN_ACCOUNT_1_USERNAME", "").strip()
        env_p1 = os.environ.get("ADMIN_ACCOUNT_1_PASSWORD", "").strip()
        env_h1 = os.environ.get("ADMIN_ACCOUNT_1_PASSWORD_HASH", "").strip()

        file_a1 = file_cfg.get("account_1", {})
        file_u1 = file_a1.get("username", "").strip()
        file_h1 = file_a1.get("password_hash", "").strip()
        file_s1 = file_a1.get("salt", "").strip()
        file_conf1 = file_a1.get("is_configured", False)

        if env_u1 and (env_p1 or env_h1):
            if env_p1:
                h1, s1 = hash_password(env_p1)
            else:
                h1, s1 = env_h1, "env_salt"
            cursor.execute("""
                UPDATE admin_accounts SET username = ?, password_hash = ?, salt = ?, is_configured = 1, updated_at = ?
                WHERE slot = 1
            """, (env_u1, h1, s1, now_ts))
        elif file_conf1 and file_u1 and file_h1 and file_s1:
            cursor.execute("""
                UPDATE admin_accounts SET username = ?, password_hash = ?, salt = ?, is_configured = 1, updated_at = ?
                WHERE slot = 1
            """, (file_u1, file_h1, file_s1, now_ts))

        # Slot 2
        env_u2 = os.environ.get("ADMIN_ACCOUNT_2_USERNAME", "").strip()
        env_p2 = os.environ.get("ADMIN_ACCOUNT_2_PASSWORD", "").strip()
        env_h2 = os.environ.get("ADMIN_ACCOUNT_2_PASSWORD_HASH", "").strip()

        file_a2 = file_cfg.get("account_2", {})
        file_u2 = file_a2.get("username", "").strip()
        file_h2 = file_a2.get("password_hash", "").strip()
        file_s2 = file_a2.get("salt", "").strip()
        file_conf2 = file_a2.get("is_configured", False)

        if env_u2 and (env_p2 or env_h2):
            if env_p2:
                h2, s2 = hash_password(env_p2)
            else:
                h2, s2 = env_h2, "env_salt"
            cursor.execute("""
                UPDATE admin_accounts SET username = ?, password_hash = ?, salt = ?, is_configured = 1, updated_at = ?
                WHERE slot = 2
            """, (env_u2, h2, s2, now_ts))
        elif file_conf2 and file_u2 and file_h2 and file_s2:
            cursor.execute("""
                UPDATE admin_accounts SET username = ?, password_hash = ?, salt = ?, is_configured = 1, updated_at = ?
                WHERE slot = 2
            """, (file_u2, file_h2, file_s2, now_ts))

        conn.commit()


def seed_initial_data():
    """Seeds a ready-to-test device if table is completely empty (no admin users seeded)."""
    now = int(time.time())
    with get_db() as conn:
        cursor = conn.cursor()

        # Sample Device: MAC AA:BB:CC:11:22:33, PIN 123456
        demo_mac = "AA:BB:CC:11:22:33"
        cursor.execute("SELECT id FROM devices WHERE device_code = ?", (demo_mac,))
        device = cursor.fetchone()

        if not device:
            cursor.execute("""
                INSERT INTO devices (device_code, device_code_hash, device_label, platform, app_version, status, sync_version, last_seen_at, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (demo_mac, hash_token(demo_mac), "Living Room TV - Android TV 4K", "Android TV (v11)", "2.4.0", "active", 1, now, now, now))
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
            """, (device_id, "Sports & News Live Channels (M3U)", "m3u",
                  "https://iptv-org.github.io/iptv/categories/news.m3u", "", "",
                  "Free global news and sports streaming playlist (M3U)", "working", 1, now, now, now))

            cursor.execute("""
                INSERT INTO iptv_sources (device_id, name, source_type, server_url, username, password_encrypted, description, status, enabled, last_tested_at, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (device_id, "SADDAM Xtream Demo API", "xtream",
                  "http://xtream.saddamiptv.stream:8080", "saddam_vip", "********",
                  "Channels and series via Xtream Codes protocol", "working", 1, now, now, now))

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


def create_or_rotate_pin(device_id: int, expiry_minutes: int = 52560000) -> str:
    """Creates a permanent 6-digit PIN for device pairing unique to this device."""
    from security import generate_device_pin
    pin = generate_device_pin()
    return set_device_pin(device_id, pin, expiry_minutes)


def set_device_pin(device_id: int, pin: str, expiry_minutes: int = 52560000) -> str:
    """Sets the permanent pairing PIN for a device (never expires) and revokes previous keys."""
    pin_str = str(pin).strip()
    pin_h = hash_pin(pin_str)
    now = int(time.time())
    expires_at = now + (expiry_minutes * 60)

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM device_pairing_codes WHERE device_id = ?", (device_id,))
        cursor.execute("""
            INSERT INTO device_pairing_codes (device_id, pin_hash, expires_at, attempt_count, consumed_at, created_at)
            VALUES (?, ?, ?, 0, NULL, ?)
        """, (device_id, pin_h, expires_at, now))
        conn.commit()

    return pin_str


def pair_device_from_web(mac: str, label: str = "Player Device", account_slot: int = 1, pin: Optional[str] = None) -> Tuple[Dict[str, Any], str]:
    """
    Registers or pairs a device from the website, generates a unique 6-digit numeric Device KEY,
    stores its hash, links to account_slot, and returns (device_dict, raw_6_digit_key).
    Crucial: Never alters or deletes any playlists in the account.
    """
    clean_mac = normalize_mac(mac)
    now = int(time.time())
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM devices WHERE device_code = ?", (clean_mac,))
        row = cursor.fetchone()

        if row:
            dev_id = row['id']
            cursor.execute("""
                UPDATE devices 
                SET device_label = ?, status = 'active', account_slot = ?, updated_at = ?
                WHERE id = ?
            """, (label.strip() if label else row['device_label'], account_slot, now, dev_id))
        else:
            cursor.execute("""
                INSERT INTO devices (device_code, device_code_hash, device_label, platform, app_version, status, sync_version, account_slot, last_seen_at, created_at, updated_at)
                VALUES (?, ?, ?, 'Player', '1.0.0', 'active', 1, ?, ?, ?, ?)
            """, (clean_mac, hash_token(clean_mac), label.strip() or 'Player Device', account_slot, now, now, now))
            dev_id = cursor.lastrowid
        conn.commit()

    from security import generate_device_pin
    raw_key = str(pin).strip() if pin and len(str(pin).strip()) == 6 and str(pin).strip().isdigit() else generate_device_pin()
    set_device_pin(dev_id, raw_key)
    create_device_session(dev_id)

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM devices WHERE id = ?", (dev_id,))
        dev_row = dict(cursor.fetchone())

    log_audit("admin", str(account_slot), "device_paired", "device", str(dev_id), {"mac": clean_mac, "label": label})
    return dev_row, raw_key


def verify_device_credentials(mac: str, pin: str) -> Optional[Dict[str, Any]]:
    """
    Verifies MAC and PIN against database.
    - Checks device status
    - Checks permanent device pairing PIN
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

        # Look for valid pairing code for this device (order by latest first)
        cursor.execute("""
            SELECT * FROM device_pairing_codes
            WHERE device_id = ?
            ORDER BY id DESC
        """, (device_dict['id'],))
        codes = cursor.fetchall()

        if not codes:
            return None

        # Check PIN against all assigned codes for this device
        for code_row in codes:
            stored_hash = code_row['pin_hash']
            if verify_pin(pin, stored_hash):
                # Update last seen timestamp without overriding blocked/disabled status
                cursor.execute("UPDATE devices SET last_seen_at = ?, updated_at = ? WHERE id = ?", (now, now, device_dict['id']))
                conn.commit()
                return device_dict

        # If no code matched, increment attempt counter
        cursor.execute("UPDATE device_pairing_codes SET attempt_count = attempt_count + 1 WHERE id = ?", (codes[0]['id'],))
        conn.commit()
        return None


def create_device_session(device_id: int, lifetime_hours: int = 87600) -> str:
    """Creates a permanent high-entropy device session (valid for 10 years)."""
    raw_token = generate_session_token()
    tok_hash = hash_token(raw_token)
    now = int(time.time())
    expires_at = now + (lifetime_hours * 3600)

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO device_sessions (device_id, token_hash, token, expires_at, revoked_at, last_used_at, created_at)
            VALUES (?, ?, ?, ?, NULL, ?, ?)
        """, (device_id, tok_hash, raw_token, expires_at, now, now))
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


revoke_device_sessions = revoke_all_device_sessions


def unlink_device(device_id: int):
    """Unlinks a device, revoking all sessions and updating status."""
    now = int(time.time())
    revoke_all_device_sessions(device_id)
    with get_db() as conn:
        conn.execute("UPDATE devices SET status = 'unlinked', updated_at = ? WHERE id = ?", (now, device_id))
        conn.commit()
    log_audit("device_session", str(device_id), "device_unlinked", "device", str(device_id))


def link_device_to_account(device_id: int, account_slot: int) -> bool:
    """Links a device to an admin/user account slot without affecting any playlists."""
    now = int(time.time())
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE devices 
            SET account_slot = ?, status = 'active', updated_at = ? 
            WHERE id = ?
        """, (account_slot, now, device_id))
        conn.commit()
    log_audit("admin", str(account_slot), "device_linked_to_account", "device", str(device_id), {"account_slot": account_slot})
    return True


def get_account_devices(account_slot: int) -> List[Dict[str, Any]]:
    """Retrieves all active devices linked to this account slot."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM devices
            WHERE account_slot = ? AND status != 'deleted'
            ORDER BY last_seen_at DESC, id DESC
        """, (account_slot,))
        return [dict(r) for r in cursor.fetchall()]


# IPTV Sources Management

def get_account_sources(account_slot: int, only_enabled: bool = False, mask_password: bool = True) -> List[Dict[str, Any]]:
    """
    Retrieves all IPTV sources belonging to this account.
    Core business rule: A playlist belongs to the user's account, not to a specific device.
    Device pairing must never delete or replace playlists.
    A playlist remains available until its own expiration date.
    """
    now = int(time.time())
    with get_db() as conn:
        cursor = conn.cursor()
        query = """
            SELECT s.*
            FROM iptv_sources s
            WHERE (s.account_slot = ? OR s.device_id IN (SELECT id FROM devices WHERE account_slot = ?))
        """
        if only_enabled:
            query += " AND s.enabled = 1"
        query += " ORDER BY s.id DESC"

        cursor.execute(query, (account_slot, account_slot))
        rows = cursor.fetchall()
        result = []
        seen_ids = set()
        for r in rows:
            if r['id'] in seen_ids:
                continue
            seen_ids.add(r['id'])
            d = dict(r)
            d['is_enabled'] = d.get('enabled', 1)

            # Check expiration lifecycle
            status = d.get('status', 'untested')
            is_expired = False
            if status in ('expired', 'STATUS_EXPIRED') or (d.get('last_error_code') and 'EXPIRED' in str(d.get('last_error_code')).upper()):
                is_expired = True
                status = 'expired'
            elif d.get('expires_at'):
                try:
                    exp_val = str(d['expires_at']).strip()
                    if exp_val.isdigit():
                        exp_ts = int(exp_val)
                        if exp_ts < 10000000000:
                            exp_ts *= 1000
                        if (now * 1000) > exp_ts:
                            is_expired = True
                            status = 'expired'
                except Exception:
                    pass
            d['is_expired'] = is_expired
            d['status'] = status

            # Mask password for web frontend, but preserve for Android client
            raw_pwd = d.get('password_encrypted') or ""
            d['has_password'] = bool(raw_pwd)
            if mask_password:
                if raw_pwd:
                    d['password_encrypted'] = "••••••••"
            else:
                d['password'] = raw_pwd
                d['password_encrypted'] = raw_pwd
            result.append(d)
        return result


def get_device_sources(device_id: int, only_enabled: bool = False, mask_password: bool = True) -> List[Dict[str, Any]]:
    """
    Retrieves all IPTV sources directly linked to this device_id.
    Ensures strict device-level playlist isolation for Android TV clients.
    """
    with get_db() as conn:
        cursor = conn.cursor()
        if only_enabled:
            cursor.execute("SELECT * FROM iptv_sources WHERE device_id = ? AND enabled = 1 ORDER BY id DESC", (device_id,))
        else:
            cursor.execute("SELECT * FROM iptv_sources WHERE device_id = ? ORDER BY id DESC", (device_id,))
        rows = cursor.fetchall()
        result = []
        now = int(time.time())
        for r in rows:
            d = dict(r)
            d['is_enabled'] = d.get('enabled', 1)
            status = d.get('status', 'untested')
            is_expired = False
            if status in ('expired', 'STATUS_EXPIRED') or (d.get('last_error_code') and 'EXPIRED' in str(d.get('last_error_code')).upper()):
                is_expired = True
                status = 'expired'
            elif d.get('expires_at'):
                try:
                    exp_val = str(d['expires_at']).strip()
                    if exp_val.isdigit():
                        exp_ts = int(exp_val)
                        if exp_ts < 10000000000:
                            exp_ts *= 1000
                        if (now * 1000) > exp_ts:
                            is_expired = True
                            status = 'expired'
                except Exception:
                    pass
            d['is_expired'] = is_expired
            d['status'] = status

            raw_pwd = d.get('password_encrypted') or ""
            d['has_password'] = bool(raw_pwd)
            if mask_password:
                if raw_pwd:
                    d['password_encrypted'] = "••••••••"
            else:
                d['password'] = raw_pwd
                d['password_encrypted'] = raw_pwd
            result.append(d)
        return result


def add_iptv_source(device_id: Optional[int], data: dict, account_slot: Optional[int] = None) -> Dict[str, Any]:
    """
    Adds a new IPTV source (M3U / Xtream) and increments sync_version.
    Uses independent records and does NOT overwrite or delete existing playlists.
    """
    now = int(time.time())
    name = data.get("name", "").strip()
    source_type = data.get("source_type", "m3u").lower()
    server_url = data.get("server_url", "").strip()
    username = data.get("username", "").strip()
    password = (data.get("password") or data.get("password_encrypted") or "").strip()
    description = data.get("description", "").strip()
    enabled = 1 if data.get("enabled", True) else 0

    # Auto-extract and normalize credentials and server URL
    try:
        parsed = urllib.parse.urlparse(server_url)
        qs = urllib.parse.parse_qs(parsed.query)
        if not username and "username" in qs:
            username = qs["username"][0].strip()
        if not password and "password" in qs:
            password = qs["password"][0].strip()

        # If Xtream source, clean base URL (strip /player_api.php, /get.php, query params, trailing slashes)
        if source_type == "xtream" and parsed.scheme and parsed.netloc:
            server_url = f"{parsed.scheme}://{parsed.netloc}"
    except Exception:
        pass

    expires_at = data.get("expires_at")

    # Resolve account_slot
    resolved_slot = account_slot
    if not resolved_slot and device_id:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT account_slot FROM devices WHERE id = ?", (device_id,))
            r = cursor.fetchone()
            if r and 'account_slot' in r.keys() and r['account_slot']:
                resolved_slot = r['account_slot']
    if not resolved_slot:
        resolved_slot = 1

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO iptv_sources (device_id, account_slot, name, source_type, server_url, username, password_encrypted, description, status, enabled, last_tested_at, expires_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'untested', ?, NULL, ?, ?, ?)
        """, (device_id, resolved_slot, name, source_type, server_url, username, password, description, enabled, expires_at, now, now))
        source_id = cursor.lastrowid

        # Bump sync_version on device and account
        if device_id:
            cursor.execute("UPDATE devices SET sync_version = sync_version + 1, updated_at = ? WHERE id = ?", (now, device_id))
        cursor.execute("UPDATE devices SET sync_version = sync_version + 1, updated_at = ? WHERE account_slot = ?", (now, resolved_slot))
        conn.commit()

        cursor.execute("SELECT * FROM iptv_sources WHERE id = ?", (source_id,))
        res = dict(cursor.fetchone())
        log_audit("account", str(resolved_slot), "source_added", "source", str(source_id), {"name": name, "type": source_type})
        return res


def update_iptv_source(source_id: int, device_id: Optional[int], data: dict, account_slot: Optional[int] = None) -> Optional[Dict[str, Any]]:
    """Updates an existing IPTV source owned by device_id or account_slot."""
    now = int(time.time())
    name = data.get("name", "").strip()
    server_url = data.get("server_url", "").strip()
    username = data.get("username", "").strip()
    new_password = data.get("password") or data.get("password_encrypted") or ""
    description = data.get("description", "").strip()
    enabled = 1 if data.get("enabled", True) else 0
    expires_at = data.get("expires_at")

    with get_db() as conn:
        cursor = conn.cursor()
        if account_slot:
            cursor.execute("SELECT * FROM iptv_sources WHERE id = ? AND (account_slot = ? OR device_id = ?)", (source_id, account_slot, device_id))
        elif device_id:
            cursor.execute("SELECT * FROM iptv_sources WHERE id = ? AND device_id = ?", (source_id, device_id))
        else:
            cursor.execute("SELECT * FROM iptv_sources WHERE id = ?", (source_id,))

        existing = cursor.fetchone()
        if not existing:
            return None

        # Auto-extract credentials if present in server_url
        try:
            parsed = urllib.parse.urlparse(server_url)
            qs = urllib.parse.parse_qs(parsed.query)
            if not username and "username" in qs:
                username = qs["username"][0].strip()
            if (not new_password or new_password == "••••••••") and "password" in qs:
                new_password = qs["password"][0].strip()
            if existing["source_type"] == "xtream" and parsed.scheme and parsed.netloc:
                server_url = f"{parsed.scheme}://{parsed.netloc}"
        except Exception:
            pass

        if new_password and new_password.strip() and new_password != "••••••••":
            pwd_to_store = new_password.strip()
        else:
            pwd_to_store = existing['password_encrypted']

        exp_to_store = expires_at if expires_at is not None else existing.get('expires_at')

        cursor.execute("""
            UPDATE iptv_sources
            SET name = ?, server_url = ?, username = ?, password_encrypted = ?, description = ?, enabled = ?, expires_at = ?, updated_at = ?
            WHERE id = ?
        """, (name, server_url, username, pwd_to_store, description, enabled, exp_to_store, now, source_id))

        if existing['device_id']:
            cursor.execute("UPDATE devices SET sync_version = sync_version + 1, updated_at = ? WHERE id = ?", (now, existing['device_id']))
        if existing['account_slot']:
            cursor.execute("UPDATE devices SET sync_version = sync_version + 1, updated_at = ? WHERE account_slot = ?", (now, existing['account_slot']))
        conn.commit()

        cursor.execute("SELECT * FROM iptv_sources WHERE id = ?", (source_id,))
        res = dict(cursor.fetchone())
        log_audit("source", str(source_id), "source_updated", "source", str(source_id), {"name": name})
        return res


def delete_iptv_source(source_id: int, device_id: Optional[int] = None, account_slot: Optional[int] = None) -> bool:
    """Deletes an IPTV source owned by device_id or account_slot and updates sync_version."""
    now = int(time.time())
    with get_db() as conn:
        cursor = conn.cursor()
        if account_slot:
            cursor.execute("SELECT name, device_id, account_slot FROM iptv_sources WHERE id = ? AND (account_slot = ? OR device_id = ?)", (source_id, account_slot, device_id))
        elif device_id:
            cursor.execute("SELECT name, device_id, account_slot FROM iptv_sources WHERE id = ? AND device_id = ?", (source_id, device_id))
        else:
            cursor.execute("SELECT name, device_id, account_slot FROM iptv_sources WHERE id = ?", (source_id,))

        row = cursor.fetchone()
        if not row:
            return False

        cursor.execute("DELETE FROM iptv_sources WHERE id = ?", (source_id,))
        if row['device_id']:
            cursor.execute("UPDATE devices SET sync_version = sync_version + 1, updated_at = ? WHERE id = ?", (now, row['device_id']))
        if row['account_slot']:
            cursor.execute("UPDATE devices SET sync_version = sync_version + 1, updated_at = ? WHERE account_slot = ?", (now, row['account_slot']))
        conn.commit()

        log_audit("source", str(source_id), "source_deleted", "source", str(source_id), {"name": row['name']})
        return True


def toggle_iptv_source(source_id: int, device_id: Optional[int] = None, account_slot: Optional[int] = None, enabled: bool = True) -> bool:
    """Toggles source enabled state for the device or account."""
    now = int(time.time())
    with get_db() as conn:
        cursor = conn.cursor()
        val = 1 if enabled else 0
        if account_slot:
            cursor.execute("UPDATE iptv_sources SET enabled = ?, updated_at = ? WHERE id = ? AND (account_slot = ? OR device_id = ?)", (val, now, source_id, account_slot, device_id))
        elif device_id:
            cursor.execute("UPDATE iptv_sources SET enabled = ?, updated_at = ? WHERE id = ? AND device_id = ?", (val, now, source_id, device_id))
        else:
            cursor.execute("UPDATE iptv_sources SET enabled = ?, updated_at = ? WHERE id = ?", (val, now, source_id))

        if cursor.rowcount > 0:
            cursor.execute("SELECT device_id, account_slot FROM iptv_sources WHERE id = ?", (source_id,))
            row = cursor.fetchone()
            if row:
                if row['device_id']:
                    cursor.execute("UPDATE devices SET sync_version = sync_version + 1, updated_at = ? WHERE id = ?", (now, row['device_id']))
                if row['account_slot']:
                    cursor.execute("UPDATE devices SET sync_version = sync_version + 1, updated_at = ? WHERE account_slot = ?", (now, row['account_slot']))
            conn.commit()
            log_audit("source", str(source_id), "source_toggled", "source", str(source_id), {"enabled": val})
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

        cursor.execute("SELECT COUNT(*) as total FROM devices WHERE status IN ('disabled', 'suspended', 'blocked')")
        disabled_devices = cursor.fetchone()['total']

        cursor.execute("SELECT COUNT(*) as total FROM iptv_sources")
        total_sources = cursor.fetchone()['total']

        cursor.execute("SELECT COUNT(*) as total FROM device_sessions WHERE revoked_at IS NULL AND expires_at > ?", (int(time.time()),))
        active_sessions = cursor.fetchone()['total']

        cursor.execute("SELECT * FROM audit_logs ORDER BY id DESC LIMIT 100")
        logs = [dict(r) for r in cursor.fetchall()]

        cursor.execute("""
            SELECT d.*,
                   (SELECT COUNT(*) FROM iptv_sources WHERE device_id = d.id) as sources_count
            FROM devices d
            ORDER BY d.id DESC
        """)
        devices = [dict(r) for r in cursor.fetchall()]

        return {
            "total_devices": total_devices,
            "active_devices": active_devices,
            "disabled_devices": disabled_devices,
            "total_sources": total_sources,
            "active_sessions": active_sessions,
            "recent_logs": logs,
            "devices": devices
        }


def set_device_status(device_id: int, status: str) -> bool:
    """Updates device status ('active', 'disabled', 'suspended'). Revokes sessions if disabled."""
    now = int(time.time())
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, device_code, status FROM devices WHERE id = ?", (device_id,))
        dev = cursor.fetchone()
        if not dev:
            return False

        if status in ("disabled", "suspended", "blocked", "unlinked"):
            cursor.execute("""
                UPDATE device_sessions 
                SET revoked_at = ? 
                WHERE device_id = ? AND revoked_at IS NULL
            """, (now, device_id))

        cursor.execute("""
            UPDATE devices 
            SET status = ?, sync_version = sync_version + 1, updated_at = ? 
            WHERE id = ?
        """, (status, now, device_id))
        conn.commit()

    log_audit("admin", "1", f"device_status_{status}", "device", str(device_id), {
        "mac": dev["device_code"],
        "new_status": status
    })
    return True


def delete_device(device_id: int) -> bool:
    """
    Deletes a device and disassociates its sessions and pairing codes.
    Crucial: Unlinks playlists from this device (sets device_id = NULL),
    but NEVER deletes the user's account playlists.
    """
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT device_code FROM devices WHERE id = ?", (device_id,))
        dev = cursor.fetchone()
        if not dev:
            return False
        mac = dev["device_code"]

        cursor.execute("UPDATE iptv_sources SET device_id = NULL WHERE device_id = ?", (device_id,))
        cursor.execute("DELETE FROM device_sessions WHERE device_id = ?", (device_id,))
        cursor.execute("DELETE FROM device_pairing_codes WHERE device_id = ?", (device_id,))
        cursor.execute("DELETE FROM devices WHERE id = ?", (device_id,))
        conn.commit()

    log_audit("admin", "1", "device_deleted", "device", str(device_id), {"mac": mac})
    return True


def update_device_label(device_id: int, label: str) -> bool:
    """Updates the device friendly label."""
    now = int(time.time())
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("UPDATE devices SET device_label = ?, updated_at = ? WHERE id = ?", (label.strip(), now, device_id))
        conn.commit()
    return True


def clear_all_audit_logs() -> bool:
    """Clears all entries from the audit_logs table."""
    with get_db() as conn:
        conn.execute("DELETE FROM audit_logs")
        try:
            conn.execute("DELETE FROM sqlite_sequence WHERE name = 'audit_logs'")
        except Exception:
            pass
        conn.commit()
    log_audit("admin", "1", "audit_logs_cleared", "audit_logs", "", {"note": "Audit log completely cleared by administrator"})
    return True


def delete_audit_log(log_id: int) -> bool:
    """Deletes a single audit log entry by ID."""
    with get_db() as conn:
        conn.execute("DELETE FROM audit_logs WHERE id = ?", (log_id,))
        conn.commit()
    return True


# =========================================================================
# Enhanced Administrator Authentication & Two-Slot Management (SPD Sec 4-7)
# =========================================================================

def get_admin_slots_status() -> List[Dict[str, Any]]:
    """Returns safe status of both admin account slots (no hashes/passwords)."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT slot, username, is_configured, updated_at FROM admin_accounts ORDER BY slot ASC")
        rows = cursor.fetchall()
        return [
            {
                "slot": r["slot"],
                "is_configured": bool(r["is_configured"]),
                "username": r["username"] if r["is_configured"] else "",
                "updated_at": r["updated_at"]
            }
            for r in rows
        ]


def is_any_admin_configured() -> bool:
    """Checks if at least one admin account slot is configured."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) as cnt FROM admin_accounts WHERE is_configured = 1")
        return cursor.fetchone()["cnt"] > 0


def verify_admin_credentials(username: str, password: str) -> Optional[Dict[str, Any]]:
    """
    Verifies admin credentials against configured slots using PBKDF2.
    Returns account dict (slot, username) or None.
    """
    clean_user = (username or "").strip()
    clean_pass = (password or "").strip()
    if not clean_user or not clean_pass:
        return None

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT slot, username, password_hash, salt, is_configured
            FROM admin_accounts
            WHERE is_configured = 1 AND username = ?
        """, (clean_user,))
        row = cursor.fetchone()
        if not row:
            # Timing mitigation dummy verification
            verify_password("dummy", "00" * 32, "00" * 16)
            return None

        if verify_password(clean_pass, row["password_hash"], row["salt"]):
            return {
                "slot": row["slot"],
                "username": row["username"]
            }
        return None


def create_admin_session(slot: int, username: str, ip_address: str = "") -> str:
    """Creates a secure server-managed session for an administrator."""
    token = generate_session_token()
    token_h = hash_token(token)
    now = int(time.time())
    expires_at = now + 43200  # 12 hours absolute lifetime

    with get_db() as conn:
        conn.execute("""
            INSERT INTO admin_sessions (account_slot, username, token_hash, ip_address, created_at, last_active_at, expires_at, revoked_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
        """, (slot, username, token_h, ip_address, now, now, expires_at))
        conn.commit()

    log_audit("admin", str(slot), "admin_login_success", "admin_account", str(slot), {"ip": ip_address})
    return token


def validate_admin_session(token: str) -> Optional[Dict[str, Any]]:
    """
    Validates an admin session token. Checks revocation, absolute expiry, and idle timeout (1 hour).
    Updates last_active_at on success.
    """
    if not token:
        return None
    token_h = hash_token(token)
    now = int(time.time())

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT s.*, a.is_configured
            FROM admin_sessions s
            JOIN admin_accounts a ON s.account_slot = a.slot
            WHERE s.token_hash = ? AND s.revoked_at IS NULL AND a.is_configured = 1
        """, (token_h,))
        session = cursor.fetchone()
        if not session:
            return None

        # Check absolute lifetime
        if session["expires_at"] <= now:
            cursor.execute("UPDATE admin_sessions SET revoked_at = ? WHERE id = ?", (now, session["id"]))
            conn.commit()
            return None

        # Check idle timeout (1 hour = 3600 seconds)
        if (now - session["last_active_at"]) > 3600:
            cursor.execute("UPDATE admin_sessions SET revoked_at = ? WHERE id = ?", (now, session["id"]))
            conn.commit()
            log_audit("admin", str(session["account_slot"]), "admin_session_idle_timeout", "admin_session", str(session["id"]))
            return None

        # Update activity
        cursor.execute("UPDATE admin_sessions SET last_active_at = ? WHERE id = ?", (now, session["id"]))
        conn.commit()

        return {
            "session_id": session["id"],
            "slot": session["account_slot"],
            "username": session["username"],
            "ip_address": session["ip_address"],
            "created_at": session["created_at"],
            "last_active_at": now,
            "expires_at": session["expires_at"]
        }


def revoke_admin_session(token: str) -> bool:
    """Invalidates an admin session."""
    if not token:
        return False
    token_h = hash_token(token)
    now = int(time.time())
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, account_slot FROM admin_sessions WHERE token_hash = ? AND revoked_at IS NULL", (token_h,))
        sess = cursor.fetchone()
        if sess:
            cursor.execute("UPDATE admin_sessions SET revoked_at = ? WHERE id = ?", (now, sess["id"]))
            conn.commit()
            log_audit("admin", str(sess["account_slot"]), "admin_logout", "admin_session", str(sess["id"]))
            return True
    return False


def revoke_all_sessions_for_slot(slot: int) -> bool:
    """Revokes all active sessions for an administrator slot (e.g. after password change)."""
    now = int(time.time())
    with get_db() as conn:
        conn.execute("UPDATE admin_sessions SET revoked_at = ? WHERE account_slot = ? AND revoked_at IS NULL", (now, slot))
        conn.commit()
    return True


def update_admin_credentials(slot: int, new_username: str, new_password: str) -> bool:
    """
    Updates credentials for an admin slot (Slot 1 or 2).
    Generates PBKDF2 hash with unique salt, writes to DB and admin_config.json,
    and invalidates existing sessions.
    """
    if slot not in (1, 2):
        return False
    clean_user = (new_username or "").strip()
    clean_pass = (new_password or "").strip()
    if not clean_user or not clean_pass or len(clean_pass) < 8:
        return False

    now_ts = int(time.time())
    pwd_hash, salt = hash_password(clean_pass)

    with get_db() as conn:
        conn.execute("""
            UPDATE admin_accounts
            SET username = ?, password_hash = ?, salt = ?, is_configured = 1, updated_at = ?
            WHERE slot = ?
        """, (clean_user, pwd_hash, salt, now_ts, slot))
        conn.commit()

    # Revoke sessions for this slot
    revoke_all_sessions_for_slot(slot)

    # Update admin_config.json
    config_file = os.path.join(os.path.dirname(__file__), "admin_config.json")
    try:
        cfg = {}
        if os.path.isfile(config_file):
            with open(config_file, "r", encoding="utf-8") as f:
                cfg = json.load(f)
        slot_key = f"account_{slot}"
        cfg[slot_key] = {
            "slot": slot,
            "username": clean_user,
            "password_hash": pwd_hash,
            "salt": salt,
            "is_configured": True,
            "updated_at": now_ts
        }
        with open(config_file, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"[Config Write Warning] Failed to update admin_config.json: {e}")

    log_audit("admin", str(slot), "admin_credentials_updated", "admin_account", str(slot))
    return True


def disable_admin_slot(slot: int) -> bool:
    """Disables / resets an admin account slot."""
    if slot not in (1, 2):
        return False
    now_ts = int(time.time())
    with get_db() as conn:
        conn.execute("""
            UPDATE admin_accounts
            SET username = '', password_hash = '', salt = '', is_configured = 0, updated_at = ?
            WHERE slot = ?
        """, (now_ts, slot))
        conn.commit()

    revoke_all_sessions_for_slot(slot)

    config_file = os.path.join(os.path.dirname(__file__), "admin_config.json")
    try:
        if os.path.isfile(config_file):
            with open(config_file, "r", encoding="utf-8") as f:
                cfg = json.load(f)
            slot_key = f"account_{slot}"
            if slot_key in cfg:
                cfg[slot_key]["is_configured"] = False
                cfg[slot_key]["username"] = ""
                cfg[slot_key]["password_hash"] = ""
                cfg[slot_key]["salt"] = ""
            with open(config_file, "w", encoding="utf-8") as f:
                json.dump(cfg, f, indent=2, ensure_ascii=False)
    except Exception:
        pass

    log_audit("admin", str(slot), "admin_slot_disabled", "admin_account", str(slot))
    return True


# =========================================================================
# Enhanced Paginated User/Device Management (SPD Sec 7) - Fast for Old Devices
# =========================================================================

def get_devices_paginated(search: str = "", status_filter: str = "", page: int = 1, limit: int = 10, sort_by: str = "newest") -> Dict[str, Any]:
    """
    Retrieves devices with server-side pagination, search, and filtering.
    Optimized for fast rendering on old devices.
    """
    page = max(1, int(page or 1))
    limit = max(1, min(100, int(limit or 10)))
    offset = (page - 1) * limit

    conditions = []
    params = []

    if search:
        search_term = f"%{search.strip()}%"
        conditions.append("(device_code LIKE ? OR device_label LIKE ? OR platform LIKE ?)")
        params.extend([search_term, search_term, search_term])

    if status_filter:
        clean_status = status_filter.strip().lower()
        if clean_status == "active":
            conditions.append("status = 'active'")
        elif clean_status in ("disabled", "suspended", "blocked"):
            conditions.append("status IN ('disabled', 'suspended', 'blocked')")

    where_clause = ""
    if conditions:
        where_clause = "WHERE " + " AND ".join(conditions)

    order_clause = "ORDER BY d.id DESC"
    if sort_by == "oldest":
        order_clause = "ORDER BY d.id ASC"
    elif sort_by == "name":
        order_clause = "ORDER BY d.device_label ASC"
    elif sort_by == "last_seen":
        order_clause = "ORDER BY d.last_seen_at DESC"

    with get_db() as conn:
        cursor = conn.cursor()

        # Count total
        count_query = f"SELECT COUNT(*) as total FROM devices {where_clause}"
        cursor.execute(count_query, params)
        total = cursor.fetchone()["total"]

        # Fetch paginated items
        data_query = f"""
            SELECT d.*,
                   (SELECT COUNT(*) FROM iptv_sources WHERE device_id = d.id) as sources_count,
                   (SELECT expires_at FROM device_pairing_codes WHERE device_id = d.id AND consumed_at IS NULL ORDER BY id DESC LIMIT 1) as pin_expires_at
            FROM devices d
            {where_clause}
            {order_clause}
            LIMIT ? OFFSET ?
        """
        cursor.execute(data_query, params + [limit, offset])
        devices = [dict(r) for r in cursor.fetchall()]

        pages = max(1, (total + limit - 1) // limit)

        return {
            "devices": devices,
            "total": total,
            "page": page,
            "pages": pages,
            "limit": limit
        }


def get_device_full_details(device_id: int) -> Optional[Dict[str, Any]]:
    """Returns full details of a device including active PIN and all its IPTV sources."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM devices WHERE id = ?", (device_id,))
        dev = cursor.fetchone()
        if not dev:
            return None

        dev_dict = dict(dev)

        # Get active PIN if available
        cursor.execute("""
            SELECT id, expires_at FROM device_pairing_codes
            WHERE device_id = ? AND consumed_at IS NULL
            ORDER BY id DESC LIMIT 1
        """, (device_id,))
        pin_row = cursor.fetchone()
        dev_dict["has_pin"] = pin_row is not None

        # Get sources
        cursor.execute("SELECT * FROM iptv_sources WHERE device_id = ? ORDER BY id DESC", (device_id,))
        sources = [dict(r) for r in cursor.fetchall()]

        # Mask passwords for display
        for s in sources:
            if s.get("password_encrypted"):
                s["has_password"] = True
                s["password_display"] = "••••••••"
            else:
                s["has_password"] = False
                s["password_display"] = ""

        dev_dict["sources"] = sources
        dev_dict["sources_count"] = len(sources)

        return dev_dict


def admin_add_source_to_device(device_id: int, source_data: dict) -> Optional[Dict[str, Any]]:
    """Allows administrator to add a playlist/source directly to any device."""
    return add_iptv_source(device_id, source_data)


def admin_toggle_source(source_id: int, enabled: bool) -> bool:
    """Toggles source enabled state from admin panel."""
    now = int(time.time())
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, device_id, name FROM iptv_sources WHERE id = ?", (source_id,))
        src = cursor.fetchone()
        if not src:
            return False

        cursor.execute("""
            UPDATE iptv_sources SET enabled = ?, updated_at = ? WHERE id = ?
        """, (1 if enabled else 0, now, source_id))

        cursor.execute("UPDATE devices SET sync_version = sync_version + 1, updated_at = ? WHERE id = ?", (now, src["device_id"]))
        conn.commit()

        log_audit("admin", "1", "admin_source_toggled", "iptv_source", str(source_id), {"enabled": enabled, "name": src["name"]})
        return True


def admin_delete_source(source_id: int) -> bool:
    """Deletes an IPTV source from admin panel."""
    now = int(time.time())
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, device_id, name FROM iptv_sources WHERE id = ?", (source_id,))
        src = cursor.fetchone()
        if not src:
            return False

        cursor.execute("DELETE FROM iptv_sources WHERE id = ?", (source_id,))
        cursor.execute("UPDATE devices SET sync_version = sync_version + 1, updated_at = ? WHERE id = ?", (now, src["device_id"]))
        conn.commit()

        log_audit("admin", "1", "admin_source_deleted", "iptv_source", str(source_id), {"name": src["name"]})
        return True


def admin_update_source(source_id: int, source_data: dict) -> Optional[Dict[str, Any]]:
    """Allows administrator to update an IPTV source."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT device_id FROM iptv_sources WHERE id = ?", (source_id,))
        row = cursor.fetchone()
        if not row:
            return None
        device_id = row["device_id"]
    return update_iptv_source(source_id, device_id, source_data)


def get_audit_logs_paginated(search: str = "", page: int = 1, limit: int = 15) -> Dict[str, Any]:
    """Retrieves paginated audit logs."""
    page = max(1, int(page or 1))
    limit = max(1, min(100, int(limit or 15)))
    offset = (page - 1) * limit

    conditions = []
    params = []

    if search:
        st = f"%{search.strip()}%"
        conditions.append("(actor_type LIKE ? OR action LIKE ? OR target_type LIKE ? OR target_id LIKE ? OR metadata_redacted LIKE ?)")
        params.extend([st, st, st, st, st])

    where_clause = ""
    if conditions:
        where_clause = "WHERE " + " AND ".join(conditions)

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(f"SELECT COUNT(*) as total FROM audit_logs {where_clause}", params)
        total = cursor.fetchone()["total"]

        cursor.execute(f"""
            SELECT * FROM audit_logs
            {where_clause}
            ORDER BY id DESC
            LIMIT ? OFFSET ?
        """, params + [limit, offset])
        logs = [dict(r) for r in cursor.fetchall()]

        pages = max(1, (total + limit - 1) // limit)
        return {
            "logs": logs,
            "total": total,
            "page": page,
            "pages": pages,
            "limit": limit
        }


def get_all_sources_paginated(search: str = "", source_type: str = "", status: str = "", page: int = 1, limit: int = 15) -> Dict[str, Any]:
    """Retrieves all IPTV sources across devices with pagination, search, and filtering."""
    page = max(1, int(page or 1))
    limit = max(1, min(100, int(limit or 15)))
    offset = (page - 1) * limit

    conditions = []
    params = []

    if search:
        st = f"%{search.strip()}%"
        conditions.append("(s.name LIKE ? OR s.server_url LIKE ? OR d.device_code LIKE ? OR d.device_label LIKE ?)")
        params.extend([st, st, st, st])

    if source_type and source_type.lower() != "all":
        conditions.append("s.source_type = ?")
        params.append(source_type.lower())

    if status and status.lower() != "all":
        st_low = status.lower()
        if st_low == "enabled":
            conditions.append("s.enabled = 1")
        elif st_low == "disabled":
            conditions.append("s.enabled = 0")
        else:
            conditions.append("s.status = ?")
            params.append(st_low)

    where_clause = ""
    if conditions:
        where_clause = "WHERE " + " AND ".join(conditions)

    with get_db() as conn:
        cursor = conn.cursor()
        count_sql = f"""
            SELECT COUNT(*) as total
            FROM iptv_sources s
            LEFT JOIN devices d ON s.device_id = d.id
            {where_clause}
        """
        cursor.execute(count_sql, params)
        total = cursor.fetchone()["total"]

        data_sql = f"""
            SELECT s.*, d.device_code as device_mac, d.device_label, d.status as device_status
            FROM iptv_sources s
            LEFT JOIN devices d ON s.device_id = d.id
            {where_clause}
            ORDER BY s.id DESC
            LIMIT ? OFFSET ?
        """
        cursor.execute(data_sql, params + [limit, offset])
        sources = []
        for r in cursor.fetchall():
            d = dict(r)
            if d.get("password_encrypted"):
                d["password_encrypted"] = "••••••••"
            sources.append(d)

        pages = max(1, (total + limit - 1) // limit)
        return {
            "sources": sources,
            "total": total,
            "page": page,
            "pages": pages,
            "limit": limit
        }


def admin_sync_device(device_id: int) -> Optional[Dict[str, Any]]:
    """Increments device sync_version and updates timestamp."""
    now = int(time.time())
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, device_code, sync_version FROM devices WHERE id = ?", (device_id,))
        dev = cursor.fetchone()
        if not dev:
            return None
        new_version = (dev["sync_version"] or 1) + 1
        cursor.execute("""
            UPDATE devices SET sync_version = ?, updated_at = ? WHERE id = ?
        """, (new_version, now, device_id))
        conn.commit()
        return {
            "device_id": device_id,
            "device_code": dev["device_code"],
            "sync_version": new_version,
            "synced_at": now
        }


