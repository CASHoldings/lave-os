from tests.conftest import wp_token


def _address(api, h):
    r = api.post("/api/me/addresses", headers=h, json={"line1": "1 Haydon Way", "postcode": "sw11 1yf"})
    assert r.status_code == 201, r.text
    assert r.json()["postcode"] == "SW11 1YF"
    assert r.json()["is_default"] is True
    return r.json()["id"]


def _slots(api, start="2026-10-06", **params):
    r = api.get("/api/slots", params={"start": start, "days": 5, **params})
    assert r.status_code == 200, r.text
    return r.json()


def test_sso_creates_then_links_client(api):
    r = api.post("/api/auth/wp-exchange", json={"token": wp_token(first_name="Celia")})
    assert r.json()["client"]["first_name"] == "Celia"
    again = api.post("/api/auth/wp-exchange", json={"token": wp_token()})
    assert again.json()["client"]["id"] == r.json()["client"]["id"]


def test_sso_rejects_bad_signature(api):
    import jwt
    bad = jwt.encode({"iss": "lave-wp", "sub": "1", "email": "x@y.z", "iat": 0, "exp": 9999999999}, "wrong-secret-0123456789abcdef0123456789", algorithm="HS256")
    assert api.post("/api/auth/wp-exchange", json={"token": bad}).status_code == 401


def test_slots_respect_notice_and_sundays(api):
    today = _slots(api, start="2026-10-05", days=1)
    # Now is 08:00 with 2h notice: earliest hour slot is 10:00.
    assert min(s["starts_at"] for s in today) == "2026-10-05T10:00:00"
    week = _slots(api, start="2026-10-05", days=7)
    assert not any(s["day"] == "2026-10-11" for s in week)  # Sunday closed
    assert all(s["fee_pence"] == 400 for s in week)


def test_full_booking_to_delivery(api, client_headers, staff_headers):
    addr = _address(api, client_headers)
    coll = _slots(api)[0]
    deliveries = _slots(api, after=coll["ends_at"])
    # Delivery must be at least 24h after collection.
    too_soon = next(s for s in deliveries if s["starts_at"] < "2026-10-07T11:00:00")
    r = api.post("/api/me/bookings", headers=client_headers, json={
        "collection": {"template_id": coll["template_id"], "day": coll["day"]},
        "delivery": {"template_id": too_soon["template_id"], "day": too_soon["day"]},
        "address_id": addr})
    assert r.status_code == 409

    later = _slots(api, start="2026-10-08")[0]
    r = api.post("/api/me/bookings", headers=client_headers, json={
        "collection": {"template_id": coll["template_id"], "day": coll["day"]},
        "delivery": {"template_id": later["template_id"], "day": later["day"]},
        "address_id": addr, "requested_services": ["clean"], "notes": "Wine on the silk hem"})
    assert r.status_code == 201, r.text
    order = r.json()
    assert order["fees_pence"] == 800
    oid = order["id"]

    # Driver completes the collection -> order collected.
    board = api.get("/api/staff/dashboard", params={"day": "2026-10-06"}, headers=staff_headers).json()
    coll_booking = board["collections"][0]
    r = api.patch(f"/api/staff/bookings/{coll_booking['id']}", headers=staff_headers, json={"status": "completed"})
    assert r.status_code == 200
    assert api.get(f"/api/staff/orders/{oid}", headers=staff_headers).json()["status"] == "collected"

    # Can't inspect without items.
    assert api.post(f"/api/staff/orders/{oid}/status", headers=staff_headers, json={"status": "inspected"}).status_code == 409

    services = {s["code"]: s for s in api.get("/api/services").json()}
    r = api.post(f"/api/staff/orders/{oid}/items", headers=staff_headers,
                 json={"description": "Silk dress", "service_id": services["HAND_SILK"]["id"], "colour": "Ivory"})
    r = api.post(f"/api/staff/orders/{oid}/items", headers=staff_headers,
                 json={"description": "Wool coat", "service_id": services["DC_COAT"]["id"], "send_to_vault": True})
    detail = r.json()
    assert [i["tag_code"][-2:] for i in detail["items"]] == ["01", "02"]
    assert detail["total_pence"] == 1600 + 2500 + 800

    for st in ["inspected", "in_care", "quality_check", "ready"]:
        r = api.post(f"/api/staff/orders/{oid}/status", headers=staff_headers, json={"status": st})
        assert r.status_code == 200, r.text
    items = {i["description"]: i["status"] for i in r.json()["items"]}
    assert items == {"Silk dress": "ready", "Wool coat": "in_vault"}

    # Nothing leaves unpaid.
    assert api.post(f"/api/staff/orders/{oid}/status", headers=staff_headers, json={"status": "out_for_delivery"}).status_code == 409
    assert api.post(f"/api/staff/orders/{oid}/payment", headers=staff_headers, json={"status": "paid"}).status_code == 200
    assert api.post(f"/api/staff/orders/{oid}/status", headers=staff_headers, json={"status": "out_for_delivery"}).status_code == 200

    # Client sees the timeline without staff-only events, and the coat in the Vault.
    mine = api.get(f"/api/me/orders/{order['ref']}", headers=client_headers).json()
    labels = [e["label"] for e in mine["timeline"]]
    assert labels[0] == "Booked" and "Out for delivery" in labels
    assert not any(e["status"] == "item_added" for e in mine["timeline"])
    vault = api.get("/api/me/vault", headers=client_headers).json()
    assert [v["description"] for v in vault] == ["Wool coat"]


def test_capacity_and_cancel(api, client_headers):
    addr = _address(api, client_headers)
    slot = _slots(api)[0]
    body = {"collection": {"template_id": slot["template_id"], "day": slot["day"]}, "address_id": addr}
    for _ in range(4):
        assert api.post("/api/me/bookings", headers=client_headers, json=body).status_code == 201
    assert api.post("/api/me/bookings", headers=client_headers, json=body).status_code == 409
    after = next(s for s in _slots(api) if s["template_id"] == slot["template_id"] and s["day"] == slot["day"])
    assert after["remaining"] == 0

    booking = api.get("/api/me/bookings", headers=client_headers).json()[0]
    r = api.post(f"/api/me/bookings/{booking['id']}/cancel", headers=client_headers)
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    orders = api.get("/api/me/orders", headers=client_headers).json()
    assert any(o["status"] == "cancelled" for o in orders)
    assert api.post("/api/me/bookings", headers=client_headers, json=body).status_code == 201


def test_other_clients_cannot_see_my_data(api, client_headers):
    addr = _address(api, client_headers)
    other = api.post("/api/auth/wp-exchange", json={"token": wp_token(wp_id=7, email="other@example.com")}).json()["token"]
    oh = {"Authorization": f"Bearer {other}"}
    assert api.patch(f"/api/me/addresses/{addr}", headers=oh, json={"label": "Mine"}).status_code == 404
    slot = _slots(api)[0]
    r = api.post("/api/me/bookings", headers=oh, json={"collection": {"template_id": slot["template_id"], "day": slot["day"]}, "address_id": addr})
    assert r.status_code == 404


def test_vault_retrieval(api, client_headers, staff_headers):
    addr = _address(api, client_headers)
    me = api.get("/api/me", headers=client_headers).json()
    o = api.post("/api/staff/orders", headers=staff_headers, json={"client_id": me["id"]}).json()
    api.post(f"/api/staff/orders/{o['id']}/items", headers=staff_headers, json={"description": "Cashmere coat", "send_to_vault": True, "price_pence": 2500})
    for st in ["inspected", "in_care", "quality_check", "ready"]:
        api.post(f"/api/staff/orders/{o['id']}/status", headers=staff_headers, json={"status": st})
    item = api.get("/api/me/vault", headers=client_headers).json()[0]

    slot = _slots(api)[0]
    r = api.post("/api/me/vault/retrieve", headers=client_headers,
                 json={"item_ids": [item["id"]], "slot": {"template_id": slot["template_id"], "day": slot["day"]}, "address_id": addr})
    assert r.status_code == 201, r.text
    assert api.get("/api/me/vault", headers=client_headers).json()[0]["status"] == "retrieval_requested"
    # Second request for the same item is refused.
    r2 = api.post("/api/me/vault/retrieve", headers=client_headers,
                  json={"item_ids": [item["id"]], "slot": {"template_id": slot["template_id"], "day": slot["day"]}, "address_id": addr})
    assert r2.status_code == 409

    api.patch(f"/api/staff/bookings/{r.json()['id']}", headers=staff_headers, json={"status": "completed"})
    assert api.get("/api/me/vault", headers=client_headers).json() == []


def test_roles(api, client_headers):
    r = api.post("/api/staff/auth/login", json={"email": "driver@lavelondon.com", "password": "driver-password"})
    dh = {"Authorization": f"Bearer {r.json()['token']}"}
    api.cookies.clear()
    assert api.get("/api/staff/dashboard", headers=dh).status_code == 200
    assert api.get("/api/staff/orders", headers=dh).status_code == 403
    assert api.post("/api/staff/services", headers=dh, json={"code": "X", "name": "X", "category": "clean", "price_pence": 1}).status_code == 403
    # Client tokens don't open staff endpoints.
    assert api.get("/api/staff/dashboard", headers=client_headers).status_code == 401
    assert api.post("/api/staff/auth/login", json={"email": "driver@lavelondon.com", "password": "nope"}).status_code == 401


def test_payments_need_stripe_keys(api, client_headers):
    r = api.post("/api/me/payment/setup-intent", headers=client_headers)
    assert r.status_code == 503
