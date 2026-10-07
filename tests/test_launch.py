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
