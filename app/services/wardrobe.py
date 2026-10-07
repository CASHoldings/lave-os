"""The client's Wardrobe: every piece LAVE has cared for, so the same care can be booked again."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Client, Garment, ItemStatus, Order, OrderStatus, WardrobeItem
from app.site.catalogue import image_url

DONE = {ItemStatus.ready, ItemStatus.returned, ItemStatus.in_vault}


def link_garment(db: Session, order: Order, garment: Garment, wardrobe_item_id: int | None = None) -> WardrobeItem:
    """Attach a newly itemised garment to the client's Wardrobe, creating the piece if it's new."""
    item = db.get(WardrobeItem, wardrobe_item_id) if wardrobe_item_id else None
    if item is None or item.client_id != order.client_id:
        item = WardrobeItem(client_id=order.client_id, name=garment.description, colour=garment.colour,
                            brand=garment.brand, fibre=garment.fibre, service_id=garment.service_id)
        db.add(item)
        db.flush()
    else:
        # Keep the piece's details current with what staff recorded this time.
        for field in ("colour", "brand", "fibre"):
            if getattr(garment, field):
                setattr(item, field, getattr(garment, field))
        if garment.service_id:
            item.service_id = garment.service_id
        item.hidden = False
    garment.wardrobe_item_id = item.id
    return item


def backfill(db: Session) -> int:
    """Create Wardrobe pieces for garments itemised before the Wardrobe existed."""
    n = 0
    for g in db.scalars(select(Garment).where(Garment.wardrobe_item_id.is_(None))):
        link_garment(db, g.order, g)
        n += 1
    db.commit()
    return n


def describe(item: WardrobeItem) -> dict:
    garments = item.garments
    done = [g for g in garments if g.status in DONE or g.order.status == OrderStatus.delivered]
    in_atelier = any(g.status not in DONE and g.order.status not in (OrderStatus.delivered, OrderStatus.cancelled)
                     for g in garments)
    last = max((g.updated_at for g in done), default=None)
    svc = item.service
    return {
        "id": item.id, "name": item.name, "colour": item.colour, "brand": item.brand, "fibre": item.fibre,
        "title": " ".join(p for p in [item.colour, item.brand, item.name] if p),
        "service": {"id": svc.id, "name": svc.title, "price_pence": svc.price_pence} if svc else None,
        "image": image_url(svc) if svc else "",
        "times_cleaned": len(done), "last_cleaned": last.isoformat() if last else None,
        "in_atelier": in_atelier, "in_vault": any(g.status == ItemStatus.in_vault for g in garments),
        "hidden": item.hidden,
    }


def for_client(db: Session, client: Client, include_hidden: bool = False) -> list[dict]:
    q = select(WardrobeItem).where(WardrobeItem.client_id == client.id)
    if not include_hidden:
        q = q.where(WardrobeItem.hidden.is_(False))
    items = [describe(i) for i in db.scalars(q.order_by(WardrobeItem.updated_at.desc()))]
    return [i for i in items if i["times_cleaned"] or i["in_atelier"]]


def owned(db: Session, client_id: int, ids: list[int]) -> list[WardrobeItem]:
    if not ids:
        return []
    return list(db.scalars(select(WardrobeItem).where(WardrobeItem.id.in_(ids), WardrobeItem.client_id == client_id)))
