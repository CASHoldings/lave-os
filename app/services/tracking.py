"""Following each piece through the atelier: QR tags, stage scans, arrival photos and turnaround.

Every tag carries a QR code for lavelondon.com/t/<tag>, which a phone's camera opens in the admin. Each scan moves
the piece to its next stage (in care, quality check, ready) and is time-stamped, so the admin can show how long
each stage takes and which pieces are waiting longest. The order follows its pieces: it goes into care with the
first piece, and to quality check once every piece is there. Marking it ready stays a deliberate step, because
that tells the client.
"""
import secrets
from datetime import datetime, timedelta
from statistics import median

import segno
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Garment, GarmentPhoto, ItemStatus, Order, OrderEvent, OrderStatus
from app.services import media, storage
from app.services import orders as order_svc
from app.services.clock import local_now

Item = ItemStatus
# The stages staff move a piece through by scanning it, after the order has been inspected and priced.
STAGES = [Item.received, Item.inspected, Item.in_care, Item.quality_check, Item.ready]
LABELS = {Item.received: "Received", Item.inspected: "Inspected", Item.in_care: "In care", Item.quality_check: "Quality check",
          Item.ready: "Ready", Item.returned: "Returned", Item.in_vault: "In the Vault"}
SCANNABLE = {Item.inspected: Item.in_care, Item.in_care: Item.quality_check, Item.quality_check: Item.ready}
# The order stage that sets each piece stage, for pieces moved with their whole order rather than scanned.
ORDER_STAGE = {Item.inspected: "inspected", Item.in_care: "in_care", Item.quality_check: "quality_check", Item.ready: "ready",
               Item.returned: "delivered"}
STUCK_HOURS = 24  # half the 48-hour promise
PHOTO_WIDTH = 1600
MAX_PHOTO = 20 * 1024 * 1024


def tag_url(code: str) -> str:
    return f"{get_settings().site_url}/t/{code}"


def qr_svg(code: str) -> str:
    """The QR code for a tag, as SVG that scales to whatever size the label gives it."""
    return segno.make(tag_url(code), error="m").svg_inline(scale=1, border=0, omitsize=True, dark="#192033")


# Moving a piece on

def next_stage(g: Garment) -> ItemStatus | None:
    return SCANNABLE.get(g.status)


def previous_stage(g: Garment) -> ItemStatus | None:
    back = {v: k for k, v in SCANNABLE.items()}
    return back.get(g.status)


def move(db: Session, g: Garment, to: ItemStatus, staff_id: int | None, by: str = "") -> None:
    """One step forward (a scan) or one step back (undo, or back to care). Caller commits."""
    o = g.order
    if g.status == Item.received:
        raise HTTPException(409, "Inspect and price the order before its pieces go into care.")
    if to not in (next_stage(g), previous_stage(g)):
        raise HTTPException(409, f"{g.tag_code} is {LABELS[g.status].lower()}: it can't move to {LABELS.get(to, to).lower()}.")
    if o.status in (OrderStatus.awaiting_customer_call, OrderStatus.cancelled, OrderStatus.delivered,
                    OrderStatus.out_for_delivery):
        raise HTTPException(409, f"Order {o.ref} is {order_svc.CLIENT_LABELS[o.status.value].lower()}, so its pieces can't move.")
    g.status = to
    order_svc.log(db, o, f"item_{to.value}", f"{g.tag_code} {LABELS[to].lower()}{f' ({by})' if by else ''}", staff_id,
                  garment_id=g.id, visible=False)
    _order_follows(db, o, staff_id)


def _order_follows(db: Session, o: Order, staff_id: int | None) -> None:
    active = [g for g in o.items if g.status not in (Item.in_vault, Item.returned)]
    if not active:
        return
    lowest = min(order_svc.ITEM_RANK[g.status] for g in active)
    if o.status == OrderStatus.inspected and any(g.status != Item.inspected for g in active):
        order_svc.advance(db, o, OrderStatus.in_care, staff_id, "First piece into care")
    if o.status == OrderStatus.in_care and lowest >= order_svc.ITEM_RANK[Item.quality_check]:
        order_svc.advance(db, o, OrderStatus.quality_check, staff_id, "Every piece at quality check")
    # A scan undone, or a piece sent back to care: the order steps back too, leaving the other pieces where they are.
    elif o.status == OrderStatus.quality_check and lowest < order_svc.ITEM_RANK[Item.quality_check]:
        o.status = OrderStatus.in_care
        order_svc.log(db, o, "in_care", "A piece went back to care", staff_id, visible=False)
    elif o.status == OrderStatus.in_care and all(g.status == Item.inspected for g in active):
        o.status = OrderStatus.inspected
        order_svc.log(db, o, "inspected", "Scan undone: no piece in care yet", staff_id, visible=False)


def order_can_be_marked_ready(o: Order) -> bool:
    active = [g for g in o.items if g.status not in (Item.in_vault, Item.returned)]
    return bool(active) and all(g.status == Item.ready for g in active) and o.status in (OrderStatus.in_care,
                                                                                      OrderStatus.quality_check)


def piece(db: Session, g: Garment) -> dict:
    """What the tag page shows: the piece, where it is, what's next, its photos and history."""
    from app import serializers as ser
    o = g.order
    stamps = stage_times(g, o.events)
    nxt, prev = next_stage(g), previous_stage(g)
    pieces = [x for x in o.items if x.status not in (Item.in_vault, Item.returned)]
    return {
        "garment": ser.garment(g),
        "order": {"id": o.id, "ref": o.ref, "status": o.status.value, "status_label": order_svc.CLIENT_LABELS[o.status.value],
                  "client_name": o.client.full_name, "pieces": len(o.items),
                  "ready_pieces": sum(1 for x in pieces if x.status == Item.ready), "number": o.items.index(g) + 1,
                  "can_mark_ready": order_can_be_marked_ready(o)},
        "stage": g.status.value, "stage_label": LABELS[g.status],
        "next": nxt.value if nxt else None, "next_label": LABELS[nxt] if nxt else None,
        "previous": prev.value if prev else None, "previous_label": LABELS[prev] if prev else None,
        # Times only up to where the piece is now (a scan undone leaves a later stage blank again).
        "stages": [{"key": st.value, "label": LABELS[st],
                    "at": stamps[st].isoformat() if st in stamps and order_svc.ITEM_RANK[st] <= order_svc.ITEM_RANK[g.status] else None}
                   for st in STAGES],
        "waiting_hours": round(hours_in_stage(g, stamps, o.events), 1) if g.status in SCANNABLE or g.status == Item.received else None,
        "history": [{"status": e.status, "note": e.note, "at": e.at.isoformat()} for e in o.events
                    if e.garment_id == g.id or (e.garment_id is None and e.status in ORDER_STAGE.values())],
    }


# Photos

def add_photo(db: Session, g: Garment, data: bytes, by: str, staff_id: int | None = None) -> GarmentPhoto:
    if len(data) > MAX_PHOTO:
        raise HTTPException(413, "That photo is too large (20 MB at most).")
    ext = media.sniff(data)
    if ext not in (".jpg", ".png", ".webp"):
        raise HTTPException(400, "Use a JPEG, PNG or WebP photo. (On an iPhone, the camera button sends JPEG.)")
    data = media.slim(data, ext, PHOTO_WIDTH)
    name = f"{storage.PRIVATE}{local_now():%Y%m}-{secrets.token_hex(8)}{ext}"
    storage.current().write(name, data)
    photo = GarmentPhoto(garment_id=g.id, name=name, taken_by=by[:120], created_at=local_now())
    db.add(photo)
    order_svc.log(db, g.order, "item_photo", f"{g.tag_code} photographed{f' ({by})' if by else ''}", staff_id,
                  garment_id=g.id, visible=False)
    db.flush()
    return photo


def photo_file(photo: GarmentPhoto):
    path = storage.current().path(photo.name)
    if not path:
        raise HTTPException(404, "Photo not found.")
    return path


# Turnaround

def stage_times(g: Garment, events: list[OrderEvent]) -> dict[ItemStatus, datetime]:
    """When the piece reached each stage: its own scan, else the order moving it along, else (received) when it
    was added to the order."""
    out: dict[ItemStatus, datetime] = {}
    if g.created_at:
        out[Item.received] = g.created_at
    for e in events:
        if e.garment_id == g.id and e.status == "item_added":
            out[Item.received] = e.at
    for st, order_status in ORDER_STAGE.items():
        own = [e.at for e in events if e.garment_id == g.id and e.status == f"item_{st.value}"]
        whole = [e.at for e in events if e.garment_id is None and e.status == order_status]
        if own or whole:
            out[st] = min(own + whole)
    return out


def hours_in_stage(g: Garment, stamps: dict[ItemStatus, datetime], events: list[OrderEvent],
                   now: datetime | None = None) -> float:
    """Since the piece last arrived at its stage (a piece sent back to care counts from then)."""
    own = [e.at for e in events if e.garment_id == g.id and e.status == f"item_{g.status.value}"]
    since = max(own) if own else stamps.get(g.status) or g.created_at or local_now()
    return ((now or local_now()) - since).total_seconds() / 3600


STEPS = [(Item.received, Item.inspected, "Arrival to inspection"), (Item.inspected, Item.in_care, "Inspection to care"),
         (Item.in_care, Item.quality_check, "Care"), (Item.quality_check, Item.ready, "Quality check"),
         (Item.ready, Item.returned, "Ready to returned")]


def turnaround(db: Session, days: int = 30) -> dict:
    """How long each stage takes (pieces from the last `days`), and every piece still in the atelier that has waited
    longest in its stage, however long ago it arrived."""
    now = local_now()
    since = now - timedelta(days=days)
    rows = db.scalars(select(Garment).join(Order).where(Garment.created_at >= since,
                                                        Order.status != OrderStatus.cancelled)).all()
    spans: dict[str, list[float]] = {label: [] for _, _, label in STEPS}
    whole: list[float] = []
    for g in rows:
        stamps = stage_times(g, g.order.events)
        for a, b, label in STEPS:
            if a in stamps and b in stamps and stamps[b] >= stamps[a]:
                spans[label].append((stamps[b] - stamps[a]).total_seconds() / 3600)
        if Item.received in stamps and Item.ready in stamps:
            whole.append((stamps[Item.ready] - stamps[Item.received]).total_seconds() / 3600)
    waiting = []
    in_atelier = db.scalars(select(Garment).join(Order).where(
        Garment.status.in_([Item.received, Item.inspected, Item.in_care, Item.quality_check]),
        Order.status.not_in([OrderStatus.cancelled, OrderStatus.delivered]))).all()
    for g in in_atelier:
        hours = hours_in_stage(g, stage_times(g, g.order.events), g.order.events, now)
        if hours >= STUCK_HOURS:
            waiting.append({"tag_code": g.tag_code, "description": g.description, "stage": LABELS[g.status],
                            "hours": round(hours, 1), "order_id": g.order_id, "order_ref": g.order.ref})

    def summary(values: list[float]) -> dict:
        return {"pieces": len(values), "average_hours": round(sum(values) / len(values), 1) if values else None,
                "median_hours": round(median(values), 1) if values else None}

    return {"days": days, "steps": [{"label": label, **summary(spans[label])} for _, _, label in STEPS],
            "arrival_to_ready": summary(whole), "stuck_after_hours": STUCK_HOURS,
            "waiting": sorted(waiting, key=lambda w: -w["hours"])[:20]}
