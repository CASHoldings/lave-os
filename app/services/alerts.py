"""Tell the founder when something goes wrong: website errors (a page or API call that failed with a 500), and
background jobs that fail (reminders, photo backups). By email to LAVE_ALERT_EMAIL (or the contact address), at most
one email per kind of problem every 30 minutes so a bad night doesn't fill the inbox. The admin's System tab lists
the most recent problems.

Whether the website is up at all needs a watcher outside it: see LAUNCH.md, "Uptime".
"""
import logging
import time
from collections import deque

from app.config import get_settings
from app.services.clock import local_now

log = logging.getLogger("lave.alerts")
QUIET = 30 * 60
RECENT: deque[dict] = deque(maxlen=30)
_last_sent: dict[str, float] = {}


def report(kind: str, detail: str) -> bool:
    """Record a problem and email it, unless the same kind was emailed in the last 30 minutes. Returns whether an
    email was sent off. Never raises."""
    RECENT.appendleft({"at": local_now().isoformat(timespec="seconds"), "kind": kind, "detail": detail[:2000]})
    s = get_settings()
    if s.env == "test" and not s.alert_email:
        return False
    now = time.monotonic()
    if now - _last_sent.get(kind, -QUIET) < QUIET:
        return False
    _last_sent[kind] = now
    try:
        from app.services import mailer
        mailer.send(s.alert_email or s.contact_address, f"LAVE OS alert: {kind}",
                           f"{kind}\n\n{detail[:6000]}\n\nTime: {local_now():%A %d %B %Y, %H:%M}\n"
                           f"Admin: {s.site_url}/admin#/settings?tab=system\n\n"
                    "You'll get at most one email about this every 30 minutes.", raise_errors=True)
        return True
    except Exception:  # noqa: BLE001
        log.exception("Couldn't send an alert email")
        return False


def reset() -> None:
    RECENT.clear()
    _last_sent.clear()
