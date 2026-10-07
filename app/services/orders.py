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
    S.collected: {S.inspected, S.cancelled},
    S.inspected: {S.in_care},
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
