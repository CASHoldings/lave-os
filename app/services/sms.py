"""Text messages through Twilio. Used for "your driver is on the way"; without Twilio set up, callers email instead."""
import logging
import re
from collections import deque

import httpx

from app.config import get_settings

log = logging.getLogger("lave.sms")
OUTBOX: deque[dict] = deque(maxlen=20)  # recent texts, for tests and the developer preview


class SmsError(Exception):
    pass


def configured() -> bool:
    s = get_settings()
    return bool(s.twilio_account_sid and s.twilio_auth_token and s.twilio_from)


def uk_mobile(phone: str) -> str | None:
    """'07700 900123' or '+44 7700 900123' → '+447700900123'. None if it isn't a UK mobile number."""
    digits = re.sub(r"[^\d+]", "", (phone or "").replace("(0)", ""))
    if digits.startswith("00"):
        digits = "+" + digits[2:]
    if digits.startswith("07") and len(digits) == 11:
        digits = "+44" + digits[1:]
    return digits if re.fullmatch(r"\+447\d{9}", digits) else None


def send(phone: str, body: str) -> bool:
    """Send a text. Returns True if Twilio accepted it; never raises."""
    to = uk_mobile(phone)
    if not to or not configured():
        return False
    s = get_settings()
    sender = {"MessagingServiceSid": s.twilio_from} if s.twilio_from.startswith("MG") else {"From": s.twilio_from}
    OUTBOX.appendleft({"to": to, "body": body})
    try:
        r = httpx.post(f"https://api.twilio.com/2010-04-01/Accounts/{s.twilio_account_sid}/Messages.json",
                       data={"To": to, "Body": body, **sender}, auth=(s.twilio_account_sid, s.twilio_auth_token), timeout=15)
        if r.status_code >= 300:
            raise SmsError(f"{r.status_code} {r.text[:200]}")
    except (httpx.HTTPError, SmsError):
        log.exception("Text to %s failed", to)
        return False
    return True
