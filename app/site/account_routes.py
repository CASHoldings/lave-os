"""Client accounts on the LAVE website: sign in, create an account, emailed links, and the account pages."""
from fastapi import APIRouter, Cookie, Depends, Form, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import CLIENT_COOKIE, client_from_token, issue_client_token
from app.config import get_settings
from app.db import get_db
from app.models import Booking, BookingStatus, Client, Order, OrderStatus, VaultItem, VaultStatus
from app.services import accounts, mailer
from app.services import wardrobe as wardrobe_svc
from app.services.accounts import AccountError, safe_next
from app.services.clock import local_now
from app.site.routes import render
from app.site.store import site_dependency

router = APIRouter(include_in_schema=False, dependencies=[Depends(site_dependency)])

ACCOUNT_TABS = [("orders", "Orders"), ("bookings", "Bookings"), ("vault", "Vault"), ("profile", "Profile"),
                ("membership", "Membership"), ("wardrobe", "Wardrobe")]
STAGES = ["awaiting_collection", "collected", "inspected", "in_care", "quality_check", "ready", "delivered"]
STAGE_LABELS = ["Booked", "Collected", "Inspected", "In care", "Quality check", "Ready", "Delivered"]


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _signed_in(response: RedirectResponse, client: Client) -> RedirectResponse:
    s = get_settings()
    response.set_cookie(CLIENT_COOKIE, issue_client_token(client), httponly=True, samesite="lax", secure=s.site_url.startswith("https"),
                        max_age=s.client_session_hours * 3600, path="/")
    return response


def _to_login(next_path: str) -> RedirectResponse:
    from urllib.parse import quote
    return RedirectResponse(f"/account/login/?next={quote(next_path)}", status_code=303)


def _dev_email(email: str) -> dict | None:
    """In development, show the email that would have been sent so its link can be clicked."""
    return mailer.last_to(accounts.normalise_email(email)) if get_settings().is_dev and email else None


def current_site_client(lave_client: str | None = Cookie(default=None), db: Session = Depends(get_db)) -> Client | None:
    return client_from_token(db, lave_client)


# Sign in

@router.get("/account/login/", response_class=HTMLResponse)
def login_form(request: Request, next: str = "/account/", client: Client | None = Depends(current_site_client)):
    if client:
        return RedirectResponse(safe_next(next), status_code=303)
    return render(request, "site/auth_login.html", next=safe_next(next), email="", error="")


@router.post("/account/login/", response_class=HTMLResponse)
def login(request: Request, email: str = Form(""), password: str = Form(""), next: str = Form("/account/"),
          db: Session = Depends(get_db)):
    next_path = safe_next(next)
    key = f"login:{_client_ip(request)}:{accounts.normalise_email(email)}"
    if not accounts.allow(key, limit=8, window_seconds=15 * 60):
        return render(request, "site/auth_login.html", status_code=429, next=next_path, email=email,
                      error="Too many attempts. Wait 15 minutes, or sign in with an emailed link.")
    try:
        client = accounts.authenticate(db, email, password)
    except AccountError as e:
        return render(request, "site/auth_login.html", status_code=400, next=next_path, email=email, error=str(e),
                      dev_email=_dev_email(email))
    return _signed_in(RedirectResponse(next_path, status_code=303), client)


@router.post("/account/logout/")
def logout():
    response = RedirectResponse("/", status_code=303)
    response.delete_cookie(CLIENT_COOKIE, path="/")
    return response


# Create an account

@router.get("/account/register/", response_class=HTMLResponse)
def register_form(request: Request, next: str = "/account/"):
    return render(request, "site/auth_register.html", next=safe_next(next), form={}, error="")


@router.post("/account/register/", response_class=HTMLResponse)
def register(request: Request, first_name: str = Form(""), last_name: str = Form(""), email: str = Form(""),
             password: str = Form(""), next: str = Form("/account/"), db: Session = Depends(get_db)):
    next_path = safe_next(next)
    form = {"first_name": first_name, "last_name": last_name, "email": email}
    if not accounts.allow(f"register:{_client_ip(request)}", limit=10, window_seconds=60 * 60):
        return render(request, "site/auth_register.html", status_code=429, next=next_path, form=form,
                      error="Too many sign-ups from this connection. Try again in an hour.")
    try:
        accounts.register(db, first_name, last_name, email, password, next_path)
    except AccountError as e:
        return render(request, "site/auth_register.html", status_code=400, next=next_path, form=form, error=str(e))
    return render(request, "site/auth_check_email.html", email=accounts.normalise_email(email),
                  heading="Check your email", message="We've sent you a link to confirm your account. It expires in 24 hours.",
                  dev_email=_dev_email(email))


# Emailed links

@router.get("/account/link/", response_class=HTMLResponse)
def link_form(request: Request, purpose: str = "signin", next: str = "/account/"):
    purpose = "reset" if purpose == "reset" else "signin"
    return render(request, "site/auth_link.html", purpose=purpose, next=safe_next(next), email="")


@router.post("/account/link/", response_class=HTMLResponse)
def send_link(request: Request, email: str = Form(""), purpose: str = Form("signin"), next: str = Form("/account/"),
              db: Session = Depends(get_db)):
    purpose = "reset" if purpose == "reset" else "signin"
    email = accounts.normalise_email(email)
    if accounts.valid_email(email) and accounts.allow(f"link:{email}", limit=5, window_seconds=60 * 60):
        accounts.send_signin_link(db, email, safe_next(next), purpose)
    # Same answer whether or not the account exists.
    return render(request, "site/auth_check_email.html", email=email, heading="Check your email",
                  message="If there's a LAVE account for this email, we've sent a link. It works once and expires in 30 minutes.",
                  dev_email=_dev_email(email))


@router.get("/account/link/{token}/", response_class=HTMLResponse)
def use_link(request: Request, token: str, next: str = "/account/", db: Session = Depends(get_db)):
    result = accounts.consume_link(db, token)
    if not result:
        return render(request, "site/auth_check_email.html", status_code=400, email="", heading="This link has expired",
                      message="Links work once and expire after a short time. Request a new one to continue.",
                      show_retry=True)
    client, purpose = result
    target = "/account/password/" if purpose == "reset" else safe_next(next)
    return _signed_in(RedirectResponse(target, status_code=303), client)


@router.get("/account/password/", response_class=HTMLResponse)
def password_form(request: Request, client: Client | None = Depends(current_site_client)):
    if not client:
        return _to_login("/account/password/")
    return render(request, "site/auth_password.html", client=client, error="", saved=False)


@router.post("/account/password/", response_class=HTMLResponse)
def password_save(request: Request, password: str = Form(""), lave_client: str | None = Cookie(default=None),
                  db: Session = Depends(get_db)):
    client = client_from_token(db, lave_client)
    if not client:
        return _to_login("/account/password/")
    try:
        accounts.set_password(db, client, password)
    except AccountError as e:
        return render(request, "site/auth_password.html", status_code=400, client=client, error=str(e), saved=False)
    return render(request, "site/auth_password.html", client=client, error="", saved=True)


# Account pages

@router.get("/account/", response_class=HTMLResponse)
def account_home(request: Request, client: Client | None = Depends(current_site_client), db: Session = Depends(get_db)):
    if not client:
        return _to_login("/account/")
    now = local_now()
    upcoming = db.scalars(select(Booking).where(
        Booking.client_id == client.id, Booking.ends_at >= now,
        Booking.status.in_([BookingStatus.scheduled, BookingStatus.en_route])).order_by(Booking.starts_at).limit(3)).all()
    active = db.scalars(select(Order).where(
        Order.client_id == client.id, Order.status.not_in([OrderStatus.delivered, OrderStatus.cancelled]))
        .order_by(Order.created_at.desc()).limit(4)).all()
    last_delivered = db.scalar(select(Order).where(Order.client_id == client.id, Order.status == OrderStatus.delivered)
                               .order_by(Order.updated_at.desc()).limit(1))
    vault_count = db.scalar(select(func.count()).select_from(VaultItem).where(
        VaultItem.client_id == client.id, VaultItem.status != VaultStatus.retrieved)) or 0
    awaiting_payment = [o for o in active if o.items and o.payment_status.value not in ("paid", "waived")]
    wardrobe = wardrobe_svc.for_client(db, client)

    def stage(o: Order) -> int:
        return 5 if o.status == OrderStatus.out_for_delivery else STAGES.index(o.status.value)

    return render(request, "site/account_home.html", client=client, tabs=ACCOUNT_TABS, active_tab="",
                  upcoming=upcoming, active=active, stage=stage, stage_labels=STAGE_LABELS, vault_count=vault_count,
                  last_delivered=last_delivered, awaiting_payment=awaiting_payment, wardrobe=wardrobe)


@router.get("/account/{tab}/", response_class=HTMLResponse)
def account_tab(request: Request, tab: str, client: Client | None = Depends(current_site_client)):
    if tab not in dict(ACCOUNT_TABS):
        from fastapi import HTTPException
        raise HTTPException(404)
    if not client:
        return _to_login(f"/account/{tab}/")
    return render(request, "site/account_tab.html", client=client, tabs=ACCOUNT_TABS, active_tab=tab,
                  heading=dict(ACCOUNT_TABS)[tab])


@router.get("/book/", response_class=HTMLResponse)
def book(request: Request, mode: str = "", items: str = "", client: Client | None = Depends(current_site_client)):
    items = ",".join(i for i in items.split(",") if i.isdigit())[:200]
    if not client:
        query = "&".join(q for q in [f"mode={mode}" if mode == "drop_off" else "", f"items={items}" if items else ""] if q)
        return _to_login("/book/" + (f"?{query}" if query else ""))
    return render(request, "site/book.html", client=client, mode="drop_off" if mode == "drop_off" else "", items=items)
