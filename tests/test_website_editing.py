"""Phase 6: editing the website from /admin (content documents, image library, services and products)."""
import pytest
from sqlalchemy import select

from app.models import Media, Service
from app.services import media as media_svc
from app.site import store

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 32


@pytest.fixture(autouse=True)
def fresh_cache():
    store._cache.update(stamp=None, site=None)
    yield
    store._cache.update(stamp=None, site=None)


def _doc(api, headers, key):
    r = api.get(f"/api/staff/content/{key}", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def test_every_document_is_listed_and_loads(api, staff_headers):
    docs = api.get("/api/staff/content", headers=staff_headers).json()
    keys = [d["key"] for d in docs]
    assert keys[:2] == ["home", "page.atelier"] and "menus" in keys and "plans" in keys and "footer" in keys
    assert not any(d["customised"] for d in docs)
    for k in keys:
        assert _doc(api, staff_headers, k)["value"]


def test_menu_edit_shows_on_site_and_reset_restores(api, staff_headers):
    menus = _doc(api, staff_headers, "menus")["value"]
    apo = next(s for s in menus["sections"] if s["key"] == "apothecary")
    apo["subnav"][0]["columns"][0]["links"].append({"label": "Silk wash", "href": ""})
    r = api.put("/api/staff/content/menus", headers=staff_headers, json={"value": menus})
    assert r.status_code == 200, r.text
    assert "Silk wash" in api.get("/apothecary/").text
    assert _doc(api, staff_headers, "menus")["customised"]

    r = api.post("/api/staff/content/menus/reset", headers=staff_headers)
    assert r.status_code == 200
    assert "Silk wash" not in api.get("/apothecary/").text


def test_edits_must_keep_the_shape(api, staff_headers):
    menus = _doc(api, staff_headers, "menus")["value"]

    bad = {**menus, "sections": menus["sections"][:-1]}  # locked list
    assert api.put("/api/staff/content/menus", headers=staff_headers, json={"value": bad}).status_code == 400

    changed_key = {"sections": [dict(menus["sections"][0], key="shop")] + menus["sections"][1:]}  # readonly field
    assert api.put("/api/staff/content/menus", headers=staff_headers, json={"value": changed_key}).status_code == 400

    home = _doc(api, staff_headers, "home")["value"]
    assert api.put("/api/staff/content/home", headers=staff_headers,
                   json={"value": {"apothecary": home["apothecary"]}}).status_code == 400  # missing field
    unsafe = {**home, "atelier": {**home["atelier"], "href": "javascript:alert(1)"}}
    assert api.put("/api/staff/content/home", headers=staff_headers, json={"value": unsafe}).status_code == 400
    blank = {**home, "atelier": {**home["atelier"], "title": "  "}}
    assert api.put("/api/staff/content/home", headers=staff_headers, json={"value": blank}).status_code == 400
    assert api.put("/api/staff/content/nope", headers=staff_headers, json={"value": {}}).status_code == 404


def test_only_admins_save(api, staff_headers):
    r = api.post("/api/staff/auth/login", json={"email": "driver@lavelondon.com", "password": "driver-password"})
    api.cookies.clear()
    driver = {"Authorization": f"Bearer {r.json()['token']}"}
    home = _doc(api, staff_headers, "home")["value"]
    assert api.put("/api/staff/content/home", headers=driver, json={"value": home}).status_code == 403


def test_plan_edit_changes_prices_and_names(api, staff_headers):
    plans = _doc(api, staff_headers, "plans")["value"]
    essence = plans["plans"][0]
    essence["name"], essence["price_pence"] = "Essence Plus", 3100
    assert api.put("/api/staff/content/plans", headers=staff_headers, json={"value": plans}).status_code == 200
    page = api.get("/memberships/").text
    assert "Essence Plus" in page and "£31" in page
    cfg = {p["code"]: p for p in api.get("/api/config").json()["plans"]}
    assert cfg["essence"]["name"] == "Essence Plus" and cfg["essence"]["price_pence"] == 3100

    plans["plans"][0]["code"] = "basic"
    assert api.put("/api/staff/content/plans", headers=staff_headers, json={"value": plans}).status_code == 400


def test_home_and_footer_edits(api, staff_headers):
    home = _doc(api, staff_headers, "home")["value"]
    home["atelier"]["title"] = "The Atelier, London"
    api.put("/api/staff/content/home", headers=staff_headers, json={"value": home})
    assert "The Atelier, London" in api.get("/").text

    footer = _doc(api, staff_headers, "footer")["value"]
    footer["values_text"] = "Care for **people** <script>x</script>"
    api.put("/api/staff/content/footer", headers=staff_headers, json={"value": footer})
    page = api.get("/atelier/").text
    assert "<strong>people</strong>" in page and "<script>x</script>" not in page


def test_image_library_upload_and_alt(api, staff_headers, tmp_path, monkeypatch):
    from app.routers import staff
    monkeypatch.setattr(staff, "MEDIA_DIR", tmp_path)
    r = api.post("/api/staff/uploads", headers=staff_headers, files={"file": ("towels.png", PNG, "image/png")})
    assert r.status_code == 201
    lib = api.get("/api/staff/media", headers=staff_headers).json()
    item = lib["items"][0]
    assert item["filename"] == "towels.png" and item["url"] == r.json()["url"]
    assert lib["still_on_wordpress"] > 0  # the default content still borrows lavelondon.com images
    assert api.patch(f"/api/staff/media/{item['id']}", headers=staff_headers, json={"alt": "Folded towels"}).status_code == 200
    assert api.get("/api/staff/media?q=folded", headers=staff_headers).json()["items"][0]["alt"] == "Folded towels"


def test_wordpress_import_copies_and_rewrites(db_session, api, tmp_path):
    fetched = []

    def fake_fetch(url):
        fetched.append(url)
        if "ECLAT" in url:
            raise ValueError("404")
        return PNG

    with db_session() as db:
        before = media_svc.borrowed_urls(db, store.load(db).docs)
        result = media_svc.import_wordpress(db, store.load(db).docs, fetch=fake_fetch, media_dir=tmp_path)
        assert result["total"] == len(before) and result["copied"] == len(before) - 1
        assert len(result["failed"]) == 1 and "ECLAT" in result["failed"][0]
        left = media_svc.borrowed_urls(db, store.load(db).docs)
        assert left == {u for u in before if "ECLAT" in u}
        assert all(s.image.startswith("/media/") for s in db.scalars(select(Service).where(Service.image != "")))
        copies = db.scalar(select(Media).where(Media.source_url != "").limit(1))
        assert copies is not None

        # Running it again doesn't download what's already in the library.
        fetched.clear()
        media_svc.import_wordpress(db, store.load(db).docs, fetch=fake_fetch, media_dir=tmp_path)
        assert fetched == [u for u in sorted(left)]

    assert "/media/" in api.get("/").text and "lavelondon.com/wp-content/uploads/2025/08/LAVE_London" not in api.get("/").text
    # Logos and the browser-tab icon come from the library too, so nothing depends on WordPress.
    import re
    left_on_page = set(re.findall(r"https://lavelondon\.com/wp-content[^\"' )]+", api.get("/atelier/").text))
    assert left_on_page and all("ECLAT" in u for u in left_on_page)  # only the image that failed to copy


def test_products_and_variants(api, staff_headers):
    r = api.post("/api/staff/shop/products", headers=staff_headers,
                 json={"name": "Silk Wash", "summary": "For silk.", "menu_sub": "wash", "menu_item": "detergents"})
    assert r.status_code == 201
    pid, slug = r.json()["id"], r.json()["slug"]
    assert slug == "silk-wash"
    v = api.post(f"/api/staff/shop/products/{pid}/variants", headers=staff_headers,
                 json={"size": "500 ml", "scent": "Fig", "price_pence": 2400, "stock": 10})
    assert v.status_code == 201 and v.json()["sku"] == "SILK-WASH-500ML-FIG"
    dup = api.post(f"/api/staff/shop/products/{pid}/variants", headers=staff_headers,
                   json={"size": "500 ml", "scent": "Fig", "price_pence": 2400})
    assert dup.status_code == 409
    assert api.patch(f"/api/staff/shop/products/{pid}", headers=staff_headers, json={"summary": "For silk and satin."}).status_code == 200
    listed = {p["id"]: p for p in api.get("/api/staff/shop/products", headers=staff_headers).json()}
    assert listed[pid]["summary"] == "For silk and satin." and listed[pid]["variants"][0]["price_pence"] == 2400
    page = api.get(f"/apothecary/products/{slug}/")
    assert page.status_code == 200 and "For silk and satin." in page.text


def test_service_website_fields(api, staff_headers):
    r = api.post("/api/staff/services", headers=staff_headers,
                 json={"code": "DC_SCARF", "name": "Silk scarf – dry clean", "category": "clean", "price_pence": 1400,
                       "show_online": True, "summary": "Hand-finished.", "collections": ["women", "cats"]})
    assert r.status_code == 201, r.text
    s = r.json()
    assert s["slug"] == "silk-scarf" and s["collections"] == ["women"]
    assert "Silk scarf" in api.get("/atelier/clean/women/").text
    assert api.get(f"/atelier/services/{s['slug']}/").status_code == 200
    api.patch(f"/api/staff/services/{s['id']}", headers=staff_headers, json={"show_online": False})
    assert "Silk scarf" not in api.get("/atelier/clean/women/").text


def test_section_and_submenu_names_are_fixed(api, staff_headers):
    menus = _doc(api, staff_headers, "menus")["value"]
    lw = next(s for s in menus["sections"] if s["key"] == "laveworld")
    lw["subnav"][1]["title"] = "Learn"
    assert api.put("/api/staff/content/menus", headers=staff_headers, json={"value": menus}).status_code == 400
    lw["subnav"][1]["title"] = "Knowledge"
    lw["subnav"] = lw["subnav"][::-1]
    assert api.put("/api/staff/content/menus", headers=staff_headers, json={"value": menus}).status_code == 400
    lw["subnav"] = lw["subnav"][::-1]
    lw["subnav"][1]["columns"][0]["title"] = "Read"  # column titles stay editable
    assert api.put("/api/staff/content/menus", headers=staff_headers, json={"value": menus}).status_code == 200
    assert "Read" in api.get("/laveworld/knowledge/").text
