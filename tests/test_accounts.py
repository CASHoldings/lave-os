import re

import pytest

from app.services import accounts, mailer


@pytest.fixture(autouse=True)
def _clean():
    accounts.reset_limits()
    mailer.OUTBOX.clear()
    yield


def _link(email):
    msg = mailer.last_to(email)
    assert msg, f"no email to {email}"
    url = re.search(r"https?://\S+", msg["text"]).group(0)
    return url.split("localhost:8000", 1)[1]


def _register(api, email="new@example.com", password="a-long-password"):
    return api.post("/account/register/", data={"first_name": "Nia", "last_name": "Cole", "email": email,
                                                "password": password, "next": "/account/"})


def test_register_verify_then_login(api):
    r = _register(api)
    assert r.status_code == 200 and "Check your email" in r.text
    # Can't sign in before confirming the email.
    r = api.post("/account/login/", data={"email": "new@example.com", "password": "a-long-password"})
    assert r.status_code == 400 and "Confirm your email" in r.text
    r = api.get(_link("new@example.com"), follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "/account/"
    assert "lave_client" in r.headers["set-cookie"].lower() and "httponly" in r.headers["set-cookie"].lower()
    home = api.get("/account/")
    assert "Welcome back, Nia" in home.text
    # The cookie also authenticates the JSON API used by the account tabs.
    assert api.get("/api/me").json()["email"] == "new@example.com"
    api.post("/account/logout/")
    api.cookies.clear()
    assert api.get("/account/", follow_redirects=False).headers["location"].startswith("/account/login/")
    r = api.post("/account/login/", data={"email": "NEW@example.com ", "password": "a-long-password", "next": "/book/"},
                 follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "/book/"


def test_links_are_single_use(api):
    _register(api)
    path = _link("new@example.com")
    assert api.get(path, follow_redirects=False).status_code == 303
    api.cookies.clear()
    r = api.get(path, follow_redirects=False)
    assert r.status_code == 400 and "expired" in r.text


def test_existing_email_cannot_be_claimed_by_registering(api, client_headers):
    # client@example.com already exists (created through the WordPress sign-in in the fixture).
    r = _register(api, email="client@example.com", password="attacker-password")
    assert "Check your email" in r.text  # same response as a new account
    r = api.post("/account/login/", data={"email": "client@example.com", "password": "attacker-password"})
    assert r.status_code == 400
    assert "already has one" in mailer.last_to("client@example.com")["text"]


def test_wrong_password_and_rate_limit(api):
    _register(api)
    api.get(_link("new@example.com"))
    api.cookies.clear()
    for _ in range(8):
        r = api.post("/account/login/", data={"email": "new@example.com", "password": "wrong-password"})
        assert r.status_code == 400 and "incorrect" in r.text
    r = api.post("/account/login/", data={"email": "new@example.com", "password": "a-long-password"})
    assert r.status_code == 429


def test_signin_link_and_reset(api):
    _register(api)
    api.get(_link("new@example.com"))
    api.cookies.clear()
    r = api.post("/account/link/", data={"email": "nobody@example.com", "purpose": "signin"})
    assert "we&#39;ve sent a link" in r.text and mailer.last_to("nobody@example.com") is None
    api.post("/account/link/", data={"email": "new@example.com", "purpose": "reset"})
    r = api.get(_link("new@example.com"), follow_redirects=False)
    assert r.headers["location"] == "/account/password/"
    assert "Password saved" in api.post("/account/password/", data={"password": "brand-new-password"}).text
    api.cookies.clear()
    r = api.post("/account/login/", data={"email": "new@example.com", "password": "brand-new-password"}, follow_redirects=False)
    assert r.status_code == 303


def test_account_pages_need_sign_in_and_next_is_safe(api):
    for path in ["/account/", "/account/orders/", "/book/"]:
        r = api.get(path, follow_redirects=False)
        assert r.status_code == 303 and r.headers["location"].startswith("/account/login/")
    assert api.get("/account/nonsense/").status_code == 404
    assert accounts.safe_next("https://evil.example/") == "/account/"
    assert accounts.safe_next("//evil.example/") == "/account/"
    assert accounts.safe_next("/book/?mode=drop_off") == "/book/?mode=drop_off"
