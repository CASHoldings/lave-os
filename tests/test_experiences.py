"""The LAVE Experiences page: a photo on the left and the details beside it, dated events first, then the
experiences that run all year."""
import re
from datetime import datetime

from app.services.content import event_when

PAGE = "/memberships/access/upcoming-events/"


def _event(api, sh, **fields):
    body = {"title": "Winter Linen Evening", "kind": "event", "body": "Join us at the atelier.",
            "excerpt": "An evening on caring for fine linen.", **fields}
    e = api.post("/api/staff/posts", headers=sh, json=body)
    assert e.status_code == 201, e.text
    assert api.post(f"/api/staff/posts/{e.json()['id']}/publish", headers=sh, json={"publish": True}).status_code == 200
    return e.json()


def test_year_round_experiences_show_even_with_no_dates(api):
    page = api.get(PAGE).text
    assert "No dated experiences are scheduled right now." in page and "Throughout the year" in page
    for name in ("LAVE Strides", "LAVEYoga", "Founders Lab", "LAVE Family"):
        assert name in page
    assert 'class="exp"' in page and 'href="/memberships/#eclat"' in page
    assert 'name="robots" content="noindex' not in page  # a real page now, worth finding
    tabs = re.search(r'<nav class="tabs" aria-label="Who it\'s for">(.*?)</nav>', page, re.S).group(1)
    assert re.findall(r">([A-Za-z]+)</a>", tabs) == ["All", "Households", "Individuals", "Corporates"]
    individuals = api.get("/memberships/access/individuals/").text
    assert "<h3>Founders Lab</h3>" in individuals and "<h3>LAVEYoga</h3>" in individuals
    assert "<h3>LAVE Strides</h3>" not in individuals and "LAVE Experiences: Individuals" in individuals
    households = api.get("/memberships/access/households/").text
    assert "<h3>LAVE Family</h3>" in households and "<h3>Founders Lab</h3>" not in households
    assert "<h3>LAVE Family</h3>" not in api.get("/memberships/access/corporates/").text
    # The tabs before go to the group they belong to now.
    for old, new in (("families", "households"), ("children", "households"), ("founders", "individuals"),
                     ("professionals", "individuals"), ("businesses", "corporates")):
        r = api.get(f"/memberships/access/{old}/", follow_redirects=False)
        assert r.status_code == 301 and r.headers["location"] == f"/memberships/access/{new}/"
    # The old tabs go to All, so no link breaks.
    for old in ("lifestyle", "sport"):
        r = api.get(f"/memberships/access/{old}/", follow_redirects=False)
        assert r.status_code == 301 and r.headers["location"] == PAGE


def test_dated_events_come_first_with_their_details(api, staff_headers):
    _event(api, staff_headers, event_starts_at="2026-11-26T17:30", event_ends_at="2026-11-26T18:30",
           event_location="The atelier, Streatham", event_theme="lifestyle", members_only=True,
           event_audiences=["individuals", "corporates"],
           event_note="Free for members; £15 for a guest.", event_link="https://example.com/book",
           event_link_label="Reserve a place")
    page = api.get(PAGE).text
    assert page.index("Coming up") < page.index("Winter Linen Evening") < page.index("Throughout the year")
    assert "Thursday 26 November 2026, 5.30pm to 6.30pm" in page
    assert "<strong>Location:</strong> The atelier, Streatham" in page
    assert "Lifestyle · Members only" in page and "Free for members; £15 for a guest." in page
    assert 'href="/memberships/access/upcoming-events/winter-linen-evening/">Find out more' in page  # its own page
    assert "No dated experiences" not in page
    assert "Winter Linen Evening" in api.get("/memberships/access/corporates/").text
    assert "Winter Linen Evening" not in api.get("/memberships/access/households/").text


def test_a_run_of_days_stays_until_it_ends(api, staff_headers):
    # The tests' clock is Monday 5 October 2026, 08:00.
    _event(api, staff_headers, title="Autumn Repairs Week", event_starts_at="2026-10-01T10:00",
           event_ends_at="2026-10-09T17:00")
    _event(api, staff_headers, title="Summer Picnic", event_starts_at="2026-09-01T12:00", event_ends_at="2026-09-01T16:00")
    page = api.get(PAGE).text
    assert "Autumn Repairs Week" in page and "Thursday 1 – Friday 9 October 2026" in page
    assert 'href="/memberships/access/upcoming-events/autumn-repairs-week/">Find out more' in page
    assert "Summer Picnic" not in page


def test_event_details_are_checked(api, staff_headers):
    base = {"title": "Bad dates", "kind": "event", "body": "x"}
    r = api.post("/api/staff/posts", headers=staff_headers,
                 json={**base, "event_starts_at": "2026-11-20T18:00", "event_ends_at": "2026-11-19T18:00"})
    assert r.status_code == 400 and "end before it starts" in r.json()["detail"]
    r = api.post("/api/staff/posts", headers=staff_headers, json={**base, "event_link": "javascript:alert(1)"})
    assert r.status_code == 400
    r = api.post("/api/staff/posts", headers=staff_headers, json={**base, "event_audiences": ["men"]})
    assert r.status_code == 400 and "Unknown group" in r.json()["detail"]


def test_year_round_list_is_editable(api, staff_headers):
    doc = api.get("/api/staff/content/page.experiences", headers=staff_headers).json()["value"]
    doc["ongoing"][0] = dict(doc["ongoing"][0], title="LAVE Strides: Battersea Park", when="First Sunday of the month")
    assert api.put("/api/staff/content/page.experiences", json={"value": doc}, headers=staff_headers).status_code == 200
    page = api.get(PAGE).text
    assert "LAVE Strides: Battersea Park" in page and "First Sunday of the month" in page


def test_dates_read_naturally():
    assert event_when(datetime(2026, 11, 19), datetime(2026, 11, 21)) == "Thursday 19 – Saturday 21 November 2026"
    assert event_when(datetime(2026, 11, 16), datetime(2026, 12, 3)) == "Monday 16 November – Thursday 3 December 2026"
    assert event_when(datetime(2026, 12, 30), datetime(2027, 1, 2)) == "Wednesday 30 December 2026 – Saturday 2 January 2027"
    assert event_when(datetime(2026, 11, 28, 14, 0)) == "Saturday 28 November 2026, 2pm"


def test_saved_menus_switch_to_the_groups_once(db_session):
    from app.models import SiteContent
    from app.services import content
    from app.site.defaults import menus
    old = menus()
    for s in old["sections"]:
        for n in s["subnav"]:
            for c in n["columns"]:
                if c["title"] == "LAVE Experiences":
                    c["links"] = [{"label": "Lifestyle", "href": ""}, {"label": "Sport", "href": ""},
                                  {"label": "Upcoming events", "href": ""}]
    with db_session() as db:
        db.merge(SiteContent(key="menus", value=old))
        db.commit()
        assert content.update_brand_wording(db) >= 1
        assert content.update_brand_wording(db) == 0  # once only
        saved = db.get(SiteContent, "menus").value
    col = next(c for s in saved["sections"] for n in s["subnav"] for c in n["columns"] if c["title"] == "LAVE Experiences")
    assert [link["label"] for link in col["links"]] == ["All experiences", "Households", "Individuals", "Corporates"]


def test_menus_saved_with_the_first_groups_switch_too(db_session):
    from app.models import SiteContent
    from app.services import content
    from app.site.defaults import menus
    old = menus()
    for s in old["sections"]:
        for n in s["subnav"]:
            for c in n["columns"]:
                if c["title"] == "LAVE Experiences":
                    c["links"] = [{"label": "All experiences", "href": "/memberships/access/upcoming-events/"}] + [
                        {"label": x, "href": ""} for x in ("Families", "Founders", "Professionals", "Children", "Businesses")]
    with db_session() as db:
        db.merge(SiteContent(key="menus", value=old))
        db.commit()
        content.update_brand_wording(db)
        saved = db.get(SiteContent, "menus").value
    col = next(c for s in saved["sections"] for n in s["subnav"] for c in n["columns"] if c["title"] == "LAVE Experiences")
    assert [link["label"] for link in col["links"]] == ["All experiences", "Households", "Individuals", "Corporates"]


def test_events_saved_with_the_old_groups_move(api, staff_headers, db_session):
    from app.models import Post
    from app.services import content
    r = api.post("/api/staff/posts", headers=staff_headers, json={"title": "Old groups", "kind": "event", "body": "x",
                                                                  "event_audiences": ["founders", "children"]})
    assert r.status_code == 201 and r.json()["event_audiences"] == ["households", "individuals"]  # stored as the new ones
    with db_session() as db:
        p = db.get(Post, r.json()["id"])
        p.event_audiences = ["businesses", "families"]  # as saved before the change
        db.commit()
        assert content.update_event_audiences(db) == 1 and content.update_event_audiences(db) == 0
        assert db.get(Post, r.json()["id"]).event_audiences == ["households", "corporates"]
