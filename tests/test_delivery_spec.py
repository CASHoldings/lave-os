"""Acceptance tests from "LAVE — Collection, Delivery & Turnaround Rules" v1.4 (§11): C1–C14, T1–T7, Z1–Z7, D1–D12."""
from datetime import date, datetime

import pytest
from sqlalchemy import select

from app.models import (Booking, BookingKind, BookingMode, Client, Membership, MembershipPlan, MembershipStatus, Order,
                        Service, WindowType)
from app.services import area, clock, delivery
from app.services.slots import available_slots


# Charges (§6)

@pytest.mark.parametrize("case, level, value, one_hour, expected", [
    ("C1", None, 6000, False, 0),
    ("C2", None, 6000, True, 695),     # one-hour collection, Saver return
    ("C3", None, 6000, True, 695),     # one-hour both ways: once
    ("C4", None, 4500, False, 0),      # inclusive
    ("C5", None, 4499, False, 495),
    ("C6", None, 3000, True, 695),     # not £11.90
    ("C7", "essence", 2000, False, 0),
    ("C8", "essence", 2000, True, 495),
    ("C9", "essence", 8000, True, 495),
    ("C10", "elevate", 1000, True, 0),
    ("C11", "eclat", 0, True, 0),
])
def test_charges(db_session, case, level, value, one_hour, expected):
    with db_session() as db:
        assert delivery.charge(delivery.config(db), level, value, one_hour) == expected, case


def _order_with_legs(db, kinds: list[WindowType], estimate: int, level=None) -> Order:
    client = db.scalar(select(Client).limit(1)) or Client(email="c@example.com")
    db.add(client)
    db.flush()
    order = Order(client_id=client.id, delivery_basis={"level": level, "value_pence": estimate})
    db.add(order)
    db.flush()
    for i, w in enumerate(kinds):
        db.add(Booking(client_id=client.id, order_id=order.id, kind=BookingKind.collection if i == 0 else BookingKind.delivery,
                       mode=BookingMode.lave_collects, window_type=w, starts_at=datetime(2026, 10, 6 + 2 * i, 7),
                       ends_at=datetime(2026, 10, 6 + 2 * i, 10)))
    db.flush()
    db.refresh(order)
    delivery.recompute(db, order)
    return order


@pytest.mark.parametrize("case, estimate, counted, kinds, at_booking, final", [
    ("C12", 5000, 4000, [WindowType.saver, WindowType.saver], 0, 495),
    ("C13", 4000, 5000, [WindowType.saver, WindowType.saver], 495, 0),
    ("C14", 4000, 5000, [WindowType.hour, WindowType.saver], 695, 695),
])
def test_final_charge_follows_the_counted_value(db_session, case, estimate, counted, kinds, at_booking, final):
    from app.models import Garment
    with db_session() as db:
        order = _order_with_legs(db, kinds, estimate)
        assert order.fees_pence == at_booking, case
        db.add(Garment(order_id=order.id, description="Counted", price_pence=counted, tag_code=f"{order.ref}-01"))
        db.flush()
        db.refresh(order)
        note = delivery.settle(db, order)
        assert order.fees_pence == final, case
        assert (note is not None) == (at_booking != final)  # the client is told when it changes


def test_staff_can_override_the_charge(api, staff_headers, db_session):
    with db_session() as db:
        order = _order_with_legs(db, [WindowType.saver, WindowType.saver], 1000)
        db.commit()
        oid = order.id
    r = api.patch(f"/api/staff/orders/{oid}", headers=staff_headers, json={"fees_pence": 0})
    assert r.json()["fees_pence"] == 0
    with db_session() as db:
        order = db.get(Order, oid)
        assert delivery.recompute(db, order) == 0 and order.delivery_basis["manual"] is True


def test_cell_labels(db_session):
    with db_session() as db:
        cfg = delivery.config(db)
        assert delivery.cell_labels(cfg, None, 4500) == {"saver": "Free", "hour": "£6.95"}
        assert delivery.cell_labels(cfg, None, 4499) == {"saver": "£4.95", "hour": "£6.95"}
        assert delivery.cell_labels(cfg, "essence", 0) == {"saver": "Free", "hour": "£4.95"}
        assert delivery.cell_labels(cfg, "eclat", 0) == {"saver": "Included", "hour": "Included"}


def test_charges_are_editable_without_a_deploy(api, staff_headers):
    r = api.put("/api/staff/delivery-settings", headers=staff_headers,
                json={"nonmember_one_hour_pence": 750, "free_saver_threshold_pence": 5000, "turnaround_hours": 48})
    assert r.status_code == 200 and r.json()["nonmember_one_hour_pence"] == 750 and r.json()["free_saver_threshold_pence"] == 5000
    assert "2026-12-28" in r.json()["bank_holidays"]


# Turnaround (§4.2)

def _first(db, after: datetime, window: WindowType, day: date) -> str:
    s = available_slots(db, day, 7, window, BookingMode.lave_collects, not_before=after)[0]
    return f"{s.starts_at:%a %d %b %H:%M}–{s.ends_at:%H:%M}"


@pytest.mark.parametrize("case, now, collection_end, hour, saver", [
    ("T1", datetime(2026, 10, 20, 8), datetime(2026, 10, 26, 7), "Wed 28 Oct 07:00–08:00", "Wed 28 Oct 07:00–10:00"),
    ("T2", datetime(2026, 10, 20, 8), datetime(2026, 10, 26, 10), "Wed 28 Oct 10:00–11:00", "Wed 28 Oct 10:00–13:00"),
    ("T3", datetime(2026, 10, 20, 8), datetime(2026, 10, 26, 22), "Thu 29 Oct 06:00–07:00", "Thu 29 Oct 07:00–10:00"),
    ("T4", datetime(2026, 10, 20, 8), datetime(2026, 10, 29, 19), "Sat 31 Oct 19:00–20:00", "Sat 31 Oct 19:00–22:00"),
    ("T5", datetime(2026, 10, 20, 8), datetime(2026, 10, 30, 7), "Mon 02 Nov 06:00–07:00", "Mon 02 Nov 07:00–10:00"),
    ("T6", datetime(2026, 12, 20, 8), datetime(2026, 12, 23, 7), "Sat 26 Dec 06:00–07:00", "Sat 26 Dec 07:00–10:00"),
])
def test_turnaround(db_session, case, now, collection_end, hour, saver):
    clock.freeze(now)
    try:
        with db_session() as db:
            t = delivery.earliest_return(db, collection_end)
            assert _first(db, t, WindowType.hour, t.date()) == hour, case
            assert _first(db, t, WindowType.saver, t.date()) == saver, case
    finally:
        clock.freeze(None)


def _list_cookie(db, *names) -> str:
    ids = [db.scalar(select(Service.id).where(Service.name == n)) for n in names]
    return ",".join(f"i{i}:1" for i in ids)


def test_T7_longer_items(api, client_headers, db_session):
    from tests.test_flow import _address, _slots
    with db_session() as db:
        jacket = db.scalar(select(Service).where(Service.product_category == "Leather, suede, wax & fur", Service.active.is_(True)))
        shirt = db.scalar(select(Service).where(Service.name == "Coat, long"))
        cookie = f"i{jacket.id}:1,i{shirt.id}:1"
    api.cookies.set("lave_list", cookie)
    terms = api.get("/api/me/delivery-terms", headers=client_headers).json()
    assert terms["longer_items"] == [jacket.name] and terms["longer_note"] == delivery.LONGER_NOTE
    addr = _address(api, client_headers)
    coll = _slots(api)[0]
    back = next(s for s in _slots(api, start="2026-10-08") if s["starts_at"] >= "2026-10-08T07:00:00")
    body = {"collection": {"template_id": coll["template_id"], "day": coll["day"]}, "address_id": addr,
            "delivery": {"template_id": back["template_id"], "day": back["day"]}}
    # Default: one return when everything is ready, so no return slot yet.
    assert api.post("/api/me/bookings", headers=client_headers, json=body).status_code == 409
    api.cookies.set("lave_list", cookie)
    r = api.post("/api/me/bookings", headers=client_headers, json={**body, "return_preference": "split"})
    assert r.status_code == 201, r.text
    assert len([b for b in r.json()["bookings"] if b["kind"] == "delivery"]) == 1


# Service area (§3A)

@pytest.mark.parametrize("case, postcode, expected", [
    ("Z1", "SW11 6AB", True),
    ("Z2", "SW11 7EN", True),
    ("Z3", "SW8 5JB", True),     # Nine Elms ward, in the list
    ("Z4", "SW8 1RT", False),    # Oval, Lambeth
    ("Z5", "SW4 9AS", False),    # Clapham
    ("Z6", "sw116ab", True),     # normalised
])
def test_service_area(db_session, case, postcode, expected):
    with db_session() as db:
        assert area.in_zone(db, postcode) is expected, case


def test_out_of_area_gets_the_waitlist(api, staff_headers):
    r = api.get("/api/area/check", params={"postcode": "sw4 9as"}).json()
    assert r == {"postcode": "SW4 9AS", "in_zone": False, "message": area.OUT_OF_AREA}
    assert api.post("/api/area/waitlist", json={"name": "Ada", "email": "ada@example.com", "phone": "0700",
                                                "postcode": "sw4 9as", "services": ["Laundry"]}).status_code == 201
    summary = api.get("/api/staff/area", headers=staff_headers).json()
    assert summary["postcodes"] == 1743 and {"district": "SW4", "people": 1} in summary["waitlist_by_district"]
    # Admin adds a sector, then a single postcode, without a deploy.
    r = api.post("/api/staff/area", headers=staff_headers, json={"entries": "SW4 9\nsw12 8aa, nonsense"}).json()
    assert r == {"postcodes": ["SW12 8AA"], "sectors": ["SW4 9"], "skipped": ["nonsense"]}
    assert api.get("/api/area/check", params={"postcode": "SW4 9AS"}).json()["in_zone"] is True


def test_addresses_out_of_area_cannot_be_used(api, client_headers):
    r = api.post("/api/me/addresses", headers=client_headers, json={"line1": "1 Balham Hill", "postcode": "sw12 9ee"})
    assert r.status_code == 201 and r.json()["in_zone"] is False  # saved, but not selectable
    from tests.test_flow import _slots
    slot = _slots(api)[0]
    r = api.post("/api/me/bookings", headers=client_headers,
                 json={"collection": {"template_id": slot["template_id"], "day": slot["day"]}, "address_id": r.json()["id"]})
    assert r.status_code == 409 and "not yet in our area" in r.json()["detail"]


# Atelier drop-off (§5)

HOURS = {str(d): ["08:00", "20:00"] for d in range(7)}


def _atelier(api, h, **extra):
    r = api.post("/api/staff/ateliers", headers=h, json={"name": "LAVE Atelier, Battersea Power Station",
                                                         "address": "Circus West", "postcode": "SW11 8DD",
                                                         "access_instructions": "Concierge desk, Building 3.",
                                                         "weekly_hours": HOURS, **extra})
    assert r.status_code == 201, r.text
    return r.json()


def _member(db_session, plan="essence", email="client@example.com"):
    with db_session() as db:
        c = db.scalar(select(Client).where(Client.email == email))
        db.add(Membership(client_id=c.id, plan=MembershipPlan(plan), status=MembershipStatus.active))
        db.commit()


@pytest.mark.parametrize("case, dropped, collected, ready", [
    ("D1", datetime(2026, 11, 1, 11), datetime(2026, 11, 2, 10), datetime(2026, 11, 4, 10)),
    ("D7", datetime(2026, 11, 3, 9, 15), datetime(2026, 11, 3, 10), datetime(2026, 11, 5, 10)),
    ("—", datetime(2026, 11, 4, 5, 30), datetime(2026, 11, 4, 10), datetime(2026, 11, 6, 10)),
    ("—", datetime(2026, 11, 5, 21, 30), datetime(2026, 11, 5, 22), datetime(2026, 11, 7, 22)),
    ("D2", datetime(2026, 12, 27, 10), datetime(2026, 12, 29, 10), datetime(2026, 12, 31, 10)),
])
def test_dropoff_turnaround(db_session, case, dropped, collected, ready):
    with db_session() as db:
        assert delivery.deemed_collection(db, dropped) == collected, case
        assert delivery.earliest_return(db, collected) == ready, case


def test_saturday_night_dropoff_returns_monday(db_session):
    clock.freeze(datetime(2026, 11, 1, 8))
    try:
        with db_session() as db:
            t = delivery.earliest_return(db, delivery.deemed_collection(db, datetime(2026, 11, 5, 21, 30)))
            assert _first(db, t, WindowType.hour, t.date()) == "Mon 09 Nov 06:00–07:00"
            assert _first(db, t, WindowType.saver, t.date()) == "Mon 09 Nov 07:00–10:00"
    finally:
        clock.freeze(None)


def test_D3_non_members_dont_see_dropoff(api, client_headers, staff_headers):
    loc = _atelier(api, staff_headers)
    assert api.get("/api/me/ateliers", headers=client_headers).json() == []
    assert api.get("/api/me/delivery-terms", headers=client_headers).json()["dropoff"] is False
    r = api.post("/api/me/bookings", headers=client_headers, json={"dropoff": {"atelier_id": loc["id"], "day": "2026-10-11"}})
    assert r.status_code == 403


def _return_slot(api, window, after="2026-10-14T10:00:00"):
    slots = api.get("/api/slots", params={"start": after[:10], "days": 5, "window": window}).json()
    return next(s for s in slots if s["starts_at"] >= after)


@pytest.mark.parametrize("case, plan, window, fee", [
    ("D4", "essence", "saver", 0),
    ("D5", "essence", "hour", 495),
    ("D6", "elevate", "hour", 0),
])
def test_dropoff_charges(api, client_headers, staff_headers, db_session, case, plan, window, fee):
    from tests.test_flow import _address
    loc = _atelier(api, staff_headers)
    _member(db_session, plan)
    addr = _address(api, client_headers)
    # Sunday 11 Oct drop-off → collected Mon 12 Oct 10am → returns from Wed 14 Oct 10am.
    ret = _return_slot(api, window)
    r = api.post("/api/me/bookings", headers=client_headers, json={
        "dropoff": {"atelier_id": loc["id"], "day": "2026-10-11", "bags": 1}, "address_id": addr,
        "delivery": {"template_id": ret["template_id"], "day": ret["day"]}})
    assert r.status_code == 201, r.text
    assert r.json()["fees_pence"] == fee, case
    early = api.get("/api/slots", params={"start": "2026-10-14", "days": 1, "window": "hour"}).json()[0]
    r = api.post("/api/me/bookings", headers=client_headers, json={
        "dropoff": {"atelier_id": loc["id"], "day": "2026-10-11"}, "address_id": addr,
        "delivery": {"template_id": early["template_id"], "day": early["day"]}})
    assert r.status_code == 409 and "Wednesday 14 October, 10am" in r.json()["detail"]


def test_D8_several_dropoffs_each_with_bag_codes(api, client_headers, staff_headers, db_session):
    from tests.test_flow import _address
    a = _atelier(api, staff_headers)
    b = _atelier(api, staff_headers, name="LAVE Atelier, Nine Elms")
    _member(db_session)
    addr = _address(api, client_headers)
    one = api.post("/api/me/bookings", headers=client_headers,
                   json={"dropoff": {"atelier_id": a["id"], "day": "2026-10-11", "bags": 2}, "address_id": addr}).json()
    two = api.post("/api/me/bookings", headers=client_headers,
                   json={"dropoff": {"atelier_id": b["id"], "day": "2026-10-18", "bags": 1}, "address_id": addr}).json()
    assert one["ref"] != two["ref"]
    assert one["bookings"][0]["bag_codes"] == [f"{one['ref']}-1", f"{one['ref']}-2"]
    assert two["bookings"][0]["bag_codes"] == [f"{two['ref']}-1"]
    # Check-in: the first bag moves the order to collected ("Received at …").
    r = api.post("/api/staff/dropoffs/check-in", headers=staff_headers, json={"code": f"{one['ref']}-2".lower()})
    assert r.status_code == 200 and r.json()["all_in"] is False
    assert api.get(f"/api/staff/orders/{one['id']}", headers=staff_headers).json()["status"] == "collected"
    assert api.post("/api/staff/dropoffs/check-in", headers=staff_headers, json={"code": f"{one['ref']}-3"}).status_code == 404


def test_D9_pausing_with_bookings_warns_and_lists_members(api, client_headers, staff_headers, db_session):
    from tests.test_flow import _address
    loc = _atelier(api, staff_headers)
    _member(db_session)
    addr = _address(api, client_headers)
    for _ in range(3):
        api.post("/api/me/bookings", headers=client_headers,
                 json={"dropoff": {"atelier_id": loc["id"], "day": "2026-10-11"}, "address_id": addr})
    r = api.patch(f"/api/staff/ateliers/{loc['id']}", headers=staff_headers, json={"status": "paused"}).json()
    assert r["applied"] is False and len(r["affected"]) == 3 and r["affected"][0]["client"] == "Celia Moss"
    r = api.patch(f"/api/staff/ateliers/{loc['id']}", headers=staff_headers, json={"status": "paused", "confirm": True}).json()
    assert r["applied"] is True and r["atelier"]["status"] == "paused"
    assert "paused" in api.get(f"/api/staff/ateliers/{loc['id']}/history", headers=staff_headers).json()[0]["what"]


def test_D10_capacity_fills_a_date(api, client_headers, staff_headers, db_session):
    from tests.test_flow import _address
    loc = _atelier(api, staff_headers, daily_capacity=2)
    _member(db_session)
    addr = _address(api, client_headers)
    body = {"dropoff": {"atelier_id": loc["id"], "day": "2026-10-11"}, "address_id": addr}
    for _ in range(2):
        assert api.post("/api/me/bookings", headers=client_headers, json=body).status_code == 201
    day = next(d for d in api.get("/api/me/ateliers", headers=client_headers).json()[0]["dates"] if d["day"] == "2026-10-11")
    assert day["full"] is True
    assert api.post("/api/me/bookings", headers=client_headers, json=body).status_code == 409


def test_D11_retire_not_delete(api, client_headers, staff_headers, db_session):
    from tests.test_flow import _address
    loc = _atelier(api, staff_headers)
    _member(db_session)
    addr = _address(api, client_headers)
    api.post("/api/me/bookings", headers=client_headers, json={"dropoff": {"atelier_id": loc["id"], "day": "2026-10-11"}, "address_id": addr})
    assert api.delete(f"/api/staff/ateliers/{loc['id']}", headers=staff_headers).status_code == 409
    r = api.patch(f"/api/staff/ateliers/{loc['id']}", headers=staff_headers, json={"status": "retired", "confirm": True})
    assert r.json()["applied"] is True
    assert api.get("/api/me/ateliers", headers=client_headers).json() == []
    assert len(api.get("/api/me/bookings", headers=client_headers).json()) == 1  # history kept


def test_D12_available_from(api, client_headers, staff_headers, db_session):
    _atelier(api, staff_headers, available_from="2026-10-20")
    _member(db_session)
    dates = api.get("/api/me/ateliers", headers=client_headers, params={"days": 21}).json()[0]["dates"]
    assert min(d["day"] for d in dates) == "2026-10-20"  # not offered before it opens


def test_Z7_dropoff_return_must_be_in_area(api, client_headers, staff_headers, db_session):
    loc = _atelier(api, staff_headers)
    _member(db_session)
    home = api.post("/api/me/addresses", headers=client_headers, json={"line1": "1 Balham Hill", "postcode": "SW12 9EE"}).json()
    ret = _return_slot(api, "saver")
    r = api.post("/api/me/bookings", headers=client_headers, json={
        "dropoff": {"atelier_id": loc["id"], "day": "2026-10-11"}, "address_id": home["id"],
        "delivery": {"template_id": ret["template_id"], "day": ret["day"]}})
    assert r.status_code == 409 and "not yet in our area" in r.json()["detail"]


def test_dropoff_email_has_bag_codes_and_dates(api, client_headers, staff_headers, db_session):
    from app.services import mailer
    from tests.test_flow import _address
    loc = _atelier(api, staff_headers)
    _member(db_session)
    addr = _address(api, client_headers)
    mailer.OUTBOX.clear()
    o = api.post("/api/me/bookings", headers=client_headers,
                 json={"dropoff": {"atelier_id": loc["id"], "day": "2026-10-11", "bags": 2}, "address_id": addr}).json()
    sent = mailer.last_to("client@example.com")
    assert sent["subject"] == "Your LAVE drop-off is booked"
    assert (f"Your drop-off is booked: LAVE Atelier, Battersea Power Station, Sunday 11 October, 8am to 8pm. Label each "
            f"bag with its code: {o['ref']}-1, {o['ref']}-2. We'll treat your items as collected Monday 12 October, "
            f"10am and can return them from Wednesday 14 October, 10am.") in sent["text"]
    assert "Included with your membership" in sent["text"]


def test_atelier_hours_text():
    from app.models import AtelierLocation
    from app.services import ateliers
    loc = AtelierLocation(weekly_hours={**{str(d): ["08:00", "20:00"] for d in range(5)}, "6": ["10:00", "16:30"]})
    assert ateliers.hours_text(loc) == "Mon–Fri 8am–8pm, Sun 10am–4:30pm"


def test_return_booked_later_keeps_one_charge(api, client_headers, staff_headers):
    """Arrange later, then book the return from the account (or staff book it): still one charge, 48 hours on."""
    from tests.test_flow import _address, _slots
    addr = _address(api, client_headers)
    coll = next(s for s in _slots(api, window="saver") if s["day"] == "2026-10-06")
    order = api.post("/api/me/bookings", headers=client_headers,
                     json={"collection": {"template_id": coll["template_id"], "day": coll["day"]}, "address_id": addr}).json()
    assert order["fees_pence"] == 495  # non-member, Saver, no list yet
    too_soon = next(s for s in _slots(api, start="2026-10-07", window="hour") if s["day"] == "2026-10-07")
    r = api.post(f"/api/me/orders/{order['ref']}/return", headers=client_headers,
                 json={"slot": {"template_id": too_soon["template_id"], "day": too_soon["day"]}, "address_id": addr})
    assert r.status_code == 409 and "ready from Thursday 8 October" in r.json()["detail"]
    hour = next(s for s in _slots(api, start="2026-10-08", window="hour") if s["starts_at"] >= "2026-10-08T10:00:00")
    r = api.post(f"/api/me/orders/{order['ref']}/return", headers=client_headers,
                 json={"slot": {"template_id": hour["template_id"], "day": hour["day"]}, "address_id": addr})
    assert r.status_code == 201 and r.json()["fees_pence"] == 695  # one-hour leg: £6.95 replaces £4.95, once
    # A second return isn't possible from the account; staff can see when items are ready.
    assert api.post(f"/api/me/orders/{order['ref']}/return", headers=client_headers,
                    json={"slot": {"template_id": hour["template_id"], "day": hour["day"]}, "address_id": addr}).status_code == 409
    ready = api.get(f"/api/staff/orders/{order['id']}/earliest-return", headers=staff_headers).json()
    assert ready["earliest_return"] == "2026-10-08T10:00:00"


def test_staff_book_a_return(api, client_headers, staff_headers):
    from tests.test_flow import _address, _slots
    addr = _address(api, client_headers)
    coll = _slots(api)[0]
    order = api.post("/api/me/bookings", headers=client_headers,
                     json={"collection": {"template_id": coll["template_id"], "day": coll["day"]}, "address_id": addr}).json()
    saver = next(s for s in _slots(api, start="2026-10-08", window="saver") if s["starts_at"] >= "2026-10-08T07:00:00")
    r = api.post(f"/api/staff/orders/{order['id']}/return", headers=staff_headers,
                 json={"slot": {"template_id": saver["template_id"], "day": saver["day"]}, "address_id": addr})
    assert r.status_code == 201, r.text
    assert [b["kind"] for b in r.json()["bookings"]] == ["collection", "delivery"] and r.json()["fees_pence"] == 695


def test_dropoff_has_its_own_lower_minimum(api, client_headers, staff_headers, db_session):
    from tests.test_flow import _address
    loc = _atelier(api, staff_headers)
    _member(db_session)
    addr = _address(api, client_headers)
    with db_session() as db:
        coat = db.scalar(select(Service).where(Service.name == "Coat, long"))  # £27.99: under £30, over £20
        tie = db.scalar(select(Service).where(Service.name == "Tie"))  # £12.99: under both
    api.cookies.set("lave_list", f"i{tie.id}:1")
    body = {"dropoff": {"atelier_id": loc["id"], "day": "2026-10-11", "bags": 1}, "address_id": addr}
    r = api.post("/api/me/bookings", headers=client_headers, json=body)
    assert r.status_code == 409 and "the minimum order is £20" in r.json()["detail"]
    api.cookies.set("lave_list", f"i{coat.id}:1")
    assert "For members dropping off at a LAVE atelier, it&#39;s £20" in api.get("/atelier/list/").text
    assert 'aria-disabled="true"' not in api.get("/atelier/list/").text
    api.cookies.set("lave_client", client_headers["Authorization"].removeprefix("Bearer "))
    assert 'mode="drop_off"' in api.get("/book/").text  # booking opens on drop-off
    r = api.post("/api/me/bookings", headers=client_headers, json=body)
    assert r.status_code == 201 and r.json()["minimum_pence"] == 2000
