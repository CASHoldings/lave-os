"""Placing bookings: a home collection or an atelier drop-off, the return, and returns booked later.

The rules themselves live in delivery.py (charges, turnaround), area.py (service area) and ateliers.py (drop-off
locations); this module applies them in one place for the website and for staff.
"""
from datetime import date, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import (Address, Booking, BookingKind, BookingMode, BookingStatus, Client, Order, OrderStatus, SlotTemplate,
                        WindowType, AtelierLocation)
from app.services import area, ateliers, delivery
from app.services.slots import reserve_slot


def _in_zone(db: Session, address: Address | None, purpose: str) -> Address:
    if not address:
        raise HTTPException(400, f"Choose the address where we should {purpose} your items.")
    if not area.in_zone(db, address.postcode):
        raise HTTPException(409, f"{address.postcode} is not yet in our area, so we can't {purpose} there. "
                                 "Choose an address in SW11, Nine Elms or Battersea Power Station.")
    return address


def _home_template(db: Session, template_id: int) -> SlotTemplate:
    t = db.get(SlotTemplate, template_id)
    if not t or t.mode != BookingMode.lave_collects:
        raise HTTPException(400, "Choose a collection or return time from the calendar.")
    return t


def collected_by(db: Session, first_leg: Booking) -> datetime:
    """When the 48 hours start: the end of the collection window, or when a drop-off counts as collected."""
    if first_leg.atelier_id:
        return delivery.deemed_collection(db, first_leg.checked_in_at or first_leg.starts_at)
    return first_leg.ends_at


def place(db: Session, client: Client, *, address: Address | None, collection: tuple[int, date] | None = None,
          dropoff: tuple[int, date, int] | None = None, delivery_slot: tuple[int, date] | None = None,
          requested_items: list | None = None, estimate_pence: int | None = None, return_preference: str = "",
          enforce_minimum: bool = True, **order_fields) -> Order:
    """Create the order with its collection (or drop-off) and, if chosen, its return. Caller commits."""
    if bool(collection) == bool(dropoff):
        raise HTTPException(400, "Choose a collection time, or an atelier and day to drop off.")
    from app.services import repository as repo
    mode = "dropoff" if dropoff else "home"
    minimum, short = repo.booked_minimum(db, requested_items or [], mode)
    if short and enforce_minimum:  # staff booking by phone may go under; the minimum still applies at review
        raise HTTPException(409, repo.short_text(db, short, mode))
    level = delivery.member_level(client)
    longer = delivery.longer_items(db, requested_items or [])
    if not longer:
        return_preference = ""
    elif return_preference not in ("together", "split"):
        return_preference = "together"
    if delivery_slot and return_preference == "together":
        raise HTTPException(409, delivery.LONGER_NOTE + " Choose a split return to book the rest now, or we'll arrange "
                                 "one return when everything is ready.")

    order = Order(client_id=client.id, requested_items=requested_items or [], estimate_pence=estimate_pence,
                  return_preference=return_preference, minimum_pence=minimum,
                  delivery_basis={"level": level, "value_pence": estimate_pence or 0}, **order_fields)
    db.add(order)
    db.flush()

    if collection:
        _home_template(db, collection[0])
        _in_zone(db, address, "collect")
        first = reserve_slot(db, template_id=collection[0], day=collection[1], client_id=client.id,
                             kind=BookingKind.collection, address_id=address.id, order_id=order.id)
    else:
        atelier_id, day, bags = dropoff
        cfg = delivery.config(db)
        loc = db.get(AtelierLocation, atelier_id)
        if not cfg["dropoff_enabled"] or (loc and loc.members_only and not level):
            raise HTTPException(403, "Atelier drop-off is for LAVE members. Book a home collection instead.")
        loc = ateliers.check_open(db, loc, day)
        opens, closes = ateliers.hours_on(loc, day)
        first = Booking(client_id=client.id, order_id=order.id, kind=BookingKind.collection, mode=BookingMode.drop_off,
                        window_type=WindowType.saver, atelier_id=loc.id, bags=max(1, min(bags, 20)),
                        starts_at=datetime.combine(day, opens), ends_at=datetime.combine(day, closes), fee_pence=0)
        db.add(first)
        db.flush()

    if delivery_slot:
        book_return(db, order, delivery_slot, address, first_leg=first)
    db.refresh(order)
    delivery.recompute(db, order)
    return order


def book_return(db: Session, order: Order, slot: tuple[int, date], address: Address | None,
                first_leg: Booking | None = None) -> Booking:
    """Book a return (delivery) for an order: 48 hours or more after collection, to an address in the area.
    The order keeps a single collection & delivery charge. Caller commits."""
    if order.status in (OrderStatus.delivered, OrderStatus.cancelled):
        raise HTTPException(409, "This order has no return to book.")
    first_leg = first_leg or next((b for b in order.bookings if b.kind == BookingKind.collection), None)
    if not first_leg:
        raise HTTPException(409, "This order has no collection yet.")
    t = _home_template(db, slot[0])
    _in_zone(db, address, "deliver")
    not_before = delivery.earliest_return(db, collected_by(db, first_leg))
    if datetime.combine(slot[1], t.start) < not_before:
        raise HTTPException(409, f"Your items are ready from {when_text(not_before)}. Choose a return from then.")
    b = reserve_slot(db, template_id=slot[0], day=slot[1], client_id=order.client_id, kind=BookingKind.delivery,
                     address_id=address.id, order_id=order.id, not_before=not_before)
    db.flush()
    db.refresh(order)
    delivery.recompute(db, order)
    return b


def move_after(db: Session, b: Booking) -> datetime | None:
    """The earliest a return can move to: 48 hours after its collection. None for a collection."""
    if b.kind != BookingKind.delivery or not b.order:
        return None
    first = next((x for x in b.order.bookings if x.kind == BookingKind.collection and x.status != BookingStatus.cancelled), None)
    return delivery.earliest_return(db, collected_by(db, first)) if first else None


def move(db: Session, b: Booking, slot: tuple[int, date], by: str = "client") -> Booking:
    """Move a home collection or return to another time in the same kind of window (Saver or one-hour), so the charge
    doesn't change. A collection can't move so late that a booked return would come back too soon. Caller commits."""
    from app.config import get_settings
    from app.services.clock import local_now
    if b.status != BookingStatus.scheduled:
        raise HTTPException(409, "This visit can no longer be moved.")
    if b.atelier_id or b.mode != BookingMode.lave_collects:
        raise HTTPException(409, "To change a drop-off, simply reply to your confirmation email and we'll help.")
    if by == "client" and local_now() > b.starts_at - timedelta(minutes=get_settings().cancel_cutoff_minutes):
        raise HTTPException(409, "It's too close to the visit to change it online. Call us and we'll help.")
    t = _home_template(db, slot[0])
    if t.window_type != b.window_type:
        raise HTTPException(409, "Choose a time in the same kind of window. To change between Saver and one-hour, "
                                 "call us and we'll help.")
    not_before = move_after(db, b)
    if not_before and datetime.combine(slot[1], t.start) < not_before:
        raise HTTPException(409, f"Your items are ready from {when_text(not_before)}. Choose a return from then.")
    # Check the new time has room by reserving it, then move this visit there (keeping its reference).
    fresh = reserve_slot(db, template_id=slot[0], day=slot[1], client_id=b.client_id, kind=b.kind,
                         address_id=b.address_id, order_id=None, not_before=not_before)
    if b.kind == BookingKind.collection and b.order:
        ready = delivery.earliest_return(db, fresh.ends_at)
        clash = [r for r in b.order.bookings if r.kind == BookingKind.delivery and r.status == BookingStatus.scheduled
                 and r.starts_at < ready]
        if clash:
            db.delete(fresh)
            db.flush()
            raise HTTPException(409, f"Your return is booked for {when_text(clash[0].starts_at)}, which would be too "
                                     f"soon after this collection. Move your return to {when_text(ready)} or later first.")
    before = b.starts_at
    b.template_id, b.starts_at, b.ends_at = fresh.template_id, fresh.starts_at, fresh.ends_at
    b.reminded_at = b.on_the_way_sent_at = None
    db.delete(fresh)
    db.flush()
    if b.order:
        from app.services import orders as order_svc
        what = "Collection" if b.kind == BookingKind.collection else "Return"
        order_svc.log(db, b.order, "moved", f"{what} moved from {when_text(before)} to {when_text(b.starts_at)}"
                                            + ("" if by == "client" else f" (by {by})"))
    return b


def when_text(t: datetime) -> str:
    """Wednesday 28 October, 7am"""
    h = t.hour % 12 or 12
    clock = (f"{h}" if not t.minute else f"{h}:{t.minute:02d}") + ("am" if t.hour < 12 else "pm")
    return f"{t:%A} {t.day} {t:%B}, {clock}"


def ready_from_text(t: datetime) -> str:
    return f"Your items are ready from {when_text(t)}. Choose any time from then."
