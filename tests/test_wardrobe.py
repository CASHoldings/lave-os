def _slot(api):
    return api.get("/api/slots", params={"start": "2026-10-06", "days": 5}).json()[0]


def _order_with_items(api, ch, sh, items):
    addr = api.post("/api/me/addresses", headers=ch, json={"line1": "1 Haydon Way", "postcode": "SW11 1YF"}).json()["id"]
    s = _slot(api)
    o = api.post("/api/me/bookings", headers=ch, json={"collection": {"template_id": s["template_id"], "day": s["day"]},
                                                       "address_id": addr}).json()
    coll = next(b for b in o["bookings"] if b["kind"] == "collection")
    api.patch(f"/api/staff/bookings/{coll['id']}", headers=sh, json={"status": "completed"})
    for it in items:
        api.post(f"/api/staff/orders/{o['id']}/items", headers=sh, json=it)
    for st in ["inspected", "in_care", "quality_check", "ready"]:
        api.post(f"/api/staff/orders/{o['id']}/status", headers=sh, json={"status": st})
    api.post(f"/api/staff/orders/{o['id']}/payment", headers=sh, json={"status": "paid"})
    api.post(f"/api/staff/orders/{o['id']}/status", headers=sh, json={"status": "delivered"})
    return o, addr


def test_wardrobe_builds_and_rebooks(api, client_headers, staff_headers):
    svc = {s["code"]: s for s in api.get("/api/services").json()}
    _order_with_items(api, client_headers, staff_headers, [
        {"description": "Wool coat", "colour": "Camel", "service_id": svc["DC_COAT"]["id"]},
        {"description": "Silk blouse", "service_id": svc["HAND_SILK"]["id"]},
    ])
    wardrobe = api.get("/api/me/wardrobe", headers=client_headers).json()
    assert {w["title"] for w in wardrobe} == {"Camel Wool coat", "Silk blouse"}
    coat = next(w for w in wardrobe if w["name"] == "Wool coat")
    assert coat["times_cleaned"] == 1 and coat["service"]["price_pence"] == 2500

    # Book the coat again; staff see the request and link the new garment to the same piece.
    s = api.get("/api/slots", params={"start": "2026-10-08", "days": 3}).json()[0]
    addr = api.get("/api/me", headers=client_headers).json()["addresses"][0]["id"]
    o2 = api.post("/api/me/bookings", headers=client_headers, json={
        "collection": {"template_id": s["template_id"], "day": s["day"]}, "address_id": addr,
        "wardrobe_item_ids": [coat["id"]]}).json()
    detail = api.get(f"/api/staff/orders/{o2['id']}", headers=staff_headers).json()
    assert [r["title"] for r in detail["requested_wardrobe"]] == ["Camel Wool coat"]
    coll = next(b for b in o2["bookings"] if b["kind"] == "collection")
    api.patch(f"/api/staff/bookings/{coll['id']}", headers=staff_headers, json={"status": "completed"})
    api.post(f"/api/staff/orders/{o2['id']}/items", headers=staff_headers,
             json={"description": "Wool coat", "service_id": svc["DC_COAT"]["id"], "wardrobe_item_id": coat["id"]})
    w2 = {w["id"]: w for w in api.get("/api/me/wardrobe", headers=client_headers).json()}
    assert len(w2) == 2 and w2[coat["id"]]["in_atelier"] is True

    # Rename and hide.
    assert api.patch(f"/api/me/wardrobe/{coat['id']}", headers=client_headers, json={"name": "Winter coat"}).json()["name"] == "Winter coat"
    api.patch(f"/api/me/wardrobe/{coat['id']}", headers=client_headers, json={"hidden": True})
    assert coat["id"] not in {w["id"] for w in api.get("/api/me/wardrobe", headers=client_headers).json()}


def test_wardrobe_is_private(api, client_headers, staff_headers):
    from tests.conftest import wp_token
    svc = {s["code"]: s for s in api.get("/api/services").json()}
    _order_with_items(api, client_headers, staff_headers, [{"description": "Coat", "service_id": svc["DC_COAT"]["id"]}])
    piece = api.get("/api/me/wardrobe", headers=client_headers).json()[0]
    other = {"Authorization": "Bearer " + api.post("/api/auth/wp-exchange", json={"token": wp_token(wp_id=9, email="o@example.com")}).json()["token"]}
    assert api.patch(f"/api/me/wardrobe/{piece['id']}", headers=other, json={"hidden": True}).status_code == 404
    s = _slot(api)
    a = api.post("/api/me/addresses", headers=other, json={"line1": "2 Road", "postcode": "W1 1AA"}).json()["id"]
    r = api.post("/api/me/bookings", headers=other, json={"collection": {"template_id": s["template_id"], "day": s["day"]},
                                                         "address_id": a, "wardrobe_item_ids": [piece["id"]]})
    assert r.status_code == 404
