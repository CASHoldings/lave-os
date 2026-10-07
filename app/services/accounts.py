"""Client sign-in on the LAVE website: passwords, emailed links, and simple rate limits."""
import hashlib
import re
import secrets
import time
from urllib.parse import quote
from collections import defaultdict, deque
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import hash_password, verify_password
from app.config import get_settings
from app.models import Client, LoginToken
from app.services import mailer
from app.services.clock import local_now

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
LINK_MINUTES = {"signin": 30, "verify": 24 * 60, "reset": 30}
MIN_PASSWORD = 10

# A dummy hash so a missing account takes as long to check as a wrong password.
_DUMMY_HASH = hash_password("timing-equaliser-not-a-password")


class AccountError(Exception):
    pass


def normalise_email(email: str) -> str:
    return email.strip().lower()


def valid_email(email: str) -> bool:
    return bool(EMAIL_RE.match(email)) and len(email) <= 255


# Rate limiting (in-process; enough for a single server before launch).
_hits: dict[str, deque] = defaultdict(deque)


def allow(key: str, limit: int, window_seconds: int) -> bool:
    now = time.monotonic()
    q = _hits[key]
    while q and now - q[0] > window_seconds:
        q.popleft()
    if len(q) >= limit:
        return False
    q.append(now)
    return True


def reset_limits() -> None:
    _hits.clear()


def safe_next(target: str | None, default: str = "/account/") -> str:
    """Only allow redirects to paths on this site."""
    if target and target.startswith("/") and not target.startswith("//") and "\\" not in target:
        return target
    return default


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def issue_link(db: Session, client: Client, purpose: str, next_path: str = "/account/") -> str:
    token = secrets.token_urlsafe(32)
    db.add(LoginToken(client_id=client.id, token_hash=_hash(token), purpose=purpose,
                      expires_at=local_now() + timedelta(minutes=LINK_MINUTES[purpose])))
    db.commit()
    return f"{get_settings().site_url}/account/link/{token}/?next={quote(safe_next(next_path))}"


def consume_link(db: Session, token: str) -> tuple[Client, str] | None:
    row = db.scalar(select(LoginToken).where(LoginToken.token_hash == _hash(token)))
    if not row or row.used_at or row.expires_at < local_now():
        return None
    row.used_at = local_now()
    client = db.get(Client, row.client_id)
    if client and not client.email_verified_at:
        client.email_verified_at = local_now()
    db.commit()
    return (client, row.purpose) if client else None


def register(db: Session, first_name: str, last_name: str, email: str, password: str, next_path: str) -> None:
    """Create an account and email a verification link. Never reveals whether the email already exists."""
    email = normalise_email(email)
    if not first_name.strip() or not valid_email(email):
        raise AccountError("Enter your first name and a valid email address.")
    if len(password) < MIN_PASSWORD:
        raise AccountError(f"Choose a password of at least {MIN_PASSWORD} characters.")
    client = db.scalar(select(Client).where(Client.email == email))
    if client is None:
        client = Client(email=email, first_name=first_name.strip()[:120], last_name=last_name.strip()[:120],
                        password_hash=hash_password(password))
        db.add(client)
        db.commit()
        link = issue_link(db, client, "verify", next_path)
        mailer.send(email, "Confirm your LAVE account",
                    f"Welcome to LAVE, {client.first_name}.\n\nConfirm your email to finish setting up your account:\n{link}\n\n"
                    "This link works once and expires in 24 hours.")
    else:
        # Someone already has this email (perhaps from a booking or the old site). Don't set a password from an
        # unverified request: send a sign-in link to the real owner instead.
        link = issue_link(db, client, "signin", next_path)
        mailer.send(email, "Sign in to LAVE",
                    "Someone tried to create a LAVE account with this email, which already has one.\n\n"
                    f"If it was you, sign in here:\n{link}\n\nYou can set a password from your account. "
                    "If it wasn't you, ignore this email.")


def authenticate(db: Session, email: str, password: str) -> Client:
    email = normalise_email(email)
    client = db.scalar(select(Client).where(Client.email == email))
    if not client or not client.password_hash:
        verify_password(password, _DUMMY_HASH)
        raise AccountError("Email or password is incorrect.")
    if not verify_password(password, client.password_hash):
        raise AccountError("Email or password is incorrect.")
    if not client.email_verified_at:
        link = issue_link(db, client, "verify")
        mailer.send(email, "Confirm your LAVE account",
                    f"Confirm your email to finish setting up your LAVE account:\n{link}\n\nThis link works once and expires in 24 hours.")
        raise AccountError("Confirm your email first. We've sent you a new link.")
    return client


def send_signin_link(db: Session, email: str, next_path: str, purpose: str = "signin") -> None:
    """Email a sign-in (or reset) link if the account exists. Silent either way."""
    email = normalise_email(email)
    client = db.scalar(select(Client).where(Client.email == email))
    if not client:
        return
    link = issue_link(db, client, purpose, next_path)
    if purpose == "reset":
        mailer.send(email, "Reset your LAVE password",
                    f"Choose a new password for your LAVE account:\n{link}\n\nThis link works once and expires in 30 minutes. "
                    "If you didn't ask for it, ignore this email.")
    else:
        mailer.send(email, "Your LAVE sign-in link",
                    f"Sign in to LAVE:\n{link}\n\nThis link works once and expires in 30 minutes. "
                    "If you didn't ask for it, ignore this email.")


def set_password(db: Session, client: Client, password: str) -> None:
    if len(password) < MIN_PASSWORD:
        raise AccountError(f"Choose a password of at least {MIN_PASSWORD} characters.")
    client.password_hash = hash_password(password)
    db.commit()
