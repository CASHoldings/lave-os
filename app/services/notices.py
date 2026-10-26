"""Booking emails: the confirmation when a client books, and a reminder the evening before each visit."""
import logging
import time
from datetime import datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Booking, BookingKind, BookingMode, BookingStatus, Order, WindowType
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
    if b.atelier:
        return ", ".join(x for x in (b.atelier.name, b.atelier.address, b.atelier.postcode) if x)
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


def _window(b: Booking) -> str:
    """Tuesday 27 October, 7am to 10am (Saver)"""
    return f"{when(b)} ({'One-hour' if b.window_type == WindowType.hour else 'Saver'})"


def booking_confirmed(db: Session, order: Order) -> None:
    """Sent as soon as a client books a collection or an atelier drop-off (spec §7 wording)."""
    from app.services import bookings, delivery
    visits = [b for b in order.bookings if b.status != BookingStatus.cancelled]
    first = next((b for b in visits if b.kind == BookingKind.collection), None)
    if not first or not order.client.email:
        return
    returns = [b for b in visits if b.kind == BookingKind.delivery]
    longer = order.return_preference in ("together", "split")
    if first.atelier_id:
        return dropoff_confirmed(db, order, first, returns)
    rows = [("Collection", _window(first)), ("Address", place(first))]
    rows += [("Return", _window(r)) for r in returns] or [("Return", "We'll arrange it with you" if not longer else
                                                           "Confirmed after we've inspected your items")]
    rows.append(("Collection and delivery", delivery.charge_text(order)))
    if order.estimate_pence:
        rows.append(("Your items (fixed prices)", _pounds(order.estimate_pence)))
    if order.credit_used_pence:
        rows.append(("LAVE account credit used", "−" + _pounds(order.credit_used_pence)))
    if order.paid_pence:
        rows.append(("Paid today", _pounds(order.paid_pence)))
    rows.append(("Booking reference", order.ref))
    ready = delivery.earliest_return(db, bookings.collected_by(db, first))
    letters.send(order.client.email, "Your LAVE collection is confirmed", order.client.first_name, [
        "Thank you for booking with LAVE. Your collection is confirmed.",
        letters.Table(rows),
        *([delivery.LONGER_NOTE] if longer else []),
        "Please have your pieces ready in a bag. When they reach the atelier, we tag and itemise each one and confirm "
        f"the price with you before we charge. Your items are ready to come back from {bookings.when_text(ready)}.",
        "We'll send you a gentle reminder the evening before.",
        *([billing_wording()] if order.paid_pence or order.credit_used_pence else []),
        letters.Button("View your booking", _bookings_url()),
        _change_line(),
    ], letters.SOON)


def billing_wording() -> str:
    from app.services.billing import BOOKING_WORDING
    return BOOKING_WORDING.replace("You'll pay for your items now.", "You've paid for your items.")


def dropoff_confirmed(db: Session, order: Order, b: Booking, returns: list[Booking]) -> None:
    """"Your drop-off is booked: {name}, {day_date}, {hours}. Label each bag with its code…" (spec §7)."""
    from app.services import bookings, delivery
    loc = b.atelier
    collected = bookings.collected_by(db, b)
    ready = delivery.earliest_return(db, collected)
    day = f"{b.starts_at:%A} {b.starts_at.day} {b.starts_at:%B}"
    hours = f"{_time(b.starts_at)} to {_time(b.ends_at)}"
    codes = ", ".join(b.bag_codes)
    rows = [("Atelier", loc.name), ("Address", loc.address + (f", {loc.postcode}" if loc.postcode else "")),
            ("Drop off", f"{day}, {hours}"), ("Bag labels", codes)]
    rows += [("Return", _window(r)) for r in returns] or [("Return", "We'll arrange it with you")]
    rows += [("Collection and delivery", delivery.charge_text(order)), ("Booking reference", order.ref)]
    letters.send(order.client.email, "Your LAVE drop-off is booked", order.client.first_name, [
        f"Your drop-off is booked: {loc.name}, {day}, {hours}. Label each bag with its code: {codes}. We'll treat your "
        f"items as collected {bookings.when_text(collected)} and can return them from {bookings.when_text(ready)}.",
        letters.Table(rows),
        *([loc.access_instructions] if loc.access_instructions else []),
        *([delivery.LONGER_NOTE] if order.return_preference else []),
        letters.Button("View your booking", _bookings_url()),
        "Need to change the location, day or number of bags? You can do it until we check your bags in: simply reply "
        "to this email.",
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


def driver_on_the_way(db: Session, b: Booking) -> str | None:
    """"Your driver is on the way": by text when we have a mobile number and texts are set up, otherwise (or if the
    text fails) by email. Once per visit. Returns how it went ("text" or "email"), or None if nothing was sent."""
    from app.services import sms
    from app.services import orders as order_svc
    if b.mode != BookingMode.lave_collects or b.atelier_id:
        return None
    claimed = db.execute(update(Booking).where(Booking.id == b.id, Booking.on_the_way_sent_at.is_(None))
                         .values(on_the_way_sent_at=local_now())).rowcount
    db.commit()
    if claimed != 1:
        return None
    collecting = b.kind == BookingKind.collection
    window = f"{_time(b.starts_at)} to {_time(b.ends_at)}"
    ref = b.order.ref if b.order else b.ref
    text = (f"LAVE: your driver is on the way {'to collect your pieces' if collecting else 'with your pieces'}, due "
            f"{window} today. Booking {ref}. Questions? Call {letters.PHONE}.")
    how = None
    if sms.send(b.client.phone, text):
        how = "text"
    elif b.client.email:
        letters.send(b.client.email, "Your LAVE driver is on the way", b.client.first_name, [
            f"Your driver is on the way {'to collect your pieces' if collecting else 'with your pieces'}, and will be with "
            f"you between {window} today.",
            letters.Table([("Collection" if collecting else "Delivery", when(b)), ("Address", place(b)),
                           ("Booking reference", ref)]),
            "Please have your pieces ready in a bag." if collecting else "Please make sure someone is in to receive them.",
            f"If anything has changed, call us on {letters.PHONE} or simply reply to this email.",
        ])
        how = "email"
    if how and b.order:
        order_svc.log(db, b.order, "on_the_way", f"Driver on the way ({how} sent)")
        db.commit()
    return how


def welcome_member(client, plan: str) -> None:
    """A new member: welcome, and an invitation to "Tell us about you"."""
    from app.plans import NAMES
    if not client.email:
        return
    letters.send(client.email, f"Welcome to LAVE {NAMES.get(plan, 'membership')}", client.first_name, [
        f"How lovely to welcome you as a LAVE {NAMES.get(plan, '')} member.".replace("  ", " "),
        "To make your membership yours, tell us a little about you: your birthday, how you like us to be in touch, "
        "the pieces that matter most and anything you're preparing for. Every answer is optional, and you can change "
        "or delete them at any time.",
        letters.Button("Tell us about you", f"{get_settings().site_url}/account/about/"),
    ], letters.SOON)


def items_counted(order: Order) -> None:
    """Once the atelier has counted an order (marked inspected), tell the client how many pieces arrived."""
    if not order.client.email or not order.items:
        return
    n = len(order.items)
    letters.send(order.client.email, f"We've counted your LAVE order {order.ref}", order.client.first_name, [
        f"Your pieces have arrived safely at the atelier. We've counted {n} item{'s' if n != 1 else ''} in order "
        f"{order.ref}, and each one is tagged and recorded.",
        "You can see every piece, and the price before we charge, in your account.",
        letters.Button("View your order", f"{get_settings().site_url}/account/orders/"),
        "If anything doesn't look right, simply reply to this email.",
    ])


def _reminder(b: Booking) -> None:
    to_door = b.mode == BookingMode.lave_collects
    if b.atelier_id:
        letters.send(b.client.email, "Your LAVE drop-off is tomorrow", b.client.first_name, [
            f"A gentle reminder of your drop-off at {b.atelier.name} tomorrow.",
            letters.Table([("Drop off", when(b)), ("Address", place(b)), ("Bag labels", ", ".join(b.bag_codes))]),
            *([b.atelier.access_instructions] if b.atelier.access_instructions else []),
            "Please label each bag with its code.",
            letters.Button("View your booking", _bookings_url()),
            f"If you need to change anything, simply reply to this email or call us on {letters.PHONE}.",
        ])
        return
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
    """Runs in the background while the website is up: booking reminders, and once a day the bank holidays."""
    from app.db import SessionLocal
    from app.services import delivery
    holidays_checked = None
    while True:
        try:
            with SessionLocal() as db:
                if sent := send_reminders(db):
                    log.info("Sent %d booking reminders", sent)
                from app.services import billing
                billing.sweep_unfinished(db)  # bookings whose card check was abandoned release their slots
                if holidays_checked != local_now().date():
                    holidays_checked = local_now().date()
                    from app.services import members
                    members.celebrate(db)  # members' birthdays: suggestions, reminders, and approved gestures on the day
                    delivery.refresh_bank_holidays(db)  # gov.uk; the bundled list stays if it can't be reached
        except Exception:  # never let one bad night stop the reminders for good
            log.exception("Booking reminders or bank holiday refresh failed")
        time.sleep(CHECK_EVERY)
