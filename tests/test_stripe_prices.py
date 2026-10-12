"""Membership prices are created in Stripe automatically and follow the prices edited in /admin."""
from types import SimpleNamespace

import pytest
import stripe

from app.config import get_settings
from app.models import Client, Membership, MembershipPlan, MembershipStatus
from app.services import payments
from app.site import store


class FakeStripe:
    def __init__(self):
        self.prices, self.products, self.archived, self.sessions = {}, {}, [], []
        fake = self

        class Prices:
            def list(self, params):
                key = params["lookup_keys"][0]
                return SimpleNamespace(data=[p for p in fake.prices.values() if p.lookup_key == key and p.active])

            def create(self, params):
                if params.get("transfer_lookup_key"):
                    for p in fake.prices.values():
                        if p.lookup_key == params["lookup_key"]:
                            p.lookup_key = None
                pid = f"price_{len(fake.prices) + 1}"
                fake.prices[pid] = SimpleNamespace(id=pid, unit_amount=params["unit_amount"], currency=params["currency"],
                                                   lookup_key=params["lookup_key"], active=True, params=params)
                return fake.prices[pid]

            def update(self, pid, params):
                fake.prices[pid].active = params["active"]
                fake.archived.append(pid)

        class Products:
            def update(self, pid, params):
                if pid not in fake.products:
                    raise stripe.InvalidRequestError("No such product", "id")
                fake.products[pid].update(params)

            def create(self, params):
                fake.products[params["id"]] = dict(params)

        class Customers:
            def create(self, params):
                return SimpleNamespace(id="cus_1")

        class Sessions:
            def create(self, params):
                fake.sessions.append(params)
                return SimpleNamespace(url="https://checkout.stripe.com/c/pay/test")

        self.v1 = SimpleNamespace(prices=Prices(), products=Products(), customers=Customers(),
                                  checkout=SimpleNamespace(sessions=Sessions()))


@pytest.fixture
def fake_stripe(monkeypatch):
    fake = FakeStripe()
    monkeypatch.setattr(get_settings(), "stripe_secret_key", "sk_test_x")
    monkeypatch.setattr(payments, "_stripe", lambda: fake)
    store._cache.update(stamp=None, site=None)
    yield fake
    store._cache.update(stamp=None, site=None)


def test_prices_are_created_once_and_follow_the_admin(db_session, fake_stripe):
    with db_session() as db:
        monthly = payments.membership_price(db, "essence", "month")
        assert fake_stripe.prices[monthly].unit_amount == 2900
        assert fake_stripe.prices[monthly].params["recurring"] == {"interval": "month"}
        assert fake_stripe.products["lave_membership_essence"]["name"] == "LAVE Essence membership"
        assert payments.membership_price(db, "essence", "month") == monthly  # reused, not duplicated
        yearly = payments.membership_price(db, "eclat", "year")
        assert fake_stripe.prices[yearly].unit_amount == 129000

        # The founder changes Essence to £31 in /admin: a new price takes over and the old one is archived.
        plans = store.load(db).docs["plans"]
        plans["plans"][0]["price_pence"] = 3100
        store.save(db, "plans", plans, "Ada")
        new = payments.membership_price(db, "essence", "month")
        assert new != monthly and fake_stripe.prices[new].unit_amount == 3100 and fake_stripe.archived == [monthly]


def test_render_override_wins(db_session, fake_stripe, monkeypatch):
    monkeypatch.setattr(get_settings(), "stripe_price_elevate", "price_from_render")
    with db_session() as db:
        assert payments.membership_price(db, "elevate", "month") == "price_from_render"
    assert not fake_stripe.prices


def test_checkout_uses_the_automatic_price(api, client_headers, fake_stripe):
    cfg = {p["code"]: p for p in api.get("/api/config").json()["plans"]}
    assert cfg["elevate"]["available"] and cfg["elevate"]["annual_available"]
    r = api.post("/api/me/membership/checkout", headers=client_headers,
                 json={"plan": "elevate", "interval": "year", "return_url": "https://lavelondon.com/account/membership/"})
    assert r.status_code == 200, r.text
    line = fake_stripe.sessions[0]["line_items"][0]
    assert fake_stripe.prices[line["price"]].unit_amount == 59000


def test_plan_switch_in_billing_portal_updates_membership(db_session, monkeypatch):
    with db_session() as db:
        client = Client(email="m@lavelondon.com", first_name="M")
        db.add(client)
        db.flush()
        db.add(Membership(client_id=client.id, plan=MembershipPlan.essence, status=MembershipStatus.active))
        db.commit()
        sub = stripe.StripeObject.construct_from({
            "id": "sub_1", "status": "active", "metadata": {"lave_client_id": str(client.id), "plan": "essence"},
            "items": {"data": [{"price": {"lookup_key": "lave_elevate_month", "metadata": {"plan": "elevate"}},
                                "current_period_end": 1800000000}]},
        }, "sk_test_x")
        event = SimpleNamespace(id="evt_1", type="customer.subscription.updated", data=SimpleNamespace(object=sub))
        fake = SimpleNamespace(construct_event=lambda payload, sig, secret: event)
        monkeypatch.setattr(get_settings(), "stripe_secret_key", "sk_test_x")
        monkeypatch.setattr(payments, "_stripe", lambda: fake)
        assert payments.handle_webhook(db, b"{}", "sig") == "customer.subscription.updated"
        db.refresh(client)
        assert client.membership.plan == MembershipPlan.elevate and client.membership.status == MembershipStatus.active


def _deliver(db, monkeypatch, kind, obj, event_id):
    event = SimpleNamespace(id=event_id, type=kind, data=SimpleNamespace(object=stripe.StripeObject.construct_from(obj, "sk_test_x")))
    monkeypatch.setattr(get_settings(), "stripe_secret_key", "sk_test_x")
    monkeypatch.setattr(payments, "_stripe", lambda: SimpleNamespace(construct_event=lambda payload, sig, secret: event))
    return payments.handle_webhook(db, b"{}", "sig")


def test_paid_apothecary_order_from_webhook(db_session, monkeypatch):
    from sqlalchemy import select
    from app.models import ProductVariant, ShopOrderStatus
    from app.services import shop
    with db_session() as db:
        variant = db.scalars(select(ProductVariant).where(ProductVariant.active.is_(True))).first()
        stock = variant.stock
        order = shop.create_order(db, {variant.id: 2}, None, "delivery")
        db.commit()
        _deliver(db, monkeypatch, "checkout.session.completed", {
            "id": "cs_1", "payment_status": "paid", "metadata": {"lave_shop_order": order.ref},
            "customer_details": {"email": "buyer@lavelondon.com"},
            "collected_information": {"shipping_details": {"name": "Ada Buyer", "address": {"line1": "1 King's Road", "postal_code": "SW3 4RP"}}},
        }, "evt_shop")
        db.refresh(order); db.refresh(variant)
        assert order.status == ShopOrderStatus.paid and order.email == "buyer@lavelondon.com"
        assert order.shipping_address["name"] == "Ada Buyer" and variant.stock == stock - 2
        # Stripe sometimes sends the same event twice: handled once.
        assert _deliver(db, monkeypatch, "checkout.session.completed", {"metadata": {"lave_shop_order": order.ref}}, "evt_shop") == "duplicate"


def test_card_events_without_an_order_are_ignored(db_session, monkeypatch):
    with db_session() as db:
        assert _deliver(db, monkeypatch, "payment_intent.payment_failed", {"id": "pi_1", "metadata": {}}, "evt_pi") == "payment_intent.payment_failed"
        assert _deliver(db, monkeypatch, "setup_intent.succeeded", {"id": "seti_1", "customer": "cus_unknown"}, "evt_si") == "setup_intent.succeeded"


def test_saved_card_is_found_on_the_customer(monkeypatch):
    customer = stripe.StripeObject.construct_from({"id": "cus_1", "invoice_settings": {"default_payment_method": "pm_123"}}, "k")
    fake = SimpleNamespace(v1=SimpleNamespace(customers=SimpleNamespace(retrieve=lambda cid: customer)))
    assert payments._default_payment_method(fake, "cus_1") == "pm_123"
    expanded = stripe.StripeObject.construct_from({"id": "cus_2", "invoice_settings": {"default_payment_method": {"id": "pm_456"}}}, "k")
    fake.v1.customers.retrieve = lambda cid: expanded
    assert payments._default_payment_method(fake, "cus_2") == "pm_456"


def _member(db, interval="month"):
    client = Client(email=f"p-{interval}@lavelondon.com", first_name="P")
    db.add(client)
    db.flush()
    db.add(Membership(client_id=client.id, plan=MembershipPlan.elevate, status=MembershipStatus.active,
                      stripe_subscription_id="sub_9", billing_interval=interval))
    db.commit()
    db.refresh(client)
    return client


def test_member_pauses_and_resumes(db_session, monkeypatch):
    from app.services import shop
    calls = []
    fake = SimpleNamespace(v1=SimpleNamespace(subscriptions=SimpleNamespace(update=lambda sid, params: calls.append((sid, params)))))
    monkeypatch.setattr(get_settings(), "stripe_secret_key", "sk_test_x")
    monkeypatch.setattr(payments, "_stripe", lambda: fake)
    with db_session() as db:
        client = _member(db)
        assert shop.is_member(client)
        m = payments.pause_membership(db, client, 2)
        assert m.paused and m.effective_status == "paused" and not shop.is_member(client)
        sid, params = calls[-1]
        assert sid == "sub_9" and params["pause_collection"]["behavior"] == "void" and params["pause_collection"]["resumes_at"] > 0
        with pytest.raises(Exception):
            payments.pause_membership(db, client, 1)  # already paused
        payments.resume_membership(db, client)
        assert calls[-1] == ("sub_9", {"pause_collection": ""}) and shop.is_member(client)

        annual = _member(db, "year")
        with pytest.raises(Exception) as err:
            payments.pause_membership(db, annual, 1)
        assert "Annual" in str(err.value.detail)


def test_pause_made_in_stripe_reaches_lave(db_session, monkeypatch):
    with db_session() as db:
        client = _member(db)
        sub = {"id": "sub_9", "status": "active", "metadata": {"lave_client_id": str(client.id), "plan": "elevate"},
               "pause_collection": {"behavior": "void", "resumes_at": 1800000000},
               "items": {"data": [{"price": {"lookup_key": "lave_elevate_month", "recurring": {"interval": "month"}}}]}}
        _deliver(db, monkeypatch, "customer.subscription.updated", sub, "evt_pause")
        db.refresh(client)
        assert client.membership.paused and client.membership.resumes_at.year == 2027
        sub["pause_collection"] = None
        _deliver(db, monkeypatch, "customer.subscription.updated", sub, "evt_resume")
        db.refresh(client)
        assert not client.membership.paused and client.membership.resumes_at is None


def test_pause_endpoint_and_account_page(api, client_headers, db_session, monkeypatch):
    from app.models import Client as C
    fake = SimpleNamespace(v1=SimpleNamespace(subscriptions=SimpleNamespace(update=lambda sid, params: None)))
    monkeypatch.setattr(get_settings(), "stripe_secret_key", "sk_test_x")
    monkeypatch.setattr(payments, "_stripe", lambda: fake)
    me = api.get("/api/me", headers=client_headers).json()
    with db_session() as db:
        db.add(Membership(client_id=me["id"], plan=MembershipPlan.essence, status=MembershipStatus.active,
                          stripe_subscription_id="sub_e", billing_interval="month"))
        db.commit()
    assert api.get("/api/me", headers=client_headers).json()["membership"]["can_pause"] is True
    assert api.post("/api/me/membership/pause", headers=client_headers, json={"months": 6}).status_code == 422
    r = api.post("/api/me/membership/pause", headers=client_headers, json={"months": 1})
    assert r.status_code == 200 and r.json()["membership"]["status"] == "paused" and r.json()["membership"]["resumes_at"]
    r = api.post("/api/me/membership/resume", headers=client_headers)
    assert r.json()["membership"]["status"] == "active"
