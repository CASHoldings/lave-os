"""Endpoints for signed-in clients, called by the embeds on the WordPress site."""
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import serializers as ser
from app.auth import current_client
from app.config import get_settings
from app.db import get_db
from app.models import (
    Address,
    Booking,
    BookingKind,
    BookingStatus,
    Client,
    Order,
    OrderStatus,
    VaultItem,
    VaultStatus,
)
from app.schemas import (
    AddressIn,
    AddressPatch,
    BookingRequest,
    CardSaved,
    MembershipCheckout,
    ProfileUpdate,
    ReturnUrl,
    VaultRetrieval,
    WardrobePatch,
)
from app.services import orders as order_svc
from app.services import payments
from app.services import wardrobe as wardrobe_svc
from app.services.clock import local_now
from app.services.slots import reserve_slot

router = APIRouter(prefix="/api/me", tags=["client"])


@router.get("")
def me(client: Client = Depends(current_client)):
    return ser.client(client)


@router.patch("")
def update_me(body: ProfileUpdate, client: Client = Depends(current_client), db: Session = Depends(get_db)):
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(client, field, value)
    db.commit()
    return ser.client(client)


# Addresses

def _own_address(db: Session, client: Client, address_id: int) -> Address:
    a = db.get(Address, address_id)
    if not a or a.client_id != client.id or a.archived:
        raise HTTPException(404, "Address not found.")
    return a


def _set_default(client: Client, chosen: Address) -> None:
    for a in client.addresses:
        a.is_default = a.id == chosen.id


@router.post("/addresses", status_code=201)
def add_address(body: AddressIn, client: Client = Depends(current_client), db: Session = Depends(get_db)):
    a = Address(client_id=client.id, **body.model_dump())
    db.add(a)
    db.flush()
    db.refresh(client)
    if body.is_default or not any(x.is_default for x in client.addresses if not x.archived and x.id != a.id):
        _set_default(client, a)
    db.commit()
    return ser.address(a)


@router.patch("/addresses/{address_id}")
def edit_address(address_id: int, body: AddressPatch, client: Client = Depends(current_client), db: Session = Depends(get_db)):
    a = _own_address(db, client, address_id)
    data = body.model_dump(exclude_none=True)
    make_default = data.pop("is_default", None)
    if "postcode" in data:
        data["postcode"] = " ".join(data["postcode"].upper().split())
    for k, v in data.items():
        setattr(a, k, v)
    if make_default:
        _set_default(client, a)
    db.commit()
    return ser.address(a)


@router.delete("/addresses/{address_id}", status_code=204)
def remove_address(address_id: int, client: Client = Depends(current_client), db: Session = Depends(get_db)):
    a = _own_address(db, client, address_id)
    # Archive rather than delete: past bookings still point at it.
    a.archived = True
    a.is_default = False
    db.commit()


# Booking

@router.post("/bookings", status_code=201)
def book(body: BookingRequest, client: Client = Depends(current_client), db: Session = Depends(get_db)):
    settings = get_settings()
    if body.address_id is not None:
        _own_address(db, client, body.address_id)

    pieces = wardrobe_svc.owned(db, client.id, body.wardrobe_item_ids)
    if len(pieces) != len(set(body.wardrobe_item_ids)):
        raise HTTPException(404, "Some of those pieces aren't in your Wardrobe.")
    order = Order(client_id=client.id, requested_services=body.requested_services, client_notes=body.notes,
                  requested_wardrobe=[p.id for p in pieces])
    db.add(order)
    db.flush()

    collection = reserve_slot(db, template_id=body.collection.template_id, day=body.collection.day,
                              client_id=client.id, kind=BookingKind.collection,
                              address_id=body.address_id, order_id=order.id)
    fees = collection.fee_pence
    if body.delivery:
        delivery = reserve_slot(db, template_id=body.delivery.template_id, day=body.delivery.day,
                                client_id=client.id, kind=BookingKind.delivery, address_id=body.address_id,
                                order_id=order.id,
                                not_before=collection.ends_at + timedelta(hours=settings.turnaround_hours))
        fees += delivery.fee_pence
    order.fees_pence = fees
    order_svc.log(db, order, OrderStatus.awaiting_collection.value)
    db.commit()
    db.refresh(order)
    return ser.order(order, detail=True)


@router.get("/bookings")
def my_bookings(upcoming: bool = True, client: Client = Depends(current_client), db: Session = Depends(get_db)):
    q = select(Booking).where(Booking.client_id == client.id)
    if upcoming:
        q = q.where(Booking.ends_at >= local_now(), Booking.status.in_([BookingStatus.scheduled, BookingStatus.en_route]))
        q = q.order_by(Booking.starts_at)
    else:
        q = q.order_by(Booking.starts_at.desc()).limit(50)
    return [ser.booking(b) for b in db.scalars(q)]


@router.post("/bookings/{booking_id}/cancel")
def cancel_booking(booking_id: int, client: Client = Depends(current_client), db: Session = Depends(get_db)):
    b = db.get(Booking, booking_id)
    if not b or b.client_id != client.id:
        raise HTTPException(404, "Booking not found.")
    if b.status != BookingStatus.scheduled:
        raise HTTPException(409, "This booking can no longer be cancelled.")
    cutoff = b.starts_at - timedelta(minutes=get_settings().cancel_cutoff_minutes)
    if local_now() > cutoff:
        raise HTTPException(409, "It's too close to the slot to cancel online. Call the atelier and we'll help.")

    b.status = BookingStatus.cancelled
    order = b.order
    if order:
        order.fees_pence = max(0, order.fees_pence - b.fee_pence)
        # Cancelling the collection cancels the whole order (and its delivery) if nothing has been collected yet.
        if b.kind == BookingKind.collection and order.status == OrderStatus.awaiting_collection:
            order_svc.advance(db, order, OrderStatus.cancelled, staff_id=None, note="Cancelled by client")
    for v in db.scalars(select(VaultItem).where(VaultItem.retrieval_booking_id == b.id)):
        v.status = VaultStatus.stored
        v.retrieval_booking_id = None
    db.commit()
    return ser.booking(b)


# Orders

@router.get("/orders")
def my_orders(client: Client = Depends(current_client), db: Session = Depends(get_db)):
    rows = db.scalars(select(Order).where(Order.client_id == client.id).order_by(Order.created_at.desc()).limit(100))
    return [ser.order(o) for o in rows]


@router.get("/orders/{ref}")
def my_order(ref: str, client: Client = Depends(current_client), db: Session = Depends(get_db)):
    o = db.scalar(select(Order).where(Order.ref == ref.upper(), Order.client_id == client.id))
    if not o:
        raise HTTPException(404, "Order not found.")
    return ser.order(o, detail=True)


# Wardrobe

@router.get("/wardrobe")
def my_wardrobe(client: Client = Depends(current_client), db: Session = Depends(get_db)):
    return wardrobe_svc.for_client(db, client)


@router.patch("/wardrobe/{item_id}")
def edit_wardrobe(item_id: int, body: WardrobePatch, client: Client = Depends(current_client), db: Session = Depends(get_db)):
    item = next(iter(wardrobe_svc.owned(db, client.id, [item_id])), None)
    if not item:
        raise HTTPException(404, "That piece isn't in your Wardrobe.")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(item, k, v.strip() if isinstance(v, str) else v)
    db.commit()
    return wardrobe_svc.describe(item)


# Vault

@router.get("/vault")
def my_vault(client: Client = Depends(current_client), db: Session = Depends(get_db)):
    rows = db.scalars(select(VaultItem).where(VaultItem.client_id == client.id, VaultItem.status != VaultStatus.retrieved)
                      .order_by(VaultItem.stored_at.desc()))
    return [ser.vault_item(v) for v in rows]


@router.post("/vault/retrieve", status_code=201)
def retrieve(body: VaultRetrieval, client: Client = Depends(current_client), db: Session = Depends(get_db)):
    items = db.scalars(select(VaultItem).where(VaultItem.id.in_(body.item_ids), VaultItem.client_id == client.id)).all()
    if len(items) != len(set(body.item_ids)):
        raise HTTPException(404, "Some of those items aren't in your Vault.")
    if any(v.status != VaultStatus.stored for v in items):
        raise HTTPException(409, "Some of those items already have a return booked.")
    if body.address_id is not None:
        _own_address(db, client, body.address_id)

    booking = reserve_slot(db, template_id=body.slot.template_id, day=body.slot.day, client_id=client.id,
                           kind=BookingKind.delivery, address_id=body.address_id,
                           notes="Vault return: " + ", ".join(v.tag_code for v in items))
    for v in items:
        v.status = VaultStatus.retrieval_requested
        v.retrieval_booking_id = booking.id
    db.commit()
    return ser.booking(booking)


# Payments & membership

@router.post("/payment/setup-intent")
def setup_intent(client: Client = Depends(current_client), db: Session = Depends(get_db)):
    return {"client_secret": payments.create_setup_intent(db, client)}


@router.post("/payment/card-saved")
def card_saved(body: CardSaved, client: Client = Depends(current_client), db: Session = Depends(get_db)):
    """Called by the embed right after Stripe confirms the card, so the UI doesn't wait for the webhook."""
    sc = payments._stripe()
    intent = sc.v1.setup_intents.retrieve(body.setup_intent_id)
    if intent.customer != client.stripe_customer_id or intent.status != "succeeded":
        raise HTTPException(400, "We couldn't confirm that card. Try adding it again.")
    sc.v1.customers.update(client.stripe_customer_id, params={"invoice_settings": {"default_payment_method": intent.payment_method}})
    client.has_card_on_file = True
    db.commit()
    return ser.client(client)


@router.post("/membership/checkout")
def membership_checkout(body: MembershipCheckout, client: Client = Depends(current_client), db: Session = Depends(get_db)):
    url = payments.membership_checkout(db, client, body.plan, success_url=body.return_url, cancel_url=body.return_url,
                                       interval=body.interval)
    return {"url": url}


@router.post("/membership/portal")
def membership_portal(body: ReturnUrl, client: Client = Depends(current_client), db: Session = Depends(get_db)):
    return {"url": payments.billing_portal(db, client, body.return_url)}
