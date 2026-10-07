"""Authentication.

Clients never hold a password here. WordPress (via the connector plugin) mints a
short-lived token signed with the shared `wp_sso_secret`; the embed exchanges it
for a client session token signed with `secret_key`.

Staff sign in with email and password and receive a session token in an
httpOnly cookie (the dashboard is same-origin) or as a bearer token.
"""
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Cookie, Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import Client, StaffRole, StaffUser

ALGO = "HS256"
STAFF_COOKIE = "lave_staff"
CLIENT_COOKIE = "lave_client"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except ValueError:
        return False


def _issue(claims: dict, hours: int) -> str:
    now = datetime.now(timezone.utc)
    payload = {**claims, "iat": now, "exp": now + timedelta(hours=hours)}
    return jwt.encode(payload, get_settings().secret_key, algorithm=ALGO)


def issue_client_token(client: Client) -> str:
    # "fn" lets server-rendered pages greet the client without a database lookup.
    return _issue({"sub": str(client.id), "typ": "client", "fn": client.first_name or ""}, get_settings().client_session_hours)


def peek_client(token: str | None) -> dict | None:
    """Claims of a valid client session token, without touching the database."""
    if not token:
        return None
    try:
        return _decode_session(token, "client")
    except HTTPException:
        return None


def issue_staff_token(staff: StaffUser) -> str:
    return _issue({"sub": str(staff.id), "typ": "staff", "role": staff.role.value}, get_settings().staff_session_hours)


def decode_wp_sso(token: str) -> dict:
    """Validate a token minted by the WordPress connector."""
    try:
        claims = jwt.decode(
            token,
            get_settings().wp_sso_secret,
            algorithms=[ALGO],
            issuer="lave-wp",
            options={"require": ["exp", "iat", "sub", "email"]},
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Your sign-in link has expired. Refresh the page to continue.") from exc
    return claims


def _decode_session(token: str, typ: str) -> dict:
    try:
        claims = jwt.decode(token, get_settings().secret_key, algorithms=[ALGO])
    except jwt.PyJWTError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired. Sign in again.") from exc
    if claims.get("typ") != typ:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong kind of session.")
    return claims


def _bearer(authorization: str | None) -> str | None:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:]
    return None


def client_from_token(db: Session, token: str | None) -> Client | None:
    """The client a session token belongs to, or None if it's missing, expired or invalid."""
    if not token:
        return None
    try:
        claims = _decode_session(token, "client")
    except HTTPException:
        return None
    return db.get(Client, int(claims["sub"]))


def current_client(
    authorization: str | None = Header(default=None),
    lave_client: str | None = Cookie(default=None),
    db: Session = Depends(get_db),
) -> Client:
    # Embeds on other sites send a bearer token; the LAVE website itself uses the httpOnly cookie.
    token = _bearer(authorization) or lave_client
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in to continue.")
    claims = _decode_session(token, "client")
    client = db.get(Client, int(claims["sub"]))
    if not client:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account not found.")
    return client


def current_staff(
    authorization: str | None = Header(default=None),
    lave_staff: str | None = Cookie(default=None),
    db: Session = Depends(get_db),
) -> StaffUser:
    token = _bearer(authorization) or lave_staff
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in to continue.")
    claims = _decode_session(token, "staff")
    staff = db.get(StaffUser, int(claims["sub"]))
    if not staff or not staff.active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account disabled.")
    return staff


def require_role(*roles: StaffRole):
    def dep(staff: StaffUser = Depends(current_staff)) -> StaffUser:
        if staff.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You don't have permission for this.")
        return staff
    return dep


def find_staff_by_email(db: Session, email: str) -> StaffUser | None:
    return db.scalar(select(StaffUser).where(StaffUser.email == email.lower().strip()))
