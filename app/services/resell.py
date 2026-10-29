"""Rehome → Resell: luxury and rare pieces, new or nearly new, that LAVE has cared for and is finding a new home for.

Pieces are added in /admin → Website → Resell. Customers enquire about a piece (there's no checkout): the team arranges
a private viewing or reserves it for them.
"""
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ResalePiece
from app.site.content import slugify

CATEGORIES = [("bags", "Bags"), ("ready-to-wear", "Ready-to-wear"), ("shoes", "Shoes"), ("accessories", "Accessories"),
              ("home", "Home textiles")]
CONDITIONS = [("new", "New"), ("nearly_new", "Nearly new"), ("vintage", "Vintage"), ("rare", "Rare")]
STATUSES = ["available", "reserved", "sold"]
SORTS = [("featured", "Featured"), ("newest", "Newest"), ("price_asc", "Price: low to high"), ("price_desc", "Price: high to low")]
CATEGORY_NAMES, CONDITION_NAMES = dict(CATEGORIES), dict(CONDITIONS)
FIELDS = ("title", "designer", "detail", "category", "condition", "price_pence", "images", "description",
          "condition_notes", "status", "show_online", "sort")


def pieces(db: Session, category: str = "", condition: str = "", sort: str = "featured", online_only: bool = True) -> list[ResalePiece]:
    q = select(ResalePiece)
    if online_only:
        q = q.where(ResalePiece.show_online.is_(True))
    if category in CATEGORY_NAMES:
        q = q.where(ResalePiece.category == category)
    if condition in CONDITION_NAMES:
        q = q.where(ResalePiece.condition == condition)
    order = {"newest": [ResalePiece.created_at.desc()], "price_asc": [ResalePiece.price_pence],
             "price_desc": [ResalePiece.price_pence.desc()]}.get(sort, [ResalePiece.sort, ResalePiece.created_at.desc()])
    rows = list(db.scalars(q.order_by(*order, ResalePiece.id)))
    # Sold pieces go to the end, whatever the order.
    return [p for p in rows if p.status != "sold"] + [p for p in rows if p.status == "sold"]


def by_slug(db: Session, slug: str, include_hidden: bool = False) -> ResalePiece | None:
    q = select(ResalePiece).where(ResalePiece.slug == slug)
    if not include_hidden:
        q = q.where(ResalePiece.show_online.is_(True))
    return db.scalar(q)


def _unique_slug(db: Session, text: str, current: int | None = None) -> str:
    base = slugify(text)[:140] or "piece"
    slug, n = base, 2
    while (row := db.scalar(select(ResalePiece).where(ResalePiece.slug == slug))) and row.id != current:
        slug, n = f"{base}-{n}", n + 1
    return slug


def _check(data: dict) -> dict:
    if "title" in data and not (data["title"] or "").strip():
        raise HTTPException(400, "Give the piece a name.")
    if data.get("category") and data["category"] not in CATEGORY_NAMES:
        raise HTTPException(400, "Choose one of the categories.")
    if data.get("condition") and data["condition"] not in CONDITION_NAMES:
        raise HTTPException(400, "Choose one of the conditions.")
    if data.get("status") and data["status"] not in STATUSES:
        raise HTTPException(400, "Choose available, reserved or sold.")
    if "price_pence" in data and (data["price_pence"] or 0) < 0:
        raise HTTPException(400, "The price can't be negative.")
    if "images" in data:
        data["images"] = [u.strip() for u in data["images"] or [] if isinstance(u, str) and u.strip()][:12]
    return {k: (v.strip() if isinstance(v, str) else v) for k, v in data.items() if k in FIELDS}


def create(db: Session, data: dict) -> ResalePiece:
    data = _check(data)
    piece = ResalePiece(**data, slug=_unique_slug(db, f"{data.get('designer', '')} {data['title']}"))
    db.add(piece)
    db.commit()
    return piece


def update(db: Session, piece: ResalePiece, data: dict) -> ResalePiece:
    data = _check(data)
    for k, v in data.items():
        setattr(piece, k, v)
    if "title" in data or "designer" in data:
        piece.slug = _unique_slug(db, f"{piece.designer} {piece.title}", piece.id)
    db.commit()
    return piece


# Sample pieces so the layout can be seen before real stock arrives: hidden from customers (the team sees them on the
# page while signed in to LAVE OS), added once, and never again once deleted.
EXAMPLES_KEY = "resell.examples_loaded"
EXAMPLES = [
    ("Velvet Evening Blazer", "Midnight silk velvet, satin lapels", "ready-to-wear", "nearly_new", 128000, "available",
     ["women-blazer-velvet-silk-satin-trimmed.webp"]),
    ("Camel Hair Coat", "Pure camel hair, single-breasted", "ready-to-wear", "vintage", 165000, "available",
     ["women-coat-camel-hair.webp"]),
    ("Cashmere Wrap Coat", "Ivory double-faced cashmere", "ready-to-wear", "rare", 240000, "reserved",
     ["women-coat-cashmere.webp"]),
    ("Jacquard Cardigan", "Metallic jacquard knit", "ready-to-wear", "new", 69000, "available",
     ["women-cardigan-metallic-jacquard-knit.webp", "women-cardigan-merino-wool.webp"]),
    ("Trench Jacket", "Stone cotton gabardine", "ready-to-wear", "nearly_new", 88000, "available", ["women-jacket-trench.webp"]),
    ("Silk Twill Scarf", "Printed silk twill, 90 cm", "accessories", "new", 36000, "available", ["men-accessories-scarf-silk.webp"]),
    ("Silk Pocket Square", "Hand-rolled silk", "accessories", "new", 9500, "available", ["men-accessories-pocket-square-silk.webp"]),
    ("Cashmere Gloves", "Charcoal cashmere", "accessories", "nearly_new", 18000, "sold", ["men-accessories-gloves-cashmere.webp"]),
]


def load_examples(db: Session) -> int:
    """Add the sample pieces, hidden, on a site with no pieces yet. Once only. Returns how many were added."""
    from app.models import SiteSetting
    if db.get(SiteSetting, EXAMPLES_KEY):
        return 0
    added = 0
    if not db.scalar(select(ResalePiece.id).limit(1)):
        for i, (title, detail, category, condition, price, status, images) in enumerate(EXAMPLES):
            db.add(ResalePiece(slug=_unique_slug(db, f"example {title}"), title=f"[Example] {title}", designer="Example House",
                               detail=detail, category=category, condition=condition, price_pence=price, status=status,
                               images=[f"/media/{name}" for name in images], show_online=False, sort=i,
                               description="A sample piece, so you can see how the Resell page looks. Edit it into a "
                                           "real piece or delete it in /admin → Website → Resell."))
            db.flush()
            added += 1
    db.add(SiteSetting(key=EXAMPLES_KEY, value="1"))
    db.commit()
    return added


def describe(p: ResalePiece) -> dict:
    return {"id": p.id, "slug": p.slug, "title": p.title, "designer": p.designer, "detail": p.detail,
            "category": p.category, "condition": p.condition, "price_pence": p.price_pence, "images": p.images or [],
            "description": p.description, "condition_notes": p.condition_notes, "status": p.status,
            "show_online": p.show_online, "sort": p.sort, "url": f"/atelier/rehome/resell/{p.slug}/"}
