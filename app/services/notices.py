"""Booking emails: the confirmation when a client books, and a reminder the evening before each visit."""
import logging
import time
from datetime import datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Booking, BookingKind, BookingMode, BookingStatus, Order
from app.services import letters
from app.services.clock import local_now

log = logging.getLogger("lave.notices")

REMIND_FROM_HOUR = 17           # reminders for tomorrow go out from 5pm
JUST_BOOKED = timedelta(hours=6)  # booked this recently: the confirmation is reminder enough
CHECK_EVERY = 15 * 60           # seconds between checks for reminders to send


def _time(t: datetime) -> str:
    hour = t.hour % 12 or 12
    return f"{hour}{t:%p}".lower() if t.minute == 0 else f"{hour}:{t:%M}{t:%p}".lower()


def when(b: Booking) -> str:
    """Tuesday 27 October, 9am to 10am"""
    return f"{b.starts_at:%A} {b.starts_at.day} {b.starts_at:%B}, {_time(b.starts_at)} to {_time(b.ends_at)}"


def place(b: Booking) -> str:
    a = b.address if b.mode == BookingMode.lave_collects else None
    if not a:
        return "At the atelier"
    return ", ".join(x for x in (a.line1, a.line2, a.postcode) if x)


def _pounds(pence: int) -> str:
    return f"£{pence / 100:.2f}"


def _bookings_url() -> str:
    return f"{get_settings().site_url}/account/bookings/"


def _change_line() -> str:
    hours = get_settings().cancel_cutoff_minutes // 60
    return (f"Need to change something? You can cancel from your account up to {hours} hours before your slot, or "
            "simply reply to this email and we'll help.")


def booking_confirmed(order: Order) -> None:
    """Sent as soon as a client books a collection (and, if chosen, the delivery back)."""
    visits = [b for b in order.bookings if b.status != BookingStatus.cancelled]
    collection = next((b for b in visits if b.kind == BookingKind.collection), None)
    if not collection or not order.client.email:
        return
    delivery = next((b for b in visits if b.kind == BookingKind.delivery), None)
    collects = collection.mode == BookingMode.lave_collects
    rows = [("Collection" if collects else "Drop-off at the atelier", when(collection))]
    if collects:
        rows.append(("Address", place(collection)))
    if delivery:
        rows.append(("Delivery" if delivery.mode == BookingMode.lave_collects else "Ready to collect", when(delivery)))
    if order.fees_pence:
        rows.append(("Collection and delivery", _pounds(order.fees_pence)))
    if order.estimate_pence:
        rows.append(("Estimate for your list", _pounds(order.estimate_pence)))
    rows.append(("Booking reference", order.ref))
    letters.send(order.client.email, "Your LAVE collection is confirmed", order.client.first_name, [
        f"Thank you for booking with LAVE. Your {'collection' if collects else 'drop-off'} is confirmed.",
        letters.Table(rows),
        ("Please have your pieces ready in a bag." if collects else
         "Please bring your pieces to the atelier at your chosen time.")
        + " When they reach the atelier, we tag and itemise each one and confirm the price with you before we charge.",
        "We'll send you a gentle reminder the evening before.",
        letters.Button("View your booking", _bookings_url()),
        _change_line(),
    ], letters.SOON)


def vault_return_booked(booking: Booking, pieces: int) -> None:
    """Sent when a client books pieces home from the Vault."""
    if not booking.client.email:
        return
    to_door = booking.mode == BookingMode.lave_collects
    rows = [("Delivery" if to_door else "Ready to collect", when(booking))]
    if to_door:
        rows.append(("Address", place(booking)))
    rows += [("Pieces", str(pieces)), ("Booking reference", booking.ref)]
    letters.send(booking.client.email, "Your LAVE Vault return is booked", booking.client.first_name, [
        "Your pieces are ready to come home from the Vault, and your return is booked.",
        letters.Table(rows),
        "We'll send you a gentle reminder the evening before.",
        letters.Button("View your booking", _bookings_url()),
        _change_line(),
    ])


def _reminder(b: Booking) -> None:
    to_door = b.mode == BookingMode.lave_collects
    if b.kind == BookingKind.collection:
        subject = "See you tomorrow: your LAVE collection"
        opening = ("A gentle reminder that we'll be with you tomorrow to collect your pieces." if to_door else
                   "A gentle reminder that we're expecting you at the atelier tomorrow.")
        ready = ("Please have your pieces ready in a bag." if to_door else "Please bring your pieces with you.")
        label = "Collection" if to_door else "Drop-off at the atelier"
    else:
        subject = "Your pieces come home tomorrow"
        opening = ("A gentle reminder that we'll be delivering your pieces tomorrow." if to_door else
                   "A gentle reminder that your pieces will be ready to collect from the atelier tomorrow.")
        ready = ("Please make sure someone is in to receive them." if to_door else
                 "We look forward to handing them back to you.")
        label = "Delivery" if to_door else "Ready to collect"
    rows = [(label, when(b))] + ([("Address", place(b))] if to_door else [])
    letters.send(b.client.email, subject, b.client.first_name, [
        opening,
        letters.Table(rows),
        ready,
        letters.Button("View your booking", _bookings_url()),
        f"If you need to change anything, simply reply to this email or call us on {letters.PHONE}.",
    ])


def send_reminders(db: Session, now: datetime | None = None) -> int:
    """From 5pm, remind clients about tomorrow's visits, once each. Returns how many were sent."""
    now = now or local_now()
    if now.hour < REMIND_FROM_HOUR:
        return 0
    tomorrow = datetime.combine(now.date() + timedelta(days=1), datetime.min.time())
    due = db.scalars(select(Booking).where(
        Booking.status == BookingStatus.scheduled, Booking.reminded_at.is_(None),
        Booking.starts_at >= tomorrow, Booking.starts_at < tomorrow + timedelta(days=1))).all()
    sent = 0
    for b in due:
        # Claim it first, so two copies of the website running side by side during a deploy can't both send it.
        claimed = db.execute(update(Booking).where(Booking.id == b.id, Booking.reminded_at.is_(None))
                             .values(reminded_at=now)).rowcount
        db.commit()
        if claimed != 1 or b.created_at > now - JUST_BOOKED or not b.client.email:
            continue
        _reminder(b)
        sent += 1
    return sent


def reminder_loop() -> None:
    """Runs in the background while the website is up."""
    from app.db import SessionLocal
    while True:
        try:
            with SessionLocal() as db:
                if sent := send_reminders(db):
                    log.info("Sent %d booking reminders", sent)
        except Exception:  # never let one bad night stop the reminders for good
            log.exception("Booking reminders failed")
        time.sleep(CHECK_EVERY)
