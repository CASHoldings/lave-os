"""The Atelier service catalogue shown on the website.

The starting catalogue was imported from the WooCommerce products on lavelondon.com
(app/site/data/atelier_services.json). Once loaded, the Service table is the source of truth.
"""
import json
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Service, ServiceCategory
from app.site.content import WP

DATA = Path(__file__).resolve().parent / "data" / "atelier_services.json"

# Item pages under Atelier → Clean → Personals that list services.
PERSONALS = ["women", "men", "children", "pets"]

# Garment groups on a collection page, matched by tag in this order.
GROUPS = [
    ("Coats", {"women-coat", "raincoat"}),
    ("Jackets & blazers", {"herjackets", "blazer", "jacket"}),
    ("Dresses", {"dress"}),
    ("Shirts & bundles", {"women-shirts", "shirts-trousers", "womenbundle"}),
    ("Babywear", {"baby"}),
    ("Tailoring", {"co-ords-boys"}),
]


def _collections(tags: list[str]) -> list[str]:
    return [c for c in PERSONALS if c in tags]


def load_starting_catalogue(db: Session) -> int:
    """Add catalogue services that aren't in the database yet. Never overwrites edits."""
    rows = json.loads(DATA.read_text())
    existing = set(db.scalars(select(Service.code)))
    added = 0
    for r in rows:
        code = f"WC-{r['wc_id']}"
        if code in existing:
            continue
        db.add(Service(
            code=code, name=r["name"], category=ServiceCategory.clean, unit="item", price_pence=r["price_pence"],
            show_online=not r.get("hidden", False), slug=r["slug"], image=r["image"], summary=r["summary"],
            collections=_collections(r["tags"]), tags=r["tags"], review_note=r.get("review", ""),
        ))
        added += 1
    return added


def image_url(service: Service) -> str:
    if not service.image:
        return ""
    return service.image if service.image.startswith(("http", "/")) else WP + service.image


def group_of(service: Service) -> str:
    tags = set(service.tags or [])
    for name, match in GROUPS:
        if tags & match:
            return name
    return "Other"


def for_collection(db: Session, collection: str) -> list[tuple[str, list[Service]]]:
    services = [s for s in db.scalars(select(Service).where(Service.show_online.is_(True), Service.active.is_(True))
                                      .order_by(Service.price_pence, Service.name))
                if collection in (s.collections or [])]
    grouped: dict[str, list[Service]] = {}
    for s in services:
        grouped.setdefault(group_of(s), []).append(s)
    order = [g for g, _ in GROUPS] + ["Other"]
    return [(g, grouped[g]) for g in order if g in grouped]


def counts(db: Session) -> dict[str, int]:
    out = dict.fromkeys(PERSONALS, 0)
    for s in db.scalars(select(Service).where(Service.show_online.is_(True), Service.active.is_(True))):
        for c in s.collections or []:
            if c in out:
                out[c] += 1
    return out


def by_slug(db: Session, slug: str) -> Service | None:
    return db.scalar(select(Service).where(Service.slug == slug, Service.show_online.is_(True), Service.active.is_(True)))


def search(db: Session, needle: str) -> list[Service]:
    rows = db.scalars(select(Service).where(Service.show_online.is_(True), Service.active.is_(True)).order_by(Service.price_pence))
    return [s for s in rows if needle in s.name.lower() or needle in (s.summary or "").lower()
            or any(needle in t for t in (s.tags or []))][:24]
