"""Booking confirmation and the evening-before reminder."""
from datetime import datetime

from sqlalchemy import select

from app.models import Booking, BookingKind
from app.services import mailer, notices
from tests.test_flow import _address, _slots


def _book(api, h, delivery_from="2026-10-08"):
    addr = _address(api, h)
    coll = _slots(api)[0]
    back = next(s for s in _slots(api, start=delivery_from) if s["starts_at"] >= "2026-10-08T07:00:00")
    r = api.post("/api/me/bookings", headers=h, json={
        "collection": {"template_id": coll["template_id"], "day": coll["day"]},
        "delivery": {"template_id": back["template_id"], "day": back["day"]}, "address_id": addr})
    assert r.status_code == 201, r.text
    return r.json()


def test_booking_is_confirmed_by_email(api, client_headers):
    mailer.OUTBOX.clear()
    order = _book(api, client_headers)
    sent = mailer.last_to("client@example.com")
    assert sent["subject"] == "Your LAVE collection is confirmed"
    assert sent["text"].startswith("Hello Celia,")
    assert "Tuesday 6 October" in sent["text"] and "1 Haydon Way, SW11 1YF" in sent["text"]
    assert order["ref"] in sent["text"] and "Collection and delivery" in sent["text"] and "£6.95" in sent["text"]
    assert "/account/bookings/" in sent["html"] and "View your booking" in sent["html"]


def test_reminder_goes_out_the_evening_before_once(api, client_headers, db_session):
    _book(api, client_headers)
    with db_session() as db:
        for b in db.scalars(select(Booking)):
            b.created_at = datetime(2026, 10, 1, 12, 0)  # booked days ago
        db.commit()
        mailer.OUTBOX.clear()
        assert notices.send_reminders(db, datetime(2026, 10, 5, 16, 30)) == 0  # not before 5pm
        assert notices.send_reminders(db, datetime(2026, 10, 5, 18, 0)) == 1  # the collection on the 6th only
        sent = mailer.last_to("client@example.com")
        assert sent["subject"] == "See you tomorrow: your LAVE collection" and "Tuesday 6 October" in sent["text"]
        assert notices.send_reminders(db, datetime(2026, 10, 5, 18, 15)) == 0  # once
        # The delivery back gets its own reminder the evening before it.
        assert notices.send_reminders(db, datetime(2026, 10, 7, 19, 0)) == 1
        assert mailer.last_to("client@example.com")["subject"] == "Your pieces come home tomorrow"


def test_no_reminder_right_after_booking_or_after_cancelling(api, client_headers, db_session):
    _book(api, client_headers)
    with db_session() as db:
        coll = db.scalar(select(Booking).where(Booking.kind == BookingKind.collection))
        coll.created_at = datetime(2026, 10, 5, 17, 30)  # booked this evening: the confirmation is enough
        db.commit()
        mailer.OUTBOX.clear()
        assert notices.send_reminders(db, datetime(2026, 10, 5, 18, 0)) == 0 and not mailer.OUTBOX
        assert db.get(Booking, coll.id).reminded_at is not None  # not tried again
    with db_session() as db:
        delivery = db.scalar(select(Booking).where(Booking.kind == BookingKind.delivery))
        delivery.created_at = datetime(2026, 10, 1, 12, 0)
        db.commit()
        r = api.post(f"/api/me/bookings/{delivery.id}/cancel", headers=client_headers)
        assert r.status_code == 200, r.text
        assert notices.send_reminders(db, datetime(2026, 10, 7, 19, 0)) == 0


def test_times_read_naturally():
    b = Booking(starts_at=datetime(2026, 10, 6, 9, 0), ends_at=datetime(2026, 10, 6, 10, 30))
    assert notices.when(b) == "Tuesday 6 October, 9am to 10:30am"
    b = Booking(starts_at=datetime(2026, 10, 6, 12, 0), ends_at=datetime(2026, 10, 6, 18, 0))
    assert notices.when(b) == "Tuesday 6 October, 12pm to 6pm"
