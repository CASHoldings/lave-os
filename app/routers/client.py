"""Endpoints for signed-in clients, called by the embeds on the WordPress site."""
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import serializers as ser
from app.auth import current_client
from app.config import get_settings
from app.db import get_db
from app.models import (
    Address,
    AtelierLocation,
    Booking,
    BookingKind,
    BookingMode,
    BookingStatus,
    Client,
    Order,
    OrderStatus,
    SlotTemplate,
    VaultItem,
    VaultStatus,
    WindowType,
)
from app.schemas import (
    AddressIn,
    AddressPatch,
    BookingRequest,
    CancelRequest,
    CardSaved,
    MembershipCheckout,
    MembershipPause,
    ProfileUpdate,
    ReturnRequest,
    ReturnUrl,
    SlotChoice,
    VaultRetrieval,
    WardrobePatch,
)
from app.services import orders as order_svc
from app.services import payments
from app.services import wardrobe as wardrobe_svc
from app.services.clock import local_now
from app.services import ateliers, billing, delivery, members, notices
from app.services import bookings as bookings_svc
from app.services.slots import reserve_slot

router = APIRouter(prefix="/api/me", tags=["client"])


@router.get("")
def me(client: Client = Depends(current_client)):
    return ser.client(client)


@router.patch("")
def update_me(body: ProfileUpdate, client: Client = Depends(current_client), db: Session = Depends(get_db)):
    from app.services import sms
    if body.phone and body.phone.strip():
        if not (number := sms.valid_phone(body.phone)):
            raise HTTPException(400, PHONE_NEEDED)
        body.phone = number
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

PHONE_NEEDED = ("Add your mobile number, so your driver can text you when they're on the way. A UK mobile (07…), "
                "or an international number starting with +.")


def _need_phone(client: Client, phone: str) -> None:
    """A mobile number is needed to book: kept if we have one, otherwise taken from the booking."""
    from app.services import sms
    if phone.strip():
        if not (number := sms.valid_phone(phone)):
            raise HTTPException(400, PHONE_NEEDED)
        client.phone = number
    elif not sms.valid_phone(client.phone or ""):
        raise HTTPException(400, PHONE_NEEDED)


@router.post("/bookings", status_code=201)
def book(body: BookingRequest, response: Response, lave_list: str | None = Cookie(default=None),
         client: Client = Depends(current_client), db: Session = Depends(get_db)):
    address = _own_address(db, client, body.address_id) if body.address_id is not None else None
    pieces = wardrobe_svc.owned(db, client.id, body.wardrobe_item_ids)
    if len(pieces) != len(set(body.wardrobe_item_ids)):
        raise HTTPException(404, "Some of those pieces aren't in your Wardrobe.")
    _need_phone(client, body.phone)
    # The client's list from the price list goes with the booking as an estimate, then the list is cleared.
    from app.services import repository as repo
    planned = repo.summarise(db, repo.parse_list(lave_list))
    booked = repo.snapshot(planned) + wardrobe_svc.as_booked_lines(pieces)
    estimate = sum(line["unit_pence"] * line["qty"] for line in booked if not line["priced_later"])
    order = bookings_svc.place(
        db, client, address=address,
        collection=(body.collection.template_id, body.collection.day) if body.collection else None,
        dropoff=(body.dropoff.atelier_id, body.dropoff.day, body.dropoff.bags) if body.dropoff else None,
        delivery_slot=(body.delivery.template_id, body.delivery.day) if body.delivery else None,
        requested_items=booked, estimate_pence=estimate if booked else None,
        return_preference=body.return_preference,
        requested_services=body.requested_services, client_notes=body.notes, requested_wardrobe=[p.id for p in pieces])
    order_svc.log(db, order, OrderStatus.awaiting_collection.value)
    order_svc.log(db, order, "start_now", "Asked us to start within the 14-day cancellation period", visible=False)
    # Pay now for the fixed-price items and the collection & delivery charge. A declined card undoes the booking.
    try:
        payment = billing.take_booking_payment(db, order)
    except HTTPException:
        db.rollback()
        raise
    db.commit()
    db.refresh(order)
    if payment["status"] != "requires_action":
        notices.booking_confirmed(db, order)
    if lave_list:
        response.delete_cookie(repo.LIST_COOKIE, path="/")
    return {**ser.order(order, detail=True), "payment": payment}


@router.post("/orders/{ref}/booking-payment")
def confirm_booking_payment(ref: str, client: Client = Depends(current_client), db: Session = Depends(get_db)):
    """After the card check (3D Secure) at booking: confirm the payment, or release the booking if it failed."""
    order = db.scalar(select(Order).where(Order.ref == ref.upper(), Order.client_id == client.id))
    if not order:
        raise HTTPException(404, "Order not found.")
    result = billing.confirm_booking_payment(db, order)
    db.commit()
    if result == "failed":
        raise HTTPException(402, "Your card check didn't go through, so the booking wasn't made. Try again, or use another card.")
    if result == "paid":
        db.refresh(order)
        notices.booking_confirmed(db, order)
    return {**ser.order(order, detail=True), "payment": {"status": result}}


@router.get("/export")
def export_my_data(client: Client = Depends(current_client), db: Session = Depends(get_db)):
    """Everything we hold about you (UK GDPR), as a JSON file."""
    from fastapi.responses import JSONResponse
    from app.services import privacy
    return JSONResponse(privacy.export(db, client), headers={
        "Content-Disposition": f'attachment; filename="lave-my-data-{local_now():%Y-%m-%d}.json"', "Cache-Control": "no-store"})


@router.post("/delete-request")
def ask_to_delete(client: Client = Depends(current_client), db: Session = Depends(get_db)):
    """Ask us to delete your account. An admin carries it out (once nothing of yours is still with us)."""
    from app.services import privacy
    privacy.request_deletion(db, client)
    return {"requested_at": client.deletion_requested_at.isoformat()}


@router.get("/credit")
def my_credit(client: Client = Depends(current_client), db: Session = Depends(get_db)):
    return {"balance_pence": billing.credit_balance(db, client), "history": billing.credit_history(db, client)}


@router.get("/delivery-terms")
def delivery_terms(lave_list: str | None = Cookie(default=None), client: Client = Depends(current_client),
                   db: Session = Depends(get_db)):
    """What collection & delivery costs this client right now, for the booking screen's labels and notes."""
    from app.services import repository as repo
    planned = repo.summarise(db, repo.parse_list(lave_list))
    cfg = delivery.config(db)
    level = delivery.member_level(client)
    estimate = planned.estimate_pence if planned.lines else 0
    longer = delivery.longer_items(db, repo.snapshot(planned))
    return {
        "level": level, "labels": delivery.cell_labels(cfg, level, estimate), "estimate_pence": estimate,
        "amounts": {"saver": delivery.charge(cfg, level, estimate, False), "hour": delivery.charge(cfg, level, estimate, True)},
        "threshold_pence": cfg["free_saver_threshold_pence"],
        "to_free_pence": max(0, cfg["free_saver_threshold_pence"] - estimate) if not level else 0,
        "longer_items": longer, "longer_note": delivery.LONGER_NOTE if longer else "",
        "one_charge_note": delivery.ONE_CHARGE_NOTE,
        "dropoff": bool(cfg["dropoff_enabled"] and level),
        "turnaround_hours": cfg["turnaround_hours"],
        # Paid at booking: fixed-price items now (quotes after inspection), after any LAVE account credit.
        "items_fixed_pence": estimate,
        "priced_later": sum(line.qty for line in planned.lines if line.priced_later),
        "credit_pence": billing.credit_balance(db, client),
        # Minimum order (items): a list under it can't be booked; no list, and it's topped up at review.
        "minimum": {"home_pence": cfg["home_minimum_pence"], "dropoff_pence": cfg["dropoff_minimum_pence"],
                    "applies": not any(line.kind == "pack" for line in planned.lines), "has_list": bool(planned.lines),
                    "counted_pence": planned.counted_pence,
                    "home_short_pence": planned.short_pence("home"), "dropoff_short_pence": planned.short_pence("dropoff")},
        "booking_wording": billing.BOOKING_WORDING,
        "start_now_wording": billing.START_NOW_BOOKING,
    }


@router.get("/earliest-return")
def earliest_return(collection_end: datetime | None = None, atelier_id: int | None = None, day: date | None = None,
                    client: Client = Depends(current_client), db: Session = Depends(get_db)):
    """When items are ready to come back: 48 hours after the collection window ends (or the drop-off counts as
    collected)."""
    if atelier_id and day:
        loc = db.get(AtelierLocation, atelier_id)
        hours = ateliers.hours_on(loc, day) if loc else None
        if not hours:
            raise HTTPException(404, "That atelier isn't open that day.")
        collected = delivery.deemed_collection(db, datetime.combine(day, hours[0]))
    elif collection_end:
        collected = collection_end
    else:
        raise HTTPException(400, "Choose a collection first.")
    ready = delivery.earliest_return(db, collected)
    return {"collected_at": collected.isoformat(), "earliest_return": ready.isoformat(),
            "text": bookings_svc.ready_from_text(ready)}


@router.get("/ateliers")
def my_ateliers(start: date | None = None, days: int = 14, client: Client = Depends(current_client),
                db: Session = Depends(get_db)):
    """Atelier locations open for drop-off, with their dates. Members only."""
    if not delivery.member_level(client) or not delivery.config(db)["dropoff_enabled"]:
        return []
    start = max(start or local_now().date(), local_now().date())
    days = max(1, min(days, get_settings().booking_horizon_days))
    return ateliers.offered(db, start, days)


@router.post("/orders/{ref}/return", status_code=201)
def book_my_return(ref: str, body: ReturnRequest, client: Client = Depends(current_client), db: Session = Depends(get_db)):
    """Book the return for an order whose return was left to arrange later."""
    order = db.scalar(select(Order).where(Order.ref == ref.upper(), Order.client_id == client.id))
    if not order:
        raise HTTPException(404, "Order not found.")
    if any(b.kind == BookingKind.delivery and b.status in (BookingStatus.scheduled, BookingStatus.en_route) for b in order.bookings) \
            and order.return_preference != "split":
        raise HTTPException(409, "This order already has a return booked.")
    bookings_svc.book_return(db, order, (body.slot.template_id, body.slot.day), _own_address(db, client, body.address_id))
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
    out = []
    for b in db.scalars(q):
        after = bookings_svc.move_after(db, b) if upcoming else None
        out.append({**ser.booking(b), "move_after": after.isoformat() if after else None,
                    "movable": b.status == BookingStatus.scheduled and b.mode == BookingMode.lave_collects and not b.atelier_id})
    return out


@router.post("/bookings/{booking_id}/move")
def move_booking(booking_id: int, body: SlotChoice, client: Client = Depends(current_client), db: Session = Depends(get_db)):
    """Move a home collection or return to another time (same kind of window)."""
    b = db.get(Booking, booking_id)
    if not b or b.client_id != client.id:
        raise HTTPException(404, "Booking not found.")
    bookings_svc.move(db, b, (body.template_id, body.day))
    db.commit()
    notices.booking_moved(b)
    return {**ser.booking(b), "move_after": None}


@router.post("/bookings/{booking_id}/cancel")
def cancel_booking(booking_id: int, body: CancelRequest | None = None, client: Client = Depends(current_client),
                   db: Session = Depends(get_db)):
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
        db.flush()
        db.refresh(order)
        delivery.recompute(db, order)  # one charge per booking: recalculated from the legs that remain
        # Cancelling the collection cancels the whole order (and its delivery) if nothing has been collected yet.
        whole_order = b.kind == BookingKind.collection and order.status == OrderStatus.awaiting_collection
        if whole_order:
            reason = (body.reason.strip() if body else "") or "No reason given"
            order_svc.advance(db, order, OrderStatus.cancelled, staff_id=None, note="Cancelled by client")
            order_svc.log(db, order, "cancel_reason", reason, visible=False)
            # Card refunds are made by hand, after we've understood why (Cancellation policy, 1). Credit used at
            # booking goes straight back to their LAVE account.
            if order.credit_used_pence:
                billing.add_credit(db, client, order.credit_used_pence, f"Order {order.ref} cancelled", order)
            if order.paid_pence:
                order_svc.log(db, order, "refund_due", f"Refund {billing.pounds(order.paid_pence)} to the card by hand in Stripe",
                              visible=False)
    for v in db.scalars(select(VaultItem).where(VaultItem.retrieval_booking_id == b.id)):
        v.status = VaultStatus.stored
        v.retrieval_booking_id = None
    db.commit()
    if order and order.status == OrderStatus.cancelled and b.kind == BookingKind.collection:
        notices.order_cancelled(order, (body.reason.strip() if body else ""))
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
    address = _own_address(db, client, body.address_id) if body.address_id is not None else None
    t = db.get(SlotTemplate, body.slot.template_id)
    if not t or t.mode != BookingMode.lave_collects:
        raise HTTPException(400, "Choose a delivery time from the calendar.")
    bookings_svc._in_zone(db, address, "deliver")
    booking = reserve_slot(db, template_id=body.slot.template_id, day=body.slot.day, client_id=client.id,
                           kind=BookingKind.delivery, address_id=body.address_id,
                           notes="Vault return: " + ", ".join(v.tag_code for v in items))
    # Its own booking, so its own single charge, on the same terms as any return.
    booking.fee_pence = delivery.charge(delivery.config(db), delivery.member_level(client), 0,
                                        booking.window_type == WindowType.hour)
    for v in items:
        v.status = VaultStatus.retrieval_requested
        v.retrieval_booking_id = booking.id
    db.commit()
    notices.vault_return_booked(booking, len(items))
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


@router.post("/membership/pause")
def membership_pause(body: MembershipPause, client: Client = Depends(current_client), db: Session = Depends(get_db)):
    payments.pause_membership(db, client, body.months)
    return ser.client(client)


@router.post("/membership/resume")
def membership_resume(client: Client = Depends(current_client), db: Session = Depends(get_db)):
    payments.resume_membership(db, client)
    return ser.client(client)


@router.post("/membership/portal")
def membership_portal(body: ReturnUrl, client: Client = Depends(current_client), db: Session = Depends(get_db)):
    return {"url": payments.billing_portal(db, client, body.return_url)}


# "Tell us about you" (members' experience)

@router.get("/about")
def my_about(client: Client = Depends(current_client), db: Session = Depends(get_db)):
    return members.about(db, client)


@router.put("/about")
def save_my_about(body: dict, client: Client = Depends(current_client), db: Session = Depends(get_db)):
    return members.save_about(db, client, body)


@router.delete("/about", status_code=204)
def forget_my_about(client: Client = Depends(current_client), db: Session = Depends(get_db)):
    members.forget_about(db, client)


@router.post("/occasions", status_code=201)
def add_my_occasion(body: dict, client: Client = Depends(current_client), db: Session = Depends(get_db)):
    try:
        day = date.fromisoformat(str(body.get("day")))
    except ValueError:
        raise HTTPException(400, "Choose the date of the occasion.")
    members.add_occasion(db, client, day, str(body.get("title") or ""), str(body.get("note") or ""))
    return members.about(db, client)


@router.delete("/occasions/{occasion_id}", status_code=204)
def remove_my_occasion(occasion_id: int, client: Client = Depends(current_client), db: Session = Depends(get_db)):
    from app.models import ClientOccasion
    o = db.get(ClientOccasion, occasion_id)
    if not o or o.client_id != client.id:
        raise HTTPException(404, "Occasion not found.")
    db.delete(o)
    db.commit()
