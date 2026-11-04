from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models import (
    BookingStatus,
    Garment,
    ItemStatus,
    Order,
    OrderEvent,
    OrderStatus,
    PaymentStatus,
    VaultItem,
)
from app.services.clock import local_now

S = OrderStatus

TRANSITIONS: dict[OrderStatus, set[OrderStatus]] = {
    S.awaiting_collection: {S.collected, S.cancelled},
    S.collected: {S.inspected, S.awaiting_customer_call, S.cancelled},
    S.awaiting_customer_call: {S.inspected, S.cancelled},
    S.inspected: {S.in_care, S.awaiting_customer_call},
    S.in_care: {S.quality_check},
    S.quality_check: {S.ready, S.in_care},
    S.ready: {S.out_for_delivery, S.delivered},
    S.out_for_delivery: {S.delivered, S.ready},
    S.delivered: set(),
    S.cancelled: set(),
}

# What the client sees on their timeline.
CLIENT_LABELS: dict[str, str] = {
    "awaiting_collection": "Booked",
    "collected": "Collected",
    "awaiting_customer_call": "We'll call you",
    "inspected": "Inspected and itemised",
    "in_care": "In care",
    "quality_check": "Final quality check",
    "ready": "Ready",
    "out_for_delivery": "Out for delivery",
    "delivered": "Delivered",
    "cancelled": "Cancelled",
}

# Order stages that move every active garment along with them.
ITEM_FOLLOWS: dict[OrderStatus, ItemStatus] = {
    S.inspected: ItemStatus.inspected,
    S.in_care: ItemStatus.in_care,
    S.quality_check: ItemStatus.quality_check,
    S.ready: ItemStatus.ready,
    S.delivered: ItemStatus.returned,
}

NEEDS_PAYMENT = {S.out_for_delivery, S.delivered}


def log(db: Session, order: Order, status_: str, note: str = "", staff_id: int | None = None,
        garment_id: int | None = None, visible: bool = True) -> None:
    db.add(OrderEvent(order_id=order.id, garment_id=garment_id, status=status_, note=note,
                      staff_id=staff_id, visible_to_client=visible, at=local_now()))


def next_tag_code(order: Order) -> str:
    used = {g.tag_code for g in order.items}
    n = len(order.items) + 1
    while (code := f"{order.ref}-{n:02d}") in used:
        n += 1
    return code


def move_to_vault(db: Session, order: Order, garment: Garment) -> VaultItem:
    item = VaultItem(
        client_id=order.client_id,
        garment_id=garment.id,
        tag_code=garment.tag_code,
        description=" ".join(p for p in [garment.colour, garment.brand, garment.description] if p),
        stored_at=local_now(),
    )
    garment.status = ItemStatus.in_vault
    db.add(item)
    return item


def advance(db: Session, order: Order, target: OrderStatus, staff_id: int | None, note: str = "") -> Order:
    if target not in TRANSITIONS[order.status]:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"An order that is {CLIENT_LABELS[order.status.value].lower()} can't move to {CLIENT_LABELS[target.value].lower()}.",
        )
    if target == S.inspected and not order.items:
        raise HTTPException(status.HTTP_409_CONFLICT, "Add the garments before marking the order inspected.")
    if target in NEEDS_PAYMENT and order.payment_status not in (PaymentStatus.paid, PaymentStatus.waived):
        # Items all going to the Vault still need paying for; nothing leaves unpaid.
        raise HTTPException(status.HTTP_409_CONFLICT, "Take payment (or waive it) before this order leaves the atelier.")

    order.status = target
    if item_status := ITEM_FOLLOWS.get(target):
        for g in order.items:
            if g.status == ItemStatus.in_vault:
                continue
            if target == S.ready and g.send_to_vault:
                move_to_vault(db, order, g)
            else:
                g.status = item_status

    if target == S.collected:
        _complete_booking(order, "collection")
    if target == S.delivered:
        _complete_booking(order, "delivery")
    if target == S.cancelled:
        for b in order.bookings:
            if b.status == BookingStatus.scheduled:
                b.status = BookingStatus.cancelled

    log(db, order, target.value, note, staff_id)
    return order


def _complete_booking(order: Order, kind: str) -> None:
    for b in order.bookings:
        if b.kind.value == kind and b.status in (BookingStatus.scheduled, BookingStatus.en_route):
            b.status = BookingStatus.completed


def delete_blockers(db: Session, order: Order) -> list[str]:
    """Why an order can't be deleted: money changed hands (the record must stay for the accounts), or pieces are in
    the Vault. A mistaken or test order with neither can go completely."""
    from sqlalchemy import func, select
    from app.models import ClientCredit
    out = []
    if order.payment_status in (PaymentStatus.paid, PaymentStatus.refunded) or any(
            p.status in ("succeeded", "pending") for p in order.payments):
        out.append("Money has been taken for it. Keep it for your accounts, and refund it if it was a mistake")
    if order.credit_used_pence or order.credited_pence or db.scalar(
            select(func.count()).select_from(ClientCredit).where(ClientCredit.order_id == order.id)):
        out.append("LAVE account credit was used or given on it")
    garment_ids = [g.id for g in order.items]
    if garment_ids and db.scalar(select(func.count()).select_from(VaultItem).where(VaultItem.garment_id.in_(garment_ids))):
        out.append("Some of its pieces are in the Vault")
    return out


def deletion_summary(order: Order) -> str:
    """One line on what the order was, e.g. "Cancelled, payment waived. 1 garment: Blouse (Blouse, press only) £9.99.
    No bookings (walk-in)." Garments and services only: no names or addresses."""
    def money(p):
        return f"£{p / 100:.2f}"
    parts = [f"{order.status.value.replace('_', ' ').capitalize()}, payment {order.payment_status.value}."]
    if order.items:
        pieces = "; ".join(f"{g.description}{f' ({g.service.name})' if g.service else ''} {money(g.price_pence)}"
                           for g in order.items)
        parts.append(f"{len(order.items)} garment{'s' if len(order.items) != 1 else ''}: {pieces}.")
    else:
        parts.append("No garments.")
    if order.bookings:
        parts.append("Bookings: " + "; ".join(f"{b.kind.value} {b.starts_at.day} {b.starts_at:%b %Y} ({b.status.value})"
                                             for b in order.bookings) + ".")
    else:
        parts.append("No bookings (walk-in).")
    return " ".join(parts)


def delete(db: Session, order: Order, by: str, reason: str) -> None:
    """Remove an order completely: its garments, bookings, history, and Wardrobe pieces that came only from it,
    keeping a short DeletedOrder record. Caller checks delete_blockers first, and commits."""
    from sqlalchemy import func, select, update
    from app.models import Booking, DeletedOrder, WardrobeItem
    db.add(DeletedOrder(ref=order.ref, client_id=order.client_id, summary=deletion_summary(order),
                        total_pence=order.total_pence, order_created_at=order.created_at, reason=reason.strip()[:300],
                        deleted_by=by, deleted_at=local_now()))
    wardrobe_ids = {g.wardrobe_item_id for g in order.items if g.wardrobe_item_id}
    booking_ids = [b.id for b in order.bookings]
    if booking_ids:
        db.execute(update(VaultItem).where(VaultItem.retrieval_booking_id.in_(booking_ids)).values(retrieval_booking_id=None))
        for b in db.scalars(select(Booking).where(Booking.id.in_(booking_ids))):
            db.delete(b)
    db.delete(order)
    db.flush()
    for item_id in wardrobe_ids:
        if not db.scalar(select(func.count()).select_from(Garment).where(Garment.wardrobe_item_id == item_id)):
            db.delete(db.get(WardrobeItem, item_id))
