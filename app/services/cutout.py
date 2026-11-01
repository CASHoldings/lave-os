"""Product photos without their studio background, so a piece sits straight on the page's grey tile (Resell).

A copy is made for each photo with a plain, light background (the usual white or pale-grey product shot): the
background connected to the photo's edges becomes transparent, the piece itself is untouched. Photos with a real
setting (a room, a model outdoors) are left as they are. Copies are kept beside the original as cutout-<name>.webp.
"""
import io
import logging
import statistics

from PIL import Image, ImageChops, ImageDraw, ImageFilter

from app.services import storage

log = logging.getLogger("lave.cutout")
WORK = 480          # connectivity is worked out on a copy this wide (fast), then applied at full size
LIGHT = 185         # the background must be at least this light (0–255)


def name_for(name: str) -> str:
    return "cutout-" + name.rsplit(".", 1)[0].replace("/", "-") + ".webp"


def _border(img: Image.Image) -> list[tuple[int, int, int]]:
    w, h = img.size
    px = img.load()
    step = max(1, (w + h) // 400)
    pts = [(x, y) for x in range(0, w, step) for y in (0, 1, h - 2, h - 1)] + \
          [(x, y) for y in range(0, h, step) for x in (0, 1, w - 2, w - 1)]
    return [px[x, y] for x, y in pts]


def remove_background(data: bytes) -> bytes | None:
    """The photo with its plain light background made transparent, as WebP; None if it has no such background."""
    img = Image.open(io.BytesIO(data)).convert("RGB")
    border = _border(img)
    bg = tuple(int(statistics.median(c[i] for c in border)) for i in range(3))
    if sum(bg) / 3 < LIGHT:
        return None
    dist = [max(abs(c[i] - bg[i]) for i in range(3)) for c in border]
    spread = sorted(dist)[int(len(dist) * 0.9)]
    if spread > 30:  # the edges aren't one plain colour: a real setting, not a studio background
        return None
    tol = min(40, max(16, spread + 10))

    # Pixels close to the background colour, at full size.
    diff = ImageChops.difference(img, Image.new("RGB", img.size, bg))
    r, g, b = diff.split()
    near = ImageChops.lighter(ImageChops.lighter(r, g), b).point(lambda v: 255 if v <= tol else 0)

    # Of those, the ones joined to the edges are background (a white shirt in the middle stays). Worked out small.
    small = near.resize((WORK, max(1, round(WORK * img.height / img.width))), Image.NEAREST)
    sw, sh = small.size
    for x, y in [(x, 0) for x in range(sw)] + [(x, sh - 1) for x in range(sw)] + [(0, y) for y in range(sh)] + [(sw - 1, y) for y in range(sh)]:
        if small.getpixel((x, y)) == 255:
            ImageDraw.floodfill(small, (x, y), 128, thresh=0)
    joined = small.point(lambda v: 255 if v == 128 else 0).filter(ImageFilter.MaxFilter(3)).resize(img.size, Image.BILINEAR)
    background = ImageChops.multiply(near, joined.point(lambda v: 255 if v > 64 else 0))

    covered = sum(background.histogram()[255:]) / (img.width * img.height)
    if not 0.15 <= covered <= 0.97:  # nearly nothing or nearly everything: not a product on a backdrop
        return None
    alpha = ImageChops.invert(background).filter(ImageFilter.GaussianBlur(0.8))  # a soft edge, no halo
    out = img.convert("RGBA")
    out.putalpha(alpha)
    buf = io.BytesIO()
    out.save(buf, "WEBP", quality=88, method=5)
    return buf.getvalue()


def ensure(url: str) -> str | None:
    """Make the background-free copy of a library photo (/media/<name>) if it doesn't exist yet. Returns its address,
    or None when the photo has no plain background (or can't be read)."""
    if not url or not url.startswith("/media/"):
        return None
    name = url.removeprefix("/media/")
    target = name_for(name)
    store = storage.current()
    try:
        if store.has(target):
            return "/media/" + target
        path = storage.find(name)
        if not path:
            return None
        made = remove_background(path.read_bytes())
        if not made:
            return None
        store.write(target, made)
        return "/media/" + target
    except Exception:  # noqa: BLE001  (a photo we can't process still shows, as it is)
        log.exception("Couldn't remove the background from %s", url)
        return None


def url_for(url: str) -> str:
    """For the page: the background-free copy when there is one, otherwise the photo itself."""
    if url and url.startswith("/media/"):
        target = name_for(url.removeprefix("/media/"))
        try:
            if storage.current().has(target):
                return "/media/" + target
        except Exception:  # noqa: BLE001
            pass
    return url
