"""Stripe integration.

Flow:
- At booking, the client saves a card through a SetupIntent (Stripe Elements in the embed).
- Once staff have counted and priced the garments, they charge the order off-session.
- Memberships are Stripe subscriptions started through Checkout; webhooks keep our copy in sync.
"""
from datetime import datetime, timezone

import stripe
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import (
    Client,
    Membership,
    MembershipPlan,
    MembershipStatus,
    Order,
    PaymentStatus,
    ProcessedWebhook,
)
from app.services import orders as order_svc
from app.services.clock import local_now


def _stripe() -> stripe.StripeClient:
    settings = get_settings()
    if not settings.stripe_enabled:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            f"Card payments aren't switched on yet. Please try again soon, or email {settings.contact_address}.")
    return stripe.StripeClient(settings.stripe_secret_key)


def ensure_customer(db: Session, client: Client) -> str:
    sc = _stripe()
    if client.stripe_customer_id:
        # A customer made with test keys doesn't exist once live keys are in use (and vice versa): start afresh.
        try:
            existing = sc.v1.customers.retrieve(client.stripe_customer_id).to_dict()
            if not existing.get("deleted"):
                return client.stripe_customer_id
        except stripe.InvalidRequestError:
            pass
        client.stripe_customer_id, client.has_card_on_file = None, False
    customer = sc.v1.customers.create(params={
        "email": client.email,
        "name": client.full_name,
        "phone": client.phone or None,
        "metadata": {"lave_client_id": str(client.id)},
    })
    client.stripe_customer_id = customer.id
    db.commit()
    return customer.id


def create_setup_intent(db: Session, client: Client) -> str:
    customer_id = ensure_customer(db, client)
    intent = _stripe().v1.setup_intents.create(params={
        "customer": customer_id,
        "usage": "off_session",
        "automatic_payment_methods": {"enabled": True, "allow_redirects": "never"},
    })
    return intent.client_secret


def _default_payment_method(sc: stripe.StripeClient, customer_id: str) -> str | None:
    customer = sc.v1.customers.retrieve(customer_id).to_dict()
    pm = (customer.get("invoice_settings") or {}).get("default_payment_method")
    if pm:
        return pm if isinstance(pm, str) else pm.get("id")
    methods = sc.v1.customers.payment_methods.list(customer_id, params={"limit": 1})
    return methods.data[0].id if methods.data else None


def charge_order(db: Session, order: Order, staff_id: int | None) -> Order:
    if order.payment_status == PaymentStatus.paid:
        raise HTTPException(status.HTTP_409_CONFLICT, "This order is already paid.")
    if not order.items:
        raise HTTPException(status.HTTP_409_CONFLICT, "Add and price the garments before charging.")
    amount = order.total_pence
    if amount <= 0:
        order.payment_status = PaymentStatus.waived
        order_svc.log(db, order, "payment", "Nothing to charge", staff_id, visible=False)
        db.commit()
        return order

    sc = _stripe()
    client = order.client
    if not client.stripe_customer_id:
        raise HTTPException(status.HTTP_409_CONFLICT, "This client has no card on file. Ask them to add one from their account.")
    pm = _default_payment_method(sc, client.stripe_customer_id)
    if not pm:
        raise HTTPException(status.HTTP_409_CONFLICT, "This client has no card on file. Ask them to add one from their account.")

    try:
        intent = sc.v1.payment_intents.create(
            params={
                "amount": amount,
                "currency": "gbp",
                "customer": client.stripe_customer_id,
                "payment_method": pm,
                "off_session": True,
                "confirm": True,
                "description": f"LAVE order {order.ref}",
                "metadata": {"lave_order_id": str(order.id), "lave_order_ref": order.ref},
            },
            # Same order + same amount never charges twice, even on a retried click.
            # Same order, amount and card never charge twice; a new card (after a decline) gets a fresh attempt.
            options={"idempotency_key": f"order-{order.id}-{amount}-{pm}"},
        )
    except stripe.CardError as exc:
        order.payment_status = PaymentStatus.failed
        order_svc.log(db, order, "payment_failed", exc.user_message or "Card declined", staff_id, visible=False)
        db.commit()
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, f"Card declined: {exc.user_message or 'no reason given'}. Ask the client to update their card.") from exc

    order.stripe_payment_intent_id = intent.id
    if intent.status == "succeeded":
        _mark_paid(db, order, staff_id)
    else:
        order.payment_status = PaymentStatus.failed
        order_svc.log(db, order, "payment_failed", f"Stripe status: {intent.status}", staff_id, visible=False)
    db.commit()
    return order


def _mark_paid(db: Session, order: Order, staff_id: int | None = None) -> None:
    if order.payment_status == PaymentStatus.paid:
        return
    order.payment_status = PaymentStatus.paid
    order.paid_at = local_now()
    order_svc.log(db, order, "payment", f"Paid £{order.total_pence / 100:.2f}", staff_id)


def plan_amount(db: Session, code: str, interval: str) -> int:
    """What the membership costs per month or year, from the plans edited in /admin → Website."""
    from app.site import store
    plan = store.load(db).plan(code) or {}
    return int(plan.get("annual_pence" if interval == "year" else "price_pence") or 0)


def membership_price(db: Session, code: str, interval: str = "month") -> str:
    """The Stripe Price for a plan, created or replaced automatically so it always matches the admin's price.

    Prices are found by lookup key (lave_<plan>_<month|year>). When the amount in /admin changes, a new Price takes
    over the lookup key and the old one is archived; existing members keep paying what they signed up for.
    A price ID set in Render (LAVE_STRIPE_PRICE_<PLAN>[_ANNUAL]) overrides all this.
    """
    if override := get_settings().stripe_price_for(code, interval):
        return override
    amount = plan_amount(db, code, interval)
    if amount <= 0:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "This membership isn't available online yet.")
    from app.site import store
    name = (store.load(db).plan(code) or {}).get("name", code.title())
    sc, key = _stripe(), f"lave_{code}_{interval}"
    current = next(iter(sc.v1.prices.list(params={"lookup_keys": [key], "active": True, "limit": 1}).data), None)
    if current and current.unit_amount == amount and current.currency == "gbp":
        return current.id
    product_id = f"lave_membership_{code}"
    try:
        sc.v1.products.update(product_id, params={"name": f"LAVE {name} membership", "active": True})
    except stripe.InvalidRequestError:
        sc.v1.products.create(params={"id": product_id, "name": f"LAVE {name} membership", "metadata": {"plan": code}})
    price = sc.v1.prices.create(params={
        "product": product_id, "currency": "gbp", "unit_amount": amount, "recurring": {"interval": interval},
        "lookup_key": key, "transfer_lookup_key": True, "nickname": f"{name} {'annual' if interval == 'year' else 'monthly'}",
        "metadata": {"plan": code},
    })
    if current:
        sc.v1.prices.update(current.id, params={"active": False})
    return price.id


def membership_checkout(db: Session, client: Client, plan: MembershipPlan, success_url: str, cancel_url: str,
                        interval: str = "month") -> str:
    price = membership_price(db, plan.value, interval)
    if client.membership and client.membership.status == MembershipStatus.active:
        raise HTTPException(status.HTTP_409_CONFLICT, "You already have an active membership. Manage it from your account.")
    customer_id = ensure_customer(db, client)
    session = _stripe().v1.checkout.sessions.create(params={
        "mode": "subscription",
        "customer": customer_id,
        "line_items": [{"price": price, "quantity": 1}],
        "success_url": success_url,
        "cancel_url": cancel_url,
        "client_reference_id": str(client.id),
        "subscription_data": {"metadata": {"lave_client_id": str(client.id), "plan": plan.value}},
    })
    return session.url


PAUSE_MONTHS = (1, 2, 3)


def pause_membership(db: Session, client: Client, months: int) -> Membership:
    """Pause a monthly membership: Stripe voids the invoices in between, and member benefits stop until it resumes."""
    m = client.membership
    if not m or not m.stripe_subscription_id or m.status != MembershipStatus.active:
        raise HTTPException(status.HTTP_409_CONFLICT, "There's no active membership to pause.")
    if m.paused:
        raise HTTPException(status.HTTP_409_CONFLICT, "Your membership is already paused.")
    if m.billing_interval == "year":
        raise HTTPException(status.HTTP_409_CONFLICT, "Annual memberships can't be paused. Email us and we'll help.")
    if months not in PAUSE_MONTHS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Choose a pause of 1, 2 or 3 months.")
    resumes = _add_months(local_now(), months)
    _stripe().v1.subscriptions.update(m.stripe_subscription_id, params={
        "pause_collection": {"behavior": "void", "resumes_at": int(resumes.replace(tzinfo=timezone.utc).timestamp())}})
    m.paused, m.resumes_at = True, resumes
    db.commit()
    return m


def resume_membership(db: Session, client: Client) -> Membership:
    m = client.membership
    if not m or not m.paused or not m.stripe_subscription_id:
        raise HTTPException(status.HTTP_409_CONFLICT, "Your membership isn't paused.")
    _stripe().v1.subscriptions.update(m.stripe_subscription_id, params={"pause_collection": ""})
    m.paused, m.resumes_at = False, None
    db.commit()
    return m


def _add_months(when: datetime, months: int) -> datetime:
    import calendar
    month = when.month - 1 + months
    year, month = when.year + month // 12, month % 12 + 1
    return when.replace(year=year, month=month, day=min(when.day, calendar.monthrange(year, month)[1]))


def billing_portal(db: Session, client: Client, return_url: str) -> str:
    customer_id = ensure_customer(db, client)
    session = _stripe().v1.billing_portal.sessions.create(params={"customer": customer_id, "return_url": return_url})
    return session.url


SUB_STATUS = {
    "active": MembershipStatus.active,
    "paused": MembershipStatus.active,  # still a member, just paused (see Membership.paused)
    "trialing": MembershipStatus.active,
    "past_due": MembershipStatus.past_due,
    "unpaid": MembershipStatus.past_due,
    "canceled": MembershipStatus.cancelled,
    "incomplete_expired": MembershipStatus.cancelled,
    "incomplete": MembershipStatus.pending,
}


def handle_webhook(db: Session, payload: bytes, signature: str | None) -> str:
    settings = get_settings()
    sc = _stripe()
    try:
        event = sc.construct_event(payload, signature, settings.stripe_webhook_secret)
    except (ValueError, stripe.SignatureVerificationError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid webhook signature") from exc

    if db.scalar(select(ProcessedWebhook).where(ProcessedWebhook.event_id == event.id)):
        return "duplicate"

    # Plain dicts: Stripe's objects don't support .get() in this library version.
    raw = event.data.object
    obj = raw.to_dict() if hasattr(raw, "to_dict") else dict(raw)
    meta = obj.get("metadata") or {}
    kind = event.type

    if kind == "setup_intent.succeeded":
        client = db.scalar(select(Client).where(Client.stripe_customer_id == obj.get("customer")))
        if client:
            sc.v1.customers.update(obj["customer"], params={"invoice_settings": {"default_payment_method": obj.get("payment_method")}})
            client.has_card_on_file = True

    elif kind == "checkout.session.completed" and meta.get("lave_shop_order"):
        from app.services import shop
        order = shop.by_ref(db, meta["lave_shop_order"])
        if order and obj.get("payment_status") == "paid":
            details = obj.get("customer_details") or {}
            shipping = obj.get("shipping_details") or (obj.get("collected_information") or {}).get("shipping_details") or {}
            shop.mark_paid(db, order, email=details.get("email") or "",
                           address=dict(shipping.get("address") or {}, name=shipping.get("name") or ""))

    elif kind == "payment_intent.succeeded":
        order_id = meta.get("lave_order_id")
        if order_id and (order := db.get(Order, int(order_id))):
            _mark_paid(db, order)

    elif kind == "payment_intent.payment_failed":
        order_id = meta.get("lave_order_id")
        if order_id and (order := db.get(Order, int(order_id))) and order.payment_status != PaymentStatus.paid:
            order.payment_status = PaymentStatus.failed

    elif kind in ("customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted",
                  "customer.subscription.paused", "customer.subscription.resumed"):
        client_id, plan = meta.get("lave_client_id"), meta.get("plan")
        items = (obj.get("items") or {}).get("data") or [{}]
        # If the member switched plan in Stripe's billing portal, the price says which plan they're on now.
        price = items[0].get("price") or {}
        price_plan = (price.get("metadata") or {}).get("plan") or ((price.get("lookup_key") or "").split("_") + ["", ""])[1]
        if price_plan in {p.value for p in MembershipPlan}:
            plan = price_plan
        if client_id and plan and (client := db.get(Client, int(client_id))):
            m = client.membership or Membership(client_id=client.id, plan=MembershipPlan(plan))
            m.plan = MembershipPlan(plan)
            m.stripe_subscription_id = obj.get("id")
            m.status = MembershipStatus.cancelled if kind.endswith("deleted") else SUB_STATUS.get(obj.get("status"), MembershipStatus.pending)
            m.billing_interval = ((price.get("recurring") or {}).get("interval")) or m.billing_interval
            # Two kinds of pause in Stripe: a paused subscription, or an active one whose payments are paused.
            pause = obj.get("pause_collection") or {}
            m.paused = obj.get("status") == "paused" or bool(pause)
            m.resumes_at = (datetime.fromtimestamp(pause["resumes_at"], tz=timezone.utc).replace(tzinfo=None)
                            if m.paused and pause.get("resumes_at") else None)
            period_end = obj.get("current_period_end") or items[0].get("current_period_end")
            if period_end:
                m.current_period_end = datetime.fromtimestamp(period_end, tz=timezone.utc).replace(tzinfo=None)
            db.add(m)

    db.add(ProcessedWebhook(event_id=event.id))
    db.commit()
    return kind
