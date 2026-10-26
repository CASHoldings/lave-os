"""'Your driver is on the way': a text when we can, otherwise an email; once per visit."""
from app.config import get_settings
from app.services import mailer, sms
from tests.test_flow import _address, _slots


def _booking(api, client_headers, staff_headers):
    addr = _address(api, client_headers)
    s = _slots(api)[0]
    order = api.post("/api/me/bookings", headers=client_headers,
                     json={"collection": {"template_id": s["template_id"], "day": s["day"]}, "address_id": addr}).json()
    return order, order["bookings"][0]["id"]


def test_email_when_texts_arent_set_up(api, client_headers, staff_headers):
    order, bid = _booking(api, client_headers, staff_headers)
    mailer.OUTBOX.clear()
    assert api.patch(f"/api/staff/bookings/{bid}", headers=staff_headers, json={"status": "en_route"}).status_code == 200
    sent = mailer.last_to("client@example.com")
    assert sent["subject"] == "Your LAVE driver is on the way" and "to collect your pieces" in sent["text"]
    api.patch(f"/api/staff/bookings/{bid}", headers=staff_headers, json={"status": "en_route"})
    assert len([m for m in mailer.OUTBOX if m["subject"] == "Your LAVE driver is on the way"]) == 1  # once
    timeline = api.get(f"/api/me/orders/{order['ref']}", headers=client_headers).json()["timeline"]
    assert any(e["note"] == "Driver on the way (email sent)" for e in timeline)


def test_text_when_set_up(api, client_headers, staff_headers, monkeypatch):
    order, bid = _booking(api, client_headers, staff_headers)
    api.patch("/api/me", headers=client_headers, json={"phone": "07700 900123"})
    s = get_settings()
    monkeypatch.setattr(s, "twilio_account_sid", "AC123")
    monkeypatch.setattr(s, "twilio_auth_token", "token")
    monkeypatch.setattr(s, "twilio_from", "LAVE")
    calls = []

    class Ok:
        status_code = 201
        text = ""

    monkeypatch.setattr(sms.httpx, "post", lambda url, data, auth, timeout: calls.append(data) or Ok())
    mailer.OUTBOX.clear()
    api.patch(f"/api/staff/bookings/{bid}", headers=staff_headers, json={"status": "en_route"})
    assert calls and calls[0]["To"] == "+447700900123" and calls[0]["From"] == "LAVE"
    assert calls[0]["Body"].startswith("LAVE: your driver is on the way to collect your pieces") and order["ref"] in calls[0]["Body"]
    assert not mailer.OUTBOX  # texted, so no email


def test_failed_text_falls_back_to_email(api, client_headers, staff_headers, monkeypatch):
    _, bid = _booking(api, client_headers, staff_headers)
    api.patch("/api/me", headers=client_headers, json={"phone": "07700 900123"})
    s = get_settings()
    for k, v in (("twilio_account_sid", "AC1"), ("twilio_auth_token", "t"), ("twilio_from", "+447700900000")):
        monkeypatch.setattr(s, k, v)

    class Fail:
        status_code = 400
        text = "bad number"

    monkeypatch.setattr(sms.httpx, "post", lambda *a, **k: Fail())
    mailer.OUTBOX.clear()
    api.patch(f"/api/staff/bookings/{bid}", headers=staff_headers, json={"status": "en_route"})
    assert mailer.last_to("client@example.com")["subject"] == "Your LAVE driver is on the way"


def test_uk_mobile_numbers():
    assert sms.uk_mobile("07700 900123") == "+447700900123"
    assert sms.uk_mobile("+44 (0)7700 900123") == "+447700900123"
    assert sms.uk_mobile("0044 7700 900123") == "+447700900123"
    assert sms.uk_mobile("020 7946 0000") is None  # a landline can't take a text


def test_admin_test_text(api, staff_headers, monkeypatch):
    r = api.post("/api/staff/sms/test", headers=staff_headers, json={"phone": "07700 900123"})
    assert r.status_code == 502 and "aren't set up" in r.json()["detail"]
    s = get_settings()
    for k, v in (("twilio_account_sid", "AC1"), ("twilio_auth_token", "t"), ("twilio_from", "LAVE")):
        monkeypatch.setattr(s, k, v)

    class Refused:
        status_code = 400
        text = ""
        def json(self): return {"message": "Permission to send an SMS has not been enabled for the region"}

    monkeypatch.setattr(sms.httpx, "post", lambda *a, **k: Refused())
    r = api.post("/api/staff/sms/test", headers=staff_headers, json={"phone": "07700 900123"})
    assert r.status_code == 502 and "has not been enabled for the region" in r.json()["detail"]

    class Ok:
        status_code = 201
        text = ""

    monkeypatch.setattr(sms.httpx, "post", lambda *a, **k: Ok())
    assert api.post("/api/staff/sms/test", headers=staff_headers, json={"phone": "07700 900123"}).json() == {"sent_to": "+447700900123"}
