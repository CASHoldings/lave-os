"""Loads editable website content for each request, and validates edits before they're saved."""
from dataclasses import dataclass
from datetime import datetime

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Media, SiteContent
from app.site.content import BRAND, Column, Section, SubNav
from app.site.defaults import DOCUMENTS

SAFE_HREF = ("/", "https://", "http://", "#", "mailto:", "tel:")


# Validation: an edited document must keep the shape of its default.

def conform(value, default, path: str = "", locked: set[str] = frozenset(), readonly: set[str] = frozenset(), original=None):
    """Check `value` has the same structure as `default`. Returns the cleaned value or raises HTTPException(400)."""
    where = path or "document"
    if isinstance(default, dict):
        if not isinstance(value, dict):
            raise HTTPException(400, f"{where} should be a group of fields.")
        if set(value) != set(default):
            missing, extra = set(default) - set(value), set(value) - set(default)
            raise HTTPException(400, f"{where} has the wrong fields (missing {sorted(missing)}, unexpected {sorted(extra)}).")
        out = {}
        own = path.rsplit(".", 1)[-1].split("[")[0]
        for k, d in default.items():
            orig_k = original.get(k) if isinstance(original, dict) else None
            if (k in readonly or f"{own}.{k}" in readonly) and original is not None and value[k] != orig_k:
                raise HTTPException(400, f"{where}.{k} can't be changed.")
            out[k] = conform(value[k], d, f"{where}.{k}", locked, readonly, orig_k)
        return out
    if isinstance(default, list):
        if not isinstance(value, list):
            raise HTTPException(400, f"{where} should be a list.")
        name = path.rsplit(".", 1)[-1].split("[")[0]
        if name in locked and original is not None and len(value) != len(original):
            raise HTTPException(400, f"Entries can't be added to or removed from {where}.")
        if not default:
            return [str(v) for v in value]
        template = default[0]
        return [conform(v, template, f"{where}[{i}]", locked, readonly,
                        original[i] if isinstance(original, list) and i < len(original) else None) for i, v in enumerate(value)]
    if isinstance(default, bool):
        if not isinstance(value, bool):
            raise HTTPException(400, f"{where} should be on or off.")
        return value
    if isinstance(default, int):
        if not isinstance(value, int) or isinstance(value, bool) or value < 0:
            raise HTTPException(400, f"{where} should be a whole number of 0 or more.")
        return value
    if isinstance(default, str) or default is None:
        if not isinstance(value, str):
            raise HTTPException(400, f"{where} should be text.")
        value = value.strip()
        key = path.rsplit(".", 1)[-1]
        if key in ("href", "url") and value and not value.startswith(SAFE_HREF):
            raise HTTPException(400, f"{where} must be a web address starting with / or https://.")
        if len(value) > 4000:
            raise HTTPException(400, f"{where} is too long.")
        return value
    return value


def validate(key: str, value: dict, current: dict) -> dict:
    spec = DOCUMENTS.get(key)
    if not spec:
        raise HTTPException(404, "Unknown content.")
    default = spec["default"]()
    cleaned = conform(value, default, "", set(spec.get("locked", [])), set(spec.get("readonly", [])), current)
    # Required text: titles and labels can't be blank.
    def walk(v, path=""):
        if isinstance(v, dict):
            for k, x in v.items():
                if k in ("title", "label", "name", "heading") and isinstance(x, str) and not x:
                    raise HTTPException(400, f"{path}.{k} can't be empty.")
                walk(x, f"{path}.{k}")
        elif isinstance(v, list):
            for i, x in enumerate(v):
                walk(x, f"{path}[{i}]")
    walk(cleaned)
    if key == "menus":
        for s in cleaned["sections"]:
            if not s["subnav"]:
                raise HTTPException(400, f"{s['title']} needs at least one sub-menu.")
            for n in s["subnav"]:
                if not 1 <= len(n["columns"]) <= 4:
                    raise HTTPException(400, f"{s['title']} → {n['title']} needs between 1 and 4 columns.")
    return cleaned


# Loading

@dataclass
class Site:
    docs: dict[str, dict]
    sections: list[Section]
    brand: dict[str, str]  # logos and icon: the library copy once imported, else the WordPress original

    @property
    def by_key(self) -> dict[str, Section]:
        return {s.key: s for s in self.sections}

    @property
    def by_path(self) -> dict[str, Section]:
        return {s.path.strip("/"): s for s in self.sections}

    def page(self, name: str) -> dict:
        return self.docs[f"page.{name}"]

    @property
    def plans(self) -> list[dict]:
        return self.docs["plans"]["plans"]

    def plan(self, code: str) -> dict | None:
        return next((p for p in self.plans if p["code"] == code), None)


def sections_from(doc: dict) -> list[Section]:
    return [Section(s["key"], s["title"], s["path"], hero=s["hero"], subnav=[
        SubNav(n["title"], [Column(c["title"], c["image"], [(l["label"], l["href"]) if l["href"] else l["label"] for l in c["links"]])
                            for c in n["columns"]]) for n in s["subnav"]]) for s in doc["sections"]]


_cache: dict = {"stamp": None, "site": None}
CURRENT: dict = {}  # last loaded documents, for code that runs outside a request (e.g. plan names in emails)


def load(db: Session) -> Site:
    rows = db.execute(select(SiteContent.key, SiteContent.updated_at)).all()
    stamp = tuple(sorted((k, str(t)) for k, t in rows))
    if _cache["stamp"] == stamp and _cache["site"] is not None:
        return _cache["site"]
    saved = {r.key: r.value for r in db.scalars(select(SiteContent))}
    docs = {k: saved.get(k) or spec["default"]() for k, spec in DOCUMENTS.items()}
    copies = dict(db.execute(select(Media.source_url, Media.url).where(Media.source_url.in_(BRAND.values()))).all())
    site = Site(docs, sections_from(docs["menus"]), {k: copies.get(u, u) for k, u in BRAND.items()})
    _cache.update(stamp=stamp, site=site)
    CURRENT.update(docs)
    return site


def site_dependency(request: Request, db: Session = Depends(get_db)) -> Site:
    request.state.site = load(db)
    return request.state.site


def save(db: Session, key: str, value: dict, who: str) -> dict:
    if key not in DOCUMENTS:
        raise HTTPException(404, "Unknown content.")
    current = load(db).docs[key]
    cleaned = validate(key, value, current)
    row = db.get(SiteContent, key) or SiteContent(key=key)
    row.value, row.updated_by, row.updated_at = cleaned, who, datetime.now()
    db.add(row)
    db.commit()
    _cache["stamp"] = None
    return cleaned


def reset(db: Session, key: str) -> None:
    row = db.get(SiteContent, key)
    if row:
        db.delete(row)
        db.commit()
    _cache["stamp"] = None


def plan_name(code: str) -> str:
    from app import plans
    for p in (CURRENT.get("plans") or {}).get("plans", []):
        if p["code"] == code:
            return p["name"]
    return plans.NAMES.get(code, code)
