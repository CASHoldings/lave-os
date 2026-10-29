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


def by_slug(db: Session, slug: str) -> ResalePiece | None:
    return db.scalar(select(ResalePiece).where(ResalePiece.slug == slug, ResalePiece.show_online.is_(True)))


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


def describe(p: ResalePiece) -> dict:
    return {"id": p.id, "slug": p.slug, "title": p.title, "designer": p.designer, "detail": p.detail,
            "category": p.category, "condition": p.condition, "price_pence": p.price_pence, "images": p.images or [],
            "description": p.description, "condition_notes": p.condition_notes, "status": p.status,
            "show_online": p.show_online, "sort": p.sort, "url": f"/atelier/rehome/resell/{p.slug}/"}
