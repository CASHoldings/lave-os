"""Paying at booking, the review afterwards, LAVE account credit, and the packs-of-5 rule (pricing rules, Oct 2026)."""
from types import SimpleNamespace

import pytest
import stripe
from sqlalchemy import select

from app.config import get_settings
from app.models import Client, ClientCredit, Garment, Membership, MembershipPlan, MembershipStatus, Order, Service
from app.services import billing, payments
from tests.test_flow import _address, _slots


class FakeStripe:
    """Payment intents and refunds, as LAVE OS uses them."""

    def __init__(self, status="succeeded", decline=False):
        self.created, self.refunds, self.status, self.decline = [], [], status, decline
        self.intents = {}
        outer = self

        class Intents:
            def create(self, params, options=None):
                if outer.decline:
                    raise stripe.CardError("Your card was declined.", None, "card_declined")
                pi = SimpleNamespace(id=f"pi_{len(outer.created) + 1}", status=outer.status, client_secret="secret_x",
                                     params=params)
                outer.created.append(pi)
                outer.intents[pi.id] = pi
                return pi

            def retrieve(self, pid):
                return outer.intents[pid]

        class Refunds:
            def create(self, params, options=None):
                outer.refunds.append(params)
                return SimpleNamespace(id="re_1")

        self.v1 = SimpleNamespace(payment_intents=Intents(), refunds=Refunds())


@pytest.fixture
def stripe_on(monkeypatch, db_session):
    fake = FakeStripe()
    monkeypatch.setattr(get_settings(), "stripe_secret_key", "sk_test_x")
    monkeypatch.setattr(payments, "_stripe", lambda: fake)
    monkeypatch.setattr(payments, "_default_payment_method", lambda sc, cid: "pm_card")
    with db_session() as db:
        for c in db.scalars(select(Client)):
            c.stripe_customer_id, c.has_card_on_file = "cus_1", True
        db.commit()
    return fake


def _set_card(db_session):
    with db_session() as db:
        for c in db.scalars(select(Client)):
            c.stripe_customer_id, c.has_card_on_file = "cus_1", True
        db.commit()


def _service(db_session, name):
    with db_session() as db:
        return db.scalar(select(Service.id).where(Service.name == name))


def _list(api, *pairs):
    api.cookies.set("lave_list", ",".join(f"i{i}:{q}" for i, q in pairs))


def _book(api, h, window="saver", **extra):
    saved = api.get("/api/me", headers=h).json()["addresses"]
    addr = saved[0]["id"] if saved else _address(api, h)
    slot = next(s for s in _slots(api, window=window) if s["day"] == "2026-10-06")
    return api.post("/api/me/bookings", headers=h, json={"collection": {"template_id": slot["template_id"], "day": slot["day"]},
                                                       "address_id": addr, **extra})


# Minimum order (rules 1, 2, 8, 9, 11)

def test_list_under_the_home_minimum_is_blocked_everywhere(api, client_headers, db_session):
    shirt = _service(db_session, "Shirt, non-member folded")
    knit = _service(db_session, "Knitwear, light")
    with db_session() as db:
        price = db.get(Service, shirt).price_pence
    _list(api, (shirt, 3))
    short = 3000 - 3 * price
    page = api.get("/atelier/list/").text
    assert "more to book a home collection: the minimum order is £30" in page and 'aria-disabled="true"' in page
    assert ">+ Shirt" in page and ">+ Knitwear" in page  # quick-add
    terms = api.get("/api/me/delivery-terms", headers=client_headers).json()["minimum"]
    assert terms["home_short_pence"] == short and terms["home_pence"] == 3000 and terms["dropoff_pence"] == 2000
    r = _book(api, client_headers)
    assert r.status_code == 409 and "the minimum order is £30" in r.json()["detail"]
    _list(api, (shirt, 3), (knit, 3))
    assert "minimum order" not in api.get("/atelier/list/").text
    r = _book(api, client_headers)
    assert r.status_code == 201 and r.json()["minimum_pence"] == 3000


def test_staples_no_longer_need_a_pack_of_5(api, client_headers, db_session):
    shirt = _service(db_session, "Shirt, non-member folded")
    coat = _service(db_session, "Coat, wash & press")
    _list(api, (shirt, 1), (coat, 1))  # one shirt is fine once the order reaches £30
    assert _book(api, client_headers).status_code == 201


def test_quotes_count_at_their_from_price(api, client_headers, db_session):
    with db_session() as db:
        quote = db.scalar(select(Service).where(Service.sale_mode == "quote", Service.active.is_(True), Service.show_online.is_(True),
                                                Service.price_pence >= 3000))
        quote_id = quote.id
    _list(api, (quote_id, 1))
    assert api.get("/api/me/delivery-terms", headers=client_headers).json()["minimum"]["home_short_pence"] == 0
    assert _book(api, client_headers).status_code == 201


def test_curated_packs_are_always_bookable(api, client_headers, db_session):
    from app.models import Pack
    with db_session() as db:
        pack = db.scalar(select(Pack).where(Pack.active.is_(True), Pack.show_online.is_(True)))
        pack_id = pack.id
    api.cookies.set("lave_list", f"p{pack_id}:1")
    terms = api.get("/api/me/delivery-terms", headers=client_headers).json()["minimum"]
    assert terms["applies"] is False and terms["home_short_pence"] == 0
    r = _book(api, client_headers)
    assert r.status_code == 201 and r.json()["minimum_pence"] == 0


def test_no_list_is_topped_up_to_the_minimum_at_review(api, client_headers, staff_headers, db_session):
    r = _book(api, client_headers)  # no list: allowed, the minimum applies at review
    assert r.status_code == 201 and r.json()["minimum_pence"] == 3000
    order_id = r.json()["id"]
    with db_session() as db:
        o = db.get(Order, order_id)
        o.items.append(Garment(tag_code=f"{o.ref}-01", description="Shirt", price_pence=599, service_id=_service(db_session, "Shirt, non-member hung")))
        db.commit()
        assert o.minimum_top_up_pence == 3000 - 599
        assert o.total_pence == 3000 + o.fees_pence
    detail = api.get(f"/api/staff/orders/{order_id}", headers=staff_headers).json()
    assert detail["minimum_top_up_pence"] == 2401
    # Staff can waive it.
    detail = api.patch(f"/api/staff/orders/{order_id}", headers=staff_headers, json={"minimum_pence": 0}).json()
    assert detail["minimum_top_up_pence"] == 0


def test_one_item_under_the_minimum_can_go_to_a_drop_off_but_not_home(api, client_headers, db_session):
    coat = _service(db_session, "Coat, long")  # £27.99: under £30, over £20
    _list(api, (coat, 1))
    terms = api.get("/api/me/delivery-terms", headers=client_headers).json()["minimum"]
    assert terms["home_short_pence"] > 0 and terms["dropoff_short_pence"] == 0
    assert _book(api, client_headers).status_code == 409


# Paying at booking

def test_items_and_delivery_are_paid_at_booking(api, client_headers, db_session, stripe_on):
    shirt = _service(db_session, "Shirt, non-member folded")  # £6.99
    _list(api, (shirt, 5))  # £34.95: under £45, so Saver is £4.95
    r = _book(api, client_headers)
    assert r.status_code == 201, r.text
    o = r.json()
    assert o["payment"] == {"status": "paid", "amount_pence": 3495 + 495}
    assert stripe_on.created[0].params["amount"] == 3990 and o["paid_pence"] == 3990 and o["balance_pence"] == 0


def test_quotes_arent_charged_at_booking(api, client_headers, db_session, stripe_on):
    with db_session() as db:
        quote = db.scalar(select(Service.id).where(Service.sale_mode == "quote", Service.active.is_(True)))
    _list(api, (quote, 1))
    o = _book(api, client_headers).json()
    assert o["payment"]["amount_pence"] == 495  # only the collection & delivery charge


def test_declined_card_undoes_the_booking(api, client_headers, db_session, stripe_on):
    stripe_on.decline = True
    r = _book(api, client_headers)
    assert r.status_code == 402 and "declined" in r.json()["detail"]
    assert api.get("/api/me/bookings", headers=client_headers).json() == []


def test_card_check_then_confirm(api, client_headers, db_session, stripe_on):
    stripe_on.status = "requires_action"
    o = _book(api, client_headers).json()
    assert o["payment"]["status"] == "requires_action" and o["payment"]["client_secret"] == "secret_x"
    stripe_on.intents["pi_1"].status = "succeeded"
    r = api.post(f"/api/me/orders/{o['ref']}/booking-payment", headers=client_headers)
    assert r.status_code == 200 and r.json()["paid_pence"] == 495


def test_abandoned_card_check_releases_the_slot(api, client_headers, db_session, stripe_on):
    from datetime import datetime
    stripe_on.status = "requires_action"
    o = _book(api, client_headers).json()
    stripe_on.intents["pi_1"].status = "requires_payment_method"
    with db_session() as db:
        assert billing.sweep_unfinished(db, datetime(2099, 1, 1)) == 1
    assert api.get(f"/api/me/orders/{o['ref']}", headers=client_headers).json()["status"] == "cancelled"


def test_credit_is_used_first(api, client_headers, db_session, stripe_on):
    with db_session() as db:
        c = db.scalar(select(Client).where(Client.email == "client@example.com"))
        billing.add_credit(db, c, 300, "Goodwill")
        db.commit()
    o = _book(api, client_headers).json()
    assert o["credit_used_pence"] == 300 and o["payment"]["amount_pence"] == 195


# After review

def _review(api, staff_headers, oid, items, note=""):
    api.patch(f"/api/staff/bookings/{api.get(f'/api/staff/orders/{oid}', headers=staff_headers).json()['bookings'][0]['id']}",
              headers=staff_headers, json={"status": "completed"})
    for svc, price in items:
        api.post(f"/api/staff/orders/{oid}/items", headers=staff_headers,
                 json={"description": "Piece", "service_id": svc, **({"price_pence": price} if price is not None else {})})
    return api.post(f"/api/staff/orders/{oid}/status", headers=staff_headers, json={"status": "inspected", "note": note}).json()


def test_review_matching_the_booking_settles_quietly(api, client_headers, staff_headers, db_session, stripe_on):
    shirt = _service(db_session, "Shirt, non-member folded")
    _list(api, (shirt, 5))
    o = _book(api, client_headers).json()
    r = _review(api, staff_headers, o["id"], [(shirt, None)] * 5)
    assert r["status"] == "inspected" and r["review"] == {} and r["balance_pence"] == 0


def test_changes_wait_for_a_call_then_charge_the_difference(api, client_headers, staff_headers, db_session, stripe_on):
    shirt = _service(db_session, "Shirt, non-member folded")
    _list(api, (shirt, 5))
    o = _book(api, client_headers).json()
    r = _review(api, staff_headers, o["id"], [(shirt, None)] * 6)  # one more than booked
    assert r["status"] == "awaiting_customer_call" and r["review"]["on_hold"] is True
    assert "booked 5, found 6" in r["call_notes"]
    assert api.get(f"/api/me/orders/{o['ref']}", headers=client_headers).json()["status_label"] == "We'll call you"
    assert len(stripe_on.created) == 1  # nothing charged before the call
    no_note = api.post(f"/api/staff/orders/{o['id']}/status", headers=staff_headers, json={"status": "inspected"})
    assert no_note.status_code == 400
    r = api.post(f"/api/staff/orders/{o['id']}/status", headers=staff_headers,
                 json={"status": "inspected", "note": "Client agreed the sixth shirt"}).json()
    # 6 × £6.99 = £41.94 (still under £45: £4.95) − paid £39.90 = £6.99 charged.
    assert r["status"] == "inspected" and r["review"] == {"charged": 699} and r["balance_pence"] == 0
    assert "Client agreed the sixth shirt" in r["call_notes"]


def test_quote_priced_after_review_and_crossing_45(api, client_headers, staff_headers, db_session, stripe_on):
    """A booked quote item is priced after inspection: no call needed. Reaching £45 frees the Saver charge."""
    knit = _service(db_session, "Knitwear, light")  # £12.99
    with db_session() as db:
        quote = db.scalar(select(Service.id).where(Service.sale_mode == "quote", Service.active.is_(True)))
    _list(api, (knit, 3), (quote, 1))  # £38.97 fixed + £4.95 Saver = £43.92 paid; the quote isn't charged yet
    o = _book(api, client_headers).json()
    assert o["paid_pence"] == 4392
    r = _review(api, staff_headers, o["id"], [(knit, None)] * 3 + [(quote, 1000)])
    # £48.97 reaches £45, so Saver is free: £48.97 due − £43.92 paid = £5.05 (the £10 quote less the £4.95 back).
    assert r["status"] == "inspected" and r["review"] == {"charged": 505} and r["fees_pence"] == 0


def test_lower_total_is_credited_and_can_be_refunded(api, client_headers, staff_headers, db_session, stripe_on):
    knit = _service(db_session, "Knitwear, light")
    _list(api, (knit, 4))  # £51.96, free Saver: £51.96 paid
    o = _book(api, client_headers).json()
    assert o["paid_pence"] == 5196
    r = _review(api, staff_headers, o["id"], [(knit, None)] * 3)  # one fewer: a call
    r = api.post(f"/api/staff/orders/{o['id']}/status", headers=staff_headers, json={"status": "inspected", "note": "3 only"}).json()
    # £38.97 is under £45, so the £4.95 Saver charge returns: £43.92 due, £51.96 paid → £8.04 credited.
    assert r["review"] == {"credited": 804} and r["balance_pence"] == 0
    credit = api.get("/api/me/credit", headers=client_headers).json()
    assert credit["balance_pence"] == 804
    cid = db_session().scalar(select(Client.id).where(Client.email == "client@example.com"))
    r = api.post(f"/api/staff/clients/{cid}/credit/refund", headers=staff_headers, json={})
    assert r.json() == {"refunded_pence": 804, "balance_pence": 0}
    assert stripe_on.refunds == [{"payment_intent": "pi_1", "amount": 804}]
    assert api.get(f"/api/staff/orders/{o['id']}", headers=staff_headers).json()["balance_pence"] == 0


def test_credit_expiry_is_a_setting(api, staff_headers, db_session):
    from datetime import timedelta
    from app.services import clock
    assert api.put("/api/staff/credit-expiry", headers=staff_headers, json={"days": 30}).json() == {"days": 30}
    with db_session() as db:
        c = db.scalar(select(Client).limit(1)) or Client(email="x@example.com")
        db.add(c)
        db.flush()
        billing.add_credit(db, c, 500, "Test")
        db.commit()
        assert billing.credit_balance(db, c) == 500
        row = db.scalar(select(ClientCredit).where(ClientCredit.client_id == c.id))
        assert row.expires_at is not None
        clock.freeze(clock.local_now() + timedelta(days=31))
        assert billing.credit_balance(db, c) == 0
    assert api.put("/api/staff/credit-expiry", headers=staff_headers, json={"days": None}).json() == {"days": None}
