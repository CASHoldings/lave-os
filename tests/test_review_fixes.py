"""Regression tests for issues found in the code review."""
import pytest

from app.config import Settings
from app.models import ProductVariant
from app.services import mailer, shop
from tests.conftest import wp_token


def test_wordpress_login_cannot_claim_existing_account(api, client_headers):
    # client@example.com exists (linked to WordPress user 42). A different WordPress user with the same email is refused.
    r = api.post("/api/auth/wp-exchange", json={"token": wp_token(wp_id=99, email="client@example.com")})
    assert r.status_code == 409
    # A website-only account can't be taken over through WordPress either.
    from app.services import accounts
    accounts.reset_limits()
    api.post("/account/register/", data={"first_name": "Site", "email": "site@example.com", "password": "a-long-password"})
    assert api.post("/api/auth/wp-exchange", json={"token": wp_token(wp_id=100, email="site@example.com")}).status_code == 409


def test_production_is_the_default_and_refuses_weak_secrets(monkeypatch):
    for var in ("LAVE_ENV", "LAVE_SECRET_KEY", "LAVE_WP_SSO_SECRET"):
        monkeypatch.delenv(var, raising=False)
    s = Settings(_env_file=None)
    assert s.env == "production" and not s.is_dev
    with pytest.raises(RuntimeError, match="LAVE_SECRET_KEY"):
        s.check_production_safety()
    ok = Settings(_env_file=None, secret_key="x" * 40, wp_sso_secret="y" * 40, site_url="https://lavelondon.com")
    ok.check_production_safety()


def test_dev_shortcuts_are_off_outside_development(api):
    assert api.get("/api/dev/wp-token").status_code in (404, 405)
    assert api.post("/checkout/dev-pay/AP-XXXXXX/").status_code == 404


def test_order_page_needs_the_buyers_key(api, staff_headers, db_session):
    api.post("/api/staff/shop/selling", headers=staff_headers, json={"on": True})
    with db_session() as s:
        v = s.query(ProductVariant).first()
        order = shop.create_order(s, {v.id: 1}, None, "collect")
        shop.mark_paid(s, order, email="buyer@example.com")
        ref, key = order.ref, order.view_key
    assert api.get(f"/checkout/done/{ref}/").status_code == 404
    assert api.get(f"/checkout/done/{ref}/?key=wrong").status_code == 404
    page = api.get(f"/checkout/done/{ref}/?key={key}")
    assert page.status_code == 200 and "is confirmed" in page.text


def test_oversold_orders_are_flagged(api, staff_headers, db_session):
    with db_session() as s:
        v = s.query(ProductVariant).first()
        v.stock = 1
        s.commit()
        a = shop.create_order(s, {v.id: 1}, None, "delivery")
        b = shop.create_order(s, {v.id: 1}, None, "delivery")  # both start checkout while 1 is left
        shop.mark_paid(s, a)
        shop.mark_paid(s, b)
        assert a.stock_issue == "" and "paid for 1, 0 in stock" in b.stock_issue
    orders = api.get("/api/staff/shop/orders", headers=staff_headers).json()
    assert any(o["stock_issue"] for o in orders)


def test_upload_checks_real_file_type(api, staff_headers, tmp_path, monkeypatch):
    from app.routers import staff
    monkeypatch.setattr(staff, "MEDIA_DIR", tmp_path)
    wav = b"RIFF\x00\x00\x00\x00WAVEfmt "
    assert api.post("/api/staff/uploads", headers=staff_headers, files={"file": ("a.webp", wav, "image/webp")}).status_code == 400
    webp = b"RIFF\x00\x00\x00\x00WEBPVP8 "
    assert api.post("/api/staff/uploads", headers=staff_headers, files={"file": ("a.webp", webp, "image/webp")}).status_code == 201


def test_mail_server_failure_does_not_break_requests(monkeypatch):
    import smtplib
    from app import config
    monkeypatch.setattr(config.get_settings(), "smtp_host", "mail.invalid")

    def boom(*a, **k):
        raise smtplib.SMTPConnectError(421, "down")
    monkeypatch.setattr(smtplib, "SMTP", boom)
    mailer.send("x@example.com", "Hi", "Body")  # logged, not raised
