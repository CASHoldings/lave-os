"""The LAVE Experiences page: a photo on the left and the details beside it, dated events first, then the
experiences that run all year."""
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
    for tab in ("All", "Families", "Founders", "Professionals", "Children", "Businesses"):
        assert f">{tab}</a>" in page
    founders = api.get("/memberships/access/founders/").text
    assert "<h3>Founders Lab</h3>" in founders and "<h3>LAVE Strides</h3>" not in founders
    assert "LAVE Experiences: Founders" in founders
    assert "<h3>Founders Lab</h3>" in api.get("/memberships/access/professionals/").text
    children = api.get("/memberships/access/children/").text
    assert "<h3>LAVE Family</h3>" in children and "<h3>LAVEYoga</h3>" not in children
    assert "<h3>LAVEYoga</h3>" in api.get("/memberships/access/families/").text
    # The old tabs go to All, so no link breaks.
    for old in ("lifestyle", "sport"):
        r = api.get(f"/memberships/access/{old}/", follow_redirects=False)
        assert r.status_code == 301 and r.headers["location"] == PAGE


def test_dated_events_come_first_with_their_details(api, staff_headers):
    _event(api, staff_headers, event_starts_at="2026-11-26T17:30", event_ends_at="2026-11-26T18:30",
           event_location="The atelier, Streatham", event_theme="lifestyle", members_only=True,
           event_audiences=["founders", "businesses"],
           event_note="Free for members; £15 for a guest.", event_link="https://example.com/book",
           event_link_label="Reserve a place")
    page = api.get(PAGE).text
    assert page.index("Coming up") < page.index("Winter Linen Evening") < page.index("Throughout the year")
    assert "Thursday 26 November 2026, 5.30pm to 6.30pm" in page
    assert "<strong>Location:</strong> The atelier, Streatham" in page
    assert "Lifestyle · Members only" in page and "Free for members; £15 for a guest." in page
    assert 'href="/memberships/access/upcoming-events/winter-linen-evening/">Find out more' in page  # its own page
    assert "No dated experiences" not in page
    assert "Winter Linen Evening" in api.get("/memberships/access/businesses/").text
    assert "Winter Linen Evening" not in api.get("/memberships/access/families/").text


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
    assert [link["label"] for link in col["links"]] == ["All experiences", "Families", "Founders", "Professionals",
                                                        "Children", "Businesses"]
