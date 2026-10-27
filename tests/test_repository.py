"""The product repository: the private admin view, the client-facing price list and packs, and the client's list."""
import csv
import io

import pytest
from sqlalchemy import select

from app.models import Order, Pack, Service, SiteSetting
from app.services import repository as repo


def _item(db_session, name):
    with db_session() as db:
        return db.scalar(select(Service).where(Service.name == name))


def _admin_overview(api, staff_headers):
    r = api.get("/api/staff/repository", headers=staff_headers)
    assert r.status_code == 200, r.text
    return r.json()


def test_repository_replaces_the_starting_price_list(db_session):
    with db_session() as db:
        items = repo.items(db)
        assert len(items) == 329
        assert len(repo.packs(db)) == 71
        # The old placeholder list and WordPress listings are retired, and old listings point at their replacement.
        old = db.scalar(select(Service).where(Service.slug == "silk-chiffon-dress-dry-cleaning"))
        assert not old.active and not old.show_online
        assert db.get(Service, old.replaced_by_id).name == "Dress, short silk"
        assert not db.scalar(select(Service).where(Service.code == "HAND_SILK")).active
        # Photos carried over to the matching item.
        assert _item(db_session, "Leather jacket").image.endswith("LAVE_Leather-Blazer-Dry-Cleaning.avif")
        # Loading twice changes nothing.
        assert repo.load_repository(db) is None


def test_figures_match_the_sheet(db_session):
    with db_session() as db:
        by_id = {s.id: s for s in repo.items(db)}
        week = db.scalar(select(Pack).where(Pack.name == "The Work Week"))
        fig = repo.pack_figures(week, by_id)
        assert fig["price_pence"] == 4395 and fig["count"] == 5 and fig["margin"] == 75
        bath = db.scalar(select(Pack).where(Pack.name == "Bathroom Set"))
        assert repo.pack_figures(bath, by_id)["margin"] is None  # face towel has no cost yet
        shirt = _item(db_session, "Shirt, non-member hung")
        assert (shirt.sale_mode, shirt.price_pence, shirt.cost_pence, repo.margin(shirt.price_pence, shirt.cost_pence)) == ("pack", 599, 140, 77)
        assert db.scalar(select(Pack).where(Pack.name == "Winter Warmers")).months == [1, 2, 4, 11, 12]


def test_price_list_shows_prices_but_never_costs(api):
    page = api.get("/atelier/prices/").text
    for text in ["Shirt, non-member hung", "£5.99", "5 for £29.95", "Best value in packs of 5", "Leather jacket", "from</span> £109.99",
                 "Quoted after inspection", "per m²", "Wardrobe", "Home", "Pressing, alterations &amp; repairs", "Free Saver collection and delivery on orders from £45"]:
        assert text in page, text
    for secret in ["American Standard", "SoFresh", "Market reference", "Margin", "American basis", "£1.40"]:
        assert secret not in page, secret
    assert api.get("/prices/", follow_redirects=False).headers["location"] == "/atelier/prices/"
    public = api.get("/api/services").json()
    assert public and not any("cost_pence" in s or "internal_notes" in s for s in public)


def test_packs_page(api):
    page = api.get("/atelier/packs/").text
    assert "The Work Week" in page and "£43.95" in page and "3 ×" in page and "Shirt, non-member hung" in page
    assert "Everyday packs" in page and "Home packs" in page and "Add-ons" in page


def _add(api, kind, ident, qty=1, action="add"):
    r = api.post("/atelier/list/", data={"action": action, "kind": kind, "id": ident, "qty": qty}, headers={"Accept": "application/json"})
    assert r.status_code == 200, r.text
    return r.json()


def test_client_list_estimate_and_rules(api, db_session):
    shirt = _item(db_session, "Shirt, non-member hung")
    jacket = _item(db_session, "Leather jacket")
    with db_session() as db:
        week = db.scalar(select(Pack).where(Pack.name == "The Work Week"))
    r = _add(api, "item", shirt.id, 2)
    assert r["count"] == 2 and r["estimate_pence"] == 1198 and "the minimum order is £29.95" in r["warnings"][0]
    r = _add(api, "item", shirt.id, 3)
    assert r["qty"] == 5 and not r["warnings"]  # a 5-shirt pack (£29.95) meets the minimum
    r = _add(api, "item", jacket.id)  # quoted after inspection: not in the estimate, but counts towards the minimum
    assert r["estimate_pence"] == 2995
    r = _add(api, "pack", week.id)
    assert r["estimate_pence"] == 2995 + 4395
    page = api.get("/atelier/list/").text
    assert "The Work Week" in page and "Quoted after inspection" in page and "£73.90" in page and "Free Saver collection and delivery" in page
    r = _add(api, "item", shirt.id, 0, action="set")
    assert r["qty"] == 0 and r["count"] == 2  # the jacket and the pack remain
    assert api.post("/atelier/list/", data={"action": "add", "kind": "item", "id": 999999}).status_code == 404
    assert "Your list (" in api.get("/atelier/prices/").text


def test_list_goes_with_the_booking(api, client_headers, staff_headers, db_session):
    from tests.test_wardrobe import _slot
    coat = _item(db_session, "Coat, long")
    _add(api, "item", coat.id, 2)
    addr = api.post("/api/me/addresses", headers=client_headers, json={"line1": "1 Battersea Park Road", "city": "London", "postcode": "SW11 4NP"}).json()["id"]
    slot = _slot(api)
    r = api.post("/api/me/bookings", headers=client_headers, json={"collection": slot, "address_id": addr})
    assert r.status_code == 201, r.text
    assert "lave_list=" in r.headers.get("set-cookie", "")  # cleared
    order = api.get(f"/api/staff/orders/{r.json()['id']}", headers=staff_headers).json()
    assert order["estimate_pence"] == 5598
    assert order["requested_items"][0]["name"] == "Coat, long" and order["requested_items"][0]["qty"] == 2


def test_admin_repository_is_admin_only(api, staff_headers):
    r = api.post("/api/staff/auth/login", json={"email": "driver@lavelondon.com", "password": "driver-password"})
    api.cookies.clear()
    driver = {"Authorization": f"Bearer {r.json()['token']}"}
    assert api.get("/api/staff/repository", headers=driver).status_code == 403
    data = _admin_overview(api, staff_headers)
    assert data["stats"]["items"] == 329 and data["stats"]["missing_cost"] == 146 and data["stats"]["packs"] == 71
    assert data["categories"][0] == "Shirts & tops (wash & press)"
    shirt = next(s for s in data["items"] if s["name"] == "Shirt, non-member hung")
    assert shirt["margin"] == 77 and shirt["pack_pence"] == 2995 and shirt["internal_notes"] == ""


def test_admin_edits_items_and_packs_follow(api, staff_headers, db_session):
    shirt = _item(db_session, "Shirt, non-member hung")
    r = api.patch(f"/api/staff/repository/items/{shirt.id}", headers=staff_headers, json={"price_pence": 649, "cost_pence": None})
    assert r.status_code == 200 and r.json()["margin"] is None and r.json()["cost_pence"] is None
    week = next(p for p in _admin_overview(api, staff_headers)["packs"] if p["name"] == "The Work Week")
    assert week["price_pence"] == 3 * 649 + 2 * 1299 and week["margin"] is None
    assert "£6.49" in api.get("/atelier/prices/").text

    new = api.post("/api/staff/repository/items", headers=staff_headers,
                   json={"name": "Cape, velvet", "product_category": "Coats", "sale_mode": "single", "service_type": "Dry clean",
                         "price_pence": 3299, "cost_pence": 900, "show_online": True})
    assert new.status_code == 201 and new.json()["margin"] == 73 and new.json()["collections"] == ["women", "men"]
    assert api.post("/api/staff/repository/items", headers=staff_headers,
                    json={"name": "cape, velvet", "product_category": "Coats", "price_pence": 1}).status_code == 409
    pack = api.post("/api/staff/repository/packs", headers=staff_headers,
                    json={"name": "Velvet Season", "note": "November–December", "items": [{"service_id": new.json()["id"], "qty": 2}], "months": [11, 12]})
    assert pack.status_code == 201 and pack.json()["price_pence"] == 6598 and pack.json()["margin"] == 73
    assert "Velvet Season" in api.get("/atelier/packs/").text
    api.patch(f"/api/staff/repository/items/{new.json()['id']}", headers=staff_headers, json={"active": False})
    assert "Velvet Season" not in api.get("/atelier/packs/").text  # a pack with a retired item is hidden
    assert api.delete(f"/api/staff/repository/packs/{pack.json()['id']}", headers=staff_headers).status_code == 204


def test_rules_drive_the_client_list(api, staff_headers, db_session):
    r = api.put("/api/staff/repository/rules", headers=staff_headers,
                json={"home_minimum_pence": 3500, "dropoff_minimum_pence": 2000, "free_delivery_from_pence": 6000,
                      "minimum_margin": 70, "text": "House rules"})
    assert r.status_code == 200 and r.json()["home_minimum_pence"] == 3500
    shirt = _item(db_session, "Shirt, non-member hung")
    assert f"Add £{(3500 - 5 * shirt.price_pence) / 100:.2f} more" in _add(api, "item", shirt.id, 5)["warnings"][0]
    assert "Free Saver collection and delivery on orders from £60" in api.get("/atelier/prices/").text
    assert _admin_overview(api, staff_headers)["stats"]["low_margin"] > 0


def _upload(api, headers, text, apply=False, retire=False):
    return api.post("/api/staff/repository/import", headers=headers, files={"file": ("sheet.csv", text.encode(), "text/csv")},
                    data={"apply": str(apply).lower(), "retire_missing": str(retire).lower()})


def test_export_then_import_round_trip(api, staff_headers):
    exported = api.get("/api/staff/repository/export.csv", headers=staff_headers)
    assert exported.status_code == 200 and exported.headers["content-type"].startswith("text/csv")
    preview = _upload(api, staff_headers, exported.text).json()
    assert preview["rows"] == 329 and not preview["new"] and not preview["changed"] and not preview["missing"] and not preview["problems"]


def test_import_from_the_pricing_sheet(api, staff_headers, db_session):
    rows = list(csv.DictReader(open(repo.ITEMS_CSV)))
    for r in rows:
        if r["Item"] == "Coat, long":
            r["LAVE price £"], r["LAVE cost £"] = "£29.99", "£9.00"
    rows = [r for r in rows if r["Item"] != "Slippers"]
    rows.append({**rows[0], "Item": "Shirt, linen hung", "LAVE price £": "£6.49", "LAVE cost £": "", "Notes": "New for spring"})
    out = io.StringIO()
    w = csv.DictWriter(out, fieldnames=list(rows[0].keys()))
    w.writeheader()
    w.writerows(rows)
    text = out.getvalue()

    preview = _upload(api, staff_headers, text).json()
    assert [n["name"] for n in preview["new"]] == ["Shirt, linen hung"]
    changed = {c["name"]: c["changes"] for c in preview["changed"]}
    assert changed["Coat, long"]["price_pence"] == [2799, 2999] and changed["Coat, long"]["cost_pence"] == [848, 900]
    assert [m["name"] for m in preview["missing"]] == ["Slippers"]
    assert _item(db_session, "Coat, long").price_pence == 2799  # preview changes nothing

    result = _upload(api, staff_headers, text, apply=True, retire=True).json()
    assert result == {"applied": True, "added": 1, "updated": 329 - 1, "retired": 1}
    assert _item(db_session, "Coat, long").price_pence == 2999
    assert not _item(db_session, "Slippers").active
    assert "Shirt, linen hung" in api.get("/atelier/prices/").text

    bad = _upload(api, staff_headers, "Category,Item,How sold,LAVE price £\nCoats,Cape,Sometimes,£10\n").json()
    assert "How sold" in bad["problems"][0]
    assert "missing these columns" in _upload(api, staff_headers, "Name,Price\nx,1\n").json()["problems"][0]


@pytest.mark.parametrize("raw,expected", [("i12:3,p4:1", {"i12": 3, "p4": 1}), ("i1:0,x:3,i2:500", {}), ("", {})])
def test_list_cookie_is_validated(raw, expected):
    assert repo.parse_list(raw) == expected


def test_atelier_page_links_to_prices_and_packs(api):
    page = api.get("/atelier/").text
    assert 'href="/atelier/prices/"' in page and 'href="/atelier/packs/"' in page


def test_bundled_photos_go_to_the_library_and_the_price_list(db_session, api, staff_headers, tmp_path):
    from app.models import Media
    with db_session() as db:
        chosen = db.scalar(select(Service).where(Service.name == "Coat, long"))
        chosen.image = "/media/founder-picked.webp"  # picked in /admin before the photos arrived
        db.commit()
        result = repo.load_bundled_images(db)
        assert result["added"] == 461 and result["packs"] == 50 and result["categories"] == 19
        assert result["items"] == 123  # all mapped items except the one already chosen
        assert db.scalar(select(Service).where(Service.name == "Coat, long")).image == "/media/founder-picked.webp"
        cashmere = db.scalar(select(Service).where(Service.name == "Coat, cashmere"))
        assert cashmere.image == "/media/women-coat-cashmere.webp"
        assert db.scalar(select(Media).where(Media.url == cashmere.image)).alt == "Women's coat, cashmere"
        # The old WordPress photo carried onto Leather jacket gives way to the studio shot.
        assert _item(db_session, "Leather jacket").image == "/media/men-jacket-leather.webp"
        # A second deploy adds and changes nothing, even if the founder has since removed a photo.
        cashmere.image = ""
        db.commit()
        assert repo.load_bundled_images(db) == {"added": 0, "items": 0, "packs": 0, "categories": 0}
        assert db.scalar(select(Service).where(Service.name == "Coat, cashmere")).image == ""

        # A newer photo set refreshes photos the bundle placed (here: a scene photo that has since been dropped),
        # but never the founder's own choice.
        throw = db.scalar(select(Service).where(Service.name == "Throw"))
        throw.image = "/media/lave-lave143.webp"
        repo.set_setting(db, "images_applied", "0")
        db.query(SiteSetting).filter(SiteSetting.key == "repository.images_assigned").delete()
        db.commit()
        repo.load_bundled_images(db)
        assert db.scalar(select(Service).where(Service.name == "Throw")).image == ""
        assert db.scalar(select(Service).where(Service.name == "Coat, long")).image == "/media/founder-picked.webp"
        assert "Curtains & blinds" not in repo.category_images(db)  # no clean photo, so no banner

    page = api.get("/atelier/prices/").text
    assert 'class="cat-index"' in page and "/media/lave-lave166.webp" in page and 'class="price-thumb"' in page
    packs_page = api.get("/atelier/packs/").text
    assert "/media/lave-lave184.webp" in packs_page  # The Work Week flat-lay
    assert "/media/pack-the-weekend.webp" in packs_page  # built from its items' studio shots

    r = api.put("/api/staff/repository/category-image", headers=staff_headers, json={"category": "Coats", "image": "/media/new-coats.webp"})
    assert r.status_code == 200 and r.json()["Coats"] == "/media/new-coats.webp"
    assert api.put("/api/staff/repository/category-image", headers=staff_headers, json={"category": "Nope", "image": ""}).status_code == 404
    assert api.put("/api/staff/repository/category-image", headers=staff_headers,
                   json={"category": "Coats", "image": "javascript:alert(1)"}).status_code == 400


def test_bundled_photos_are_sent_from_the_code(api):
    from app.services.repository import IMAGES_DIR
    first = sorted(IMAGES_DIR.glob("*.webp"))[0]
    r = api.get(f"/media/{first.name}")
    assert r.status_code == 200 and r.content == first.read_bytes()
    assert r.headers["cache-control"] == "public, max-age=86400"
    assert api.get("/media/../app/config.py").status_code == 404
    assert api.get("/media/nothing-here.webp").status_code == 404
