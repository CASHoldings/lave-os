"""Launch: old WordPress addresses, the not-found page, settings for the host, and the release step."""
from app.config import Settings


def test_old_wordpress_addresses_redirect(api):
    cases = {
        "/contact-us/": "/contact/",
        "/premium-dry-cleaning-for-her/": "/atelier/clean/women/",
        "/collection/collection-booking-slot-2026-09-21-on-10am-11am/": "/book/",
        "/membership-account/membership-levels/": "/memberships/plans/",
        "/product/lave-elevate/": "/memberships/plans/",
        "/product/leather-blazer-dry-cleaning-luxury-care-for-structured-style/":
            "/atelier/services/leather-blazer-dry-cleaning-luxury-care-for-structured-style/",
        "/product/something-retired/": "/atelier/clean/",
        "/product-tag/boys/": "/atelier/clean/children/",
        "/product-tag/cashmere/": "/search/?q=cashmere",
        "/portfolio/venenatis-nam-phasellus/": "/",
        "/blog/the-human-touch-in-a-digital-world/": "/laveworld/knowledge/",
    }
    for old, new in cases.items():
        r = api.get(old, follow_redirects=False)
        assert r.status_code == 301 and r.headers["location"] == new, (old, r.status_code, r.headers.get("location"))
        assert api.get(old).status_code == 200, old


def test_missing_slash_still_arrives(api):
    r = api.get("/privacy-policy")
    assert r.status_code == 200 and r.url.path == "/policies/"


def test_real_pages_win_over_redirects(api):
    assert api.get("/atelier/", follow_redirects=False).status_code == 200
    assert api.get("/policies/", follow_redirects=False).status_code == 200


def test_not_found_page(api):
    r = api.get("/nothing-here/")
    assert r.status_code == 404 and "couldn't find that page" in r.text and "<footer" in r.text
    assert api.get("/atelier/nonsense/").status_code == 404
    assert api.get("/api/nothing").json() == {"detail": "Not Found"}  # the API still answers in JSON


def test_copied_images_keep_their_old_address(db_session, api):
    from app.models import Media
    with db_session() as db:
        db.add(Media(url="/media/202610-abc.webp", filename="coat.webp", source_url="https://lavelondon.com/wp-content/uploads/2025/06/coat.webp"))
        db.commit()
    r = api.get("/wp-content/uploads/2025/06/coat.webp", follow_redirects=False)
    assert r.status_code == 301 and r.headers["location"] == "/media/202610-abc.webp"
    assert api.get("/wp-content/uploads/2025/06/missing.webp", follow_redirects=False).status_code == 404


def test_host_database_address_uses_psycopg():
    s = Settings(database_url="postgresql://u:p@db.internal/lave")
    assert s.database_url == "postgresql+psycopg://u:p@db.internal/lave"
    assert Settings(database_url="postgres://u:p@h/d").database_url.startswith("postgresql+psycopg://")
    assert Settings(media_dir="/var/data/media").media_path.as_posix() == "/var/data/media"


def test_health_check(api):
    assert api.get("/healthz").json() == {"ok": True}


def test_robots_and_sitemap(api):
    robots = api.get("/robots.txt").text
    assert "Disallow: /admin" in robots and "Sitemap: http://localhost:8000/sitemap.xml" in robots
    sm = api.get("/sitemap.xml")
    assert sm.headers["content-type"].startswith("application/xml")
    for path in ("/atelier/", "/apothecary/wash/", "/memberships/plans/", "/laveworld/story/", "/atelier/services/"):
        assert f"http://localhost:8000{path}" in sm.text
    # Every address in the sitemap answers.
    import re
    for loc in re.findall(r"<loc>http://localhost:8000([^<]+)</loc>", sm.text):
        assert api.get(loc.replace("&amp;", "&")).status_code == 200, loc


def test_www_goes_to_the_main_address(api):
    r = api.get("/atelier/?x=1", headers={"host": "www.lavelondon.com"}, follow_redirects=False)
    assert r.status_code == 301 and r.headers["location"] == "http://lavelondon.com/atelier/?x=1"


def test_release_waits_for_a_starting_database(monkeypatch):
    from sqlalchemy.exc import OperationalError
    from app import release

    real, attempts = release.engine, []

    class StartingEngine:
        def connect(self):
            attempts.append(1)
            if len(attempts) < 3:
                raise OperationalError("SELECT 1", {}, Exception("Connection refused"))
            return real.connect()

    monkeypatch.setattr(release, "engine", StartingEngine())
    monkeypatch.setattr(release.time, "sleep", lambda seconds: None)
    release.wait_for_database(timeout=60, every=0)
    assert len(attempts) == 3


def test_test_email_button(api, staff_headers, monkeypatch):
    from app.config import get_settings
    from app.services import mailer

    status = api.get("/api/staff/email", headers=staff_headers).json()
    assert status["configured"] is False and status["send_to"] == "admin@lavelondon.com"
    r = api.post("/api/staff/email/test", headers=staff_headers)
    assert r.status_code == 502 and "isn't set up" in r.json()["detail"]

    sent = []

    class FakeSMTP:
        def __init__(self, host, port, timeout): sent.append((host, port))
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def starttls(self): pass
        def login(self, user, password): sent.append(("login", user))
        def send_message(self, msg): sent.append(("to", msg["To"], msg["Reply-To"]))

    monkeypatch.setattr(get_settings(), "smtp_host", "smtp.sendgrid.net")
    monkeypatch.setattr(get_settings(), "smtp_user", "apikey")
    monkeypatch.setattr(mailer.smtplib, "SMTP", FakeSMTP)
    assert api.post("/api/staff/email/test", headers=staff_headers).json() == {"sent_to": "admin@lavelondon.com"}
    assert ("smtp.sendgrid.net", 587) in sent and ("login", "apikey") in sent

    class RejectingSMTP(FakeSMTP):
        def login(self, user, password):
            import smtplib
            raise smtplib.SMTPAuthenticationError(535, b"Authentication failed")

    monkeypatch.setattr(mailer.smtplib, "SMTP", RejectingSMTP)
    r = api.post("/api/staff/email/test", headers=staff_headers)
    assert r.status_code == 502 and "username or password" in r.json()["detail"]


def test_contact_messages_can_be_replied_to(api, monkeypatch):
    from app.config import get_settings
    from app.services import accounts, mailer
    accounts.reset_limits()
    got = []
    monkeypatch.setattr(mailer, "send", lambda to, subject, text, reply_to=None, raise_errors=False: got.append((to, reply_to)))
    api.post("/contact/", data={"name": "Ada", "email": "ada@example.com", "topic": "Something else", "message": "Hello"})
    assert got == [("hello@lavelondon.com", "ada@example.com")]


def test_one_address_for_sending_and_contact(monkeypatch):
    from app.config import Settings
    assert Settings().contact_address == "hello@lavelondon.com"
    assert Settings(mail_from="LAVE <care@lavelondon.com>").contact_address == "care@lavelondon.com"
