"""Clients' data rights (UK GDPR): download everything we hold about you, ask us to delete your account, and the
admin-only delete itself.

Deleting keeps the business records the law asks us to keep (orders, payments and credit, for HMRC) but removes
everything that identifies the person: name, email, phone, addresses, notes, About you, Wardrobe, occasions and
waitlist entries. Orders stay, attached to a "Deleted client".
"""
import logging

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import (AreaWaitlistEntry, Booking, Client, ClientGesture, ClientOccasion, ContactMessage, Garment,
                        LoginToken, Membership, MembershipStatus, Order, OrderStatus, ShopOrder, VaultItem, VaultStatus,
                        WaitlistEntry, WardrobeItem)
from app.services.clock import local_now

log = logging.getLogger("lave.privacy")


def _iso(v) -> str | None:
    return v.isoformat() if v else None


def export(db: Session, client: Client) -> dict:
    """Everything LAVE holds about this client, as one JSON document."""
    from app import serializers as ser
    from app.services import billing, members
    orders = db.scalars(select(Order).where(Order.client_id == client.id).order_by(Order.created_at)).all()
    shop = db.scalars(select(ShopOrder).where((ShopOrder.client_id == client.id) | (ShopOrder.email == client.email))).all()
    vault = db.scalars(select(VaultItem).where(VaultItem.client_id == client.id)).all()
    wardrobe = db.scalars(select(WardrobeItem).where(WardrobeItem.client_id == client.id)).all()
    occasions = db.scalars(select(ClientOccasion).where(ClientOccasion.client_id == client.id)).all()
    area_wait = db.scalars(select(AreaWaitlistEntry).where(AreaWaitlistEntry.email == client.email)).all()
    shop_wait = db.scalars(select(WaitlistEntry).where(WaitlistEntry.email == client.email)).all()
    messages = db.scalars(select(ContactMessage).where(ContactMessage.email == client.email)).all()
    m = client.membership
    return {
        "exported_at": local_now().isoformat(),
        "about_this_file": "Everything LAVE holds about you. Questions: " + get_settings().contact_address,
        "profile": {"first_name": client.first_name, "last_name": client.last_name, "email": client.email,
                    "phone": client.phone, "care_preferences": client.preferences or {},
                    "account_created": _iso(client.created_at), "email_confirmed": _iso(client.email_verified_at),
                    "card_saved_with_stripe": client.has_card_on_file},
        "about_you": {**members.about(db, client), "occasions": [{"day": _iso(o.day), "title": o.title, "note": o.note} for o in occasions]},
        "addresses": [ser.address(a) for a in client.addresses],
        "membership": {"plan": m.plan.value, "status": m.status.value, "since": _iso(m.created_at)} if m else None,
        "orders": [{**ser.order(o, detail=True), "payments": [{"kind": p.kind, "amount_pence": p.amount_pence, "status": p.status,
                                                                "at": _iso(p.created_at)} for p in o.payments]} for o in orders],
        "vault": [ser.vault_item(v) for v in vault],
        "wardrobe": [{"name": w.name, "colour": w.colour, "brand": w.brand, "fibre": w.fibre, "hidden": w.hidden} for w in wardrobe],
        "lave_account_credit": {"balance_pence": billing.credit_balance(db, client), "history": billing.credit_history(db, client)},
        "apothecary_orders": [{"ref": s.ref, "status": s.status.value, "total_pence": s.total_pence, "at": _iso(s.created_at),
                               "shipping_address": s.shipping_address} for s in shop],
        "waitlists": [{"list": "Service area", "postcode": w.postcode, "at": _iso(w.created_at)} for w in area_wait]
                     + [{"list": "Apothecary", "at": _iso(w.created_at)} for w in shop_wait],
        "messages_to_us": [{"topic": x.topic, "message": x.message, "at": _iso(x.created_at)} for x in messages],
    }


def request_deletion(db: Session, client: Client) -> None:
    """The client asks us to delete their account: noted, the founder is told, and the client gets a reply."""
    from app.services import letters, mailer
    if not client.deletion_requested_at:
        client.deletion_requested_at = local_now()
        db.commit()
    s = get_settings()
    mailer.send(s.contact_address, f"Account deletion request: {client.full_name}",
                f"{client.full_name} ({client.email}) has asked us to delete their LAVE account.\n\n"
                f"Review it in the admin: {s.site_url}/admin#/clients/{client.id}\n\n"
                "UK GDPR gives us one month to respond.")
    if client.email:
        letters.send(client.email, "We've received your request to delete your LAVE account", client.first_name, [
            "We've received your request to delete your LAVE account, and we'll take care of it within one month.",
            "If you have pieces with us, in the Vault or on their way back, or credit on your account, we'll be in touch "
            "first so nothing of yours is lost. We keep the records of past orders and payments that the law requires "
            "(for tax), without your name or contact details.",
            "Changed your mind? Simply reply to this email.",
        ])


def blockers(db: Session, client: Client) -> list[str]:
    """Why this client can't be deleted yet: pieces or money still with us."""
    from app.services import billing
    out = []
    open_orders = db.scalars(select(Order.ref).where(Order.client_id == client.id,
                                                     Order.status.not_in([OrderStatus.delivered, OrderStatus.cancelled]))).all()
    if open_orders:
        out.append(f"Open orders: {', '.join(open_orders)}")
    stored = db.scalar(select(VaultItem.id).where(VaultItem.client_id == client.id, VaultItem.status != VaultStatus.retrieved).limit(1))
    if stored:
        out.append("Pieces in the Vault")
    if (credit := billing.credit_balance(db, client)) > 0:
        out.append(f"£{credit / 100:.2f} of account credit (refund it first)")
    m = client.membership
    if m and m.status not in (MembershipStatus.cancelled,):
        out.append("A membership that hasn't ended")
    return out


def erase(db: Session, client: Client, by: str) -> None:
    """Remove everything that identifies the client, keeping the order and payment records. Caller commits."""
    if client.deleted_at:
        raise HTTPException(409, "This client has already been deleted.")
    if problems := blockers(db, client):
        raise HTTPException(409, "Not yet: " + "; ".join(problems) + ".")
    email = client.email
    if client.stripe_customer_id and get_settings().stripe_enabled:
        try:  # removes their saved cards from Stripe too
            from app.services.payments import _stripe
            _stripe().v1.customers.delete(client.stripe_customer_id)
        except Exception:  # noqa: BLE001  (Stripe may already have forgotten them; the rest still goes ahead)
            log.warning("Couldn't delete the Stripe customer for client %s", client.id)
    for a in client.addresses:
        a.label, a.line1, a.line2, a.instructions, a.archived, a.is_default = "Removed", "Removed", "", "", True, False
        a.postcode = (a.postcode or "").split(" ")[0]  # the district only, for area statistics
    for o in db.scalars(select(Order).where(Order.client_id == client.id)):
        o.client_notes, o.staff_notes, o.call_notes = "", "", ""
    for b in db.scalars(select(Booking).where(Booking.client_id == client.id)):
        b.notes = ""
    wardrobe_ids = db.scalars(select(WardrobeItem.id).where(WardrobeItem.client_id == client.id)).all()
    if wardrobe_ids:
        for g in db.scalars(select(Garment).where(Garment.wardrobe_item_id.in_(wardrobe_ids))):
            g.wardrobe_item_id = None
    for model in (WardrobeItem, ClientOccasion, ClientGesture, LoginToken, Membership):
        db.execute(delete(model).where(model.client_id == client.id))
    for s in db.scalars(select(ShopOrder).where((ShopOrder.client_id == client.id) | (ShopOrder.email == email))):
        s.email, s.shipping_address = "", {}
    for model in (AreaWaitlistEntry, WaitlistEntry, ContactMessage):
        db.execute(delete(model).where(model.email == email))
    client.first_name, client.last_name = "Deleted", "client"
    client.email = f"deleted-{client.id}@deleted.invalid"
    client.phone, client.preferences, client.staff_notes, client.about = "", {}, "", {}
    client.birthday_day = client.birthday_month = client.about_completed_at = None
    client.password_hash = client.wp_user_id = client.stripe_customer_id = client.email_verified_at = None
    client.has_card_on_file = False
    client.deleted_at = local_now()
    log.info("Client %s deleted by %s", client.id, by)
