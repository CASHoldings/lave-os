from app.services import accounts, mailer
from app.services.content import render_markdown


def test_publish_flow_and_drafts(api, staff_headers):
    # The starter post is a draft: hidden from the public.
    assert api.get("/journal/how-to-store-cashmere-for-the-summer/").status_code == 404
    p = api.post("/api/staff/posts", headers=staff_headers, json={"title": "Caring for linen", "body": "## Wash cool\n\nIron damp."}).json()
    assert p["status"] == "draft" and p["slug"] == "caring-for-linen"
    assert api.get("/journal/caring-for-linen/").status_code == 404
    assert api.post(f"/api/staff/posts/{p['id']}/publish", headers=staff_headers, json={"publish": True}).status_code == 200
    page = api.get("/journal/caring-for-linen/")
    assert page.status_code == 200 and "<h2>Wash cool</h2>" in page.text
    assert "Caring for linen" in api.get("/laveworld/knowledge/").text
    assert "Caring for linen" in api.get("/laveworld/").text
    assert "Caring for linen" in api.get("/journal/feed.xml").text
    # Scheduled for later: not visible yet.
    q = api.post("/api/staff/posts", headers=staff_headers, json={"title": "Coming soon", "body": "Soon."}).json()
    api.post(f"/api/staff/posts/{q['id']}/publish", headers=staff_headers, json={"publish": True, "published_at": "2027-01-01T09:00"})
    assert api.get("/journal/coming-soon/").status_code == 404
    # Same title gets a different address.
    r = api.post("/api/staff/posts", headers=staff_headers, json={"title": "Caring for linen", "body": "x"}).json()
    assert r["slug"] == "caring-for-linen-2"


def test_events_need_a_date_and_list_by_theme(api, staff_headers):
    e = api.post("/api/staff/posts", headers=staff_headers, json={"title": "Polo at Hurlingham", "kind": "event", "body": "Join us.",
                                                                  "event_theme": "sport"}).json()
    assert api.post(f"/api/staff/posts/{e['id']}/publish", headers=staff_headers, json={"publish": True}).status_code == 409
    api.patch(f"/api/staff/posts/{e['id']}", headers=staff_headers, json={"title": "Polo at Hurlingham", "kind": "event", "body": "Join us.",
                                                                           "event_theme": "sport", "event_starts_at": "2026-11-20T14:00",
                                                                           "event_location": "Hurlingham Club"})
    api.post(f"/api/staff/posts/{e['id']}/publish", headers=staff_headers, json={"publish": True})
    assert "Polo at Hurlingham" in api.get("/memberships/access/sport/").text
    assert "Polo at Hurlingham" not in api.get("/memberships/access/lifestyle/").text
    assert "Polo at Hurlingham" in api.get("/laveworld/knowledge/events/").text


def test_markdown_is_safe():
    out = render_markdown('<script>alert(1)</script> [x](javascript:alert(1)) [ok](/atelier/) **bold**')
    assert "<script>" not in out and "javascript:" not in out
    assert 'href="/atelier/"' in out and "<strong>bold</strong>" in out


def test_pages_and_policies(api, staff_headers):
    assert "Intentional care for the people" in api.get("/laveworld/impact/people/").text
    assert api.get("/laveworld/story/creation/").status_code == 200  # draft page falls back to "being written"
    pages = {p["path"]: p for p in api.get("/api/staff/pages", headers=staff_headers).json()}
    creation = pages["/laveworld/story/creation/"]
    api.patch(f"/api/staff/pages/{creation['id']}", headers=staff_headers,
              json={"title": "Creation", "intro": "Founded in London.", "body": "Our first atelier.", "published": True})
    assert "Our first atelier." in api.get("/laveworld/story/creation/").text
    assert "being updated" in api.get("/policies/").text


def test_contact_form(api, staff_headers):
    accounts.reset_limits()
    mailer.OUTBOX.clear()
    bad = api.post("/contact/", data={"name": "", "email": "x", "message": ""})
    assert bad.status_code == 400
    r = api.post("/contact/", data={"name": "Jo", "email": "jo@example.com", "topic": "LAVE Privé", "message": "We have a large house."},
                 follow_redirects=False)
    assert r.headers["location"] == "/contact/?sent=1"
    msgs = api.get("/api/staff/messages", headers=staff_headers).json()
    assert msgs[0]["topic"] == "LAVE Privé"
    assert mailer.OUTBOX[0]["to"] == "care@lavelondon.com"


def test_upload_rejects_non_images(api, staff_headers, tmp_path, monkeypatch):
    from app.routers import staff
    monkeypatch.setattr(staff, "MEDIA_DIR", tmp_path)
    r = api.post("/api/staff/uploads", headers=staff_headers, files={"file": ("x.png", b"not an image", "image/png")})
    assert r.status_code == 400
    r = api.post("/api/staff/uploads", headers=staff_headers, files={"file": ("x.png", b"\x89PNG\r\n\x1a\nrest", "image/png")})
    assert r.status_code == 201 and r.json()["url"].startswith("/media/")
    assert len(list(tmp_path.iterdir())) == 1
