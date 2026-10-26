"""Bots on the sign-up form: caught quietly, nothing created, nothing emailed."""
from datetime import datetime

import pytest
from sqlalchemy import select

from app.config import get_settings
from app.models import Client, Order
from app.services import accounts, bot_guard, mailer
from tests.conftest import form_fields


@pytest.fixture(autouse=True)
def _clean():
    accounts.reset_limits()
    mailer.OUTBOX.clear()


def _signup(api, **extra):
    data = {**form_fields(), "first_name": "Nia", "last_name": "Cole", "email": "nia@example.com", "password": "a-long-password", **extra}
    return api.post("/account/register/", data=data)


def _created(db_session, email="nia@example.com"):
    return db_session().scalar(select(Client).where(Client.email == email)) is not None


@pytest.mark.parametrize("name", ["dIHnGBWZoCBMfZYaizE", "hQqjnpjcBOUUdjBRuYQwJj", "ZSgmFKIAcOdnsFta", "xyAvZluStxvTTEOGsydUSL"])
def test_random_letter_names_are_caught(api, db_session, name):
    r = _signup(api, first_name=name)
    assert r.status_code == 200 and "Check your email" in r.text  # looks normal to the bot
    assert not _created(db_session) and not mailer.OUTBOX


@pytest.mark.parametrize("name", ["McDonald", "DeLaCruz", "Ana-María", "Nguyen", "O'Brien", "MacKenzie-Smith", "Oluwaseun"])
def test_real_names_get_through(api, db_session, name):
    assert "Check your email" in _signup(api, first_name=name).text and _created(db_session)


def test_hidden_field_and_missing_or_forged_stamp(api, db_session):
    _signup(api, website="https://spam.example")
    _signup(api, t="")
    _signup(api, t="1793000000.forged")
    assert not _created(db_session) and not mailer.OUTBOX


def test_too_fast_is_caught(api, db_session, monkeypatch):
    monkeypatch.setattr(bot_guard, "MIN_SECONDS", 3)
    _signup(api)  # stamped this instant
    assert not _created(db_session)
    old = str(int(datetime.now().timestamp()) - 10)
    _signup(api, t=f"{old}.{bot_guard._sign(old)}")  # ten seconds of typing
    assert _created(db_session)


def test_sign_in_link_form_is_guarded(api, client_headers):
    api.post("/account/link/", data={"email": "client@example.com", "purpose": "signin", "website": "x", "t": bot_guard.form_token()})
    assert mailer.last_to("client@example.com") is None
    api.post("/account/link/", data={**form_fields(), "email": "client@example.com", "purpose": "signin"})
    assert mailer.last_to("client@example.com")["subject"] == "Your LAVE sign-in link"


def test_turnstile_when_switched_on(api, db_session, monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "turnstile_site_key", "0x4AAA")
    monkeypatch.setattr(s, "turnstile_secret", "0x4BBB")
    assert 'class="cf-turnstile" data-sitekey="0x4AAA"' in api.get("/account/register/").text

    class Answer:
        def __init__(self, ok): self.ok = ok
        def json(self): return {"success": self.ok}

    monkeypatch.setattr(bot_guard.httpx, "post", lambda url, data, timeout: Answer(data["response"] == "good"))
    _signup(api, **{"cf-turnstile-response": "bad"})
    assert not _created(db_session)
    _signup(api, **{"cf-turnstile-response": "good"})
    assert _created(db_session)


def test_unconfirmed_signups_hidden_and_removed(api, staff_headers, db_session):
    _signup(api)
    _signup(api, email="kept@example.com", first_name="Kept")
    with db_session() as db:
        for c in db.scalars(select(Client).where(Client.email.in_(["nia@example.com", "kept@example.com"]))):
            c.created_at = datetime(2026, 9, 1)
        kept = db.scalar(select(Client).where(Client.email == "kept@example.com"))
        db.add(Order(client_id=kept.id))  # has an order: never removed
        db.commit()
    emails = {c["email"] for c in api.get("/api/staff/clients", headers=staff_headers).json()}
    assert "nia@example.com" not in emails
    assert api.get("/api/staff/clients/unconfirmed", headers=staff_headers).json()["count"] == 2
    assert "nia@example.com" in {c["email"] for c in api.get("/api/staff/clients?unconfirmed=true", headers=staff_headers).json()}
    assert api.post("/api/staff/clients/remove-unconfirmed", headers=staff_headers, json={"days": 2}).json() == {"removed": 1}
    assert not _created(db_session) and _created(db_session, "kept@example.com")
