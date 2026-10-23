"""Image library: saving uploads, and copying the images the site still borrows from lavelondon.com/wp-content."""
import json
import re
import secrets
from pathlib import Path
from urllib.parse import urlparse

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Media, PageContent, Post, Product, Service, SiteContent
from app.services import storage
from app.services.clock import local_now

WP_PREFIX = "https://lavelondon.com/wp-content/uploads/"
WP_URL = re.compile(r"https://lavelondon\.com/wp-content/uploads/[^\s\"')]+")
MAX_IMPORT = 15 * 1024 * 1024
# Names given to uploads and copies (202610-1a2b3c4d5e6f7a8b.webp). The bundled price-list photos are named differently.
UPLOAD_NAME = re.compile(r"\d{6}-[0-9a-f]{16}\.(jpg|png|webp|avif)$")
# Photos wider or heavier than this are slimmed down for the web.
MAX_WIDTH = 1920
# Smaller copies for cards, menus and price-list tiles, which show a photo at most about 360 px wide.
THUMB_WIDTH = 720
SLIM_FROM = 150 * 1024
QUALITY = {".jpg": 82, ".webp": 80, ".avif": 60}

# Background import progress, shown in /admin.
STATUS: dict = {"running": False, "total": 0, "done": 0, "copied": 0, "failed": [], "finished_at": None}


def sniff(data: bytes) -> str | None:
    """The real file type from the file's first bytes, or None if it isn't a supported image."""
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    if data[4:8] == b"ftyp":
        # AVIF: the main label is avif/avis, or a generic mif1/msf1 with avif listed among the compatible ones.
        size = int.from_bytes(data[:4], "big")
        brands = data[8:12] + data[16:max(16, min(size, 64))]
        if any(brands[i:i + 4] in (b"avif", b"avis") for i in range(0, len(brands) - 3, 4)):
            return ".avif"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return ".gif"
    return None


def save_bytes(db: Session, data: bytes, ext: str, filename: str = "", source_url: str = "", media_dir: Path | None = None) -> Media:
    """Add a photo to the library, in photo storage (the R2 bucket on the live site)."""
    store = storage.Folder(media_dir) if media_dir else storage.current()
    name = f"{local_now():%Y%m}-{secrets.token_hex(8)}{ext}"
    data = slim(data, ext)
    store.write(name, data)
    make_thumb(store, name, data)
    m = Media(url=f"/media/{name}", filename=filename[:200], source_url=source_url[:600], size_bytes=len(data))
    db.add(m)
    db.flush()
    return m


def slim(data: bytes, ext: str, width: int = MAX_WIDTH) -> bytes:
    """A lighter copy of a photo for the website: at most `width` px wide and saved at good web quality, in the same
    format. The original comes back if it's already light, or the copy wouldn't be clearly smaller."""
    if ext not in (".jpg", ".png", ".webp", ".avif"):
        return data
    from io import BytesIO
    from PIL import Image, ImageOps
    try:
        img = Image.open(BytesIO(data))
        if len(data) <= SLIM_FROM and img.width <= width:
            return data
        if getattr(img, "n_frames", 1) > 1:
            return data  # animated
        img = ImageOps.exif_transpose(img)
        if img.width > width:
            img = img.resize((width, round(img.height * width / img.width)), Image.LANCZOS)
        if ext == ".jpg" and img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        out = BytesIO()
        options = {"icc_profile": img.info.get("icc_profile")} if img.info.get("icc_profile") else {}
        if ext == ".png":
            img.save(out, "PNG", optimize=True, **options)
        else:
            fmt = {".jpg": "JPEG", ".webp": "WEBP", ".avif": "AVIF"}[ext]
            extra = {"progressive": True} if ext == ".jpg" else {"method": 6} if ext == ".webp" else {}
            img.save(out, fmt, quality=QUALITY[ext], **extra, **options)
    except Exception:
        return data  # unreadable here: keep it as it is
    return out.getvalue() if out.tell() < len(data) * 0.9 else data


def make_thumb(store, name: str, data: bytes) -> None:
    """Save the small copy of a photo as thumbs/<name>, if it's worth having."""
    small = slim(data, Path(name).suffix, THUMB_WIDTH)
    if small is not data:
        store.write(f"thumbs/{name}", small)


def small_url(url: str) -> str:
    """The small copy's address for a library photo, where there is one; otherwise the photo itself."""
    name = (url or "").removeprefix("/media/")
    try:
        if name != url and UPLOAD_NAME.match(name) and storage.current().has(f"thumbs/{name}"):
            return f"/media/thumbs/{name}"
    except Exception:  # storage unreachable: the full-size photo still shows
        pass
    return url


def slim_library(media_dir: Path) -> int:
    """Slim down photos already in the library, and make their small copies, once each. Files keep their names, so
    every page still finds them.
    Runs in the background when the website starts, for photos kept in a folder (uploads to the bucket are slimmed as
    they arrive); the record of what's done is kept in the folder."""
    folder = storage.Folder(media_dir)
    record_file = media_dir / ".slimmed.json"
    try:
        done = json.loads(record_file.read_text())
    except (OSError, ValueError):
        done = {}
    slimmed = 0
    for path in sorted(media_dir.iterdir()):
        if not UPLOAD_NAME.match(path.name) or done.get(path.name) == path.stat().st_size:
            continue
        data = path.read_bytes()
        smaller = slim(data, path.suffix)
        if smaller is not data:
            folder.write(path.name, smaller)
            slimmed += 1
        make_thumb(folder, path.name, smaller)
        done[path.name] = len(smaller)
        record_file.write_text(json.dumps(done))
    return slimmed


def _wp(url_or_path: str) -> str | None:
    if not url_or_path:
        return None
    if url_or_path.startswith(WP_PREFIX):
        return url_or_path
    if not url_or_path.startswith(("http", "/")):
        return WP_PREFIX + url_or_path  # catalogue paths like "2025/06/coat.webp"
    return None


def borrowed_urls(db: Session, docs: dict) -> set[str]:
    """Every image address on the site that still points at lavelondon.com."""
    from app.site.content import BRAND

    urls = set(WP_URL.findall(json.dumps(docs)))
    copied = set(db.scalars(select(Media.source_url).where(Media.source_url.in_(BRAND.values()))))
    urls |= set(BRAND.values()) - copied
    for model, field in ((Service, "image"), (Product, "image"), (Post, "cover_image"), (PageContent, "image")):
        for value in db.scalars(select(getattr(model, field))):
            if u := _wp(value or ""):
                urls.add(u)
    return urls


def import_wordpress(db: Session, docs: dict, fetch=None, media_dir: Path | None = None) -> dict:
    """Copy borrowed images into the library and point the site at the copies. Safe to run again."""
    from app.site import store

    fetch = fetch or _fetch
    already = {m.source_url: m.url for m in db.scalars(select(Media).where(Media.source_url != ""))}
    urls = sorted(borrowed_urls(db, docs))
    STATUS.update(running=True, total=len(urls), done=0, copied=0, failed=[], finished_at=None)
    mapping: dict[str, str] = {}
    try:
        for url in urls:
            if url in already:
                mapping[url] = already[url]
            else:
                try:
                    data = fetch(url)
                    ext = sniff(data)
                    if not ext:
                        raise ValueError("not an image")
                    mapping[url] = save_bytes(db, data, ext, Path(urlparse(url).path).name, url, media_dir).url
                    db.commit()
                    STATUS["copied"] += 1
                except Exception as exc:  # one bad image must not stop the rest
                    STATUS["failed"].append(f"{url} ({exc})")
            STATUS["done"] += 1

        # Point everything at the copies.
        def swap(text: str) -> str:
            return WP_URL.sub(lambda m: mapping.get(m.group(0), m.group(0)), text)

        for key, value in docs.items():
            new = json.loads(swap(json.dumps(value)))
            if new != value:
                row = db.get(SiteContent, key) or SiteContent(key=key)
                row.value, row.updated_by = new, "Image import"
                db.add(row)
        for model, field in ((Service, "image"), (Product, "image"), (Post, "cover_image"), (PageContent, "image")):
            for obj in db.scalars(select(model)):
                current = getattr(obj, field) or ""
                if (u := _wp(current)) and u in mapping:
                    setattr(obj, field, mapping[u])
        db.commit()
        store._cache["stamp"] = None
    finally:
        STATUS.update(running=False, finished_at=local_now().isoformat())
    return dict(STATUS)


def _fetch(url: str) -> bytes:
    if urlparse(url).hostname != "lavelondon.com":
        raise ValueError("only lavelondon.com images are copied")
    with httpx.stream("GET", url, timeout=30, follow_redirects=True) as r:
        r.raise_for_status()
        chunks, size = [], 0
        for chunk in r.iter_bytes():
            size += len(chunk)
            if size > MAX_IMPORT:
                raise ValueError("larger than 15 MB")
            chunks.append(chunk)
    return b"".join(chunks)
