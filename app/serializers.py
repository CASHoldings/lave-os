from app.models import (
    Address,
    Booking,
    Client,
    Garment,
    Membership,
    Order,
    Service,
    SlotTemplate,
    StaffUser,
    VaultItem,
)
from app.services.orders import CLIENT_LABELS
from app.services.slots import Slot

from app.site.store import plan_name  # noqa: E402
# Monthly prices as listed on lavelondon.com/atelier. Stripe holds the billing truth; these are for display.



def iso(dt):
    return dt.isoformat() if dt else None


def address(a: Address) -> dict:
    return {
        "id": a.id, "label": a.label, "line1": a.line1, "line2": a.line2, "city": a.city,
        "postcode": a.postcode, "instructions": a.instructions, "is_default": a.is_default,
        "one_line": a.one_line(),
    }


def membership(m: Membership | None) -> dict | None:
    if not m:
        return None
    return {"plan": m.plan.value, "plan_name": plan_name(m.plan.value), "status": m.status.value,
            "current_period_end": iso(m.current_period_end)}


def client(c: Client, staff_view: bool = False) -> dict:
    out = {
        "id": c.id, "email": c.email, "first_name": c.first_name, "last_name": c.last_name,
        "full_name": c.full_name, "phone": c.phone, "preferences": c.preferences or {},
        "has_card_on_file": c.has_card_on_file,
        "addresses": [address(a) for a in c.addresses if not a.archived],
        "membership": membership(c.membership),
    }
    if staff_view:
        out.update(staff_notes=c.staff_notes, wp_user_id=c.wp_user_id, stripe_customer_id=c.stripe_customer_id,
                   created_at=iso(c.created_at))
    return out


def slot(s: Slot) -> dict:
    return {"template_id": s.template_id, "day": s.day.isoformat(), "starts_at": iso(s.starts_at),
            "ends_at": iso(s.ends_at), "window_type": s.window_type.value, "mode": s.mode.value,
            "fee_pence": s.fee_pence, "remaining": s.remaining, "available": s.remaining > 0}


def booking(b: Booking, staff_view: bool = False) -> dict:
    out = {
        "id": b.id, "ref": b.ref, "kind": b.kind.value, "mode": b.mode.value, "window_type": b.window_type.value,
        "starts_at": iso(b.starts_at), "ends_at": iso(b.ends_at), "fee_pence": b.fee_pence,
        "status": b.status.value, "address": address(b.address) if b.address else None,
        "order_ref": b.order.ref if b.order else None, "order_id": b.order_id,
    }
    if staff_view:
        out.update(client={"id": b.client.id, "name": b.client.full_name, "phone": b.client.phone},
                   driver={"id": b.driver.id, "name": b.driver.name} if b.driver else None, notes=b.notes)
    return out


def service(s: Service) -> dict:
    return {"id": s.id, "code": s.code, "name": s.name, "category": s.category.value, "unit": s.unit,
            "price_pence": s.price_pence, "active": s.active, "show_online": s.show_online, "slug": s.slug,
            "image": s.image, "summary": s.summary, "collections": s.collections or [], "review_note": s.review_note}


def garment(g: Garment) -> dict:
    return {
        "id": g.id, "tag_code": g.tag_code, "description": g.description, "brand": g.brand, "colour": g.colour,
        "fibre": g.fibre, "condition_notes": g.condition_notes, "price_pence": g.price_pence,
        "status": g.status.value, "send_to_vault": g.send_to_vault,
        "service": service(g.service) if g.service else None,
    }


def order(o: Order, staff_view: bool = False, detail: bool = False) -> dict:
    out = {
        "id": o.id, "ref": o.ref, "status": o.status.value, "status_label": CLIENT_LABELS[o.status.value],
        "created_at": iso(o.created_at), "item_count": len(o.items),
        "items_total_pence": o.items_total_pence, "fees_pence": o.fees_pence, "discount_pence": o.discount_pence,
        "total_pence": o.total_pence, "payment_status": o.payment_status.value,
        "requested_services": o.requested_services or [], "client_notes": o.client_notes,
        "bookings": [booking(b, staff_view) for b in o.bookings],
    }
    if detail:
        out["items"] = [garment(g) for g in o.items]
        out["timeline"] = [
            {"status": e.status, "label": CLIENT_LABELS.get(e.status, e.status.replace("_", " ").capitalize()),
             "note": e.note, "at": iso(e.at), "garment_id": e.garment_id}
            for e in o.events if staff_view or e.visible_to_client
        ]
    if staff_view:
        out.update(client={"id": o.client.id, "name": o.client.full_name, "email": o.client.email,
                           "has_card_on_file": o.client.has_card_on_file},
                   staff_notes=o.staff_notes, paid_at=iso(o.paid_at))
    return out


def vault_item(v: VaultItem, staff_view: bool = False) -> dict:
    out = {"id": v.id, "tag_code": v.tag_code, "description": v.description, "season": v.season,
           "status": v.status.value, "stored_at": iso(v.stored_at), "retrieved_at": iso(v.retrieved_at),
           "retrieval": booking(v.retrieval_booking) if v.retrieval_booking else None}
    if staff_view:
        out.update(location=v.location, client={"id": v.client.id, "name": v.client.full_name})
    return out


def template(t: SlotTemplate) -> dict:
    return {"id": t.id, "weekday": t.weekday, "start": t.start.strftime("%H:%M"), "end": t.end.strftime("%H:%M"),
            "window_type": t.window_type.value, "mode": t.mode.value, "capacity": t.capacity,
            "fee_pence": t.fee_pence, "active": t.active}


def staff(s: StaffUser) -> dict:
    return {"id": s.id, "email": s.email, "name": s.name, "role": s.role.value, "active": s.active}
