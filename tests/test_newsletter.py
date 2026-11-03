"""The newsletter box: where it shows, what it saves, and passing sign-ups to Klaviyo."""
from sqlalchemy import select

from app.config import get_settings
from app.models import NewsletterSignup
from app.services import newsletter
from app.site.routes import show_signup


class Answer:
    def __init__(self, status_code, body=None):
        self.status_code, self._body, self.text = status_code, body or {}, ""

    def json(self):
        return self._body


def klaviyo(monkeypatch, status=202):
    monkeypatch.setattr(get_settings(), "klaviyo_public_key", "AbC123")
    monkeypatch.setattr(get_settings(), "klaviyo_list_id", "XyZ789")
    calls = []

    def post(url, params, json, timeout, headers):
        calls.append({"url": url, "params": params, "json": json, "headers": headers})
        return Answer(status, {"errors": [{"detail": "List not found"}]} if status >= 300 else {})
    monkeypatch.setattr(newsletter.httpx, "post", post)
    return calls


def test_the_box_is_on_reading_pages_but_not_forms():
    for path in ("/", "/atelier/", "/memberships/living/", "/laveworld/knowledge/", "/apothecary/wash/"):
        assert show_signup(path, None), path
    for path in ("/book/", "/basket/", "/checkout/done/X/", "/account/login/", "/contact/", "/policies/privacy/",
                 "/atelier/list/", "/apothecary/"):
        assert not show_signup(path, None), path
    assert not show_signup("/", {"fn": "Ada"})  # signed-in clients


def test_pages_carry_the_box_with_the_founders_wording(api):
    page = api.get("/atelier/").text
    assert "data-signup" in page and "The Atelier and Apothecary open soon." in page
    assert "Join the list to hear first, before anything goes on sale." in page
    assert 'name="page" value="/atelier/"' in page and 'href="/policies/privacy/"' in page
    assert "data-signup" not in api.get("/book/").text


def test_sign_up_is_kept_even_without_klaviyo(api, db_session):
    r = api.post("/subscribe/", data={"email": " Ada@Example.com ", "page": "/atelier/"})
    assert r.status_code == 200 and r.json() == {"ok": True, "confirm": False}
    api.post("/subscribe/", data={"email": "ada@example.com", "page": "/"})  # twice: still one entry
    rows = db_session().scalars(select(NewsletterSignup)).all()
    assert [(n.email, n.page, n.sent_to_klaviyo_at) for n in rows] == [("ada@example.com", "/atelier/", None)]


def test_bad_email_and_bots(api, db_session):
    assert api.post("/subscribe/", data={"email": "not-an-email"}).status_code == 400
    assert api.post("/subscribe/", data={"email": "bot@example.com", "website": "spam"}).json()["ok"]
    assert not db_session().scalars(select(NewsletterSignup)).all()


def test_sign_up_goes_to_the_klaviyo_list(api, db_session, monkeypatch):
    calls = klaviyo(monkeypatch)
    r = api.post("/subscribe/", data={"email": "ada@example.com", "page": "/memberships/"})
    assert r.json() == {"ok": True, "confirm": True}
    (call,) = calls
    assert call["params"] == {"company_id": "AbC123"} and call["headers"]["revision"]
    data = call["json"]["data"]
    assert data["relationships"]["list"]["data"]["id"] == "XyZ789"
    assert data["attributes"]["profile"]["data"]["attributes"]["email"] == "ada@example.com"
    assert db_session().scalar(select(NewsletterSignup)).sent_to_klaviyo_at


def test_klaviyo_failure_waits_for_the_admin_button(api, db_session, staff_headers, monkeypatch):
    api.post("/subscribe/", data={"email": "early@example.com", "page": "/"})  # before Klaviyo was set up
    klaviyo(monkeypatch, status=400)
    assert api.post("/subscribe/", data={"email": "ada@example.com"}).json()["confirm"] is False
    listed = api.get("/api/staff/newsletter", headers=staff_headers).json()
    assert listed["klaviyo"] and {s["email"]: s["error"] for s in listed["signups"]}["ada@example.com"].startswith("Klaviyo said (400): List not found")

    calls = klaviyo(monkeypatch)
    assert api.post("/api/staff/newsletter/send", headers=staff_headers).json() == {"sent": 2, "waiting": 0}
    assert len(calls) == 2
    assert all(n.sent_to_klaviyo_at and not n.klaviyo_error for n in db_session().scalars(select(NewsletterSignup)))


def test_send_button_explains_missing_settings(api, staff_headers):
    r = api.post("/api/staff/newsletter/send", headers=staff_headers)
    assert r.status_code == 400 and "LAVE_KLAVIYO_PUBLIC_KEY" in r.json()["detail"]


def test_wording_is_editable_in_the_admin(api, staff_headers):
    doc = api.get("/api/staff/content/signup", headers=staff_headers).json()
    value = dict(doc["value"], heading="Something new is coming.")
    assert api.put("/api/staff/content/signup", json={"value": value}, headers=staff_headers).status_code == 200
    assert "Something new is coming." in api.get("/").text
