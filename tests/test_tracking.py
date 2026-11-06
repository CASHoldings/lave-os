"""Following each piece: QR tags, scans that move a piece on, arrival photos, and turnaround."""
import io
from datetime import timedelta

import pytest
from PIL import Image

from app.services import clock, storage
from tests.conftest import NOW
from tests.test_documents import _counted_unpaid_order


@pytest.fixture(autouse=True)
def _photos_in_a_temp_folder(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "_store", storage.Folder(tmp_path))


def _jpeg() -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (40, 30), (120, 90, 60)).save(out, "JPEG")
    return out.getvalue()


def _tag(api, sh, code):
    return api.get(f"/api/staff/tags/{code}", headers=sh).json()["piece"]


def _move(api, sh, piece, to):
    return api.post(f"/api/staff/items/{piece['garment']['id']}/move", headers=sh, json={"to": to})


def test_scans_move_a_piece_and_its_order_along(api, client_headers, staff_headers):
    o = _counted_unpaid_order(api, client_headers, staff_headers)
    code = api.get(f"/api/staff/orders/{o['id']}", headers=staff_headers).json()["items"][0]["tag_code"]
    p = _tag(api, staff_headers, code)
    assert p["stage"] == "received" and p["next"] is None
    assert _move(api, staff_headers, p, "in_care").status_code == 409  # inspect and price first

    api.post(f"/api/staff/orders/{o['id']}/status", headers=staff_headers, json={"status": "inspected"})
    p = _tag(api, staff_headers, code)
    assert (p["stage"], p["next"], p["next_label"]) == ("inspected", "in_care", "In care")
    assert _move(api, staff_headers, p, "ready").status_code == 409  # one stage at a time

    p = _move(api, staff_headers, p, "in_care").json()
    assert p["order"]["status"] == "in_care"  # the order goes into care with its first piece
    p = _move(api, staff_headers, p, "inspected").json()  # undo: the order steps back too
    assert p["stage"] == "inspected" and p["order"]["status"] == "inspected"
    p = _move(api, staff_headers, p, "in_care").json()
    p = _move(api, staff_headers, p, "quality_check").json()
    assert p["order"]["status"] == "quality_check"  # and to quality check once every piece is there
    p = _move(api, staff_headers, p, "in_care").json()  # sent back to care
    assert p["stage"] == "in_care" and p["order"]["status"] == "in_care"
    p = _move(api, staff_headers, _move(api, staff_headers, p, "quality_check").json(), "ready").json()
    assert p["stage"] == "ready" and p["order"]["can_mark_ready"]
    assert [s["key"] for s in p["stages"] if s["at"]] == ["received", "inspected", "in_care", "quality_check", "ready"]
    assert any(h["status"] == "item_ready" for h in p["history"])

    # Marking the order ready is a deliberate step (it tells the client).
    assert api.post(f"/api/staff/orders/{o['id']}/status", headers=staff_headers, json={"status": "ready"}).status_code == 200
    assert _tag(api, staff_headers, code)["order"]["status"] == "ready"


def test_the_order_moving_on_never_pulls_a_piece_back(api, client_headers, staff_headers):
    o = _counted_unpaid_order(api, client_headers, staff_headers)
    api.post(f"/api/staff/orders/{o['id']}/items", headers=staff_headers, json={"description": "Napkins", "price": 1200})
    api.post(f"/api/staff/orders/{o['id']}/status", headers=staff_headers, json={"status": "inspected"})
    first, second = [i["tag_code"] for i in api.get(f"/api/staff/orders/{o['id']}", headers=staff_headers).json()["items"]]
    p = _move(api, staff_headers, _tag(api, staff_headers, first), "in_care").json()
    p = _move(api, staff_headers, _move(api, staff_headers, p, "quality_check").json(), "ready").json()
    assert p["order"]["status"] == "in_care" and not p["order"]["can_mark_ready"]  # the napkins are still waiting
    api.post(f"/api/staff/orders/{o['id']}/status", headers=staff_headers, json={"status": "quality_check"})
    assert _tag(api, staff_headers, first)["stage"] == "ready"
    assert _tag(api, staff_headers, second)["stage"] == "quality_check"


def test_arrival_photos_are_private(api, client_headers, staff_headers):
    o = _counted_unpaid_order(api, client_headers, staff_headers)
    item = api.get(f"/api/staff/orders/{o['id']}", headers=staff_headers).json()["items"][0]
    r = api.post(f"/api/staff/items/{item['id']}/photos", headers=staff_headers,
                 files={"photo": ("arrival.jpg", _jpeg(), "image/jpeg")})
    assert r.status_code == 201, r.text
    (pid,) = r.json()["garment"]["photo_ids"]
    assert api.get(f"/api/staff/garment-photos/{pid}", headers=staff_headers).content.startswith(b"\xff\xd8")
    mine = api.get(f"/api/me/orders/{o['ref']}", headers=client_headers).json()["items"][0]
    assert mine["photo_ids"] == [pid]
    assert api.get(f"/api/me/garment-photos/{pid}", headers=client_headers).status_code == 200

    from app.models import GarmentPhoto
    from app.db import get_db
    name = next(api.app.dependency_overrides[get_db]()).get(GarmentPhoto, pid).name
    assert name.startswith("garments/")
    api.cookies.clear()
    assert api.get(f"/media/{name}").status_code == 404  # never on the public photo address
    assert api.get(f"/api/me/garment-photos/{pid}").status_code == 401
    assert api.get(f"/api/staff/garment-photos/{pid}").status_code == 401

    bad = api.post(f"/api/staff/items/{item['id']}/photos", headers=staff_headers,
                   files={"photo": ("notes.txt", b"not a photo", "text/plain")})
    assert bad.status_code == 400


def test_printed_tags_carry_a_qr_code_and_no_name(api, client_headers, staff_headers):
    o = _counted_unpaid_order(api, client_headers, staff_headers)
    (tag,) = api.get(f"/api/staff/orders/{o['id']}/tags", headers=staff_headers).json()
    assert tag["qr_svg"].startswith("<svg") and (tag["number"], tag["of"]) == (1, 1)
    name = api.get(f"/api/staff/orders/{o['id']}", headers=staff_headers).json()["client"]["name"]
    assert name not in str(tag)

    r = api.get(f"/t/{tag['tag_code']}", follow_redirects=False)
    assert r.status_code == 302 and r.headers["location"] == f"/admin#/tag/{tag['tag_code']}?scan=1"
    assert api.get("/t/<script>", follow_redirects=False).headers["location"] == "/admin#/tag/SCRIPT?scan=1"


def test_turnaround_and_pieces_waiting_longest(api, client_headers, staff_headers):
    o = _counted_unpaid_order(api, client_headers, staff_headers)
    code = api.get(f"/api/staff/orders/{o['id']}", headers=staff_headers).json()["items"][0]["tag_code"]
    api.post(f"/api/staff/orders/{o['id']}/status", headers=staff_headers, json={"status": "inspected"})
    clock.freeze(NOW + timedelta(hours=3))
    _move(api, staff_headers, _tag(api, staff_headers, code), "in_care")
    clock.freeze(NOW + timedelta(hours=40))  # left in care too long
    t = api.get("/api/staff/turnaround", headers=staff_headers).json()
    step = {s["label"]: s for s in t["steps"]}
    assert step["Inspection to care"]["pieces"] == 1 and step["Inspection to care"]["median_hours"] == pytest.approx(3, abs=0.1)
    (waiting,) = t["waiting"]
    assert waiting["tag_code"] == code and waiting["stage"] == "In care" and waiting["hours"] == pytest.approx(37, abs=0.1)
