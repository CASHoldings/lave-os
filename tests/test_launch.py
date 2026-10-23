"""Launch: old WordPress addresses, the not-found page, settings for the host, and the release step."""
from app.config import Settings


def test_old_wordpress_addresses_redirect(api):
    cases = {
        "/contact-us/": "/contact/",
        "/premium-dry-cleaning-for-her/": "/atelier/clean/women/",
        "/collection/collection-booking-slot-2026-09-21-on-10am-11am/": "/book/",
        "/membership-account/membership-levels/": "/memberships/plans/",
        "/product/lave-elevate/": "/memberships/plans/",
        "/product/leather-blazer-dry-cleaning-luxury-care-for-structured-style/": "/atelier/prices/#leather-jacket",
        "/product/something-retired/": "/atelier/prices/",
        "/product-tag/boys/": "/atelier/clean/children/",
        "/product-tag/cashmere/": "/search/?q=cashmere",
        "/portfolio/venenatis-nam-phasellus/": "/",
        "/blog/the-human-touch-in-a-digital-world/": "/laveworld/knowledge/",
    }
    for old, new in cases.items():
        r = api.get(old, follow_redirects=False)
        assert r.status_code == 301 and r.headers["location"] == new, (old, r.status_code, r.headers.get("location"))
        assert api.get(old.split("#")[0]).status_code == 200, old


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
    for path in ("/atelier/", "/apothecary/wash/", "/memberships/plans/", "/laveworld/story/", "/atelier/prices/", "/atelier/packs/", "/atelier/clean/bedding/"):
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


def test_reset_admin_password_from_the_command_line(db_session, api, monkeypatch):
    import pytest
    from app import reset_password
    monkeypatch.setattr(reset_password, "SessionLocal", db_session)
    assert "Password changed for admin@lavelondon.com" in reset_password.reset(" Admin@LaveLondon.com ", "a-brand-new-password")
    ok = api.post("/api/staff/auth/login", json={"email": "admin@lavelondon.com", "password": "a-brand-new-password"})
    assert ok.status_code == 200
    with pytest.raises(SystemExit):
        reset_password.reset("nobody@lavelondon.com", "a-brand-new-password")


def test_staff_forgot_password_by_email(api):
    import re
    from app.services import accounts, mailer
    accounts.reset_limits()
    mailer.OUTBOX.clear()
    # Same answer whether or not the email is a staff account.
    assert api.post("/api/staff/auth/forgot", json={"email": "nobody@lavelondon.com"}).json() == {"ok": True}
    assert not mailer.OUTBOX
    assert api.post("/api/staff/auth/forgot", json={"email": "Admin@lavelondon.com"}).json() == {"ok": True}
    mail = mailer.OUTBOX[0]
    assert mail["to"] == "admin@lavelondon.com"
    token = re.search(r"/admin#/reset/(\S+)", mail["text"]).group(1)

    assert api.post("/api/staff/auth/reset", json={"token": token, "password": "short"}).status_code == 422
    r = api.post("/api/staff/auth/reset", json={"token": token, "password": "a-fresh-admin-password"})
    assert r.json() == {"ok": True, "email": "admin@lavelondon.com"}
    assert api.post("/api/staff/auth/login", json={"email": "admin@lavelondon.com", "password": "a-fresh-admin-password"}).status_code == 200
    # The link works once.
    again = api.post("/api/staff/auth/reset", json={"token": token, "password": "another-new-password"})
    assert again.status_code == 400 and "expired or has already been used" in again.json()["detail"]
    assert api.post("/api/staff/auth/reset", json={"token": "x" * 40, "password": "another-new-password"}).status_code == 400


def test_co_uk_goes_to_the_main_address(api, monkeypatch):
    from app.config import get_settings
    monkeypatch.setattr(get_settings(), "site_url", "https://lavelondon.com")
    for host in ("lavelondon.co.uk", "www.lavelondon.co.uk"):
        r = api.get("/atelier/prices/?x=1", headers={"host": host}, follow_redirects=False)
        assert r.status_code == 301 and r.headers["location"] == "https://lavelondon.com/atelier/prices/?x=1"


def test_browsers_keep_files(api):
    css = api.get("/static/site/site.css?v=41")
    assert css.headers["cache-control"] == "public, max-age=31536000, immutable"
    assert api.get("/static/site/site.css").headers["cache-control"] == "public, max-age=86400"
    assert api.get("/static/site/fonts/century-gothic-400.woff2").headers["cache-control"] == "public, max-age=2592000"
    assert api.get("/admin").headers["cache-control"] == "no-cache"
    assert "cache-control" not in api.get("/atelier/").headers  # pages are always fresh
    from app.main import cache_rule
    assert cache_rule("/media/202610-0123456789abcdef.webp", False) == "public, max-age=2592000"
    assert cache_rule("/media/thumbs/202610-0123456789abcdef.webp", False) == "public, max-age=2592000"
    assert cache_rule("/media/shirt-1.webp", False) == "public, max-age=86400"


def _photo(width, height, fmt="WEBP"):
    import random
    from io import BytesIO
    from PIL import Image
    random.seed(1)
    img = Image.frombytes("RGB", (width, height), bytes(random.getrandbits(8) for _ in range(width * height * 3)))
    out = BytesIO()
    img.save(out, fmt, quality=100)
    return out.getvalue()


def test_oversized_photos_are_slimmed(tmp_path, monkeypatch):
    from io import BytesIO
    from PIL import Image
    from app.services import media

    big = _photo(2400, 1200)
    small = media.slim(big, ".webp")
    assert Image.open(BytesIO(small)).size == (1920, 960) and len(small) < len(big)
    light = _photo(300, 200, "JPEG")
    assert len(light) < media.SLIM_FROM and media.slim(light, ".jpg") is light  # already light: untouched
    assert media.slim(b"not a photo", ".png") == b"not a photo"

    # The library pass: slims uploads in place (same name), makes small copies, leaves bundled photos, runs once.
    monkeypatch.setattr(media, "MEDIA_DIR", tmp_path)
    upload = tmp_path / "202610-0123456789abcdef.webp"
    upload.write_bytes(big)
    bundled = tmp_path / "shirt-1.webp"
    bundled.write_bytes(big)
    assert media.slim_library(tmp_path) == 1
    assert Image.open(upload).width == 1920 and bundled.read_bytes() == big
    assert Image.open(tmp_path / "thumbs" / upload.name).width == media.THUMB_WIDTH
    assert media.small_url(f"/media/{upload.name}") == f"/media/thumbs/{upload.name}"
    assert media.small_url("/media/shirt-1.webp") == "/media/shirt-1.webp"
    stamp = upload.stat().st_mtime_ns
    assert media.slim_library(tmp_path) == 0 and upload.stat().st_mtime_ns == stamp


def test_uploads_are_slimmed(api, staff_headers, tmp_path, monkeypatch):
    from PIL import Image
    from app.routers import staff
    from app.services import media
    monkeypatch.setattr(staff, "MEDIA_DIR", tmp_path)
    monkeypatch.setattr(media, "MEDIA_DIR", tmp_path)
    r = api.post("/api/staff/uploads", headers=staff_headers, files={"file": ("big.webp", _photo(2400, 1200), "image/webp")})
    name = r.json()["url"].removeprefix("/media/")
    assert Image.open(tmp_path / name).width == 1920 and (tmp_path / "thumbs" / name).exists()
