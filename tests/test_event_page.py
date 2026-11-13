"""Each LAVE Experience's own page, and reserving a place: confirmed while there's room, then the waiting list,
which moves up when someone gives up their place."""
import re
from datetime import datetime

import pytest
from sqlalchemy import select

from app.models import Client, EventReservation, Membership, MembershipPlan, MembershipStatus
from app.services import experiences, mailer
from tests.conftest import wp_token

PAGE = "/memberships/access/upcoming-events/"


@pytest.fixture(autouse=True)
def _clean_outbox():
    mailer.OUTBOX.clear()


def _event(api, sh, **fields):
    body = {"title": "Linen and Light", "kind": "event", "body": "An evening at the atelier.\n\n## The evening\n\nTea and talk.",
            "excerpt": "How to keep fine linen bright, with the atelier team.", "event_starts_at": "2026-11-26T18:30",
            "event_ends_at": "2026-11-26T20:00", "event_location": "The atelier", "event_theme": "lifestyle",
            "event_address": "12 Linen Lane, London SW11 1YF", "event_address_private": True,
            "event_price": "Included with your membership", "event_capacity": 3, "event_places_each": 2,
            "event_timings": "6.30pm  Arrival\n7pm  The talk", "event_included": "Tea and cake",
            "event_bring": "A piece of linen you love", "event_good_to_know": "Step-free access",
            "event_quote": "Linen gets better with every wash.", "event_host_name": "Ada Lovelace",
            "event_host_bio": "Head of the atelier.", "event_audiences": ["individuals"], **fields}
    r = api.post("/api/staff/posts", headers=sh, json=body)
    assert r.status_code == 201, r.text
    assert api.post(f"/api/staff/posts/{r.json()['id']}/publish", headers=sh, json={"publish": True}).status_code == 200
    return r.json()


def _sign_in(api, wp_id, email, first="Celia"):
    """A client signed in to the website (its cookie), as when they arrive from the sign-in page."""
    token = api.post("/api/auth/wp-exchange", json={"token": wp_token(wp_id=wp_id, email=email, first_name=first)}).json()["token"]
    api.cookies.set("lave_client", token)
    return token


def _make_member(db_session, email):
    with db_session() as db:
        c = db.scalar(select(Client).where(Client.email == email))
        db.add(Membership(client_id=c.id, plan=MembershipPlan.elevate, status=MembershipStatus.active))
        db.commit()


def test_the_page_shows_everything_at_a_glance(api, staff_headers):
    e = _event(api, staff_headers)
    url = PAGE + e["slug"] + "/"
    api.cookies.clear()
    page = api.get(url).text
    assert "<h1>Linen and Light</h1>" in page and "Thursday 26 November 2026, 6.30pm to 8pm" in page
    assert "Included with your membership" in page and "3 of 3 left" in page and "<dd>Individuals</dd>" in page
    assert "12 Linen Lane" not in page and "The address is shared with confirmed guests." in page
    assert "<strong>6.30pm</strong><span>Arrival</span>" in page
    for text in ("Tea and cake", "A piece of linen you love", "Step-free access",
                 "Linen gets better with every wash.", "Ada Lovelace", "Sign in to reserve", "Add to calendar"):
        assert text in page, text
    assert '"@type": "Event"' in page and '"startDate": "2026-11-26T18:30:00+00:00"' in page
    # Old Journal links and the list both lead here.
    r = api.get(f"/journal/{e['slug']}/", follow_redirects=False)
    assert r.status_code == 301 and r.headers["location"] == url
    assert f'href="{url}"' in api.get(PAGE).text
    ics = api.get(url + "calendar.ics")
    assert ics.headers["content-type"].startswith("text/calendar") and "DTSTART:20261126T183000Z" in ics.text
    assert "SUMMARY:Linen and Light" in ics.text and "Streatham" not in ics.text  # private until confirmed


def test_reserve_waitlist_and_moving_up(api, staff_headers, db_session):
    e = _event(api, staff_headers)
    url = PAGE + e["slug"] + "/"

    _sign_in(api, 1, "first@example.com", "Ada")
    r = api.post(url + "reserve", data={"places": "2", "note": "No dairy, please"}, follow_redirects=False)
    assert r.status_code == 303 and "done=confirmed" in r.headers["location"]
    page = api.get(url).text
    assert "You're going: 2 places reserved." in page and "12 Linen Lane" in page and "1 of 3 left" in page
    msg = mailer.last_to("first@example.com")
    assert msg["subject"] == "Your place at Linen and Light" and msg["attachments"] == [f"LAVE-{e['slug']}.ics"]
    assert "12 Linen Lane" in msg["text"]
    assert "already" in api.post(url + "reserve", data={"places": "1"}, follow_redirects=False).headers["location"]

    _sign_in(api, 2, "second@example.com", "Ben")
    assert "done=waitlist" in api.post(url + "reserve", data={"places": "2"}, follow_redirects=False).headers["location"]
    assert "You're on the waiting list for 2 places." in api.get(url).text
    assert mailer.last_to("second@example.com")["subject"] == "You're on the waiting list for Linen and Light"
    assert "up to 2 places" in api.post(url + "reserve", data={"places": "3"}, follow_redirects=False).headers["location"].replace("%20", " ")

    # The first guest gives up their places: the waiting list moves up and is told.
    _sign_in(api, 1, "first@example.com", "Ada")
    assert "done=cancelled" in api.post(url + "cancel", follow_redirects=False).headers["location"]
    assert mailer.last_to("second@example.com")["subject"] == "Your place at Linen and Light"
    with db_session() as db:
        rows = {r.client.email: r.status for r in db.scalars(select(EventReservation))}
    assert rows == {"first@example.com": "cancelled", "second@example.com": "confirmed"}

    # The guest list in the admin, and cancelling from there.
    g = api.get(f"/api/staff/posts/{e['id']}/reservations", headers=staff_headers).json()
    assert g["taken"] == 2 and [r["status"] for r in g["reservations"]] == ["confirmed", "cancelled"]
    rid = g["reservations"][0]["id"]
    assert api.post(f"/api/staff/reservations/{rid}/cancel", headers=staff_headers).status_code == 200
    assert mailer.last_to("second@example.com")["subject"] == "Your reservation for Linen and Light is cancelled"


def test_members_only_and_signed_out(api, staff_headers, db_session):
    e = _event(api, staff_headers, members_only=True, event_capacity=0)
    url = PAGE + e["slug"] + "/"
    api.cookies.clear()
    assert api.post(url + "reserve", data={"places": "1"}, follow_redirects=False).headers["location"].startswith("/account/login/")
    _sign_in(api, 3, "guest@example.com")
    assert "Become a member to reserve" in api.get(url).text
    assert "for%20LAVE%20members" in api.post(url + "reserve", data={"places": "1"}, follow_redirects=False).headers["location"]
    _make_member(db_session, "guest@example.com")
    assert "done=confirmed" in api.post(url + "reserve", data={"places": "1"}, follow_redirects=False).headers["location"]
    assert "places left" not in api.get(url).text  # no limit, no count


def test_outside_booking_link_and_past_events(api, staff_headers):
    e = _event(api, staff_headers, event_link="https://tickets.example.com/linen", event_link_label="Buy tickets")
    page = api.get(PAGE + e["slug"] + "/").text
    assert 'href="https://tickets.example.com/linen"' in page and "Buy tickets" in page and "Reserve a place" not in page
    old = _event(api, staff_headers, title="Summer Picnic", event_starts_at="2026-09-01T12:00", event_ends_at="2026-09-01T16:00")
    page = api.get(PAGE + old["slug"] + "/").text
    assert "This experience has taken place." in page and 'content="noindex' in page and '"@type": "Event"' not in page


def test_reminder_the_evening_before(api, staff_headers, db_session):
    e = _event(api, staff_headers)
    _sign_in(api, 1, "first@example.com", "Ada")
    api.post(PAGE + e["slug"] + "/reserve", data={"places": "1"})
    mailer.OUTBOX.clear()
    with db_session() as db:
        assert experiences.send_reminders(db, now=datetime(2026, 11, 25, 12, 0)) == 0  # too early in the day
        assert experiences.send_reminders(db, now=datetime(2026, 11, 25, 17, 30)) == 1
        assert experiences.send_reminders(db, now=datetime(2026, 11, 25, 18, 0)) == 0  # once
    assert mailer.last_to("first@example.com")["subject"] == "Tomorrow: Linen and Light"


def test_calendar_file_is_well_formed(api, staff_headers):
    e = _event(api, staff_headers, title="A, very; long title " * 6, event_ends_at=None,
               event_starts_at="2026-12-05T00:00")
    text = api.get(PAGE + e["slug"] + "/calendar.ics").text
    assert "DTSTART;VALUE=DATE:20261205" in text and "DTEND;VALUE=DATE:20261206" in text
    assert all(len(line.encode()) <= 75 for line in text.split("\r\n"))
    assert re.search(r"SUMMARY:A\\, very\\; long", text)


def test_attendance_is_marked_and_shows_on_the_profile(api, staff_headers, db_session):
    e = _event(api, staff_headers)
    url = PAGE + e["slug"] + "/"
    _sign_in(api, 1, "first@example.com", "Ada")
    api.post(url + "reserve", data={"places": "2"})
    _sign_in(api, 2, "second@example.com", "Ben")
    api.post(url + "reserve", data={"places": "1"})
    g = api.get(f"/api/staff/posts/{e['id']}/reservations", headers=staff_headers).json()
    ada, ben = g["reservations"]
    assert g["started"] is False and ada["attended"] is None

    # Before the day, attendance can't be marked; the profile shows the place as Going.
    r = api.post(f"/api/staff/reservations/{ada['id']}/attendance", headers=staff_headers, json={"attended": True})
    assert r.status_code == 409 and "day of the event" in r.json()["detail"]
    prof = api.get(f"/api/staff/clients/{ada['client_id']}", headers=staff_headers).json()
    assert [(x["title"], x["label"], x["places"]) for x in prof["events"]] == [("Linen and Light", "Going", 2)]

    # The event has happened: Ada came, Ben didn't.
    with db_session() as db:
        p = db.get(EventReservation, ada["id"]).post
        p.event_starts_at, p.event_ends_at = datetime(2026, 10, 1, 18, 30), datetime(2026, 10, 1, 20, 0)
        db.commit()
    assert api.post(f"/api/staff/reservations/{ada['id']}/attendance", headers=staff_headers, json={"attended": True}).status_code == 200
    assert api.post(f"/api/staff/reservations/{ben['id']}/attendance", headers=staff_headers, json={"attended": False}).status_code == 200
    g = api.get(f"/api/staff/posts/{e['id']}/reservations", headers=staff_headers).json()
    assert g["started"] is True and g["attended"] == 2 and [x["attended"] for x in g["reservations"]] == [True, False]

    prof = api.get(f"/api/staff/clients/{ada['client_id']}", headers=staff_headers).json()
    assert prof["events_attended"] == 1 and prof["events"][0]["label"] == "Attended"
    prof = api.get(f"/api/staff/clients/{ben['client_id']}", headers=staff_headers).json()
    assert prof["events_missed"] == 1 and prof["events"][0]["label"] == "Didn't come"

    # Clearing a mark, and cancelled places can't be marked.
    assert api.post(f"/api/staff/reservations/{ben['id']}/attendance", headers=staff_headers, json={"attended": None}).json()["attended"] is None
    assert api.get(f"/api/staff/clients/{ben['client_id']}", headers=staff_headers).json()["events"][0]["label"] == "Not marked"
    api.post(f"/api/staff/reservations/{ben['id']}/cancel", headers=staff_headers)
    assert api.post(f"/api/staff/reservations/{ben['id']}/attendance", headers=staff_headers, json={"attended": True}).status_code == 409
