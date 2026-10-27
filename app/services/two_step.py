"""Two-step sign-in for LAVE OS staff: a six-digit code from an authenticator app (Google Authenticator, 1Password,
Microsoft Authenticator…) after the password. Standard TOTP (RFC 6238): 30-second codes, SHA-1, six digits.

Each person turns it on from Settings → Two-step sign-in, and gets ten single-use recovery codes for a lost phone.
An admin can require it for everyone (staff without it are then asked to set it up when they next sign in), and can
reset it for someone who has lost their phone.
"""
import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote

from sqlalchemy.orm import Session

from app.models import SiteSetting, StaffUser
from app.services.clock import local_now

STEP, DIGITS, ISSUER = 30, 6, "LAVE OS"
REQUIRED_KEY = "staff.two_step_required"


def new_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def code_at(secret: str, step: int) -> str:
    key = base64.b32decode(secret + "=" * (-len(secret) % 8), casefold=True)
    digest = hmac.new(key, struct.pack(">Q", step), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    number = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(number % 10 ** DIGITS).zfill(DIGITS)


def _hash(code: str) -> str:
    return hashlib.sha256(code.replace("-", "").replace(" ", "").lower().encode()).hexdigest()


def check(staff: StaffUser, code: str, secret: str | None = None, now: float | None = None) -> bool:
    """A current app code (allowing for a clock 30 seconds out either way, each code used once) or, once two-step is
    on, an unused recovery code."""
    code = (code or "").replace(" ", "").replace("-", "")
    secret = secret or staff.totp_secret
    if not secret or not code:
        return False
    if code.isdigit() and len(code) == DIGITS:
        step = int((now or time.time()) // STEP)
        for s in (step - 1, step, step + 1):
            if s > (staff.totp_last_step or 0) and hmac.compare_digest(code_at(secret, s), code):
                staff.totp_last_step = s
                return True
        return False
    hashes = list(staff.recovery_codes or [])
    if staff.totp_enabled_at and _hash(code) in hashes:
        hashes.remove(_hash(code))
        staff.recovery_codes = hashes
        return True
    return False


def start(staff: StaffUser) -> dict:
    """Begin setting up: a fresh secret (not active until confirmed with a code) and its QR code."""
    import segno
    staff.totp_secret, staff.totp_enabled_at, staff.totp_last_step = new_secret(), None, 0
    uri = f"otpauth://totp/{quote(ISSUER)}:{quote(staff.email)}?secret={staff.totp_secret}&issuer={quote(ISSUER)}"
    return {"secret": " ".join(staff.totp_secret[i:i + 4] for i in range(0, len(staff.totp_secret), 4)), "uri": uri,
            "qr_svg": segno.make(uri, error="m").svg_inline(scale=5, border=2)}


def enable(staff: StaffUser, code: str) -> list[str]:
    """Confirm setup with a code from the app. Returns ten recovery codes, shown once."""
    from fastapi import HTTPException
    if not staff.totp_secret or not check(staff, code):
        raise HTTPException(400, "That code didn't match. Check the time on your phone is set automatically, and try the newest code.")
    codes = [f"{secrets.token_hex(2)}-{secrets.token_hex(2)}" for _ in range(10)]
    staff.recovery_codes = [_hash(c) for c in codes]
    staff.totp_enabled_at = local_now()
    return codes


def turn_off(staff: StaffUser) -> None:
    staff.totp_secret, staff.totp_enabled_at, staff.totp_last_step, staff.recovery_codes = None, None, 0, []


def required(db: Session) -> bool:
    row = db.get(SiteSetting, REQUIRED_KEY)
    return bool(row and row.value == "1")


def set_required(db: Session, on: bool) -> None:
    row = db.get(SiteSetting, REQUIRED_KEY) or SiteSetting(key=REQUIRED_KEY)
    row.value = "1" if on else "0"
    db.add(row)
