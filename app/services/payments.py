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
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Card payments aren't set up yet. Add the Stripe keys to the server settings.")
    return stripe.StripeClient(settings.stripe_secret_key)


def ensure_customer(db: Session, client: Client) -> str:
    if client.stripe_customer_id:
        return client.stripe_customer_id
    customer = _stripe().v1.customers.create(params={
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
    customer = sc.v1.customers.retrieve(customer_id)
    pm = (customer.get("invoice_settings") or {}).get("default_payment_method")
    if pm:
        return pm if isinstance(pm, str) else pm.id
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


def membership_checkout(db: Session, client: Client, plan: MembershipPlan, success_url: str, cancel_url: str,
                        interval: str = "month") -> str:
    price = get_settings().stripe_price_for(plan.value, interval)
    if not price:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "This membership isn't available online yet.")
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


def billing_portal(db: Session, client: Client, return_url: str) -> str:
    customer_id = ensure_customer(db, client)
    session = _stripe().v1.billing_portal.sessions.create(params={"customer": customer_id, "return_url": return_url})
    return session.url


SUB_STATUS = {
    "active": MembershipStatus.active,
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

    obj = event.data.object
    kind = event.type

    if kind == "setup_intent.succeeded":
        client = db.scalar(select(Client).where(Client.stripe_customer_id == obj.customer))
        if client:
            sc.v1.customers.update(obj.customer, params={"invoice_settings": {"default_payment_method": obj.payment_method}})
            client.has_card_on_file = True

    elif kind == "checkout.session.completed" and (obj.metadata or {}).get("lave_shop_order"):
        from app.services import shop
        order = shop.by_ref(db, obj.metadata["lave_shop_order"])
        if order and obj.get("payment_status") == "paid":
            details = obj.get("customer_details") or {}
            shipping = (obj.get("shipping_details") or obj.get("collected_information", {}).get("shipping_details") or {})
            shop.mark_paid(db, order, email=details.get("email", ""), address=dict(shipping.get("address") or {}, name=shipping.get("name", "")))

    elif kind == "payment_intent.succeeded":
        order_id = (obj.metadata or {}).get("lave_order_id")
        if order_id and (order := db.get(Order, int(order_id))):
            _mark_paid(db, order)

    elif kind == "payment_intent.payment_failed":
        order_id = (obj.metadata or {}).get("lave_order_id")
        if order_id and (order := db.get(Order, int(order_id))) and order.payment_status != PaymentStatus.paid:
            order.payment_status = PaymentStatus.failed

    elif kind in ("customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"):
        meta = obj.metadata or {}
        client_id, plan = meta.get("lave_client_id"), meta.get("plan")
        if client_id and plan and (client := db.get(Client, int(client_id))):
            m = client.membership or Membership(client_id=client.id, plan=MembershipPlan(plan))
            m.plan = MembershipPlan(plan)
            m.stripe_subscription_id = obj.id
            m.status = MembershipStatus.cancelled if kind.endswith("deleted") else SUB_STATUS.get(obj.status, MembershipStatus.pending)
            period_end = obj.get("current_period_end") or (obj["items"]["data"][0].get("current_period_end") if obj.get("items") else None)
            if period_end:
                m.current_period_end = datetime.fromtimestamp(period_end, tz=timezone.utc).replace(tzinfo=None)
            db.add(m)

    db.add(ProcessedWebhook(event_id=event.id))
    db.commit()
    return kind
