#!/usr/bin/env python3
"""
SADDAM IPTV - Administrator Account Configuration Utility
Used by the site owner to configure or update Account 1 and Account 2.
Strict compliance with SADDAM_IPTV_Website_Security_and_User_Management_SPD:
- Exactly two account slots permitted (Slot 1 and Slot 2).
- Strong PBKDF2-HMAC-SHA256 password hashing with unique random salt.
- No plain passwords or hashes committed to source control or sent to browser.
"""

import sys
import os
import argparse
import getpass
import json

# Ensure current directory is in path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import database as db
import security


def main():
    parser = argparse.ArgumentParser(description="Configure SADDAM IPTV Administrator Accounts (Slot 1 or Slot 2)")
    parser.add_argument("--slot", type=int, choices=[1, 2], help="Account slot to configure (1 or 2)")
    parser.add_argument("--username", type=str, help="Username for the chosen administrator account")
    parser.add_argument("--password", type=str, help="Password for the chosen administrator account")
    parser.add_argument("--status", action="store_true", help="Display current status of account slots (without secrets)")
    parser.add_argument("--disable", type=int, choices=[1, 2], help="Disable / reset chosen account slot")

    args = parser.parse_args()

    # Initialize database
    db.init_db()

    if args.status:
        slots = db.get_admin_slots_status()
        print("\n================ SADDAM IPTV Admin Slots Status ================")
        for s in slots:
            status_text = "CONFIGURED (Active)" if s["is_configured"] else "EMPTY (Disabled / Unconfigured)"
            username_display = s["username"] if s["is_configured"] else "[None]"
            print(f" Slot {s['slot']}: {status_text} | Username: {username_display}")
        print("===============================================================\n")
        return

    if args.disable:
        slot = args.disable
        ok = db.disable_admin_slot(slot)
        if ok:
            print(f"[+] Account Slot {slot} has been disabled and cleared.")
        else:
            print(f"[-] Failed to disable Account Slot {slot}.")
        return

    slot = args.slot
    if not slot:
        print("Choose which administrator account slot to configure:")
        print(" [1] Account Slot 1")
        print(" [2] Account Slot 2")
        choice = input("Enter choice (1 or 2): ").strip()
        if choice not in ("1", "2"):
            print("Invalid slot choice.")
            sys.exit(1)
        slot = int(choice)

    username = args.username
    if not username:
        username = input(f"Enter username for Account Slot {slot}: ").strip()
        if not username:
            print("Username cannot be empty.")
            sys.exit(1)

    password = args.password
    if not password:
        password = getpass.getpass(f"Enter password for Account Slot {slot} (min 8 chars): ").strip()
        confirm = getpass.getpass("Confirm password: ").strip()
        if password != confirm:
            print("[-] Passwords do not match.")
            sys.exit(1)

    if len(password) < 8:
        print("[-] Password must be at least 8 characters long.")
        sys.exit(1)

    success = db.update_admin_credentials(slot, username, password)
    if success:
        print(f"\n[+] Successfully configured Administrator Account Slot {slot} ('{username}')!")
        print("[+] Password hashed securely with PBKDF2-HMAC-SHA256 (200,000 iterations).")
        print("[+] Existing sessions for this slot have been invalidated.")
    else:
        print(f"\n[-] Failed to configure Administrator Account Slot {slot}.")
        sys.exit(1)


if __name__ == "__main__":
    main()

