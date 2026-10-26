"""Members' experience: 'Tell us about you', what's coming up, and birthday gestures the founder approves."""
from datetime import date, datetime

from sqlalchemy import select

from app.models import (Client, ClientGesture, Garment, Membership, MembershipPlan, MembershipStatus, Order,
                        OrderStatus, Service)
from app.services import billing, clock, mailer, members


def _member(db, plan="essence", email="client@example.com", **about):
    c = db.scalar(select(Client).where(Client.email == email))
    db.add(Membership(client_id=c.id, plan=MembershipPlan(plan), status=MembershipStatus.active,
                      created_at=datetime(2025, 10, 15)))
    for k, v in about.items():
        setattr(c, k, v)
    db.commit()
    return c


def test_tell_us_about_you(api, client_headers):
    r = api.put("/api/me/about", headers=client_headers, json={
        "preferred_name": "Cee", "birthday_day": 12, "birthday_month": 10, "contact_channel": "text",
        "interests": ["Running", "Not a real interest"], "household": [{"name": "Ada", "relation": "Daughter", "age": "6"}, {"name": ""}],
        "allergies": "Fragrance", "special_pieces": "Grandmother's silk scarf", "feature_ok": True})
    a = r.json()
    assert a["preferred_name"] == "Cee" and (a["birthday_day"], a["birthday_month"]) == (12, 10) and a["completed"]
    assert a["interests"] == ["Running"] and a["household"] == [{"name": "Ada", "relation": "Daughter", "age": "6"}]
    assert api.put("/api/me/about", headers=client_headers, json={"birthday_day": 31, "birthday_month": 2}).status_code == 400
    r = api.post("/api/me/occasions", headers=client_headers, json={"day": "2026-10-20", "title": "Sister's wedding", "note": "Navy suit"})
    assert r.json()["occasions"][0]["title"] == "Sister's wedding"
    assert api.delete("/api/me/about", headers=client_headers).status_code == 204
    a = api.get("/api/me/about", headers=client_headers).json()
    assert a["birthday_day"] is None and a["preferred_name"] == "" and a["occasions"] == []


def test_suggestion_follows_what_they_send(client_headers, db_session):
    with db_session() as db:
        c = _member(db, birthday_day=12, birthday_month=10,
                    about={"preferred_name": "Cee", "interests": ["Running"], "allergies": "Fragrance"})
        shirt = db.scalar(select(Service).where(Service.name == "Shirt, non-member hung"))
        o = Order(client_id=c.id, status=OrderStatus.delivered)
        db.add(o)
        db.flush()
        for n in range(6):
            db.add(Garment(order_id=o.id, description="Shirt", service_id=shirt.id, price_pence=shirt.price_pence, tag_code=f"T-{n}"))
        db.commit()
        s = members.suggest(db, c, date(2026, 10, 12))
        assert s["kind"] == "credit" and s["title"] == "A pack of 5 shirts, on us" and s["value_pence"] == 5 * shirt.price_pence
        assert any("Sends us mostly shirts" in r for r in s["reasons"]) and "Enjoys running" in s["reasons"]
        gift = next(a for a in s["alternatives"] if a["kind"] == "gift")
        assert "Unscented" in gift["title"]  # fragrance allergy
        assert any("Run Club" in a["title"] for a in s["alternatives"])
        assert s["alternatives"][-1]["kind"] == "note"


def test_founder_is_reminded_then_approves_and_it_goes_out_on_the_day(api, client_headers, staff_headers, db_session):
    with db_session() as db:
        c = _member(db, birthday_day=12, birthday_month=10, about={"preferred_name": "Cee"})
        cid = c.id
    # 5 October: the birthday is 7 days away. Today shows it, and the founder gets one reminder email.
    events = api.get("/api/staff/coming-up", headers=staff_headers).json()
    bday = next(e for e in events if e["kind"] == "birthday")
    assert bday["client"]["name"] == "Cee" and bday["gesture"]["status"] == "suggested"
    assert any(e["kind"] == "anniversary" and e["years"] == 1 for e in events)  # member since 15 October 2025
    mailer.OUTBOX.clear()
    with db_session() as db:
        assert members.celebrate(db, date(2026, 10, 5))["reminded"] == 1
        assert members.celebrate(db, date(2026, 10, 6))["reminded"] == 0
    assert mailer.last_to("hello@lavelondon.com")["subject"] == "Members' birthdays coming up (1)"
    assert mailer.last_to("client@example.com") is None  # nothing reaches the member before approval
    # The founder chooses another gesture: £20 of credit.
    gid = bday["gesture"]["id"]
    r = api.post(f"/api/staff/gestures/{gid}", headers=staff_headers,
                 json={"action": "approve", "kind": "credit", "title": "A birthday treat", "value_pence": 2000, "detail": "On us"})
    assert r.json()["status"] == "approved" and r.json()["value_pence"] == 2000
    with db_session() as db:
        assert members.celebrate(db, date(2026, 10, 11))["sent"] == 0  # not before the day
        assert members.celebrate(db, date(2026, 10, 12))["sent"] == 1
        assert members.celebrate(db, date(2026, 10, 12))["sent"] == 0  # once
        assert billing.credit_balance(db, db.get(Client, cid)) == 2000
    sent = mailer.last_to("client@example.com")
    assert sent["subject"] == "Happy birthday, Cee" and "We've added £20 to your LAVE account" in sent["text"]


def test_skipped_birthdays_send_nothing(api, client_headers, staff_headers, db_session):
    with db_session() as db:
        _member(db, birthday_day=8, birthday_month=10)
    g = next(e for e in api.get("/api/staff/coming-up", headers=staff_headers).json() if e["kind"] == "birthday")["gesture"]
    api.post(f"/api/staff/gestures/{g['id']}", headers=staff_headers, json={"action": "skip"})
    mailer.OUTBOX.clear()
    with db_session() as db:
        assert members.celebrate(db, date(2026, 10, 8))["sent"] == 0
        assert db.get(ClientGesture, g["id"]).status == "skipped"


def test_non_members_and_staff_notes(api, staff_headers, db_session, client_headers):
    with db_session() as db:
        c = db.scalar(select(Client).where(Client.email == "client@example.com"))
        c.birthday_day, c.birthday_month = 8, 10
        db.commit()
        cid = c.id
    assert not [e for e in api.get("/api/staff/coming-up", headers=staff_headers).json() if e["kind"] == "birthday"]
    r = api.put(f"/api/staff/clients/{cid}/about", headers=staff_headers, json={"special_pieces": "Vintage trench"})
    assert r.json()["special_pieces"] == "Vintage trench" and r.json()["birthday_day"] == 8 and not r.json()["completed"]


def test_welcome_email_invites_new_members(client_headers, db_session):
    from app.services import notices
    with db_session() as db:
        c = db.scalar(select(Client).where(Client.email == "client@example.com"))
        mailer.OUTBOX.clear()
        notices.welcome_member(c, "elevate")
    sent = mailer.last_to("client@example.com")
    assert sent["subject"] == "Welcome to LAVE Elevate" and "/account/about/" in sent["text"]


def test_leap_day_birthdays():
    c = Client(email="x@example.com", birthday_day=29, birthday_month=2)
    assert members.next_birthday(c, date(2027, 1, 1)) == date(2027, 2, 28)
    assert members.next_birthday(c, date(2028, 1, 1)) == date(2028, 2, 29)
