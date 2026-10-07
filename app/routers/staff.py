"""Endpoints for the staff dashboard."""
from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app import serializers as ser
from app.auth import (
    STAFF_COOKIE,
    current_staff,
    find_staff_by_email,
    hash_password,
    issue_staff_token,
    require_role,
    verify_password,
)
from app.config import get_settings
from app.db import get_db
from app.models import (
    Booking,
    BookingKind,
    BookingStatus,
    Client,
    Garment,
    ItemStatus,
    Order,
    OrderStatus,
    PaymentStatus,
    Service,
    SlotBlackout,
    SlotTemplate,
    StaffRole,
    StaffUser,
    VaultItem,
    VaultStatus,
)
from app.schemas import (
    BlackoutIn,
    BookingPatch,
    ClientCreate,
    ClientPatch,
    GarmentIn,
    GarmentPatch,
    ManualPayment,
    OrderPatch,
    OrderStatusChange,
    ServiceIn,
    ServicePatch,
    SlotTemplateIn,
    SlotTemplatePatch,
    StaffCreate,
    StaffLogin,
    StaffPatch,
    VaultPatch,
    WalkInOrder,
)
from app.services import orders as order_svc
from app.services import payments
from app.services import wardrobe as wardrobe_svc
from app.services.clock import local_now

router = APIRouter(prefix="/api/staff", tags=["staff"])
admin_only = require_role(StaffRole.admin)
ops = require_role(StaffRole.admin, StaffRole.operator)
anyone = Depends(current_staff)


# Auth

@router.post("/auth/login")
def login(body: StaffLogin, response: Response, db: Session = Depends(get_db)):
    staff = find_staff_by_email(db, body.email)
    if not staff or not staff.active or not verify_password(body.password, staff.password_hash):
        raise HTTPException(401, "Email or password is incorrect.")
    token = issue_staff_token(staff)
    response.set_cookie(STAFF_COOKIE, token, httponly=True, samesite="strict", secure=not get_settings().is_dev,
                        max_age=get_settings().staff_session_hours * 3600, path="/")
    return {"staff": ser.staff(staff), "token": token}


@router.post("/auth/logout", status_code=204)
def logout(response: Response):
    response.delete_cookie(STAFF_COOKIE, path="/")


@router.get("/me")
def whoami(staff: StaffUser = anyone):
    return ser.staff(staff)


# Day board

def _day_bounds(day: date) -> tuple[datetime, datetime]:
    start = datetime.combine(day, time.min)
    return start, start + timedelta(days=1)


@router.get("/dashboard")
def dashboard(day: date | None = None, staff: StaffUser = anyone, db: Session = Depends(get_db)):
    day = day or local_now().date()
    start, end = _day_bounds(day)
    bookings = db.scalars(select(Booking).where(Booking.starts_at >= start, Booking.starts_at < end,
                                                Booking.status != BookingStatus.cancelled).order_by(Booking.starts_at)).all()
    if staff.role == StaffRole.driver:
        bookings = [b for b in bookings if b.driver_id in (None, staff.id)]
    counts = dict(db.execute(select(Order.status, func.count()).where(Order.status.not_in([OrderStatus.delivered, OrderStatus.cancelled]))
                             .group_by(Order.status)).all())
    retrievals = db.scalar(select(func.count()).select_from(VaultItem).where(VaultItem.status == VaultStatus.retrieval_requested))
    unpaid_ready = db.scalar(select(func.count()).select_from(Order).where(Order.status == OrderStatus.ready,
                                                                           Order.payment_status.not_in([PaymentStatus.paid, PaymentStatus.waived])))
    return {
        "day": day.isoformat(),
        "collections": [ser.booking(b, True) for b in bookings if b.kind == BookingKind.collection],
        "deliveries": [ser.booking(b, True) for b in bookings if b.kind == BookingKind.delivery],
        "pipeline": {s.value: counts.get(s, 0) for s in OrderStatus if s not in (OrderStatus.delivered, OrderStatus.cancelled)},
        "vault_retrievals": retrievals,
        "ready_unpaid": unpaid_ready,
        "drivers": [ser.staff(s) for s in db.scalars(select(StaffUser).where(StaffUser.role == StaffRole.driver, StaffUser.active.is_(True)))],
    }


@router.patch("/bookings/{booking_id}")
def patch_booking(booking_id: int, body: BookingPatch, staff: StaffUser = anyone, db: Session = Depends(get_db)):
    b = db.get(Booking, booking_id)
    if not b:
        raise HTTPException(404, "Booking not found.")
    if staff.role == StaffRole.driver and (body.driver_id not in (None, staff.id) or (b.driver_id not in (None, staff.id))):
        raise HTTPException(403, "Drivers can only update their own runs.")
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(b, k, v)
    # A completed collection means the bag is in our hands.
    if body.status == BookingStatus.completed and b.kind == BookingKind.collection and b.order \
            and b.order.status == OrderStatus.awaiting_collection:
        order_svc.advance(db, b.order, OrderStatus.collected, staff.id)
    if body.status == BookingStatus.completed and b.kind == BookingKind.delivery:
        if b.order and b.order.status in (OrderStatus.ready, OrderStatus.out_for_delivery):
            order_svc.advance(db, b.order, OrderStatus.delivered, staff.id)
        for v in db.scalars(select(VaultItem).where(VaultItem.retrieval_booking_id == b.id)):
            v.status = VaultStatus.retrieved
            v.retrieved_at = local_now()
    db.commit()
    return ser.booking(b, True)


# Orders

def _order(db: Session, order_id: int) -> Order:
    o = db.get(Order, order_id)
    if not o:
        raise HTTPException(404, "Order not found.")
    return o


@router.get("/orders")
def list_orders(status: OrderStatus | None = None, q: str | None = None, active: bool = False,
                limit: int = Query(100, le=500), staff: StaffUser = Depends(ops), db: Session = Depends(get_db)):
    query = select(Order).join(Client)
    if status:
        query = query.where(Order.status == status)
    elif active:
        query = query.where(Order.status.not_in([OrderStatus.delivered, OrderStatus.cancelled]))
    if q:
        like = f"%{q.strip()}%"
        query = query.where(or_(Order.ref.ilike(like), Client.email.ilike(like), Client.first_name.ilike(like),
                                Client.last_name.ilike(like)))
    rows = db.scalars(query.order_by(Order.created_at.desc()).limit(limit))
    return [ser.order(o, staff_view=True) for o in rows]


@router.post("/orders", status_code=201)
def walk_in(body: WalkInOrder, staff: StaffUser = Depends(ops), db: Session = Depends(get_db)):
    """Order for a client who brought items to the counter without booking."""
    client = db.get(Client, body.client_id)
    if not client:
        raise HTTPException(404, "Client not found.")
    o = Order(client_id=client.id, client_notes=body.client_notes, status=OrderStatus.collected)
    db.add(o)
    db.flush()
    order_svc.log(db, o, OrderStatus.collected.value, "Received at the atelier", staff.id)
    db.commit()
    return ser.order(o, staff_view=True, detail=True)


@router.get("/orders/{order_id}")
def get_order(order_id: int, staff: StaffUser = Depends(ops), db: Session = Depends(get_db)):
    o = _order(db, order_id)
    out = ser.order(o, staff_view=True, detail=True)
    # The client's Wardrobe, so intake can link a garment to a piece cleaned before.
    out["client_wardrobe"] = [{"id": w["id"], "title": w["title"], "service_id": (w["service"] or {}).get("id")}
                              for w in wardrobe_svc.for_client(db, o.client, include_hidden=True)]
    requested = wardrobe_svc.owned(db, o.client_id, o.requested_wardrobe or [])
    out["requested_wardrobe"] = [{"id": w.id, "title": " ".join(p for p in [w.colour, w.brand, w.name] if p)} for w in requested]
    return out


@router.patch("/orders/{order_id}")
def patch_order(order_id: int, body: OrderPatch, staff: StaffUser = Depends(ops), db: Session = Depends(get_db)):
    o = _order(db, order_id)
    if o.payment_status == PaymentStatus.paid and (body.fees_pence is not None or body.discount_pence is not None):
        raise HTTPException(409, "This order is paid; its total can't change. Refund in Stripe instead.")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(o, k, v)
    db.commit()
    return ser.order(o, staff_view=True, detail=True)


@router.post("/orders/{order_id}/status")
def change_status(order_id: int, body: OrderStatusChange, staff: StaffUser = Depends(ops), db: Session = Depends(get_db)):
    o = _order(db, order_id)
    order_svc.advance(db, o, body.status, staff.id, body.note)
    db.commit()
    return ser.order(o, staff_view=True, detail=True)


@router.post("/orders/{order_id}/charge")
def charge(order_id: int, staff: StaffUser = Depends(ops), db: Session = Depends(get_db)):
    o = _order(db, order_id)
    payments.charge_order(db, o, staff.id)
    return ser.order(o, staff_view=True, detail=True)


@router.post("/orders/{order_id}/payment")
def manual_payment(order_id: int, body: ManualPayment, staff: StaffUser = Depends(admin_only), db: Session = Depends(get_db)):
    """Record payment taken outside Stripe (e.g. at the counter), or waive it."""
    if body.status not in (PaymentStatus.paid, PaymentStatus.waived):
        raise HTTPException(400, "Record a payment as paid or waived.")
    o = _order(db, order_id)
    o.payment_status = body.status
    if body.status == PaymentStatus.paid:
        o.paid_at = local_now()
    order_svc.log(db, o, "payment", f"{body.status.value.capitalize()} by {staff.name}. {body.note}".strip(), staff.id, visible=False)
    db.commit()
    return ser.order(o, staff_view=True, detail=True)


EDITABLE_ITEM_ORDER_STATES = {OrderStatus.collected, OrderStatus.inspected, OrderStatus.in_care, OrderStatus.quality_check}


@router.post("/orders/{order_id}/items", status_code=201)
def add_item(order_id: int, body: GarmentIn, staff: StaffUser = Depends(ops), db: Session = Depends(get_db)):
    o = _order(db, order_id)
    if o.status not in EDITABLE_ITEM_ORDER_STATES:
        raise HTTPException(409, "Garments can only be added between collection and quality check.")
    if o.payment_status == PaymentStatus.paid:
        raise HTTPException(409, "This order is paid; start a new order for extra items.")
    data = body.model_dump(exclude={"wardrobe_item_id"})
    if data["price_pence"] is None:
        svc = db.get(Service, body.service_id) if body.service_id else None
        data["price_pence"] = svc.price_pence if svc else 0
    g = Garment(order_id=o.id, tag_code=order_svc.next_tag_code(o), **data)
    db.add(g)
    db.flush()
    wardrobe_svc.link_garment(db, o, g, body.wardrobe_item_id)
    order_svc.log(db, o, "item_added", f"{g.tag_code} {g.description}", staff.id, garment_id=g.id, visible=False)
    db.commit()
    db.refresh(o)
    return ser.order(o, staff_view=True, detail=True)


def _garment(db: Session, garment_id: int) -> Garment:
    g = db.get(Garment, garment_id)
    if not g:
        raise HTTPException(404, "Garment not found.")
    return g


@router.patch("/items/{garment_id}")
def patch_item(garment_id: int, body: GarmentPatch, staff: StaffUser = Depends(ops), db: Session = Depends(get_db)):
    g = _garment(db, garment_id)
    if g.order.payment_status == PaymentStatus.paid and body.price_pence is not None and body.price_pence != g.price_pence:
        raise HTTPException(409, "This order is paid; prices can't change.")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(g, k, v)
    db.commit()
    return ser.order(g.order, staff_view=True, detail=True)


@router.delete("/items/{garment_id}")
def delete_item(garment_id: int, staff: StaffUser = Depends(ops), db: Session = Depends(get_db)):
    g = _garment(db, garment_id)
    o = g.order
    if o.status not in (OrderStatus.collected, OrderStatus.inspected) or o.payment_status == PaymentStatus.paid:
        raise HTTPException(409, "Garments can only be removed before care starts on an unpaid order.")
    order_svc.log(db, o, "item_removed", f"{g.tag_code} {g.description}", staff.id, visible=False)
    db.delete(g)
    db.commit()
    db.refresh(o)
    return ser.order(o, staff_view=True, detail=True)


@router.get("/tags/{code}")
def lookup_tag(code: str, staff: StaffUser = anyone, db: Session = Depends(get_db)):
    """Scan a tag: find the garment and its order, or the Vault item."""
    code = code.strip().upper()
    g = db.scalar(select(Garment).where(Garment.tag_code == code))
    v = db.scalar(select(VaultItem).where(VaultItem.tag_code == code))
    if not g and not v:
        raise HTTPException(404, f"No item with tag {code}.")
    return {
        "garment": ser.garment(g) if g else None,
        "order": ser.order(g.order, staff_view=True) if g else None,
        "vault_item": ser.vault_item(v, True) if v else None,
    }


# Clients

@router.get("/clients")
def list_clients(q: str | None = None, staff: StaffUser = Depends(ops), db: Session = Depends(get_db)):
    query = select(Client)
    if q:
        like = f"%{q.strip()}%"
        query = query.where(or_(Client.email.ilike(like), Client.first_name.ilike(like), Client.last_name.ilike(like),
                                Client.phone.ilike(like)))
    rows = db.scalars(query.order_by(Client.created_at.desc()).limit(100))
    return [ser.client(c, staff_view=True) for c in rows]


@router.post("/clients", status_code=201)
def create_client(body: ClientCreate, staff: StaffUser = Depends(ops), db: Session = Depends(get_db)):
    email = body.email.lower()
    if db.scalar(select(Client).where(Client.email == email)):
        raise HTTPException(409, "A client with this email already exists.")
    c = Client(email=email, first_name=body.first_name, last_name=body.last_name, phone=body.phone)
    db.add(c)
    db.commit()
    return ser.client(c, staff_view=True)


@router.get("/clients/{client_id}")
def get_client(client_id: int, staff: StaffUser = Depends(ops), db: Session = Depends(get_db)):
    c = db.get(Client, client_id)
    if not c:
        raise HTTPException(404, "Client not found.")
    orders = db.scalars(select(Order).where(Order.client_id == c.id).order_by(Order.created_at.desc()).limit(50))
    vault = db.scalars(select(VaultItem).where(VaultItem.client_id == c.id).order_by(VaultItem.stored_at.desc()))
    lifetime = db.scalar(select(func.count()).select_from(Order).where(Order.client_id == c.id, Order.payment_status == PaymentStatus.paid))
    return {**ser.client(c, staff_view=True),
            "orders": [ser.order(o, staff_view=True) for o in orders],
            "vault": [ser.vault_item(v, True) for v in vault],
            "paid_orders": lifetime}


@router.patch("/clients/{client_id}")
def patch_client(client_id: int, body: ClientPatch, staff: StaffUser = Depends(ops), db: Session = Depends(get_db)):
    c = db.get(Client, client_id)
    if not c:
        raise HTTPException(404, "Client not found.")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(c, k, v)
    db.commit()
    return ser.client(c, staff_view=True)


# Vault

@router.get("/vault")
def list_vault(status: VaultStatus | None = None, q: str | None = None, staff: StaffUser = Depends(ops), db: Session = Depends(get_db)):
    query = select(VaultItem).join(Client)
    query = query.where(VaultItem.status == status) if status else query.where(VaultItem.status != VaultStatus.retrieved)
    if q:
        like = f"%{q.strip()}%"
        query = query.where(or_(VaultItem.tag_code.ilike(like), VaultItem.description.ilike(like), VaultItem.location.ilike(like),
                                Client.last_name.ilike(like), Client.email.ilike(like)))
    return [ser.vault_item(v, True) for v in db.scalars(query.order_by(VaultItem.location, VaultItem.tag_code).limit(500))]


@router.patch("/vault/{item_id}")
def patch_vault(item_id: int, body: VaultPatch, staff: StaffUser = Depends(ops), db: Session = Depends(get_db)):
    v = db.get(VaultItem, item_id)
    if not v:
        raise HTTPException(404, "Vault item not found.")
    for k, val in body.model_dump(exclude_none=True).items():
        setattr(v, k, val)
    db.commit()
    return ser.vault_item(v, True)


@router.post("/vault/{item_id}/retrieved")
def mark_retrieved(item_id: int, staff: StaffUser = Depends(ops), db: Session = Depends(get_db)):
    v = db.get(VaultItem, item_id)
    if not v:
        raise HTTPException(404, "Vault item not found.")
    v.status = VaultStatus.retrieved
    v.retrieved_at = local_now()
    db.commit()
    return ser.vault_item(v, True)


# Settings: slots, services, staff

@router.get("/slots/templates")
def list_templates(staff: StaffUser = Depends(ops), db: Session = Depends(get_db)):
    rows = db.scalars(select(SlotTemplate).order_by(SlotTemplate.mode, SlotTemplate.window_type, SlotTemplate.weekday, SlotTemplate.start))
    return [ser.template(t) for t in rows]


@router.post("/slots/templates", status_code=201)
def add_template(body: SlotTemplateIn, staff: StaffUser = Depends(admin_only), db: Session = Depends(get_db)):
    start, end = time.fromisoformat(body.start), time.fromisoformat(body.end)
    if end <= start:
        raise HTTPException(400, "The window must end after it starts.")
    t = SlotTemplate(**body.model_dump(exclude={"start", "end"}), start=start, end=end)
    db.add(t)
    db.commit()
    return ser.template(t)


@router.patch("/slots/templates/{template_id}")
def patch_template(template_id: int, body: SlotTemplatePatch, staff: StaffUser = Depends(admin_only), db: Session = Depends(get_db)):
    t = db.get(SlotTemplate, template_id)
    if not t:
        raise HTTPException(404, "Slot not found.")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(t, k, v)
    db.commit()
    return ser.template(t)


@router.get("/slots/blackouts")
def list_blackouts(staff: StaffUser = Depends(ops), db: Session = Depends(get_db)):
    rows = db.scalars(select(SlotBlackout).where(SlotBlackout.day >= local_now().date()).order_by(SlotBlackout.day))
    return [{"id": b.id, "day": b.day.isoformat(), "reason": b.reason} for b in rows]


@router.post("/slots/blackouts", status_code=201)
def add_blackout(body: BlackoutIn, staff: StaffUser = Depends(admin_only), db: Session = Depends(get_db)):
    if db.scalar(select(SlotBlackout).where(SlotBlackout.day == body.day)):
        raise HTTPException(409, "That day is already closed.")
    b = SlotBlackout(day=body.day, reason=body.reason)
    db.add(b)
    db.commit()
    affected = db.scalar(select(func.count()).select_from(Booking).where(
        Booking.starts_at >= datetime.combine(body.day, time.min),
        Booking.starts_at < datetime.combine(body.day + timedelta(days=1), time.min),
        Booking.status == BookingStatus.scheduled))
    return {"id": b.id, "day": b.day.isoformat(), "reason": b.reason, "existing_bookings": affected}


@router.delete("/slots/blackouts/{blackout_id}", status_code=204)
def remove_blackout(blackout_id: int, staff: StaffUser = Depends(admin_only), db: Session = Depends(get_db)):
    b = db.get(SlotBlackout, blackout_id)
    if b:
        db.delete(b)
        db.commit()


@router.get("/services")
def list_services(staff: StaffUser = anyone, db: Session = Depends(get_db)):
    return [ser.service(s) for s in db.scalars(select(Service).order_by(Service.category, Service.name))]


@router.post("/services", status_code=201)
def add_service(body: ServiceIn, staff: StaffUser = Depends(admin_only), db: Session = Depends(get_db)):
    if db.scalar(select(Service).where(Service.code == body.code)):
        raise HTTPException(409, "A service with this code already exists.")
    from app.services.content import unique_slug
    s = Service(**body.model_dump())
    s.collections = [c for c in body.collections if c in ("women", "men", "children", "pets")]
    if s.show_online:
        s.slug = unique_slug(db, body.name.split(" – ")[0], model=Service)
    db.add(s)
    db.commit()
    return ser.service(s)


@router.patch("/services/{service_id}")
def patch_service(service_id: int, body: ServicePatch, staff: StaffUser = Depends(admin_only), db: Session = Depends(get_db)):
    s = db.get(Service, service_id)
    if not s:
        raise HTTPException(404, "Service not found.")
    data = body.model_dump(exclude_none=True)
    if "collections" in data:
        data["collections"] = [c for c in data["collections"] if c in ("women", "men", "children", "pets")]
    for k, v in data.items():
        setattr(s, k, v)
    if s.show_online and not s.slug:
        from app.services.content import unique_slug
        s.slug = unique_slug(db, s.name.split(" – ")[0], model=Service)
    db.commit()
    return ser.service(s)


@router.get("/team")
def list_team(staff: StaffUser = Depends(admin_only), db: Session = Depends(get_db)):
    return [ser.staff(s) for s in db.scalars(select(StaffUser).order_by(StaffUser.name))]


@router.post("/team", status_code=201)
def add_team(body: StaffCreate, staff: StaffUser = Depends(admin_only), db: Session = Depends(get_db)):
    if find_staff_by_email(db, body.email):
        raise HTTPException(409, "Someone with this email is already on the team.")
    s = StaffUser(email=body.email.lower(), name=body.name, role=body.role, password_hash=hash_password(body.password))
    db.add(s)
    db.commit()
    return ser.staff(s)


@router.patch("/team/{staff_id}")
def patch_team(staff_id: int, body: StaffPatch, staff: StaffUser = Depends(admin_only), db: Session = Depends(get_db)):
    s = db.get(StaffUser, staff_id)
    if not s:
        raise HTTPException(404, "Team member not found.")
    if s.id == staff.id and (body.active is False or (body.role and body.role != StaffRole.admin)):
        raise HTTPException(409, "You can't remove your own admin access.")
    data = body.model_dump(exclude_none=True)
    if pw := data.pop("password", None):
        s.password_hash = hash_password(pw)
    for k, v in data.items():
        setattr(s, k, v)
    db.commit()
    return ser.staff(s)


# Apothecary shop

from app.models import Product, ProductVariant, ShopOrder, ShopOrderStatus, WaitlistEntry  # noqa: E402
from app.schemas import SellingSwitch, ShopOrderUpdate, VariantPatch  # noqa: E402
from app.services import mailer, shop as shop_svc  # noqa: E402


def _shop_order(o: ShopOrder) -> dict:
    return {
        "id": o.id, "ref": o.ref, "status": o.status.value, "fulfilment": o.fulfilment, "email": o.email,
        "client": {"id": o.client.id, "name": o.client.full_name} if o.client else None,
        "subtotal_pence": o.subtotal_pence, "shipping_pence": o.shipping_pence, "total_pence": o.total_pence,
        "address": o.shipping_address or {}, "tracking": o.tracking, "created_at": ser.iso(o.created_at),
        "paid_at": ser.iso(o.paid_at), "dispatched_at": ser.iso(o.dispatched_at), "stock_issue": o.stock_issue,
        "lines": [{"name": l.name, "variant": l.variant_label, "qty": l.quantity, "unit_price_pence": l.unit_price_pence}
                  for l in o.lines],
    }


@router.get("/shop")
def shop_overview(staff: StaffUser = Depends(ops), db: Session = Depends(get_db)):
    waitlist = db.scalars(select(WaitlistEntry).order_by(WaitlistEntry.created_at.desc())).all()
    to_pack = db.scalar(select(func.count()).select_from(ShopOrder).where(ShopOrder.status == ShopOrderStatus.paid))
    return {"selling": shop_svc.selling(db), "to_pack": to_pack,
            "waitlist": [{"name": f"{w.first_name} {w.surname}".strip(), "email": w.email, "source": w.source,
                          "joined": ser.iso(w.created_at), "notified": ser.iso(w.notified_at)} for w in waitlist]}


@router.post("/shop/selling")
def shop_selling(body: SellingSwitch, staff: StaffUser = Depends(admin_only), db: Session = Depends(get_db)):
    sent = shop_svc.set_selling(db, body.on)
    return {"selling": shop_svc.selling(db), "emails_sent": sent}


@router.get("/shop/products")
def shop_products(staff: StaffUser = Depends(ops), db: Session = Depends(get_db)):
    rows = db.scalars(select(Product).order_by(Product.sort, Product.name))
    return [{"id": p.id, "name": p.name, "slug": p.slug, "menu": f"{p.menu_sub} / {p.menu_item}", "active": p.active,
             "summary": p.summary or "", "image": p.image or "",
             "variants": [{"id": v.id, "sku": v.sku, "label": v.label, "price_pence": v.price_pence, "stock": v.stock,
                           "active": v.active} for v in p.variants]} for p in rows]


@router.patch("/shop/variants/{variant_id}")
def shop_variant(variant_id: int, body: VariantPatch, staff: StaffUser = Depends(admin_only), db: Session = Depends(get_db)):
    v = db.get(ProductVariant, variant_id)
    if not v:
        raise HTTPException(404, "Option not found.")
    for k, val in body.model_dump(exclude_none=True).items():
        setattr(v, k, val)
    db.commit()
    return {"id": v.id, "price_pence": v.price_pence, "stock": v.stock, "active": v.active}


@router.get("/shop/orders")
def shop_orders(status: str = "open", staff: StaffUser = Depends(ops), db: Session = Depends(get_db)):
    q = select(ShopOrder)
    if status == "open":
        q = q.where(ShopOrder.status == ShopOrderStatus.paid)
    elif status != "all":
        q = q.where(ShopOrder.status == ShopOrderStatus(status))
    return [_shop_order(o) for o in db.scalars(q.order_by(ShopOrder.created_at.desc()).limit(200))]


@router.post("/shop/orders/{order_id}/status")
def shop_order_status(order_id: int, body: ShopOrderUpdate, staff: StaffUser = Depends(ops), db: Session = Depends(get_db)):
    o = db.get(ShopOrder, order_id)
    if not o:
        raise HTTPException(404, "Order not found.")
    allowed = {"dispatched": {ShopOrderStatus.paid}, "collected": {ShopOrderStatus.paid}, "cancelled": {ShopOrderStatus.pending_payment}}
    if body.status not in allowed or o.status not in allowed[body.status]:
        raise HTTPException(409, f"An order that is {o.status.value.replace('_', ' ')} can't be marked {body.status}.")
    o.status = ShopOrderStatus(body.status)
    if body.status == "dispatched":
        o.dispatched_at = local_now()
        o.tracking = body.tracking.strip()[:120]
        if o.email:
            mailer.send(o.email, f"Your LAVE order {o.ref} is on its way",
                        f"Your Apothecary order {o.ref} has been dispatched." + (f"\nTracking: {o.tracking}" if o.tracking else "") + "\n\nLAVE")
    elif body.status == "collected":
        o.dispatched_at = local_now()
    db.commit()
    return _shop_order(o)


# Journal, pages, uploads and messages

import secrets as _secrets  # noqa: E402
from pathlib import Path as _Path  # noqa: E402

from fastapi import File, UploadFile  # noqa: E402

from app.models import ContactMessage, PageContent, Post, PostStatus  # noqa: E402
from app.schemas import MarkdownIn, PageIn, PostIn, PublishChange  # noqa: E402
from app.services import content as cms  # noqa: E402

MEDIA_DIR = get_settings().media_path
IMAGE_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/avif": ".avif"}
MAX_UPLOAD = 8 * 1024 * 1024


def _post(p: Post, full: bool = False) -> dict:
    out = {"id": p.id, "slug": p.slug, "kind": p.kind, "title": p.title, "excerpt": p.excerpt, "status": p.status.value,
           "published_at": ser.iso(p.published_at), "updated_at": ser.iso(p.updated_at), "cover_image": p.cover_image,
           "cover_url": cms.image(p.cover_image), "event_starts_at": ser.iso(p.event_starts_at)}
    if full:
        out.update(body=p.body, author=p.author, event_location=p.event_location, event_theme=p.event_theme,
                   members_only=p.members_only, outlet=p.outlet, external_url=p.external_url)
    return out


def _parse_dt(value: str | None):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(400, "Use a date and time like 2026-11-20T18:30.") from exc


@router.get("/posts")
def list_posts(kind: str | None = None, staff: StaffUser = Depends(ops), db: Session = Depends(get_db)):
    q = select(Post)
    if kind:
        q = q.where(Post.kind == kind)
    return [_post(p) for p in db.scalars(q.order_by(Post.updated_at.desc()))]


@router.post("/posts", status_code=201)
def create_post(body: PostIn, staff: StaffUser = Depends(ops), db: Session = Depends(get_db)):
    data = body.model_dump(exclude={"slug", "event_starts_at"})
    p = Post(**data, slug=cms.unique_slug(db, body.slug or body.title), event_starts_at=_parse_dt(body.event_starts_at),
             status=PostStatus.draft)
    db.add(p)
    db.commit()
    return _post(p, full=True)


@router.get("/posts/{post_id}")
def get_post(post_id: int, staff: StaffUser = Depends(ops), db: Session = Depends(get_db)):
    p = db.get(Post, post_id)
    if not p:
        raise HTTPException(404, "Post not found.")
    return _post(p, full=True)


@router.patch("/posts/{post_id}")
def update_post(post_id: int, body: PostIn, staff: StaffUser = Depends(ops), db: Session = Depends(get_db)):
    p = db.get(Post, post_id)
    if not p:
        raise HTTPException(404, "Post not found.")
    for k, v in body.model_dump(exclude={"slug", "event_starts_at"}).items():
        setattr(p, k, v)
    p.event_starts_at = _parse_dt(body.event_starts_at)
    if body.slug and body.slug != p.slug:
        p.slug = cms.unique_slug(db, body.slug, current_id=p.id)
    db.commit()
    return _post(p, full=True)


@router.post("/posts/{post_id}/publish")
def publish_post(post_id: int, body: PublishChange, staff: StaffUser = Depends(ops), db: Session = Depends(get_db)):
    p = db.get(Post, post_id)
    if not p:
        raise HTTPException(404, "Post not found.")
    if body.publish:
        if not p.title.strip() or (p.kind != "press" and not p.body.strip()):
            raise HTTPException(409, "Add a title and some text before publishing.")
        if p.kind == "event" and not p.event_starts_at:
            raise HTTPException(409, "Add the event's date and time before publishing.")
        p.status = PostStatus.published
        p.published_at = _parse_dt(body.published_at) or p.published_at or local_now()
    else:
        p.status = PostStatus.draft
    db.commit()
    return _post(p, full=True)


@router.delete("/posts/{post_id}", status_code=204)
def delete_post(post_id: int, staff: StaffUser = Depends(admin_only), db: Session = Depends(get_db)):
    p = db.get(Post, post_id)
    if p:
        db.delete(p)
        db.commit()


@router.post("/markdown")
def preview_markdown(body: MarkdownIn, staff: StaffUser = Depends(ops)):
    return {"html": cms.render_markdown(body.text)}


@router.get("/pages")
def list_pages(staff: StaffUser = Depends(ops), db: Session = Depends(get_db)):
    return [{"id": pg.id, "path": pg.path, "title": pg.title, "intro": pg.intro, "body": pg.body, "image": pg.image,
             "published": pg.published, "updated_at": ser.iso(pg.updated_at)}
            for pg in db.scalars(select(PageContent).order_by(PageContent.path))]


@router.patch("/pages/{page_id}")
def update_page(page_id: int, body: PageIn, staff: StaffUser = Depends(ops), db: Session = Depends(get_db)):
    pg = db.get(PageContent, page_id)
    if not pg:
        raise HTTPException(404, "Page not found.")
    for k, v in body.model_dump().items():
        setattr(pg, k, v)
    db.commit()
    return {"id": pg.id, "published": pg.published}


@router.post("/uploads", status_code=201)
async def upload_image(file: UploadFile = File(...), staff: StaffUser = Depends(ops), db: Session = Depends(get_db)):
    ext = IMAGE_TYPES.get(file.content_type or "")
    if not ext:
        raise HTTPException(400, "Upload a JPEG, PNG, WebP or AVIF image.")
    data = await file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "Images must be 8 MB or smaller.")
    # Check the file really is the image type it claims to be.
    looks_right = {
        ".jpg": data.startswith(b"\xff\xd8\xff"),
        ".png": data.startswith(b"\x89PNG\r\n\x1a\n"),
        ".webp": data[:4] == b"RIFF" and data[8:12] == b"WEBP",
        ".avif": data[4:12] in (b"ftypavif", b"ftypavis"),
    }[ext]
    if not looks_right:
        raise HTTPException(400, "That file doesn't look like an image.")
    m = media_svc.save_bytes(db, data, ext, file.filename or "", media_dir=MEDIA_DIR)
    db.commit()
    return {"id": m.id, "url": m.url}


@router.get("/messages")
def list_messages(staff: StaffUser = Depends(ops), db: Session = Depends(get_db)):
    return [{"id": m.id, "name": m.name, "email": m.email, "topic": m.topic, "message": m.message, "handled": m.handled,
             "created_at": ser.iso(m.created_at)}
            for m in db.scalars(select(ContactMessage).order_by(ContactMessage.created_at.desc()).limit(200))]


@router.post("/messages/{message_id}/handled")
def message_handled(message_id: int, staff: StaffUser = Depends(ops), db: Session = Depends(get_db)):
    m = db.get(ContactMessage, message_id)
    if not m:
        raise HTTPException(404, "Message not found.")
    m.handled = not m.handled
    db.commit()
    return {"id": m.id, "handled": m.handled}



# Website editing: content documents, image library, products

from fastapi import BackgroundTasks  # noqa: E402

from app.models import Media, SiteContent  # noqa: E402
from app.schemas import ContentSave, MediaPatch, ProductIn, ProductPatch, VariantIn  # noqa: E402
from app.services import media as media_svc  # noqa: E402
from app.site import store  # noqa: E402
from app.site.defaults import DOCUMENTS  # noqa: E402


@router.get("/content")
def list_content(staff: StaffUser = Depends(ops), db: Session = Depends(get_db)):
    rows = {r.key: r for r in db.scalars(select(SiteContent))}
    return [{"key": k, "title": spec["title"], "help": spec["help"], "customised": k in rows,
             "updated_at": ser.iso(rows[k].updated_at) if k in rows else None,
             "updated_by": rows[k].updated_by if k in rows else ""} for k, spec in DOCUMENTS.items()]


@router.get("/content/{key}")
def get_content(key: str, staff: StaffUser = Depends(ops), db: Session = Depends(get_db)):
    spec = DOCUMENTS.get(key)
    if not spec:
        raise HTTPException(404, "Unknown content.")
    return {"key": key, "title": spec["title"], "help": spec["help"], "value": store.load(db).docs[key],
            "locked": spec.get("locked", []), "readonly": spec.get("readonly", []),
            "customised": db.get(SiteContent, key) is not None}


@router.put("/content/{key}")
def save_content(key: str, body: ContentSave, staff: StaffUser = Depends(admin_only), db: Session = Depends(get_db)):
    return {"value": store.save(db, key, body.value, staff.name)}


@router.post("/content/{key}/reset")
def reset_content(key: str, staff: StaffUser = Depends(admin_only), db: Session = Depends(get_db)):
    if key not in DOCUMENTS:
        raise HTTPException(404, "Unknown content.")
    store.reset(db, key)
    return {"value": store.load(db).docs[key]}


@router.get("/media")
def list_media(q: str = "", staff: StaffUser = Depends(ops), db: Session = Depends(get_db)):
    query = select(Media).order_by(Media.created_at.desc(), Media.id.desc())
    rows = [m for m in db.scalars(query.limit(1000)) if not q or q.lower() in (m.filename + " " + m.alt).lower()]
    borrowed = len(media_svc.borrowed_urls(db, store.load(db).docs))
    return {"items": [{"id": m.id, "url": m.url, "filename": m.filename, "alt": m.alt, "size_bytes": m.size_bytes,
                       "from_wordpress": bool(m.source_url), "created_at": ser.iso(m.created_at)} for m in rows],
            "still_on_wordpress": borrowed, "import": media_svc.STATUS}


@router.patch("/media/{media_id}")
def patch_media(media_id: int, body: MediaPatch, staff: StaffUser = Depends(ops), db: Session = Depends(get_db)):
    m = db.get(Media, media_id)
    if not m:
        raise HTTPException(404, "Image not found.")
    m.alt = body.alt.strip()
    db.commit()
    return {"id": m.id, "alt": m.alt}


def _run_import():
    from app.db import SessionLocal
    with SessionLocal() as db:
        media_svc.import_wordpress(db, store.load(db).docs)


@router.post("/media/import-wordpress", status_code=202)
def import_wordpress(background: BackgroundTasks, staff: StaffUser = Depends(admin_only)):
    if media_svc.STATUS["running"]:
        raise HTTPException(409, "The import is already running.")
    media_svc.STATUS.update(running=True, total=0, done=0, copied=0, failed=[], finished_at=None)
    background.add_task(_run_import)
    return media_svc.STATUS


@router.post("/shop/products", status_code=201)
def create_product(body: ProductIn, staff: StaffUser = Depends(admin_only), db: Session = Depends(get_db)):
    from app.services.content import unique_slug
    p = Product(**body.model_dump(), slug=unique_slug(db, body.name, model=Product),
                sort=(db.scalar(select(func.max(Product.sort))) or 0) + 1)
    db.add(p)
    db.commit()
    return {"id": p.id, "slug": p.slug}


@router.patch("/shop/products/{product_id}")
def patch_product(product_id: int, body: ProductPatch, staff: StaffUser = Depends(admin_only), db: Session = Depends(get_db)):
    p = db.get(Product, product_id)
    if not p:
        raise HTTPException(404, "Product not found.")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(p, k, v)
    db.commit()
    return {"id": p.id}


@router.post("/shop/products/{product_id}/variants", status_code=201)
def add_variant(product_id: int, body: VariantIn, staff: StaffUser = Depends(admin_only), db: Session = Depends(get_db)):
    p = db.get(Product, product_id)
    if not p:
        raise HTTPException(404, "Product not found.")
    if any(v.size == body.size and (v.scent or "") == body.scent for v in p.variants):
        raise HTTPException(409, "That size and scent already exists for this product.")
    sku = "-".join(x for x in [p.slug, body.size, body.scent] if x).upper().replace(" ", "")[:55]
    while db.scalar(select(ProductVariant).where(ProductVariant.sku == sku)):
        sku = sku[:52] + "-" + _secrets.token_hex(1).upper()
    v = ProductVariant(product_id=p.id, sku=sku, **body.model_dump())
    db.add(v)
    db.commit()
    return {"id": v.id, "sku": v.sku}
