"""PDF receipts and invoices: who can download them, what they say, numbering, sending and voiding."""
from app.config import get_settings
from app.services import documents, mailer
from tests.test_accounts import _FakeSMTP
from tests.test_order_delete import _mistaken_order
from tests.test_wardrobe import _order_with_items, _slot


def _counted_unpaid_order(api, ch, sh):
    """Collected and counted, not yet paid: the usual moment to invoice a business client."""
    addr = api.post("/api/me/addresses", headers=ch, json={"line1": "1 Haydon Way", "postcode": "SW11 1YF"}).json()["id"]
    s = _slot(api)
    o = api.post("/api/me/bookings", headers=ch, json={"collection": {"template_id": s["template_id"], "day": s["day"]},
                                                       "address_id": addr}).json()
    coll = next(b for b in o["bookings"] if b["kind"] == "collection")
    api.patch(f"/api/staff/bookings/{coll['id']}", headers=sh, json={"status": "completed"})
    api.post(f"/api/staff/orders/{o['id']}/items", headers=sh, json={"description": "Table linen", "price": 4500})
    return o


def _is_pdf(r):
    return r.status_code == 200 and r.headers["content-type"] == "application/pdf" and r.content.startswith(b"%PDF")


def test_receipt_pdf_for_a_paid_order(api, client_headers, staff_headers):
    o, _ = _order_with_items(api, client_headers, staff_headers, [{"description": "Wool coat"}])
    r = api.get(f"/api/staff/orders/{o['id']}/receipt.pdf", headers=staff_headers)
    assert _is_pdf(r) and f"LAVE-receipt-{o['ref']}.pdf" in r.headers["content-disposition"]
    assert _is_pdf(api.get(f"/api/me/orders/{o['ref']}/receipt.pdf", headers=client_headers))
    assert api.get(f"/api/me/orders/{o['ref']}", headers=client_headers).json()["receipt_available"]


def test_paid_in_person_isnt_shown_as_still_to_pay(api, client_headers, staff_headers, db_session):
    from app.models import Order
    o, _ = _order_with_items(api, client_headers, staff_headers, [{"description": "Wool coat", "price": 2799}])
    order = db_session().get(Order, o["id"])
    rows, due = documents.settlement(order)
    assert due == 0 and rows[-1][0] == "Paid in person"


def test_no_receipt_until_paid(api, client_headers, staff_headers):
    o = _counted_unpaid_order(api, client_headers, staff_headers)
    assert api.get(f"/api/staff/orders/{o['id']}/receipt.pdf", headers=staff_headers).status_code == 409
    assert api.get(f"/api/me/orders/{o['ref']}/receipt.pdf", headers=client_headers).status_code == 409
    assert not api.get(f"/api/me/orders/{o['ref']}", headers=client_headers).json()["receipt_available"]


def test_invoice_issue_send_and_void(api, client_headers, staff_headers, monkeypatch):
    o = _counted_unpaid_order(api, client_headers, staff_headers)
    url = f"/api/staff/orders/{o['id']}/invoices"
    start = api.get(url, headers=staff_headers).json()
    assert start["invoices"] == [] and start["terms_days"] == 14 and start["bill_to"]["email"]

    monkeypatch.setattr(get_settings(), "smtp_host", "smtp.example.com")
    monkeypatch.setattr(mailer.smtplib, "SMTP", _FakeSMTP)
    mailer.OUTBOX.clear()
    bill = {"company": "Haydon Hotels Ltd", "contact_name": "Ada Lovelace", "address": "1 Haydon Way\nLondon SW11 1YF",
            "email": "accounts@haydon.example", "po_ref": "PO-77", "terms_days": 30, "send": True}
    r = api.post(url, headers=staff_headers, json=bill)
    assert r.status_code == 201, r.text
    inv = r.json()
    assert inv["number"] == "INV-0001" and inv["emailed"] is True and inv["terms"] == "30 days" and not inv["estimate"]
    assert inv["due_pence"] == inv["total_pence"] > 0
    msg = mailer.last_to("accounts@haydon.example")
    assert msg["subject"] == "Invoice INV-0001 from LAVE" and msg["attachments"] == ["LAVE-INV-0001.pdf"]
    assert "Hello Ada," in msg["text"]

    pdf = api.get(f"/api/staff/invoices/{inv['id']}.pdf", headers=staff_headers)
    assert _is_pdf(pdf)
    assert _is_pdf(api.get("/api/me/invoices/INV-0001.pdf", headers=client_headers))
    mine = api.get(f"/api/me/orders/{o['ref']}", headers=client_headers).json()["invoices"]
    assert [i["number"] for i in mine] == ["INV-0001"]

    # Numbers follow on; the form remembers the business's details.
    again = api.get(url, headers=staff_headers).json()["bill_to"]
    assert again["company"] == "Haydon Hotels Ltd" and again["email"] == "accounts@haydon.example"
    second = api.post(url, headers=staff_headers, json={**bill, "send": False}).json()
    assert second["number"] == "INV-0002" and second["emailed"] is None and second["sent_at"] is None

    # A wrong invoice is voided with a reason, never deleted; the client no longer sees it.
    v = f"/api/staff/invoices/{inv['id']}/void"
    assert api.post(v, headers=staff_headers, json={"reason": ""}).status_code == 400
    assert api.post(v, headers=staff_headers, json={"reason": "Wrong address"}).json()["voided_at"]
    assert api.get("/api/me/invoices/INV-0001.pdf", headers=client_headers).status_code == 404
    assert _is_pdf(api.get(f"/api/staff/invoices/{inv['id']}.pdf", headers=staff_headers))  # still kept, marked void
    assert api.post(f"/api/staff/invoices/{inv['id']}/send", headers=staff_headers).status_code == 400


def test_invoiced_orders_cant_be_deleted(api, client_headers, staff_headers):
    o = _mistaken_order(api, client_headers, staff_headers)  # cancelled: can't be invoiced
    assert api.post(f"/api/staff/orders/{o['id']}/invoices", headers=staff_headers,
                    json={"company": "Test Ltd"}).status_code == 400
    o = _counted_unpaid_order(api, client_headers, staff_headers)
    api.post(f"/api/staff/orders/{o['id']}/invoices", headers=staff_headers, json={"company": "Test Ltd"})
    chk = api.get(f"/api/staff/orders/{o['id']}/delete-check", headers=staff_headers).json()
    assert any("invoice" in b for b in chk["blockers"])


def test_invoice_before_the_count_is_an_estimate(api, client_headers, staff_headers):
    addr = api.post("/api/me/addresses", headers=client_headers, json={"line1": "1 Haydon Way", "postcode": "SW11 1YF"}).json()["id"]
    s = _slot(api)
    o = api.post("/api/me/bookings", headers=client_headers, json={"collection": {"template_id": s["template_id"], "day": s["day"]},
                                                                   "address_id": addr}).json()
    inv = api.post(f"/api/staff/orders/{o['id']}/invoices", headers=staff_headers, json={"company": "Test Ltd"}).json()
    assert inv["estimate"] is True and inv["terms"] == "14 days"
    assert _is_pdf(api.get(f"/api/staff/invoices/{inv['id']}.pdf", headers=staff_headers))
