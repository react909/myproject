from __future__ import annotations

import hashlib
import hmac
import re
import secrets
import sys
import uuid

# Crockford Base32: excludes ambiguous I/L/O/U so a typed-in key can't be
# misread. Uppercase-only, matches how the app normalizes user input.
ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
KEY_PREFIX = "KASSIR"
PAYLOAD_LEN = 8
CHECKSUM_LEN = 4

_CLEAN_RE = re.compile(r"[^0-9A-Z]")


def _checksum(payload: str, secret: str) -> str:
    digest = hmac.new(secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).digest()
    value = int.from_bytes(digest[:3], "big") >> 4  # top 20 bits -> 4 base32 chars
    return "".join(ALPHABET[(value >> (5 * (3 - i))) & 0x1F] for i in range(CHECKSUM_LEN))


def format_key(payload: str, checksum: str) -> str:
    return f"{KEY_PREFIX}-{payload[0:4]}-{payload[4:8]}-{checksum}"


def generate_key(secret: str) -> str:
    """Vendor-side only — never called from an API route. Uniqueness comes
    from the random payload space (32**8 ≈ 1.1e12 combinations), not a
    server-side registry, so this stays fully offline end-to-end."""
    payload = "".join(secrets.choice(ALPHABET) for _ in range(PAYLOAD_LEN))
    return format_key(payload, _checksum(payload, secret))


def parse_key(raw: str) -> tuple[str, str] | None:
    """Normalize free-typed input into (payload, checksum), or None if the
    shape is wrong. Does not verify the checksum."""
    cleaned = _CLEAN_RE.sub("", raw.strip().upper())
    if not cleaned.startswith(KEY_PREFIX):
        return None
    body = cleaned[len(KEY_PREFIX) :]
    if len(body) != PAYLOAD_LEN + CHECKSUM_LEN or any(c not in ALPHABET for c in body):
        return None
    return body[:PAYLOAD_LEN], body[PAYLOAD_LEN:]


def canonical_key(raw: str) -> str | None:
    parsed = parse_key(raw)
    return None if parsed is None else format_key(*parsed)


def verify_key(raw: str, secret: str) -> bool:
    """Fully offline: recompute the checksum and compare — no network, no
    lookup table. This stops a copied install's data from just booting on a
    second PC (paired with hardware_matches() below); it does NOT stop the
    same key string being typed into two separate fresh installs, since
    there is no server-side registry of already-used keys. That tradeoff is
    inherent to offline verification."""
    parsed = parse_key(raw)
    if parsed is None:
        return False
    payload, checksum = parsed
    return secrets.compare_digest(_checksum(payload, secret), checksum)


def current_hardware_id() -> str:
    """Raw (unhashed) machine identifier. Windows: MachineGuid from the
    registry — no admin rights required, always present, survives normal
    use. Non-Windows is a dev-only fallback; the packaged app is
    Windows-only."""
    if sys.platform == "win32":
        try:
            import winreg

            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Cryptography") as key:
                value, _ = winreg.QueryValueEx(key, "MachineGuid")
                return str(value)
        except OSError:
            pass
    return f"mac:{uuid.getnode():012x}"


def hash_hardware_id(raw: str | None = None) -> str:
    raw = current_hardware_id() if raw is None else raw
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def hardware_matches(stored_hash: str) -> bool:
    """True if unset (installs activated before this feature shipped are
    not retroactively locked out) or if it matches this machine's current
    fingerprint."""
    return not stored_hash or hash_hardware_id() == stored_hash
