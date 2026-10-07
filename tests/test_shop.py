import json

from app.models import Membership, MembershipPlan, MembershipStatus, ProductVariant, ShopOrder, ShopOrderStatus
from app.services import mailer, shop


def _variant(db_session, sku_start):
    with db_session() as s:
        v = s.query(ProductVariant).filter(ProductVariant.sku.like(sku_start + "%")).first()
        return v.id, v.product_id, v.size, v.scent, v.price_pence


def test_waitlist_mode_hides_buying(api):
    page = api.get("/apothecary/").text
    assert "Coming soon" in page and "Join the waitlist" in page
    prod = api.get("/apothecary/products/laundry-detergent/").text
    assert "Add to basket" not in prod and "Artemis" in prod
    assert "Laundry Detergent" in api.get("/apothecary/wash/detergents/").text
    r = api.post("/basket/add/", data={"product_id": 1, "size": "473 ml", "scent": "Artemis"}, follow_redirects=False)
    assert r.headers["location"] == "/apothecary/#waitlist"


def test_switch_on_emails_waitlist_once(api, staff_headers):
    mailer.OUTBOX.clear()
    api.post("/waitlist/", data={"first_name": "Ada", "email": "ada@example.com"})
    r = api.post("/api/staff/shop/selling", headers=staff_headers, json={"on": True}).json()
    assert r == {"selling": True, "emails_sent": 1}
    assert mailer.last_to("ada@example.com")["subject"] == "The LAVE Apothecary is open"
    api.post("/api/staff/shop/selling", headers=staff_headers, json={"on": False})
    assert api.post("/api/staff/shop/selling", headers=staff_headers, json={"on": True}).json()["emails_sent"] == 0


def test_basket_totals_and_checkout(api, staff_headers, db_session):
    api.post("/api/staff/shop/selling", headers=staff_headers, json={"on": True})
    vid, pid, size, scent, price = _variant(db_session, "LAUNDRY-DETERGENT-473ML-ARTEMIS")
    assert price == 1800
    r = api.post("/basket/add/", data={"product_id": pid, "size": size, "scent": scent, "qty": 2}, follow_redirects=False)
    assert r.headers["location"] == "/basket/?added=1"
    page = api.get("/basket/").text
    assert "£36.00" in page and "£4.95" in page and "£40.95" in page
    # Free delivery over £50, and when collecting.
    api.post("/basket/update/", data={"variant_id": vid, "qty": 3})
    assert "£54.00" in api.get("/basket/").text and "Free" in api.get("/basket/").text
    assert "Free" in api.get("/basket/?fulfilment=collect").text
    # Without Stripe (and outside development) checkout explains payments aren't on yet.
    r = api.post("/checkout/", data={"fulfilment": "delivery"}, follow_redirects=False)
    assert "Card%20payments" in r.headers["location"]


def test_mark_paid_takes_stock_and_dispatch(api, staff_headers, db_session):
    api.post("/api/staff/shop/selling", headers=staff_headers, json={"on": True})
    vid, *_ = _variant(db_session, "FABRIC-SPRAY")
    with db_session() as s:
        before = s.get(ProductVariant, vid).stock
        order = shop.create_order(s, {vid: 2}, None, "delivery")
        order.email = "buyer@example.com"
        shop.mark_paid(s, order)
        shop.mark_paid(s, order)  # webhook and return page both fire: stock only taken once
        assert s.get(ProductVariant, vid).stock == before - 2
        oid = order.id
    rows = api.get("/api/staff/shop/orders", headers=staff_headers).json()
    assert [o["id"] for o in rows] == [oid]
    r = api.post(f"/api/staff/shop/orders/{oid}/status", headers=staff_headers, json={"status": "dispatched", "tracking": "RM123"})
    assert r.json()["status"] == "dispatched"
    assert "RM123" in mailer.last_to("buyer@example.com")["text"]


def test_stock_and_member_delivery(api, staff_headers, db_session, client_headers):
    vid, *_ = _variant(db_session, "GARMENT-BRUSH")
    api.patch(f"/api/staff/shop/variants/{vid}", headers=staff_headers, json={"stock": 1})
    with db_session() as s:
        import pytest
        from fastapi import HTTPException
        with pytest.raises(HTTPException):
            shop.create_order(s, {vid: 2}, None, "delivery")
        from app.models import Client
        c = s.query(Client).filter_by(email="client@example.com").one()
        s.add(Membership(client_id=c.id, plan=MembershipPlan.essence, status=MembershipStatus.active))
        s.commit()
        s.refresh(c)
        assert shop.totals(s, {vid: 1}, c).shipping == 0
        assert shop.totals(s, {vid: 1}, None).shipping == 495


def test_basket_cookie_is_validated():
    assert shop.parse_basket("not json") == {}
    assert shop.parse_basket(json.dumps({"3": 99, "4": -2})) == {3: 10}
