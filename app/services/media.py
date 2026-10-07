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
from app.services.clock import local_now

from app.config import get_settings

MEDIA_DIR = get_settings().media_path
WP_PREFIX = "https://lavelondon.com/wp-content/uploads/"
WP_URL = re.compile(r"https://lavelondon\.com/wp-content/uploads/[^\s\"')]+")
MAX_IMPORT = 15 * 1024 * 1024

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
    folder = media_dir or MEDIA_DIR
    folder.mkdir(parents=True, exist_ok=True)
    name = f"{local_now():%Y%m}-{secrets.token_hex(8)}{ext}"
    (folder / name).write_bytes(data)
    m = Media(url=f"/media/{name}", filename=filename[:200], source_url=source_url[:600], size_bytes=len(data))
    db.add(m)
    db.flush()
    return m


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
