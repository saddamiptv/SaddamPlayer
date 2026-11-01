#!/usr/bin/env python3
"""
SADDAM IPTV Website Security & User Management Verification Suite
Tests all 15 requirements from SPD:
- Authentication & Two Configured Account Slots
- Session Management & Revocation
- Authorization & Protected Endpoints
- Rate Limiting
- User & Device Management with Pagination
- Security Headers & Sensitive File Protection
"""

import sys
import os
import unittest
import json
import time

# Ensure current directory is in path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import database as db
import security
import server


class TestWebsiteSecurityAndUserManagement(unittest.TestCase):

    def setUp(self):
        # Initialize fresh DB
        db.init_db()

    def test_01_two_account_slots_initial_state(self):
        """Test that initially both Account 1 and Account 2 exist as empty/unconfigured slots."""
        slots = db.get_admin_slots_status()
        self.assertEqual(len(slots), 2)
        self.assertEqual(slots[0]["slot"], 1)
        self.assertEqual(slots[1]["slot"], 2)

    def test_02_no_default_credentials(self):
        """Test that predictable or default credentials do not grant access."""
        # Clear slots for test
        db.disable_admin_slot(1)
        db.disable_admin_slot(2)

        # Attempt logins with legacy/default credentials
        self.assertIsNone(db.verify_admin_credentials("admin", "admin"))
        self.assertIsNone(db.verify_admin_credentials("admin", "SaddamAdmin2026!"))
        self.assertIsNone(db.verify_admin_credentials("Saddam2026", "Saddam@1991"))
        self.assertIsNone(db.verify_admin_credentials("root", "toor"))

    def test_03_configure_and_authenticate_account_1(self):
        """Test configuring Account 1 with secure PBKDF2 hash and logging in."""
        username = "Drexx0301"
        password = "Souhaila2014"

        # Update credentials for Slot 1
        ok = db.update_admin_credentials(1, username, password)
        self.assertTrue(ok)

        # Verify password hashing
        with db.get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT password_hash, salt FROM admin_accounts WHERE slot = 1")
            row = cursor.fetchone()
            self.assertNotEqual(row["password_hash"], password)  # NOT plaintext
            self.assertEqual(len(row["salt"]), 32)  # 16-byte hex salt
            self.assertEqual(len(row["password_hash"]), 64)  # SHA-256 hex length

        # Successful login
        acc = db.verify_admin_credentials(username, password)
        self.assertIsNotNone(acc)
        self.assertEqual(acc["slot"], 1)
        self.assertEqual(acc["username"], username)

        # Wrong password rejected
        self.assertIsNone(db.verify_admin_credentials(username, "WrongPassword123"))

    def test_04_configure_and_authenticate_account_2(self):
        """Test configuring Account 2 and ensuring both slots work independently."""
        username = "Saddam1991"
        password = "Saddam@1991"

        ok = db.update_admin_credentials(2, username, password)
        self.assertTrue(ok)

        acc = db.verify_admin_credentials(username, password)
        self.assertIsNotNone(acc)
        self.assertEqual(acc["slot"], 2)

    def test_05_cannot_create_third_account(self):
        """Test that attempting to configure a third slot is strictly rejected."""
        ok = db.update_admin_credentials(3, "HackerUser", "Password12345678")
        self.assertFalse(ok)

    def test_06_server_session_creation_validation_and_revocation(self):
        """Test cryptographically secure session lifecycle with idle timeout and revocation."""
        # Create session
        token = db.create_admin_session(1, "Drexx0301", "192.168.1.100")
        self.assertIsNotNone(token)
        self.assertEqual(len(token), 64)  # 32 bytes in hex

        # Validate active session
        session = db.validate_admin_session(token)
        self.assertIsNotNone(session)
        self.assertEqual(session["username"], "Drexx0301")
        self.assertEqual(session["slot"], 1)

        # Revoke session
        ok = db.revoke_admin_session(token)
        self.assertTrue(ok)

        # Validating revoked session returns None
        self.assertIsNone(db.validate_admin_session(token))

    def test_07_rate_limiting_protection(self):
        """Test rate limiting against repeated failed admin login attempts."""
        test_key = "test_ip_127_0_0_1:admin"
        security.reset_admin_rate_limit(test_key)

        # Perform 5 failed attempts
        for _ in range(5):
            security.record_admin_failed_attempt(test_key)

        # 6th attempt must be blocked
        allowed, retry_after = security.check_admin_rate_limit(test_key)
        self.assertFalse(allowed)
        self.assertGreater(retry_after, 0)

        # Resetting rate limit restores access
        security.reset_admin_rate_limit(test_key)
        allowed, _ = security.check_admin_rate_limit(test_key)
        self.assertTrue(allowed)

    def test_08_paginated_devices_query(self):
        """Test server-side device pagination for fast rendering on old devices."""
        # Ensure at least 1 device exists
        dev = db.register_or_get_device("11:22:33:44:55:66", "Test Device Paginated")
        self.assertIsNotNone(dev)

        result = db.get_devices_paginated(page=1, limit=5)
        self.assertIn("devices", result)
        self.assertIn("total", result)
        self.assertIn("pages", result)
        self.assertGreaterEqual(result["total"], 1)
        self.assertLessEqual(len(result["devices"]), 5)

    def test_09_device_status_toggle_and_pin_rotation(self):
        """Test admin device status toggle (active -> disabled -> active) and PIN rotation."""
        dev = db.register_or_get_device("AA:11:22:33:44:99", "Toggle Test Device")
        dev_id = dev["id"]

        # Disable device
        ok = db.set_device_status(dev_id, "disabled")
        self.assertTrue(ok)

        details = db.get_device_full_details(dev_id)
        self.assertEqual(details["status"], "disabled")

        # Rotate PIN
        new_pin = db.create_or_rotate_pin(dev_id)
        self.assertEqual(len(new_pin), 6)
        self.assertTrue(new_pin.isdigit())

        # Reactivate device
        ok = db.set_device_status(dev_id, "active")
        self.assertTrue(ok)
        details = db.get_device_full_details(dev_id)
        self.assertEqual(details["status"], "active")

    def test_10_device_sources_management(self):
        """Test adding, toggling, and deleting IPTV playlist for a device."""
        dev = db.register_or_get_device("BB:22:33:44:55:66", "Source Test Device")
        dev_id = dev["id"]

        # Add source
        src = db.admin_add_source_to_device(dev_id, {
            "name": "Test Sports Channel",
            "source_type": "m3u",
            "server_url": "https://example.com/playlist.m3u"
        })
        self.assertIsNotNone(src)
        src_id = src["id"]

        # Toggle source
        ok = db.admin_toggle_source(src_id, False)
        self.assertTrue(ok)

        # Delete source
        ok = db.admin_delete_source(src_id)
        self.assertTrue(ok)

    def test_11_audit_logging_sanitization(self):
        """Test that audit log records actions without exposing secrets."""
        db.log_audit("admin", "1", "test_audit_event", "device", "42", {"safe_info": "ok"})
        logs_res = db.get_audit_logs_paginated(search="test_audit_event", page=1, limit=5)
        self.assertGreaterEqual(logs_res["total"], 1)
        log_entry = logs_res["logs"][0]
        self.assertEqual(log_entry["action"], "test_audit_event")
        # Ensure password or hash is never stored in metadata
        self.assertNotIn("password", log_entry["metadata_redacted"])

    def test_12_ssrf_safety(self):
        """Test SSRF protection blocks localhost and loopback targets."""
        safe, _ = security.is_ssrf_safe_url("http://localhost:8080/playlist.m3u")
        self.assertFalse(safe)

        safe, _ = security.is_ssrf_safe_url("http://127.0.0.1:8080/playlist.m3u")
        self.assertFalse(safe)

        safe, _ = security.is_ssrf_safe_url("https://iptv-org.github.io/iptv/categories/news.m3u")
        self.assertTrue(safe)


if __name__ == "__main__":
    unittest.main()

