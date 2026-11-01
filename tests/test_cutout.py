"""Product photos without their plain studio background, so they sit straight on the Resell page's grey."""
import io
import random

from PIL import Image, ImageDraw

from app.services import cutout


def _photo(bg=(240, 240, 241), piece=(30, 30, 40), inner_white=False, noisy=False) -> bytes:
    img = Image.new("RGB", (600, 800), bg)
    d = ImageDraw.Draw(img)
    if noisy:  # a real setting: the edges are all sorts of colours
        rnd = random.Random(1)
        for _ in range(4000):
            x, y = rnd.randrange(600), rnd.randrange(800)
            d.rectangle([x, y, x + 12, y + 12], fill=(rnd.randrange(256), rnd.randrange(256), rnd.randrange(256)))
    d.rectangle([150, 150, 450, 650], fill=piece)
    if inner_white:  # a pale-grey panel inside the piece, the same colour as the backdrop but not touching the edges
        d.rectangle([250, 300, 350, 500], fill=bg)
    buf = io.BytesIO()
    img.save(buf, "WEBP", quality=95)
    return buf.getvalue()


def test_a_plain_backdrop_becomes_transparent_and_the_piece_stays():
    out = Image.open(io.BytesIO(cutout.remove_background(_photo(inner_white=True))))
    assert out.mode == "RGBA"
    assert out.getpixel((10, 10))[3] == 0 and out.getpixel((590, 790))[3] == 0        # backdrop: gone
    assert out.getpixel((200, 200))[3] == 255                                          # the piece: kept
    assert out.getpixel((300, 400))[3] == 255  # pale inside the piece, not joined to the edges: kept


def test_photos_with_a_real_setting_or_dark_backdrop_are_left_alone():
    assert cutout.remove_background(_photo(noisy=True)) is None
    assert cutout.remove_background(_photo(bg=(40, 40, 40), piece=(220, 220, 220))) is None


def test_saved_pieces_show_their_background_free_photos(api, staff_headers):
    from app.services import storage
    photo_folder = storage.current().root
    (photo_folder / "202611-0123456789abcdef.webp").write_bytes(_photo())
    r = api.post("/api/staff/resell", headers=staff_headers, json={
        "title": "Wool Coat", "category": "ready-to-wear", "price_pence": 90000, "images": ["/media/202611-0123456789abcdef.webp"]})
    assert r.status_code == 201
    assert (photo_folder / "cutout-202611-0123456789abcdef.webp").exists()
    page = api.get("/atelier/rehome/resell/").text
    assert "/media/cutout-202611-0123456789abcdef.webp" in page
    assert "/media/cutout-202611-0123456789abcdef.webp" in api.get(r.json()["url"]).text
    assert api.get("/media/cutout-202611-0123456789abcdef.webp").status_code == 200
    assert cutout.url_for("https://example.com/photo.jpg") == "https://example.com/photo.jpg"  # outside photos untouched
