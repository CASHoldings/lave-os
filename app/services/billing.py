"""Paying for orders: at booking, after the atelier's review, and LAVE account credit.

- At booking the client pays for every fixed-price item on their list, plus the collection & delivery charge. Quote
  items aren't charged until they've been priced. Any LAVE account credit is used first.
- After review: if the reviewed total is higher, the difference is charged to the saved card; if lower, it's credited
  to the client's LAVE account (or refunded to the card if they ask). If anything differs from what was booked, the
  order waits in "Awaiting customer call" until staff have agreed the change with the client.
- Credits don't expire unless admin sets an expiry (Settings → Collection & delivery).
"""
from collections import Counter
from datetime import datetime, timedelta

import stripe
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import (BookingStatus, Client, ClientCredit, Order, OrderPayment, OrderStatus, Pack, PaymentStatus,
                        Service, SiteSetting)
from app.services import orders as order_svc
from app.services.clock import local_now

PENDING_MINUTES = 30  # an unfinished card check at booking releases the slots after this
BOOKING_WORDING = ("You'll pay for your items now. Once our atelier has checked them, we'll settle any difference: extra "
                   "is charged to your saved card, and anything we owe you is credited to your LAVE account, or "
                   "refunded if you prefer. If anything needs changing, we'll call you first.")


def pounds(pence: int) -> str:
    return f"£{pence / 100:.2f}"


# LAVE account credit

def credit_expiry_days(db: Session) -> int | None:
    row = db.get(SiteSetting, "billing.credit_expiry_days")
    return int(row.value) if row and row.value.strip().isdigit() and int(row.value) > 0 else None


def set_credit_expiry_days(db: Session, days: int | None) -> None:
    row = db.get(SiteSetting, "billing.credit_expiry_days") or SiteSetting(key="billing.credit_expiry_days")
    row.value = str(days) if days else ""
    db.add(row)
    db.commit()


def credit_balance(db: Session, client: Client) -> int:
    now = local_now()
    rows = db.scalars(select(ClientCredit).where(ClientCredit.client_id == client.id)).all()
    return max(0, sum(r.amount_pence for r in rows if r.amount_pence < 0 or r.expires_at is None or r.expires_at > now))


def add_credit(db: Session, client: Client, amount: int, reason: str, order: Order | None = None, by: str = "") -> None:
    days = credit_expiry_days(db) if amount > 0 else None
    db.add(ClientCredit(client_id=client.id, order_id=order.id if order else None, amount_pence=amount, reason=reason[:300],
                        by=by, expires_at=local_now() + timedelta(days=days) if days else None))


def credit_history(db: Session, client: Client) -> list[dict]:
    rows = db.scalars(select(ClientCredit).where(ClientCredit.client_id == client.id).order_by(ClientCredit.id.desc()).limit(100))
    return [{"amount_pence": r.amount_pence, "reason": r.reason, "at": r.created_at.isoformat() if r.created_at else None,
             "expires_at": r.expires_at.isoformat() if r.expires_at else None} for r in rows]


# At booking

def booked_items_pence(order: Order) -> int:
    """Fixed-price items on the booked list (quote and measured items are priced after inspection)."""
    return sum(line["unit_pence"] * line["qty"] for line in order.requested_items or [] if not line.get("priced_later"))


def booking_due(order: Order) -> int:
    return booked_items_pence(order) + order.fees_pence


def _card(sc, client: Client) -> str:
    from app.services.payments import _default_payment_method
    pm = _default_payment_method(sc, client.stripe_customer_id) if client.stripe_customer_id else None
    if not pm:
        raise HTTPException(402, "Add a card to book. We charge it for your items now and settle any difference later.")
    return pm


def _record(db: Session, order: Order, payment: OrderPayment, staff_id: int | None = None) -> None:
    payment.status = "succeeded"
    order.stripe_payment_intent_id = payment.stripe_id or order.stripe_payment_intent_id
    note = {"booking": "Paid at booking", "adjustment": "Paid after review", "refund": "Refunded to card"}[payment.kind]
    order_svc.log(db, order, "payment", f"{note}: {pounds(abs(payment.amount_pence))}", staff_id)
    if payment.kind != "booking":
        _update_status(order)


def _update_status(order: Order) -> None:
    """"Paid" means settled after the atelier's review (paying at booking alone doesn't settle an order)."""
    if order.items and order.balance_pence <= 0:
        order.payment_status = PaymentStatus.paid
        order.paid_at = order.paid_at or local_now()


def take_booking_payment(db: Session, order: Order) -> dict:
    """Charge what's due at booking, after any account credit. Raises 402 if the card is declined (the caller rolls
    the booking back). Returns {"status": "paid" | "none" | "requires_action", "amount_pence", "client_secret"?}."""
    due = booking_due(order)
    used = min(credit_balance(db, order.client), due)
    if used:
        add_credit(db, order.client, -used, f"Used for order {order.ref}", order)
        order.credit_used_pence = used
        order_svc.log(db, order, "payment", f"{pounds(used)} of LAVE account credit used")
    amount = due - used
    if amount <= 0:
        return {"status": "none", "amount_pence": 0}
    if not get_settings().stripe_enabled:
        return {"status": "none", "amount_pence": 0}  # this machine: no card payments, staff charge later
    from app.services.payments import _stripe
    sc = _stripe()
    pm = _card(sc, order.client)
    payment = OrderPayment(order_id=order.id, kind="booking", amount_pence=amount)
    order.payments.append(payment)
    db.flush()
    try:
        intent = sc.v1.payment_intents.create(params={
            "amount": amount, "currency": "gbp", "customer": order.client.stripe_customer_id, "payment_method": pm,
            "confirm": True, "automatic_payment_methods": {"enabled": True, "allow_redirects": "never"},
            "description": f"LAVE order {order.ref}",
            "metadata": {"lave_order_id": str(order.id), "lave_order_ref": order.ref, "lave_payment_id": str(payment.id)},
        }, options={"idempotency_key": f"lave-payment-{payment.id}"})
    except stripe.CardError as exc:
        raise HTTPException(402, f"Your card was declined: {exc.user_message or 'no reason given'}. "
                                 "Try another card, or contact your bank.") from exc
    payment.stripe_id = intent.id
    if intent.status == "succeeded":
        _record(db, order, payment)
        return {"status": "paid", "amount_pence": amount}
    if intent.status == "requires_action":
        return {"status": "requires_action", "amount_pence": amount, "client_secret": intent.client_secret}
    raise HTTPException(402, "Your card couldn't be charged. Try another card.")


def cancel_unpaid(db: Session, order: Order, reason: str) -> None:
    """A booking whose payment didn't complete: release its slots and cancel it."""
    for b in order.bookings:
        if b.status == BookingStatus.scheduled:
            b.status = BookingStatus.cancelled
    for p in order.payments:
        if p.status == "pending":
            p.status = "failed"
    if order.credit_used_pence:
        add_credit(db, order.client, order.credit_used_pence, f"Returned: order {order.ref} wasn't completed", order)
        order.credit_used_pence = 0
    order.status = OrderStatus.cancelled
    order_svc.log(db, order, "cancelled", reason, visible=False)


def confirm_booking_payment(db: Session, order: Order) -> str:
    """After the client completed a card check (3D Secure): did the payment go through?"""
    pending = next((p for p in order.payments if p.kind == "booking" and p.status == "pending"), None)
    if not pending:
        return "paid" if any(p.kind == "booking" and p.status == "succeeded" for p in order.payments) else "none"
    from app.services.payments import _stripe
    intent = _stripe().v1.payment_intents.retrieve(pending.stripe_id)
    if intent.status == "succeeded":
        _record(db, order, pending)
        return "paid"
    if intent.status in ("requires_payment_method", "canceled"):
        cancel_unpaid(db, order, "Card check not completed at booking")
        return "failed"
    return "pending"


def sweep_unfinished(db: Session, now: datetime | None = None) -> int:
    """Release bookings whose card check was abandoned. Runs in the background."""
    cutoff = (now or local_now()) - timedelta(minutes=PENDING_MINUTES)
    rows = db.scalars(select(OrderPayment).where(OrderPayment.kind == "booking", OrderPayment.status == "pending",
                                                 OrderPayment.created_at < cutoff)).all()
    done = 0
    for p in rows:
        order = db.get(Order, p.order_id)
        if order and confirm_booking_payment(db, order) in ("pending", "failed"):
            if order.status != OrderStatus.cancelled:
                cancel_unpaid(db, order, "Card check not completed within 30 minutes")
            done += 1
    db.commit()
    return done


# After review

def _booked_counts(db: Session, order: Order) -> tuple[Counter, dict[int, int]]:
    """Booked pieces by price-list item (curated packs opened up), and the booked unit price of each."""
    counts, prices = Counter(), {}
    for line in order.requested_items or []:
        if line.get("kind") == "item":
            counts[line["id"]] += line["qty"]
            prices[line["id"]] = line["unit_pence"]
        elif line.get("kind") == "pack" and (pack := db.get(Pack, line["id"])):
            for x in pack.items or []:
                counts[x["service_id"]] += int(x["qty"]) * line["qty"]
                if (s := db.get(Service, x["service_id"])):
                    prices.setdefault(s.id, s.price_pence)
    return counts, prices


def revisions(db: Session, order: Order) -> list[str]:
    """What the review changed from the booking: count, item type, price, an item that's quote-only, a short pack."""
    from app.services import repository as repo
    out = []
    services = {s.id: s for s in db.scalars(select(Service).where(Service.id.in_({g.service_id for g in order.items if g.service_id})))}
    if order.requested_items:
        booked, prices = _booked_counts(db, order)
        found = Counter(g.service_id for g in order.items)
        names = {sid: (services.get(sid) or db.get(Service, sid)).name for sid in set(booked) | set(found) if sid and (services.get(sid) or db.get(Service, sid))}
        for sid in sorted(set(booked) | set(found), key=lambda x: names.get(x, "")):
            if sid is None:
                out.append(f"{found[None]} item(s) not on the price list")
            elif booked[sid] != found[sid]:
                out.append(f"{names.get(sid, 'Item')}: booked {booked[sid]}, found {found[sid]}")
        for g in order.items:
            s = services.get(g.service_id)
            if not s:
                continue
            if s.sale_mode == "quote" and not booked[s.id]:
                out.append(f"{g.description}: needs a quote (not booked as one)")
            elif booked[s.id] and s.sale_mode not in repo.PRICED_LATER and g.price_pence != prices.get(s.id, g.price_pence):
                out.append(f"{g.description}: price {pounds(g.price_pence)}, booked at {pounds(prices[s.id])}")
    staples = sum(1 for g in order.items if (s := services.get(g.service_id)) and s.sale_mode == repo.STAPLE)
    eligible = sum(1 for g in order.items if (s := services.get(g.service_id)) and s.sale_mode in repo.PACK_ELIGIBLE)
    if short := repo.pack_shortfall(staples, eligible, repo.rules(db)["pack_minimum"]):
        out.append(f"Pack is {short} short of the minimum")
    return list(dict.fromkeys(out))


def settle(db: Session, order: Order, staff_id: int | None = None) -> dict:
    """Charge the difference to the saved card, or credit what we owe to the client's LAVE account. Caller commits.
    Returns {"charged": pence} or {"credited": pence} or {} (nothing to do), plus "error" if the card failed."""
    from app.services import delivery
    delivery.settle(db, order)  # the collection & delivery charge follows the reviewed order value
    db.flush()
    balance = order.balance_pence
    if balance < 0:
        add_credit(db, order.client, -balance, f"Order {order.ref} came to less than you paid", order)
        order.credited_pence += -balance
        order_svc.log(db, order, "payment", f"{pounds(-balance)} credited to your LAVE account", staff_id)
        _update_status(order)
        return {"credited": -balance}
    if balance == 0:
        _update_status(order)
        return {}
    if not get_settings().stripe_enabled:
        return {"error": "Card payments aren't switched on, so the difference wasn't charged."}
    from app.services.payments import _stripe
    sc = _stripe()
    try:
        pm = _card(sc, order.client)
    except HTTPException as e:
        order.payment_status = PaymentStatus.unpaid
        return {"error": "No card on file: " + e.detail}
    payment = OrderPayment(order_id=order.id, kind="adjustment", amount_pence=balance)
    order.payments.append(payment)
    db.flush()
    try:
        intent = sc.v1.payment_intents.create(params={
            "amount": balance, "currency": "gbp", "customer": order.client.stripe_customer_id, "payment_method": pm,
            "off_session": True, "confirm": True, "description": f"LAVE order {order.ref} (after review)",
            "metadata": {"lave_order_id": str(order.id), "lave_order_ref": order.ref, "lave_payment_id": str(payment.id)},
        }, options={"idempotency_key": f"lave-payment-{payment.id}"})
    except stripe.CardError as exc:
        payment.status = "failed"
        order.payment_status = PaymentStatus.failed
        order_svc.log(db, order, "payment_failed", exc.user_message or "Card declined", staff_id, visible=False)
        return {"error": f"Card declined: {exc.user_message or 'no reason given'}. Ask the client to update their card."}
    payment.stripe_id = intent.id
    if intent.status == "succeeded":
        _record(db, order, payment, staff_id)
        return {"charged": balance}
    payment.status = "failed"
    order.payment_status = PaymentStatus.failed
    return {"error": f"The card needs the client's approval (Stripe status {intent.status}). Ask them to update their card."}


def refund_credit(db: Session, client: Client, amount: int, by: str) -> int:
    """Refund LAVE account credit to the client's card, from their most recent payments. Returns the amount refunded."""
    amount = min(amount, credit_balance(db, client))
    if amount <= 0:
        raise HTTPException(409, "There's no account credit to refund.")
    from app.services.payments import _stripe
    sc = _stripe()
    paid = db.scalars(select(OrderPayment).join(Order).where(Order.client_id == client.id, OrderPayment.status == "succeeded",
                                                             OrderPayment.amount_pence > 0, OrderPayment.stripe_id != "")
                      .order_by(OrderPayment.id.desc())).all()
    left = amount
    for p in paid:
        already = -sum(r.amount_pence for r in db.scalars(select(OrderPayment).where(OrderPayment.kind == "refund",
                                                                                      OrderPayment.stripe_id == p.stripe_id)))
        room = p.amount_pence - already
        if left <= 0 or room <= 0:
            continue
        part = min(left, room)
        sc.v1.refunds.create(params={"payment_intent": p.stripe_id, "amount": part},
                             options={"idempotency_key": f"lave-refund-{p.id}-{already}-{part}"})
        order = db.get(Order, p.order_id)
        order.payments.append(OrderPayment(order_id=p.order_id, kind="refund", amount_pence=-part, status="succeeded",
                                           stripe_id=p.stripe_id))
        order_svc.log(db, order, "payment", f"{pounds(part)} of account credit refunded to card")
        left -= part
    refunded = amount - left
    if not refunded:
        raise HTTPException(409, "No card payment to refund against. Refund by bank transfer instead.")
    add_credit(db, client, -refunded, "Refunded to card", by=by)
    db.commit()
    return refunded


def unpaid_count(db: Session) -> int:
    return db.scalar(select(func.count()).select_from(OrderPayment).where(OrderPayment.status == "pending")) or 0
