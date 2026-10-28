"""
SADDAM IPTV - Security & Cryptographic Utilities
Strict compliance with SDP v1.1:
- Secure PIN & Token hashing
- SSRF Prevention for IPTV source testing
- Rate-limiting protection against PIN brute-force
- Masking sensitive device and credentials data
"""

import hashlib
import hmac
import secrets
import socket
import ipaddress
import urllib.parse
import time
from typing import Tuple, Optional

# Secret salt for hashing PINs and device codes
SYSTEM_SALT = "SADDAM_IPTV_SALT_2026_SECURE_KEY"

# Rate limiting storage: { key: [timestamps] }
_RATE_LIMITS = {}
MAX_PIN_ATTEMPTS = 5
PIN_LOCKOUT_SECONDS = 300  # 5 minutes


def hash_pin(pin: str) -> str:
    """Hashes a 6-digit PIN with system salt using SHA-256."""
    normalized_pin = str(pin).strip()
    return hashlib.sha256(f"{normalized_pin}:{SYSTEM_SALT}".encode("utf-8")).hexdigest()


def verify_pin(provided_pin: str, stored_hash: str) -> bool:
    """Verifies a 6-digit PIN against its stored hash securely."""
    candidate_hash = hash_pin(provided_pin)
    return hmac.compare_digest(candidate_hash, stored_hash)


def hash_token(token: str) -> str:
    """Hashes session tokens before storing in database."""
    return hashlib.sha256(f"{token}:{SYSTEM_SALT}".encode("utf-8")).hexdigest()


def generate_session_token() -> str:
    """Generates a cryptographically strong session token."""
    return secrets.token_hex(32)


def generate_device_pin() -> str:
    """Generates a secure 6-digit numeric PIN preserving leading zeros."""
    num = secrets.randbelow(1_000_000)
    return f"{num:06d}"


def normalize_mac(mac: str) -> str:
    """Normalizes MAC / Device code by stripping spaces, uppercasing."""
    if not mac:
        return ""
    clean = mac.strip().upper()
    return clean


def mask_mac(mac: str) -> str:
    """Masks a MAC / Device code for safe display: AA:••:••:••:22:33."""
    clean = normalize_mac(mac)
    parts = clean.replace("-", ":").split(":")
    if len(parts) >= 6:
        return f"{parts[0]}:••:••:••:{parts[-2]}:{parts[-1]}"
    if len(clean) > 6:
        return f"{clean[:3]}••••{clean[-3:]}"
    return clean


def check_rate_limit(key: str) -> Tuple[bool, int]:
    """
    Checks if a key (e.g. IP + MAC) has exceeded maximum attempts.
    Returns (is_allowed, seconds_remaining).
    """
    now = time.time()
    attempts = _RATE_LIMITS.get(key, [])
    # Keep only attempts in recent window
    attempts = [t for t in attempts if now - t < PIN_LOCKOUT_SECONDS]
    _RATE_LIMITS[key] = attempts

    if len(attempts) >= MAX_PIN_ATTEMPTS:
        oldest = attempts[0]
        remaining = int(PIN_LOCKOUT_SECONDS - (now - oldest))
        return False, max(remaining, 1)

    return True, 0


def record_failed_attempt(key: str):
    """Records a failed attempt for rate limiting."""
    now = time.time()
    attempts = _RATE_LIMITS.get(key, [])
    attempts.append(now)
    _RATE_LIMITS[key] = attempts


def reset_rate_limit(key: str):
    """Clears failed attempts on successful verification."""
    if key in _RATE_LIMITS:
        del _RATE_LIMITS[key]


def is_ssrf_safe_url(url_string: str) -> Tuple[bool, str]:
    """
    Validates that a URL does not target localhost, private networks, or metadata services.
    Enforces HTTP/HTTPS protocol.
    """
    try:
        parsed = urllib.parse.urlparse(url_string)
        if parsed.scheme.lower() not in ("http", "https"):
            return False, "يجب أن يبدأ الرابط بـ http أو https"

        hostname = parsed.hostname
        if not hostname:
            return False, "عنوان الخادم غير صالح"

        # Check for forbidden hostnames
        forbidden_hosts = {"localhost", "127.0.0.1", "0.0.0.0", "::1", "metadata.google.internal"}
        if hostname.lower() in forbidden_hosts:
            return False, "لا يمكن الاتصال بالعناوين المحلية أو المحمية (SSRF Protection)"

        # Resolve IP to check if it's in a private or reserved range
        try:
            ip_str = socket.gethostbyname(hostname)
            ip = ipaddress.ip_address(ip_str)
            if ip.is_private or ip.is_loopback or ip.is_reserved or ip.is_link_local:
                return False, "لا يمكن الاتصال بعناوين الشبكات الخاصة أو المحلية"
        except socket.gaierror:
            # If DNS fails at this stage, we can let it fail during actual probe or warn
            pass

        return True, "الرابط آمن ومطابق للمواصفات"
    except Exception as e:
        return False, f"خطأ في التحقق من أمان الرابط: {str(e)}"
