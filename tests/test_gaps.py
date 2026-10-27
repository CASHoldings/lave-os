"""Staff booking for a client, moving a visit, a mobile number to book, receipts and "ready" emails, and data rights."""
import json

from sqlalchemy import select

from app.models import Client, Order, Service
from app.services import mailer
from tests.conftest import wp_token
from tests.test_flow import _address, _slots


def _subjects(to):
    return [m["subject"] for m in mailer.OUTBOX if m["to"] == to]


def _book(api, h, day="2026-10-06", window="saver"):
    addr = api.get("/api/me", headers=h).json()["addresses"]
    addr = addr[0]["id"] if addr else _address(api, h)
    slot = next(s for s in _slots(api, window=window) if s["day"] == day)
    r = api.post("/api/me/bookings", headers=h, json={"collection": {"template_id": slot["template_id"], "day": slot["day"]},
                                                     "address_id": addr})
    assert r.status_code == 201, r.text
    return r.json()


# A mobile number to book

def test_booking_needs_a_mobile_number(api):
    h = {"Authorization": "Bearer " + api.post("/api/auth/wp-exchange", json={"token": wp_token(wp_id=7, email="nophone@example.com")}).json()["token"]}
    addr = _address(api, h)
    slot = _slots(api, window="saver")[0]
    body = {"collection": {"template_id": slot["template_id"], "day": slot["day"]}, "address_id": addr}
    r = api.post("/api/me/bookings", headers=h, json=body)
    assert r.status_code == 400 and "mobile number" in r.json()["detail"]
    assert api.post("/api/me/bookings", headers=h, json={**body, "phone": "12345"}).status_code == 400
    r = api.post("/api/me/bookings", headers=h, json={**body, "phone": "07700 900456"})
    assert r.status_code == 201
    assert api.get("/api/me", headers=h).json()["phone"] == "+447700900456"
    assert api.patch("/api/me", headers=h, json={"phone": "not a phone"}).status_code == 400
    assert api.patch("/api/me", headers=h, json={"phone": "+33 6 12 34 56 78"}).json()["phone"] == "+33612345678"


# Moving a visit

def test_client_moves_a_collection_and_its_return(api, client_headers):
    order = _book(api, client_headers)
    coll = next(b for b in order["bookings"] if b["kind"] == "collection")
    later = next(s for s in _slots(api, window=coll["window_type"]) if s["day"] == "2026-10-08")
    r = api.post(f"/api/me/bookings/{coll['id']}/move", headers=client_headers,
                 json={"template_id": later["template_id"], "day": later["day"]})
    assert r.status_code == 200, r.text
    assert r.json()["starts_at"] == later["starts_at"] and r.json()["ref"] == coll["ref"]
    assert "Your LAVE collection has moved" in _subjects("client@example.com")
    # Only to the same kind of window.
    hour = next(s for s in _slots(api, window="hour" if coll["window_type"] == "saver" else "saver") if s["day"] == "2026-10-09")
    r = api.post(f"/api/me/bookings/{coll['id']}/move", headers=client_headers, json={"template_id": hour["template_id"], "day": hour["day"]})
    assert r.status_code == 409 and "same kind of window" in r.json()["detail"]
    # The bookings list says when a return could move to, and which visits can move.
    listed = api.get("/api/me/bookings", headers=client_headers).json()
    assert any(b["id"] == coll["id"] and b["movable"] for b in listed)


def test_a_return_cant_move_before_the_items_are_ready(api, client_headers, staff_headers):
    order = _book(api, client_headers)
    r = api.post(f"/api/staff/orders/{order['id']}/return", headers=staff_headers,
                 json={"slot": {"template_id": _slots(api, start="2026-10-09", window="saver")[0]["template_id"], "day": "2026-10-09"},
                       "address_id": order["bookings"][0]["address"]["id"]})
    assert r.status_code == 201, r.text
    ret = next(b for b in r.json()["bookings"] if b["kind"] == "delivery")
    too_soon = next(s for s in _slots(api, window=ret["window_type"]) if s["day"] == "2026-10-07")
    r = api.post(f"/api/staff/bookings/{ret['id']}/move", headers=staff_headers,
                 json={"template_id": too_soon["template_id"], "day": too_soon["day"]})
    assert r.status_code == 409 and "ready from" in r.json()["detail"]


# Staff booking for a client

def test_staff_book_a_collection_for_a_client(api, staff_headers):
    c = api.post("/api/staff/clients", headers=staff_headers, json={"email": "phone@example.com", "first_name": "Ada"}).json()
    a = api.post(f"/api/staff/clients/{c['id']}/addresses", headers=staff_headers, json={"line1": "2 Haydon Way", "postcode": "sw11 1yf"})
    assert a.status_code == 201 and a.json()["is_default"]
    slot = _slots(api, window="saver")[0]
    body = {"collection": {"template_id": slot["template_id"], "day": slot["day"]}, "address_id": a.json()["id"], "notes": "Concierge"}
    r = api.post(f"/api/staff/clients/{c['id']}/bookings", headers=staff_headers, json=body)
    assert r.status_code == 400 and "mobile" in r.json()["detail"]
    r = api.post(f"/api/staff/clients/{c['id']}/bookings", headers=staff_headers, json={**body, "phone": "07700 900789"})
    assert r.status_code == 201, r.text
    o = r.json()
    assert o["minimum_pence"] == 2995 and o["paid_pence"] == 0  # nothing charged now; settled after review
    assert any("Booked by" in e["note"] for e in o["timeline"])
    assert "Your LAVE collection is confirmed" in _subjects("phone@example.com")


# Receipts and "ready"

def test_receipt_after_review_and_ready_email(api, client_headers, staff_headers, db_session):
    order = _book(api, client_headers)
    coll = next(b for b in order["bookings"] if b["kind"] == "collection")
    api.patch(f"/api/staff/bookings/{coll['id']}", headers=staff_headers, json={"status": "completed"})
    with db_session() as db:
        coat = db.scalar(select(Service).where(Service.name == "Coat, long"))
    for _ in range(2):
        api.post(f"/api/staff/orders/{order['id']}/items", headers=staff_headers, json={"description": "Coat", "service_id": coat.id})
    api.post(f"/api/staff/orders/{order['id']}/payment", headers=staff_headers, json={"status": "paid"})
    mailer.OUTBOX.clear()
    r = api.post(f"/api/staff/orders/{order['id']}/status", headers=staff_headers, json={"status": "inspected"})
    assert r.status_code == 200, r.text
    receipt = next(m for m in mailer.OUTBOX if m["subject"].startswith("Your LAVE receipt"))
    assert "Coat" in receipt["text"] and "Total" in receipt["text"]
    from app.services import notices
    with db_session() as db:
        assert notices.receipt(db, db.get(Order, order["id"])) is False  # once only
    api.post(f"/api/staff/orders/{order['id']}/status", headers=staff_headers, json={"status": "in_care"})
    api.post(f"/api/staff/orders/{order['id']}/status", headers=staff_headers, json={"status": "quality_check"})
    r = api.post(f"/api/staff/orders/{order['id']}/status", headers=staff_headers, json={"status": "ready"})
    assert r.status_code == 200, r.text
    ready = next(m for m in mailer.OUTBOX if m["subject"] == "Your LAVE pieces are ready")
    assert "Book your return" in ready["text"]


# Data rights

def test_download_my_data_and_ask_to_delete(api, client_headers):
    _book(api, client_headers)
    r = api.get("/api/me/export", headers=client_headers)
    assert r.status_code == 200 and "attachment" in r.headers["content-disposition"]
    data = r.json()
    assert data["profile"]["email"] == "client@example.com" and len(data["orders"]) == 1 and data["addresses"]
    mailer.OUTBOX.clear()
    assert api.post("/api/me/delete-request", headers=client_headers).status_code == 200
    assert api.get("/api/me", headers=client_headers).json()["deletion_requested_at"]
    subjects = [m["subject"] for m in mailer.OUTBOX]
    assert any(s.startswith("Account deletion request") for s in subjects)
    assert "We've received your request to delete your LAVE account" in subjects


def test_only_admins_delete_and_only_once_nothing_is_owed(api, client_headers, staff_headers, db_session):
    order = _book(api, client_headers)
    with db_session() as db:
        cid = db.scalar(select(Client.id).where(Client.email == "client@example.com"))
    driver = api.post("/api/staff/auth/login", json={"email": "driver@lavelondon.com", "password": "driver-password"})
    assert api.delete(f"/api/staff/clients/{cid}", headers={"Authorization": f"Bearer {driver.json()['token']}"}).status_code == 403
    r = api.delete(f"/api/staff/clients/{cid}", headers=staff_headers)
    assert r.status_code == 409 and order["ref"] in r.json()["detail"]  # an open order
    api.post(f"/api/staff/orders/{order['id']}/status", headers=staff_headers, json={"status": "cancelled"})
    r = api.delete(f"/api/staff/clients/{cid}", headers=staff_headers)
    assert r.status_code == 200, r.text
    assert r.json()["full_name"] == "Deleted client" and r.json()["email"].endswith("@deleted.invalid") and not r.json()["phone"]
    assert r.json()["addresses"] == []
    with db_session() as db:
        assert db.get(Order, order["id"]) is not None  # the order record stays
    assert api.get("/api/me", headers=client_headers).status_code in (200, 401)
    assert json.dumps(api.get(f"/api/staff/clients/{cid}", headers=staff_headers).json()).count("Haydon") == 0
