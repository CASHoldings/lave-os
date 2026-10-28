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
    return (f"Need to change something? You can move or cancel from your account up to {hours} hours before your slot, "
            "or simply reply to this email and we'll help.")


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


def booking_moved(b: Booking) -> None:
    """A collection or return moved to another time."""
    if not b.client.email:
        return
    collecting = b.kind == BookingKind.collection
    ref = b.order.ref if b.order else b.ref
    letters.send(b.client.email, f"Your LAVE {'collection' if collecting else 'return'} has moved", b.client.first_name, [
        f"Your {'collection' if collecting else 'return'} has moved to a new time.",
        letters.Table([("Collection" if collecting else "Return", _window(b)), ("Address", place(b)), ("Booking reference", ref)]),
        "We'll send you a gentle reminder the evening before.",
        letters.Button("View your bookings", _bookings_url()),
        _change_line(),
    ], letters.SOON)


def order_cancelled(order: Order, reason: str) -> None:
    """A client cancelled before collection: confirm to them, and tell the founder what to refund by hand."""
    from app.services import mailer
    paid, credit = order.paid_pence, order.credit_used_pence
    s = get_settings()
    if paid or credit:
        mailer.send(s.contact_address, f"Booking cancelled: {order.ref}, refund {_pounds(paid)} by hand",
                    f"{order.client.full_name} ({order.client.email}, {order.client.phone or 'no phone'}) cancelled order "
                    f"{order.ref} before collection.\n\nReason: {reason or 'none given'}\n\n"
                    + (f"Refund {_pounds(paid)} to their card in Stripe within 5 working days (Cancellation policy).\n" if paid else "")
                    + (f"{_pounds(credit)} of account credit has gone back to their LAVE account automatically.\n" if credit else "")
                    + f"\nOrder: {s.site_url}/admin#/orders/{order.id}")
    if not order.client.email:
        return
    blocks = [f"Your collection for order {order.ref} is cancelled."]
    if paid:
        blocks.append(f"We'll be in touch about your refund of {_pounds(paid)}, which goes back to your card within "
                      "5 working days.")
    if credit:
        blocks.append(f"The {_pounds(credit)} of LAVE account credit you used is back in your account.")
    letters.send(order.client.email, f"Your LAVE booking {order.ref} is cancelled", order.client.first_name, [
        *blocks,
        letters.Button("Book again", f"{s.site_url}/book/"),
        "If you cancelled by mistake, or there's anything we could have done better, simply reply to this email.",
    ], letters.SOON)


def visit_missed(b: Booking, fee: int) -> None:
    """We couldn't complete a visit: ask them to choose a new time, and say whether a charge applies (Terms, 10)."""
    if not b.client.email:
        return
    collecting = b.kind == BookingKind.collection
    what = "collection" if collecting else "return"
    ref = b.order.ref if b.order else b.ref
    letters.send(b.client.email, f"We missed you: please rebook your LAVE {what}", b.client.first_name, [
        f"We called by for your {what} {when(b)}, but weren't able to complete it.",
        "Please choose a new time from your account. It only takes a moment.",
        letters.Button("Choose a new time", _bookings_url()),
        (f"As this is a further missed visit on order {ref}, a {_pounds(fee)} collection and delivery charge applies, "
         "as set out in our terms." if fee else
         f"Your first missed visit on order {ref} is rebooked free of charge. After that, each extra visit carries the "
         "collection and delivery charge."),
        f"If anything has changed, simply reply to this email or call us on {letters.PHONE}.",
    ])


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


def _claim(db: Session, order: Order, kind: str) -> bool:
    """Record that a one-off email went out for this order. False if it already had."""
    from app.models import OrderEvent
    from app.services import orders as order_svc
    if db.scalar(select(OrderEvent.id).where(OrderEvent.order_id == order.id, OrderEvent.status == kind).limit(1)):
        return False
    order_svc.log(db, order, kind, "", visible=False)
    db.commit()
    return True


def receipt(db: Session, order: Order) -> bool:
    """The receipt, once an order is settled after review. Once per order. Returns True if sent."""
    from app.models import PaymentStatus
    if order.payment_status != PaymentStatus.paid or not order.items or not order.client.email:
        return False
    if not _claim(db, order, "receipt_sent"):
        return False
    items = [(" ".join(x for x in (g.colour, g.brand, g.description) if x) or "Item", _pounds(g.price_pence)) for g in order.items]
    if order.minimum_top_up_pence:
        items.append((f"Minimum order {_pounds(order.minimum_pence)}", _pounds(order.minimum_top_up_pence)))
    from app.services import delivery
    items.append(("Collection and delivery", _pounds(order.fees_pence) if order.fees_pence else delivery.charge_text(order)))
    if order.discount_pence:
        items.append(("Discount", "−" + _pounds(order.discount_pence)))
    items.append(("Total", _pounds(order.total_pence)))
    paid = [("Paid at booking", sum(p.amount_pence for p in order.payments if p.kind == "booking" and p.status == "succeeded")),
            ("Paid after review", sum(p.amount_pence for p in order.payments if p.kind == "adjustment" and p.status == "succeeded")),
            ("LAVE account credit used", order.credit_used_pence),
            ("Credited to your LAVE account", -order.credited_pence)]
    rows = [(k, ("−" if v < 0 else "") + _pounds(abs(v))) for k, v in paid if v]
    rows.append(("Still to pay", _pounds(max(0, order.balance_pence))))
    paid_on = order.paid_at or local_now()
    letters.send(order.client.email, f"Your LAVE receipt: order {order.ref}", order.client.first_name, [
        f"Thank you. Here is your receipt for order {order.ref}, settled on {paid_on:%A} {paid_on.day} {paid_on:%B %Y}.",
        letters.Table(items),
        letters.Table(rows),
        *(["The difference has been added to your LAVE account and is used automatically on your next booking. If "
           "you'd rather have it back on your card, simply reply to this email."] if order.credited_pence else []),
        letters.Button("View your order", f"{get_settings().site_url}/account/orders/"),
        "LAVE isn't VAT-registered, so no VAT is charged. If anything doesn't look right, simply reply to this email.",
    ])
    return True


def send_receipts(db: Session, now: datetime | None = None) -> int:
    """Safety net for receipts: orders settled in the last two days (e.g. by a card payment confirmed later) that
    haven't had theirs."""
    from app.models import PaymentStatus
    now = now or local_now()
    due = db.scalars(select(Order).where(Order.payment_status == PaymentStatus.paid, Order.paid_at >= now - timedelta(days=2))).all()
    return sum(1 for o in due if receipt(db, o))


def order_ready(db: Session, order: Order) -> bool:
    """Your pieces are ready: when the return is, or how to book it. Once per order."""
    if not order.client.email or not _claim(db, order, "ready_sent"):
        return False
    returns = [b for b in order.bookings if b.kind == BookingKind.delivery and b.status == BookingStatus.scheduled]
    vaulted = sum(1 for g in order.items if g.send_to_vault)
    blocks = [f"Good news: your pieces from order {order.ref} are cleaned, finished and ready."]
    if returns:
        r = returns[0]
        blocks += [letters.Table([("Return", _window(r)), ("Address", place(r))]),
                   "We'll send you a gentle reminder the evening before."]
        button = letters.Button("View your booking", _bookings_url())
    else:
        blocks.append("Choose a time for us to bring them home: it takes a moment in your account.")
        button = letters.Button("Book your return", f"{get_settings().site_url}/account/orders/")
    if vaulted:
        blocks.append(f"As you asked, {vaulted} piece{'s are' if vaulted != 1 else ' is'} now resting in the LAVE Vault.")
    letters.send(order.client.email, "Your LAVE pieces are ready", order.client.first_name, [
        *blocks, button, f"If you'd like to change anything, simply reply to this email or call us on {letters.PHONE}.",
    ])
    return True


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
                send_receipts(db)  # orders settled by a card payment confirmed after the review
                if holidays_checked != local_now().date():
                    holidays_checked = local_now().date()
                    from app.services import members
                    members.celebrate(db)  # members' birthdays: suggestions, reminders, and approved gestures on the day
                    delivery.refresh_bank_holidays(db)  # gov.uk; the bundled list stays if it can't be reached
                from app.services import backups
                backups.run(db)  # weekly dated copy of the photos, if a backup bucket is set
        except Exception as exc:  # never let one bad night stop the reminders for good
            log.exception("Booking reminders or bank holiday refresh failed")
            from app.services import alerts
            alerts.report("Background job failed", f"Reminders, receipts, birthdays or bank holidays: {exc!r}")
        time.sleep(CHECK_EVERY)
