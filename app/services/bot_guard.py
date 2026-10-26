"""Keeping bots out of the sign-up and sign-in-link forms.

Bots fill in random names and other people's email addresses, so every fake sign-up sends a confirmation email to a
stranger, which hurts LAVE's email reputation. Four checks, invisible to real people:
- a hidden field people never see (bots fill it in);
- a signed time stamp: a form sent within 3 seconds of loading, or long after, isn't a person typing;
- names that look like random letters ("dIHnGBWZoCBMfZYaizE");
- optionally Cloudflare Turnstile (LAVE_TURNSTILE_SITE_KEY and LAVE_TURNSTILE_SECRET), usually invisible.
A caught attempt gets the normal "check your email" page, but nothing is created and nothing is sent.
"""
import hashlib
import hmac
import logging
import re
import time

import httpx

from app.config import get_settings

log = logging.getLogger("lave.bots")
MIN_SECONDS, MAX_SECONDS = 3, 2 * 60 * 60
TURNSTILE_VERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


def _sign(stamp: str) -> str:
    return hmac.new(get_settings().secret_key.encode(), f"form:{stamp}".encode(), hashlib.sha256).hexdigest()[:24]


def form_token() -> str:
    """Put in the form when it's shown: when it was shown, signed so it can't be forged."""
    stamp = str(int(time.time()))
    return f"{stamp}.{_sign(stamp)}"


def _token_ok(token: str) -> bool:
    stamp, _, sig = (token or "").partition(".")
    if not stamp.isdigit() or not hmac.compare_digest(sig, _sign(stamp)):
        return False
    age = time.time() - int(stamp)
    return MIN_SECONDS <= age <= MAX_SECONDS


def gibberish(name: str) -> bool:
    """One long run of letters with capitals scattered through it, as bots make up. Real names (McDonald,
    DeLaCruz, Ana-María, Nguyen) pass."""
    for word in re.findall(r"[A-Za-z]+", name or ""):
        upper_inside = sum(1 for ch in word[1:] if ch.isupper())
        if len(word) >= 12 and upper_inside >= 3 and not word.isupper():
            return True
    return False


def turnstile_on() -> bool:
    s = get_settings()
    return bool(s.turnstile_site_key and s.turnstile_secret)


def _turnstile_ok(response: str, ip: str) -> bool:
    if not turnstile_on():
        return True
    if not response:
        return False
    try:
        r = httpx.post(TURNSTILE_VERIFY, data={"secret": get_settings().turnstile_secret, "response": response,
                                               "remoteip": ip}, timeout=10)
        return bool(r.json().get("success"))
    except (httpx.HTTPError, ValueError):
        log.warning("Turnstile couldn't be reached; letting the form through")
        return True  # never lock real customers out because Cloudflare is down


def caught(*, honeypot: str, token: str, names: tuple[str, ...] = (), turnstile: str = "", ip: str = "") -> str | None:
    """Why this looks like a bot, or None if it looks like a person."""
    if honeypot:
        reason = "hidden field filled in"
    elif not _token_ok(token):
        reason = "sent too fast, or an old or missing form"
    elif any(gibberish(n) for n in names):
        reason = "name looks like random letters"
    elif not _turnstile_ok(turnstile, ip):
        reason = "failed the Cloudflare check"
    else:
        return None
    log.info("Bot sign-up stopped (%s) from %s", reason, ip)
    return reason
