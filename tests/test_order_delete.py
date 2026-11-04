"""Deleting an order made by mistake: everything in it goes, unless money changed hands or pieces are in the Vault."""
from sqlalchemy import func, select

from app.models import Booking, DeletedOrder, Garment, Order, OrderEvent, WardrobeItem
from tests.test_wardrobe import _order_with_items, _slot


def _mistaken_order(api, ch, sh):
    """Booked, collected, one garment added, then cancelled and waived: the founder's slip."""
    addr = api.post("/api/me/addresses", headers=ch, json={"line1": "1 Haydon Way", "postcode": "SW11 1YF"}).json()["id"]
    s = _slot(api)
    o = api.post("/api/me/bookings", headers=ch, json={"collection": {"template_id": s["template_id"], "day": s["day"]},
                                                       "address_id": addr}).json()
    coll = next(b for b in o["bookings"] if b["kind"] == "collection")
    api.patch(f"/api/staff/bookings/{coll['id']}", headers=sh, json={"status": "completed"})
    assert api.post(f"/api/staff/orders/{o['id']}/items", headers=sh, json={"description": "Blouse"}).status_code == 201
    api.post(f"/api/staff/orders/{o['id']}/status", headers=sh, json={"status": "cancelled"})
    api.post(f"/api/staff/orders/{o['id']}/payment", headers=sh, json={"status": "waived"})
    return o


def _count(db, model, **where):
    q = select(func.count()).select_from(model)
    for k, v in where.items():
        q = q.where(getattr(model, k) == v)
    return db.scalar(q)


def test_mistaken_order_is_deleted_completely(api, client_headers, staff_headers, db_session):
    o = _mistaken_order(api, client_headers, staff_headers)
    chk = api.get(f"/api/staff/orders/{o['id']}/delete-check", headers=staff_headers).json()
    assert chk == {"blockers": [], "garments": 1, "bookings": 1}

    url = f"/api/staff/orders/{o['id']}/delete"
    assert api.post(url, headers=staff_headers, json={"reason": ""}).status_code == 400  # a reason is required
    r = api.post(url, headers=staff_headers, json={"reason": "Created by mistake"})
    assert r.status_code == 200 and r.json()["deleted"] == o["ref"]
    db = db_session()
    assert _count(db, Order, id=o["id"]) == 0
    assert _count(db, Garment, order_id=o["id"]) == _count(db, OrderEvent, order_id=o["id"]) == 0
    assert _count(db, Booking, order_id=o["id"]) == 0
    assert _count(db, WardrobeItem) == 0  # the blouse's Wardrobe piece came only from this order
    assert api.get(f"/api/staff/orders/{o['id']}", headers=staff_headers).status_code == 404
    assert api.get("/api/me/wardrobe", headers=client_headers).json() == []

    # A short record stays: what it was, who deleted it, when and why; no names or emails.
    (rec,) = api.get("/api/staff/deleted-orders", headers=staff_headers).json()
    assert rec["ref"] == o["ref"] and rec["reason"] == "Created by mistake" and rec["deleted_by"] and rec["deleted_at"]
    assert rec["summary"].startswith("Cancelled, payment waived. 1 garment: Blouse") and "collection" in rec["summary"]
    me = api.get("/api/me", headers=client_headers).json()
    assert me["email"] not in rec["summary"] and me["first_name"] not in rec["summary"]
    assert _count(db, DeletedOrder, ref=o["ref"]) == 1


def test_paid_orders_are_kept_for_the_accounts(api, client_headers, staff_headers):
    o, _ = _order_with_items(api, client_headers, staff_headers, [{"description": "Wool coat"}])
    chk = api.get(f"/api/staff/orders/{o['id']}/delete-check", headers=staff_headers).json()
    assert chk["blockers"] and "Money has been taken" in chk["blockers"][0]
    r = api.post(f"/api/staff/orders/{o['id']}/delete", headers=staff_headers, json={"reason": "Mistake"})
    assert r.status_code == 409 and "refund" in r.json()["detail"]
    assert api.get(f"/api/staff/orders/{o['id']}", headers=staff_headers).status_code == 200


def test_wardrobe_piece_from_an_earlier_order_stays(api, client_headers, staff_headers, db_session):
    _order_with_items(api, client_headers, staff_headers, [{"description": "Wool coat"}])  # paid, delivered
    (coat,) = api.get("/api/me/wardrobe", headers=client_headers).json()
    o = _mistaken_order(api, client_headers, staff_headers)
    db = db_session()
    g = db.scalar(select(Garment).where(Garment.order_id == o["id"]))
    g.wardrobe_item_id = coat["id"]  # staff said it was the same coat as before
    db.commit()
    assert api.post(f"/api/staff/orders/{o['id']}/delete", headers=staff_headers, json={"reason": "Mistake"}).status_code == 200
    assert [w["id"] for w in api.get("/api/me/wardrobe", headers=client_headers).json()] == [coat["id"]]
