"""Newsletter sign-ups from the box at the bottom of the site.

Each email is saved here first, then passed to the Klaviyo list, which sends the "please confirm" email (double
opt-in, switched on in the list's settings) and the newsletters themselves. Klaviyo's client API needs only the public
Site ID, so no secret is involved. If Klaviyo isn't set up or doesn't answer, the sign-up waits here and is sent with
the admin's "Send to Klaviyo" button.
"""
import logging

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import NewsletterSignup
from app.services.clock import local_now

log = logging.getLogger("lave.newsletter")
KLAVIYO_URL = "https://a.klaviyo.com/client/subscriptions"
KLAVIYO_REVISION = "2024-10-15"


def configured() -> bool:
    s = get_settings()
    return bool(s.klaviyo_public_key and s.klaviyo_list_id)


def subscribe(db: Session, email: str, page: str = "") -> NewsletterSignup:
    """Save the sign-up (once per email) and pass it to Klaviyo if it hasn't been already."""
    email = email.strip().lower()[:255]
    entry = db.scalar(select(NewsletterSignup).where(NewsletterSignup.email == email))
    if not entry:
        entry = NewsletterSignup(email=email, page=page.strip()[:200])
        db.add(entry)
        db.commit()
    if not entry.sent_to_klaviyo_at and configured():
        push(db, entry)
    return entry


def push(db: Session, entry: NewsletterSignup) -> bool:
    """Add one sign-up to the Klaviyo list. Records the outcome on the entry; never raises."""
    s = get_settings()
    body = {"data": {
        "type": "subscription",
        "attributes": {
            "custom_source": "lavelondon.com sign-up box",
            "profile": {"data": {"type": "profile", "attributes": {
                "email": entry.email, "properties": {"Signed up on": entry.page or "/"}}}},
        },
        "relationships": {"list": {"data": {"type": "list", "id": s.klaviyo_list_id}}},
    }}
    try:
        r = httpx.post(KLAVIYO_URL, params={"company_id": s.klaviyo_public_key}, json=body, timeout=10,
                       headers={"revision": KLAVIYO_REVISION, "accept": "application/vnd.api+json"})
        if r.status_code >= 300:
            try:
                detail = "; ".join(e.get("detail", "") for e in r.json().get("errors", [])) or r.text[:200]
            except Exception:  # not JSON: use the plain reply
                detail = r.text[:200]
            raise RuntimeError(f"Klaviyo said ({r.status_code}): {detail}")
    except (httpx.HTTPError, RuntimeError) as exc:
        log.warning("Newsletter sign-up %s not sent to Klaviyo: %s", entry.id, exc)
        entry.klaviyo_error = str(exc)[:300]
        db.commit()
        return False
    entry.sent_to_klaviyo_at, entry.klaviyo_error = local_now(), ""
    db.commit()
    return True


def push_waiting(db: Session) -> tuple[int, int]:
    """Send every sign-up Klaviyo doesn't have yet. Returns (sent, still waiting)."""
    waiting = db.scalars(select(NewsletterSignup).where(NewsletterSignup.sent_to_klaviyo_at.is_(None))).all()
    sent = sum(push(db, e) for e in waiting) if configured() else 0
    return sent, len(waiting) - sent
