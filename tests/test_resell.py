"""Atelier → Rehome → Resell: pieces added in the admin, shown in a Dior-like grid, enquired about by piece."""
import json
import re


def _piece(api, h, **kw):
    body = {"title": "Quilted Shoulder Bag", "designer": "Maison Example", "detail": "Black lambskin", "category": "bags",
            "condition": "nearly_new", "price_pence": 185000, "images": ["/media/rehome-pass-on.webp"], **kw}
    r = api.post("/api/staff/resell", headers=h, json=body)
    assert r.status_code == 201, r.text
    return r.json()


def test_empty_edit_invites_consignments_and_stays_out_of_search(api):
    page = api.get("/atelier/rehome/resell/").text
    assert "We curate and rehome luxury and rare pieces" in page and "The first pieces arrive soon" in page
    assert 'content="noindex, follow"' in page and "Filter &amp; Sort" not in page
    assert "Private viewing" in page and "Consign with us" in page
    assert "/atelier/rehome/resell/" not in api.get("/sitemap.xml").text


def test_pieces_show_in_the_grid_with_labels_and_prices(api, staff_headers):
    bag = _piece(api, staff_headers)
    _piece(api, staff_headers, title="Silk Scarf", designer="", detail="Ivory twill", category="accessories", condition="new", price_pence=32000)
    sold = _piece(api, staff_headers, title="Evening Clutch", category="bags", status="sold", price_pence=90000)
    _piece(api, staff_headers, title="Hidden Coat", category="ready-to-wear", show_online=False)
    page = api.get("/atelier/rehome/resell/").text
    assert "3 pieces" in page and "Hidden Coat" not in page
    assert "Quilted Shoulder Bag" in page and "Maison Example · Black lambskin" in page and "£1,850" in page
    assert "Nearly new" in page and ">New<" in page
    assert page.index("Quilted Shoulder Bag") < page.index("Evening Clutch")  # sold pieces come last
    assert 'name="robots"' not in page.split("</head>")[0] and "Filter &amp; Sort" in page
    assert "/atelier/rehome/resell/" in api.get("/sitemap.xml").text and f"/atelier/rehome/resell/{bag['slug']}/" in api.get("/sitemap.xml").text
    assert sold["status"] == "sold"


def test_filter_and_sort(api, staff_headers):
    _piece(api, staff_headers, title="Bag One", price_pence=50000)
    _piece(api, staff_headers, title="Bag Two", price_pence=20000)
    _piece(api, staff_headers, title="Scarf", category="accessories", price_pence=10000)
    page = api.get("/atelier/rehome/resell/?category=bags&sort=price_asc").text
    assert "Scarf<" not in page and page.index("Bag Two") < page.index("Bag One")
    assert 'content="noindex, follow"' in page  # filtered views repeat the main page
    assert "No pieces match" in api.get("/atelier/rehome/resell/?category=shoes").text


def test_a_piece_page_and_its_enquiry(api, staff_headers):
    bag = _piece(api, staff_headers, description="With its dust bag and box.", condition_notes="Light wear to the corners.")
    page = api.get(bag["url"]).text
    assert "With its dust bag and box." in page and "Light wear to the corners." in page and "Enquire about this piece" in page
    ld = next(json.loads(b) for b in re.findall(r'<script type="application/ld\+json">(.*?)</script>', page, re.S) if '"Product"' in b)
    assert ld["offers"]["price"] == "1850.00" and ld["itemCondition"].endswith("UsedCondition") and ld["brand"]["name"] == "Maison Example"
    contact = api.get(f"/contact/?topic=resell&piece={bag['slug']}").text
    assert "<option selected>Resell enquiry</option>" in contact and "I&#39;m interested in the Maison Example Quilted Shoulder Bag" in contact
    assert api.get("/atelier/rehome/resell/no-such-piece/").status_code == 404


def test_only_admins_change_pieces(api, staff_headers):
    driver = api.post("/api/staff/auth/login", json={"email": "driver@lavelondon.com", "password": "driver-password"}).json()
    dh = {"Authorization": f"Bearer {driver['token']}"}
    assert api.post("/api/staff/resell", headers=dh, json={"title": "X"}).status_code == 403
    bag = _piece(api, staff_headers)
    assert api.post("/api/staff/resell", headers=staff_headers, json={"title": " "}).status_code == 400
    assert api.post("/api/staff/resell", headers=staff_headers, json={"title": "X", "condition": "mint"}).status_code == 400
    r = api.patch(f"/api/staff/resell/{bag['id']}", headers=staff_headers, json={"status": "reserved", "title": "Quilted Bag"})
    assert r.json()["status"] == "reserved" and r.json()["slug"].endswith("quilted-bag")
    assert "Reserved" in api.get("/atelier/rehome/resell/").text
    assert api.delete(f"/api/staff/resell/{bag['id']}", headers=staff_headers).status_code == 204
    assert api.get(bag["url"]).status_code == 404


def test_example_pieces_are_hidden_but_the_team_sees_them(api, staff_headers, db_session):
    import inspect
    from app import release
    from app.services import resell
    with db_session() as db:
        assert resell.load_examples(db) == len(resell.EXAMPLES)
        assert resell.load_examples(db) == 0  # once only
    public = api.get("/atelier/rehome/resell/").text
    assert "[Example]" not in public and "The first pieces arrive soon" in public
    pieces = api.get("/api/staff/resell", headers=staff_headers).json()["pieces"]
    assert len(pieces) == len(resell.EXAMPLES) and not any(p["show_online"] for p in pieces)
    assert api.get(pieces[0]["url"]).status_code == 404  # customers can't open them

    api.cookies.set("lave_staff", staff_headers["Authorization"].removeprefix("Bearer "))
    preview = api.get("/atelier/rehome/resell/").text
    assert "[Example] Velvet Evening Blazer" in preview and "Hidden" in preview and "Preview: you" in preview
    assert "Reserved" in preview and "£1,280" in preview
    piece = api.get(pieces[0]["url"])
    assert piece.status_code == 200 and "this piece is hidden from customers" in piece.text
    api.cookies.clear()

    # Deleted examples don't come back on the next deploy.
    for p in pieces:
        api.delete(f"/api/staff/resell/{p['id']}", headers=staff_headers)
    with db_session() as db:
        assert resell.load_examples(db) == 0
    assert "resell.load_examples(db)" in inspect.getsource(release.release)


def test_examples_are_not_added_beside_real_pieces(api, staff_headers, db_session):
    from app.services import resell
    _piece(api, staff_headers)
    with db_session() as db:
        assert resell.load_examples(db) == 0


def test_piece_page_offers_an_enquiry_and_a_private_viewing(api, staff_headers):
    bag = _piece(api, staff_headers, condition_notes="Light wear to the corners.")
    page = api.get(bag["url"]).text
    assert "Available to view by appointment" in page and "Book a private viewing" in page and "£1,850" in page
    assert "Light wear to the corners." in page and "+44 7763 566 145" in page
    viewing = api.get(f"/contact/?topic=resell&piece={bag['slug']}&ask=viewing").text
    assert "Could we arrange a private viewing?" in viewing
    assert "Could you tell me more about it?" in api.get(f"/contact/?topic=resell&piece={bag['slug']}").text
    api.patch(f"/api/staff/resell/{bag['id']}", headers=staff_headers, json={"status": "sold"})
    sold = api.get(bag["url"]).text
    assert "This piece has found its new home" in sold and "Book a private viewing" not in sold
