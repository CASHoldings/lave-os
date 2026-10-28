"""Missed visits (Terms, 10): the first on an order is rebooked free; each one after that adds the collection and
delivery charge for that window."""
from app.models import Order
from app.services import mailer
from tests.test_flow import _slots
from tests.test_gaps import _book


def _mark(api, h, booking_id, status):
    r = api.patch(f"/api/staff/bookings/{booking_id}", headers=h, json={"status": status})
    assert r.status_code == 200, r.text
    return r.json()


def _collection(order):
    return next(b for b in order["bookings"] if b["kind"] == "collection")


def test_first_missed_visit_is_free_then_the_charge_applies(api, client_headers, staff_headers, db_session):
    order = _book(api, client_headers, window="saver")
    coll = _collection(order)
    mailer.OUTBOX.clear()
    b = _mark(api, staff_headers, coll["id"], "missed")
    assert b["missed"] == 1 and b["missed_fee_pence"] == 0
    email = next(m for m in mailer.OUTBOX if m["subject"] == "We missed you: please rebook your LAVE collection")
    assert "first missed visit in 12 months" in email["text"]

    # The client rebooks it from their account (missed visits are listed for them).
    listed = {x["id"]: x for x in api.get("/api/me/bookings", headers=client_headers).json()}
    assert listed[coll["id"]]["status"] == "missed" and listed[coll["id"]]["movable"]
    later = next(s for s in _slots(api, window="saver") if s["day"] == "2026-10-08")
    r = api.post(f"/api/me/bookings/{coll['id']}/move", headers=client_headers, json={"template_id": later["template_id"], "day": later["day"]})
    assert r.status_code == 200 and r.json()["status"] == "scheduled"

    # Missed again: the non-member Saver charge (as for an order under £45) is added to the order.
    mailer.OUTBOX.clear()
    b = _mark(api, staff_headers, coll["id"], "missed")
    assert b["missed"] == 2 and b["missed_fee_pence"] == 495
    assert "a £4.95 charge applies" in next(
        m for m in mailer.OUTBOX if m["subject"].startswith("We missed you"))["text"]
    detail = api.get(f"/api/staff/orders/{order['id']}", headers=staff_headers).json()
    assert detail["missed_visits_pence"] == 495
    with db_session() as db:
        o = db.get(Order, order["id"])
        assert o.expected_total_pence == (o.estimate_pence or 0) + o.fees_pence + 495


def test_a_visit_marked_missed_by_mistake_can_be_taken_back(api, client_headers, staff_headers):
    order = _book(api, client_headers)
    coll = _collection(order)
    _mark(api, staff_headers, coll["id"], "missed")
    later = next(s for s in _slots(api, window=coll["window_type"]) if s["day"] == "2026-10-08")
    api.post(f"/api/staff/bookings/{coll['id']}/move", headers=staff_headers, json={"template_id": later["template_id"], "day": later["day"]})
    assert _mark(api, staff_headers, coll["id"], "missed")["missed_fee_pence"] > 0
    b = _mark(api, staff_headers, coll["id"], "completed")  # the driver did collect after all
    assert b["missed"] == 1 and b["missed_fee_pence"] == 0
    assert api.get(f"/api/staff/orders/{order['id']}", headers=staff_headers).json()["missed_visits_pence"] == 0


def test_a_missed_return_on_a_settled_order_is_charged_to_the_card(api, client_headers, staff_headers, db_session, monkeypatch):
    from app.services import billing
    order = _book(api, client_headers)
    charged = []
    monkeypatch.setattr(billing, "settle", lambda db, o, staff_id=None: charged.append(o.balance_pence) or {})
    with db_session() as db:
        from app.models import PaymentStatus
        o = db.get(Order, order["id"])
        o.payment_status = PaymentStatus.paid
        db.commit()
    coll = _collection(order)
    _mark(api, staff_headers, coll["id"], "missed")  # free: nothing to charge
    later = next(s for s in _slots(api, window=coll["window_type"]) if s["day"] == "2026-10-08")
    api.post(f"/api/staff/bookings/{coll['id']}/move", headers=staff_headers, json={"template_id": later["template_id"], "day": later["day"]})
    _mark(api, staff_headers, coll["id"], "missed")
    assert len(charged) == 1 and charged[0] > 0


def test_one_free_miss_per_customer_in_12_months_across_orders(api, client_headers, staff_headers, db_session):
    first = _book(api, client_headers, day="2026-10-06")
    second = _book(api, client_headers, day="2026-10-07")
    assert _mark(api, staff_headers, _collection(first)["id"], "missed")["missed_fee_pence"] == 0
    # A new order doesn't reset it: the next miss is charged.
    assert _mark(api, staff_headers, _collection(second)["id"], "missed")["missed_fee_pence"] == 495
    with db_session() as db:
        from sqlalchemy import select
        from app.models import Client
        cid = db.scalar(select(Client.id).where(Client.email == "client@example.com"))
    assert api.get(f"/api/staff/clients/{cid}", headers=staff_headers).json()["missed_12m"] == 2


def test_a_miss_more_than_12_months_ago_doesnt_count(api, client_headers, staff_headers, db_session):
    from app.models import Booking
    old = _book(api, client_headers, day="2026-10-06")
    _mark(api, staff_headers, _collection(old)["id"], "missed")
    with db_session() as db:
        b = db.get(Booking, _collection(old)["id"])
        b.missed_log = [{"at": "2025-09-01T09:00:00", "fee_pence": 0}]
        db.commit()
    new = _book(api, client_headers, day="2026-10-07")
    assert _mark(api, staff_headers, _collection(new)["id"], "missed")["missed_fee_pence"] == 0


def test_members_pay_the_flat_member_charge(api, client_headers, staff_headers, db_session):
    from tests.test_delivery_spec import _member
    _member(db_session, "elevate")
    first = _book(api, client_headers, day="2026-10-06")
    second = _book(api, client_headers, day="2026-10-07")
    _mark(api, staff_headers, _collection(first)["id"], "missed")
    assert _mark(api, staff_headers, _collection(second)["id"], "missed")["missed_fee_pence"] == 495
    r = api.put("/api/staff/delivery-settings", headers=staff_headers, json={"member_missed_visit_pence": 300})
    assert r.json()["member_missed_visit_pence"] == 300


def test_terms_wording_is_updated_on_deploy(api, db_session):
    from sqlalchemy import select
    from app.models import PageContent
    from app.services import content
    old_text, new_text = content.POLICY_CHANGES[0][1], content.POLICY_CHANGES[0][2]
    with db_session() as db:
        page = db.scalar(select(PageContent).where(PageContent.path == "/policies/terms/"))
        page.body = page.body.replace(new_text, old_text).replace("28 October 2026", "27 October 2026")
        db.commit()
        assert content.update_policies(db) == 1
        assert content.update_policies(db) == 0
    text = api.get("/policies/terms/").text
    assert "first missed visit in any 12 months is rebooked free" in text and "Last updated 28 October 2026" in text


def test_the_missed_visit_charge_shows_on_the_customers_order_and_receipt(api, client_headers, staff_headers, db_session):
    from app.models import Garment, PaymentStatus
    from app.services import notices
    first = _book(api, client_headers, day="2026-10-06")
    second = _book(api, client_headers, day="2026-10-07")
    _mark(api, staff_headers, _collection(first)["id"], "missed")
    _mark(api, staff_headers, _collection(second)["id"], "missed")
    mine = api.get(f"/api/me/orders/{second['ref']}", headers=client_headers).json()
    assert mine["missed_visits_pence"] == 495
    with db_session() as db:
        o = db.get(Order, second["id"])
        o.items.append(Garment(tag_code=f"{o.ref}-01", description="Coat", price_pence=4000))
        o.payment_status = PaymentStatus.paid
        db.commit()
        mailer.OUTBOX.clear()
        assert notices.receipt(db, o)
    receipt = next(m for m in mailer.OUTBOX if m["subject"].startswith("Your LAVE receipt"))
    assert "Missed visit" in receipt["text"] and "£4.95" in receipt["text"]
