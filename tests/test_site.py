def test_pages_render(api):
    for path in ["/", "/atelier/", "/apothecary/", "/memberships/", "/laveworld/", "/atelier/clean/",
                 "/atelier/preserve/adjustments/", "/atelier/clean/women/", "/apothecary/wash/detergents/",
                 "/laveworld/knowledge/thread-by-lave/", "/book/", "/account/"]:
        r = api.get(path)
        assert r.status_code == 200, (path, r.status_code)
    assert api.get("/atelier/nonsense/").status_code == 404
    assert api.get("/nowhere/").status_code == 404
    page = api.get("/atelier/").text
    assert "Welcome to LAVE Atelier" in page and "Fix &amp; Restore" in page
    assert "Maison" not in api.get("/memberships/").text


def test_waitlist(api, db_session):
    from app.models import WaitlistEntry
    r = api.post("/waitlist/", data={"first_name": "Ada", "email": "Ada@Example.com", "source": "Instagram"}, follow_redirects=False)
    assert r.status_code == 303 and "joined" in r.headers["location"]
    api.post("/waitlist/", data={"first_name": "Ada", "email": "ada@example.com"})
    bad = api.post("/waitlist/", data={"first_name": "", "email": "nope"}, follow_redirects=False)
    assert "error" in bad.headers["location"]
    with db_session() as s:
        assert [e.email for e in s.query(WaitlistEntry)] == ["ada@example.com"]
    assert "on the list" in api.get("/apothecary/?waitlist=joined").text


def test_catalogue_pages(api):
    women = api.get("/atelier/clean/women/").text
    assert "Wool Tweed Coat Cleaning Service for Women" in women and "£99.00" in women
    assert "Expert Dry Cleaning for Knit Mini Dresses" not in women  # hidden duplicate
    assert "Services for men are being added" in api.get("/atelier/clean/men/").text
    page = api.get("/atelier/services/silk-chiffon-dry-cleaning/")
    assert page.status_code == 404
    page = api.get("/atelier/services/silk-chiffon-dress-dry-cleaning/")
    assert page.status_code == 200 and "£80.00" in page.text
    assert "30 services" in api.get("/atelier/").text


def test_search(api):
    r = api.get("/search/", params={"q": "cashmere"})
    assert r.status_code == 200 and "Cashmere Jacket Dry Cleaning" in r.text
    assert "Bedding" in api.get("/search/", params={"q": "bedding"}).text
    assert "Nothing matches" in api.get("/search/", params={"q": "zzzz"}).text


def test_membership_page(api):
    page = api.get("/memberships/").text
    for text in ["Care, on a schedule you can count on.", "Everything in Essence, plus:", "Everything in Elevate, plus:",
                 "£290", "£1,290", "LAVE Family", "Coming soon", "At a glance", "Not included", "£16 per additional bag"]:
        assert text in page, text
    assert api.get("/memberships/plans/1-290-a-year/", follow_redirects=False).headers["location"] == "/memberships/#eclat"
    assert api.get("/memberships/benefits/lave-run-club/", follow_redirects=False).headers["location"] == "/memberships/#compare"
    cfg = api.get("/api/config").json()["plans"]
    assert [p["annual_pence"] for p in cfg] == [29000, 59000, 129000]
