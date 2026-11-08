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

# Admin login rate limiting
_ADMIN_RATE_LIMITS = {}
MAX_ADMIN_LOGIN_ATTEMPTS = 5
ADMIN_LOCKOUT_SECONDS = 300  # 5 minutes

# Device login rate limiting (XDGO workflow)
_DEVICE_RATE_LIMITS = {}
MAX_DEVICE_LOGIN_ATTEMPTS = 5
DEVICE_LOCKOUT_SECONDS = 300  # 5 minutes

# Playlist PIN verification rate limiting
_PLAYLIST_PIN_RATE_LIMITS = {}
MAX_PIN_VERIFY_ATTEMPTS = 5
PIN_VERIFY_LOCKOUT_SECONDS = 300  # 5 minutes


def hash_password(password: str, salt: Optional[str] = None) -> Tuple[str, str]:
    """
    Hashes a password using PBKDF2-HMAC-SHA256 with 200,000 iterations.
    Returns (hex_hash, salt_hex).
    """
    if not salt:
        salt = secrets.token_hex(16)
    normalized = str(password).strip()
    pwd_hash = hashlib.pbkdf2_hmac(
        'sha256',
        normalized.encode('utf-8'),
        salt.encode('utf-8'),
        200000
    ).hex()
    return pwd_hash, salt


def verify_password(provided_password: str, stored_hash: str, salt: str) -> bool:
    """Verifies a password against stored PBKDF2 hash using constant-time comparison."""
    if not provided_password or not stored_hash or not salt:
        return False
    candidate_hash, _ = hash_password(provided_password, salt=salt)
    return hmac.compare_digest(candidate_hash, stored_hash)


def check_admin_rate_limit(key: str) -> Tuple[bool, int]:
    """
    Checks if an IP or username has exceeded maximum failed admin login attempts.
    Returns (is_allowed, seconds_remaining).
    """
    now = time.time()
    attempts = _ADMIN_RATE_LIMITS.get(key, [])
    attempts = [t for t in attempts if now - t < ADMIN_LOCKOUT_SECONDS]
    _ADMIN_RATE_LIMITS[key] = attempts

    if len(attempts) >= MAX_ADMIN_LOGIN_ATTEMPTS:
        oldest = attempts[0]
        remaining = int(ADMIN_LOCKOUT_SECONDS - (now - oldest))
        return False, max(remaining, 1)

    return True, 0


def record_admin_failed_attempt(key: str):
    """Records a failed admin login attempt."""
    now = time.time()
    attempts = _ADMIN_RATE_LIMITS.get(key, [])
    attempts.append(now)
    _ADMIN_RATE_LIMITS[key] = attempts


def reset_admin_rate_limit(key: str):
    """Resets failed admin attempts after successful login."""
    if key in _ADMIN_RATE_LIMITS:
        del _ADMIN_RATE_LIMITS[key]


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


def validate_device_key(key: str) -> bool:
    """
    Validates that a Device Key consists of exactly six numeric digits (000000 - 999999).
    Leading zeros must be preserved and key must be a 6-character string.
    """
    if not key or not isinstance(key, str):
        return False
    clean = key.strip()
    return len(clean) == 6 and clean.isdigit()


def validate_playlist_pin(pin: str) -> bool:
    """
    Validates that an optional playlist protection PIN consists of exactly four numeric digits.
    """
    if not pin or not isinstance(pin, str):
        return False
    clean = pin.strip()
    return len(clean) == 4 and clean.isdigit()


def hash_playlist_pin(pin: str) -> str:
    """Hashes a 4-digit playlist PIN with system salt using SHA-256."""
    normalized = str(pin).strip()
    return hashlib.sha256(f"playlist:{normalized}:{SYSTEM_SALT}".encode("utf-8")).hexdigest()


def verify_playlist_pin(provided_pin: str, stored_hash: str) -> bool:
    """Verifies a 4-digit playlist PIN against its stored hash using constant-time comparison."""
    if not provided_pin or not stored_hash:
        return False
    candidate_hash = hash_playlist_pin(provided_pin)
    return hmac.compare_digest(candidate_hash, stored_hash)


def check_device_rate_limit(key: str) -> Tuple[bool, int]:
    """
    Checks if a key (IP or MAC) has exceeded maximum device login attempts.
    Returns (is_allowed, seconds_remaining).
    """
    now = time.time()
    attempts = _DEVICE_RATE_LIMITS.get(key, [])
    attempts = [t for t in attempts if now - t < DEVICE_LOCKOUT_SECONDS]
    _DEVICE_RATE_LIMITS[key] = attempts

    if len(attempts) >= MAX_DEVICE_LOGIN_ATTEMPTS:
        oldest = attempts[0]
        remaining = int(DEVICE_LOCKOUT_SECONDS - (now - oldest))
        return False, max(remaining, 1)

    return True, 0


def record_device_failed_attempt(key: str):
    """Records a failed device login attempt."""
    now = time.time()
    attempts = _DEVICE_RATE_LIMITS.get(key, [])
    attempts.append(now)
    _DEVICE_RATE_LIMITS[key] = attempts


def reset_device_rate_limit(key: str):
    """Clears failed device login attempts on successful authentication."""
    if key in _DEVICE_RATE_LIMITS:
        del _DEVICE_RATE_LIMITS[key]


def check_pin_rate_limit(key: str) -> Tuple[bool, int]:
    """
    Checks if a key has exceeded maximum failed playlist PIN attempts.
    Returns (is_allowed, seconds_remaining).
    """
    now = time.time()
    attempts = _PLAYLIST_PIN_RATE_LIMITS.get(key, [])
    attempts = [t for t in attempts if now - t < PIN_VERIFY_LOCKOUT_SECONDS]
    _PLAYLIST_PIN_RATE_LIMITS[key] = attempts

    if len(attempts) >= MAX_PIN_VERIFY_ATTEMPTS:
        oldest = attempts[0]
        remaining = int(PIN_VERIFY_LOCKOUT_SECONDS - (now - oldest))
        return False, max(remaining, 1)

    return True, 0


def record_pin_failed_attempt(key: str):
    """Records a failed playlist PIN attempt."""
    now = time.time()
    attempts = _PLAYLIST_PIN_RATE_LIMITS.get(key, [])
    attempts.append(now)
    _PLAYLIST_PIN_RATE_LIMITS[key] = attempts


def reset_pin_rate_limit(key: str):
    """Clears failed PIN verification attempts."""
    if key in _PLAYLIST_PIN_RATE_LIMITS:
        del _PLAYLIST_PIN_RATE_LIMITS[key]


import re

def validate_mac_format(mac: str) -> bool:
    """Validates 6-octet hexadecimal MAC address format (colon, hyphen, or continuous)."""
    if not mac:
        return False
    clean = mac.strip()
    return bool(re.match(r"^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$", clean) or re.match(r"^[0-9A-Fa-f]{12}$", clean))


def normalize_mac(mac: str) -> str:
    """Normalizes MAC / Device code to uppercase colon-separated format (00:1A:79:AB:CD:EF)."""
    if not mac:
        return ""
    clean = re.sub(r"[^0-9A-Fa-f]", "", mac.strip()).upper()
    if len(clean) == 12:
        return ":".join(clean[i:i+2] for i in range(0, 12, 2))
    return mac.strip().upper()


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
            return False, "URL must begin with http:// or https://"

        hostname = parsed.hostname
        if not hostname:
            return False, "Invalid server URL hostname"

        # Check for forbidden hostnames
        forbidden_hosts = {"localhost", "127.0.0.1", "0.0.0.0", "::1", "metadata.google.internal"}
        if hostname.lower() in forbidden_hosts:
            return False, "Access to localhost or internal cloud metadata addresses is prohibited (SSRF Protection)"

        # Resolve IP to check if it's in a private or reserved range
        try:
            ip_str = socket.gethostbyname(hostname)
            ip = ipaddress.ip_address(ip_str)
            if ip.is_private or ip.is_loopback or ip.is_reserved or ip.is_link_local:
                return False, "Access to private or local network IP addresses is prohibited (SSRF Protection)"
        except socket.gaierror:
            # If DNS fails at this stage, we can let it fail during actual probe or warn
            pass

        return True, "URL is safe and compliant with security rules"
    except Exception as e:
        return False, f"Error validating URL security: {str(e)}"
