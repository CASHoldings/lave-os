"""The LAVE product repository: every Atelier item with its price, cost and how it's sold, plus mixed packs.

The founder edits it in /admin → Products, or uploads the pricing sheet as CSV (same columns as the sheet's export).
Clients see prices and packs on /atelier/prices/ and /atelier/packs/; costs, margins and notes never leave the admin.
"""
import csv
import io
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Pack, Service, ServiceCategory, SiteSetting
from app.site.content import slugify

DATA = Path(__file__).resolve().parent.parent / "site" / "data"
ITEMS_CSV = DATA / "repository_items.csv"
PACKS_JSON = DATA / "repository_packs.json"
LEGACY_JSON = DATA / "repository_legacy_map.json"
RULES_MD = DATA / "repository_rules.md"

# How sold: sheet wording ↔ stored code ↔ what clients read.
SALE_MODES = {
    "Packs only": "pack",
    "Single or pack": "single_or_pack",
    "Single": "single",
    "Quote": "quote",
    "Per m²": "per_m2",
    "Per kg": "per_kg",
}
SALE_LABELS = {v: k for k, v in SALE_MODES.items()}
PRICED_LATER = {"quote", "per_m2", "per_kg"}  # not added to an estimate total: priced at the atelier

_SERVICE_CATEGORY = {
    "Press only": ServiceCategory.press,
    "Laundry & finish": ServiceCategory.refresh, "Laundry (large item)": ServiceCategory.refresh, "Wash & fold": ServiceCategory.refresh,
    "Alteration": ServiceCategory.repair, "Repair": ServiceCategory.repair,
}

# The client-facing price list is arranged in three departments.
DEPARTMENTS = [
    ("wardrobe", "Wardrobe", "Cleaning and finishing for everything you wear."),
    ("home", "Home", "Bedding, table linen, soft furnishings, curtains and rugs."),
    ("care", "Pressing, alterations & repairs", "Finishing touches, fittings and mending."),
]
HOME_CATEGORIES = {"Bed linen", "Duvets, pillows & home", "Table & kitchen linen", "Curtains & blinds", "Rugs",
                   "Laundry items", "Wash & fold bags"}
CARE_CATEGORIES = {"Pressing only", "Alterations", "Repairs"}

# Menu pages under Atelier → Clean that list items, by category (the founder can change any item's pages).
_COLLECTIONS = {
    "Skirts": ["women"], "Dresses": ["women"], "Bridal & occasion": ["women"], "Children's": ["children"],
    "Bed linen": ["bedding"], "Curtains & blinds": ["drapery"], "Table & kitchen linen": ["tableware"], "Rugs": ["furnishings"],
}
_FURNISHING_WORDS = ("sofa", "cushion", "chair", "stool", "futon", "throw", "arm cap")
COLLECTION_PAGES = ["women", "men", "children", "pets", "bedding", "drapery", "tableware", "furnishings"]

MONTHS = {m: i + 1 for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}


def department_of(category: str) -> str:
    return "home" if category in HOME_CATEGORIES else "care" if category in CARE_CATEGORIES else "wardrobe"


def default_collections(category: str, name: str) -> list[str]:
    low = name.lower()
    if "dog" in low:
        return ["pets"]
    if category == "Duvets, pillows & home":
        return ["furnishings"] if any(w in low for w in _FURNISHING_WORDS) else ["bedding"]
    if category in _COLLECTIONS:
        return list(_COLLECTIONS[category])
    if department_of(category) == "wardrobe":
        return ["women", "men"]
    return []


def parse_money(value: str) -> int | None:
    value = (value or "").replace("£", "").replace(",", "").strip()
    if not value:
        return None
    try:
        return round(float(value) * 100)
    except ValueError:
        raise ValueError(f"'{value}' isn't an amount of money")


def margin(price_pence: int | None, cost_pence: int | None) -> int | None:
    if not price_pence or cost_pence is None:
        return None
    return round((price_pence - cost_pence) * 100 / price_pence)


def season_months(text: str) -> list[int]:
    """Months a pack is in season, read from notes like "November–February" or "Christmas, Easter". Empty = all year."""
    low = (text or "").lower()
    if low.startswith("all year") or "add-on" in low:
        return []
    found: set[int] = set()
    for a, b in re.findall(r"([a-z]{3})[a-z]*\s*[–-]\s*([a-z]{3})[a-z]*", low):
        if a in MONTHS and b in MONTHS:
            m = MONTHS[a]
            while True:
                found.add(m)
                if m == MONTHS[b]:
                    break
                m = m % 12 + 1
    for word in re.findall(r"[a-z]+", low):
        if word[:3] in MONTHS and (len(word) == 3 or word in {"january", "february", "march", "april", "may", "june", "july",
                                                               "august", "september", "october", "november", "december", "sept"}):
            found.add(MONTHS[word[:3]])
    named = {"christmas": [11, 12], "easter": [3, 4], "summer": [6, 7, 8], "winter": [11, 12, 1, 2],
             "spring": [3, 4], "burns": [1], "school": [8, 9]}
    for word, months in named.items():
        if word in low:
            found.update(months)
    return sorted(found)


# Settings the founder controls on the Rules tab.

def setting(db: Session, key: str, default):
    row = db.get(SiteSetting, f"repository.{key}")
    if not row:
        return default
    return type(default)(row.value) if not isinstance(default, str) else row.value


def set_setting(db: Session, key: str, value) -> None:
    row = db.get(SiteSetting, f"repository.{key}") or SiteSetting(key=f"repository.{key}")
    row.value = str(value)
    db.add(row)


def rules(db: Session) -> dict:
    return {**{k: setting(db, k, v) for k, v in MINIMUM_DEFAULTS.items()},
            "free_delivery_from_pence": setting(db, "free_delivery_from_pence", 4500),
            "minimum_margin": setting(db, "minimum_margin", 65),
            "text": setting(db, "rules_text", RULES_MD.read_text() if RULES_MD.exists() else "")}


# Loading and importing

def items(db: Session, active_only: bool = False) -> list[Service]:
    q = select(Service).where(Service.product_category != "").order_by(Service.sort, Service.id)
    if active_only:
        q = q.where(Service.active.is_(True))
    return list(db.scalars(q))


def _new_code(db: Session, name: str) -> str:
    base = "R-" + slugify(name).upper().replace("-", "_")[:34]
    code, n = base, 2
    while db.scalar(select(Service.id).where(Service.code == code)):
        code, n = f"{base[:34]}_{n}", n + 1
    return code


def _unique_slug(db: Session, name: str, current_id: int | None = None) -> str:
    base, n = slugify(name)[:150] or "item", 2
    slug = base
    while (other := db.scalar(select(Service.id).where(Service.slug == slug))) and other != current_id:
        slug, n = f"{base}-{n}", n + 1
    return slug


@dataclass
class Row:
    line: int
    code: str
    fields: dict
    show_online: bool | None = None
    summary: str | None = None


def read_csv(text: str) -> tuple[list[Row], list[str]]:
    """Rows from the pricing sheet's CSV export (or this admin's export). Returns rows and problems."""
    reader = csv.DictReader(io.StringIO(text.lstrip("﻿")))
    need = {"Category", "Item", "How sold", "LAVE price £"}
    missing = need - set(reader.fieldnames or [])
    if missing:
        return [], [f"The file is missing these columns: {', '.join(sorted(missing))}."]
    rows, problems, seen = [], [], set()
    for n, r in enumerate(reader, start=2):
        name = (r.get("Item") or "").strip()
        if not name:
            continue
        try:
            sale_mode = SALE_MODES[(r.get("How sold") or "").strip()]
        except KeyError:
            problems.append(f"Line {n} ({name}): 'How sold' should be one of {', '.join(SALE_MODES)}.")
            continue
        try:
            price, cost = parse_money(r.get("LAVE price £")), parse_money(r.get("LAVE cost £"))
        except ValueError as e:
            problems.append(f"Line {n} ({name}): {e}.")
            continue
        if price is None:
            problems.append(f"Line {n} ({name}): no price.")
            continue
        if slugify(name) in seen:
            problems.append(f"Line {n} ({name}): this item appears twice.")
            continue
        seen.add(slugify(name))
        online = (r.get("On website") or "").strip().lower()
        rows.append(Row(n, (r.get("Code") or "").strip(), {
            "name": name[:200], "product_category": (r.get("Category") or "").strip()[:80] or "Other",
            "sale_mode": sale_mode, "service_type": (r.get("Service") or "").strip()[:40], "price_pence": price,
            "cost_pence": cost, "price_basis": (r.get("Price basis") or "").strip()[:60],
            "internal_notes": (r.get("Notes") or "").strip(),
        }, show_online={"yes": True, "no": False}.get(online), summary=r.get("Client description")))
    return rows, problems


def _match(db: Session, row: Row, by_code: dict, by_slug: dict) -> Service | None:
    return by_code.get(row.code) or by_slug.get(slugify(row.fields["name"]))


def _apply_fields(item: Service, row: Row, sort: int) -> None:
    for k, v in row.fields.items():
        setattr(item, k, v)
    item.category = _SERVICE_CATEGORY.get(item.service_type, ServiceCategory.clean)
    item.unit = {"per_m2": "m2", "per_kg": "kg"}.get(item.sale_mode, "item")
    item.sort = sort
    if row.show_online is not None:
        item.show_online = row.show_online
    if row.summary is not None:
        item.summary = row.summary.strip()


TRACKED = ["product_category", "sale_mode", "service_type", "price_pence", "cost_pence", "price_basis", "internal_notes"]


def preview_import(db: Session, text: str) -> dict:
    rows, problems = read_csv(text)
    existing = items(db)
    by_code = {s.code: s for s in existing}
    by_slug = {slugify(s.name): s for s in existing}
    new, changed, unchanged, matched = [], [], 0, set()
    for row in rows:
        item = _match(db, row, by_code, by_slug)
        if not item:
            new.append({"name": row.fields["name"], "category": row.fields["product_category"], "price_pence": row.fields["price_pence"]})
            continue
        matched.add(item.id)
        diff = {k: [getattr(item, k), row.fields[k]] for k in TRACKED if getattr(item, k) != row.fields[k]}
        if item.name != row.fields["name"]:
            diff["name"] = [item.name, row.fields["name"]]
        if not item.active:
            diff["active"] = [False, True]
        if diff:
            changed.append({"id": item.id, "name": row.fields["name"], "changes": diff})
        else:
            unchanged += 1
    missing = [{"id": s.id, "name": s.name, "category": s.product_category} for s in existing if s.active and s.id not in matched]
    return {"rows": len(rows), "new": new, "changed": changed, "unchanged": unchanged, "missing": missing, "problems": problems}


def apply_import(db: Session, text: str, retire_missing: bool = False) -> dict:
    rows, problems = read_csv(text)
    if problems:
        return {"applied": False, "problems": problems}
    existing = items(db)
    by_code = {s.code: s for s in existing}
    by_slug = {slugify(s.name): s for s in existing}
    added = updated = 0
    matched = set()
    for sort, row in enumerate(rows, start=1):
        item = _match(db, row, by_code, by_slug)
        if item is None:
            item = Service(code=_new_code(db, row.fields["name"]), show_online=True, active=True, collections=[], tags=[])
            _apply_fields(item, row, sort)
            item.slug = _unique_slug(db, item.name)
            item.collections = default_collections(item.product_category, item.name)
            db.add(item)
            db.flush()
            added += 1
        else:
            _apply_fields(item, row, sort)
            item.active = True
            updated += 1
        matched.add(item.id)
    retired = 0
    if retire_missing:
        for s in existing:
            if s.active and s.id not in matched:
                s.active, retired = False, retired + 1
    db.commit()
    return {"applied": True, "added": added, "updated": updated, "retired": retired}


EXPORT_COLUMNS = ["Code", "Category", "Item", "How sold", "Service", "LAVE price £", "Pack of 5 £", "LAVE cost £", "Margin %",
                  "Price basis", "Notes", "On website", "Client description"]


def export_csv(db: Session) -> str:
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(EXPORT_COLUMNS)
    pounds = lambda p: f"£{p / 100:,.2f}" if p is not None else ""  # noqa: E731
    for s in items(db, active_only=True):
        m = margin(s.price_pence, s.cost_pence)
        w.writerow([s.code, s.product_category, s.name, SALE_LABELS.get(s.sale_mode, ""), s.service_type, pounds(s.price_pence),
                    pounds(s.price_pence * 5) if s.sale_mode in ("pack", "single_or_pack") else "", pounds(s.cost_pence),
                    f"{m}%" if m is not None else "", s.price_basis, s.internal_notes, "Yes" if s.show_online else "No", s.summary])
    return out.getvalue()


def load_repository(db: Session) -> dict | None:
    """First load of the repository on a database that has none yet: items, packs, and retiring the old price list."""
    if db.scalar(select(Service.id).where(Service.product_category != "").limit(1)):
        return None
    result = apply_import(db, ITEMS_CSV.read_text())
    by_name = {s.name: s for s in items(db)}
    # Mixed packs.
    for sort, p in enumerate(json.loads(PACKS_JSON.read_text()), start=1):
        lines = [{"service_id": by_name[i["item"]].id, "qty": i["qty"]} for i in p["items"] if i["item"] in by_name]
        db.add(Pack(slug=slugify(p["name"]), name=p["name"], kind=p["kind"], note=p["note"], items=lines,
                    months=season_months(p["note"]), sort=sort))
    # The old price list and website listings make way; old listings point at their replacement for redirects.
    legacy = json.loads(LEGACY_JSON.read_text()) if LEGACY_JSON.exists() else {}
    retired = 0
    for s in db.scalars(select(Service).where(Service.product_category == "")):
        if s.active or s.show_online:
            retired += 1
        s.active, s.show_online = False, False
        target = by_name.get(legacy.get(s.slug or "", ""))
        if target:
            s.replaced_by_id = target.id
            if s.image and not target.image:  # keep the photo
                target.image = s.image
    db.commit()
    return {**result, "packs": len(json.loads(PACKS_JSON.read_text())), "retired_old": retired}


# Packs

def pack_lines(pack: Pack, by_id: dict[int, Service]) -> list[tuple[Service, int]]:
    return [(by_id[line["service_id"]], int(line["qty"])) for line in pack.items or [] if line.get("service_id") in by_id]


def pack_figures(pack: Pack, by_id: dict[int, Service]) -> dict:
    lines = pack_lines(pack, by_id)
    price = sum(s.price_pence * q for s, q in lines)
    costs = [s.cost_pence for s, _ in lines]
    cost = sum(c * q for (s, q), c in zip(lines, costs)) if lines and all(c is not None for c in costs) else None
    return {"price_pence": price, "count": sum(q for _, q in lines), "cost_pence": cost, "margin": margin(price, cost),
            "lines": lines, "unavailable": any(not s.active for s, _ in lines)}


def packs(db: Session, online_only: bool = False) -> list[Pack]:
    q = select(Pack).order_by(Pack.sort, Pack.id)
    if online_only:
        q = q.where(Pack.active.is_(True), Pack.show_online.is_(True))
    return list(db.scalars(q))


# The client's list: what they plan to send, kept in a cookie until they book.

LIST_COOKIE = "lave_list"


def parse_list(raw: str | None) -> dict[str, int]:
    out: dict[str, int] = {}
    for part in (raw or "").split(","):
        m = re.fullmatch(r"([ip])(\d{1,6}):(\d{1,3})", part.strip())
        if m and 0 < int(m.group(3)) <= 99:
            out[m.group(1) + m.group(2)] = int(m.group(3))
    return dict(list(out.items())[:60])


def dump_list(entries: dict[str, int]) -> str:
    return ",".join(f"{k}:{v}" for k, v in entries.items() if v > 0)


@dataclass
class ListLine:
    key: str
    kind: str  # item | pack
    id: int
    name: str
    qty: int
    unit_pence: int
    sale_mode: str = "single"
    priced_later: bool = False
    detail: str = ""

    @property
    def total_pence(self) -> int:
        return 0 if self.priced_later else self.unit_pence * self.qty

    @property
    def counted_pence(self) -> int:
        """Towards the minimum order: quotes and measured items count at their "from" price."""
        return self.unit_pence * self.qty


@dataclass
class ListSummary:
    lines: list[ListLine] = field(default_factory=list)
    estimate_pence: int = 0
    warnings: list[str] = field(default_factory=list)
    free_delivery_from_pence: int = 4500
    count: int = 0
    counted_pence: int = 0  # towards the minimum order (quotes at their "from" price)
    minimums: dict = field(default_factory=dict)  # {"home": pence, "dropoff": pence}; empty: no minimum (curated pack)
    quick_add: list[dict] = field(default_factory=list)

    def short_pence(self, mode: str) -> int:
        """How much more this list needs before it can be booked: mode "home" or "dropoff"."""
        return max(0, self.minimums.get(mode, 0) - self.counted_pence) if self.lines else 0

    @property
    def to_free_delivery_pence(self) -> int:
        return max(0, self.free_delivery_from_pence - self.estimate_pence)


# Minimum order: the items in a booking must come to at least the home-collection or drop-off minimum (Settings →
# Collection & delivery). Quotes and measured items count at their "from" price. A booking with a curated pack has no
# minimum. A booking with no list is topped up to the minimum at review if its counted items come to less.
MINIMUM_DEFAULTS = {"home_minimum_pence": 2995, "dropoff_minimum_pence": 2000}
# Quick-add buttons offered when a list is under the minimum: (label, price-list item).
QUICK_ADD = [("Shirt", "Shirt, non-member hung"), ("Trousers", "Trousers, standard"), ("T-shirt", "T-shirt, washable"),
             ("Knitwear", "Knitwear, light")]


def minimums(db: Session) -> dict:
    r = rules(db)
    return {"home": r["home_minimum_pence"], "dropoff": r["dropoff_minimum_pence"]}


def booked_minimum(db: Session, lines: list[dict], mode: str) -> tuple[int, int]:
    """For the server's check at booking: (the minimum that applies, how much the booked lines are short of it).
    No list: the minimum still applies (topped up at review), nothing is short. A curated pack: no minimum."""
    if any(line.get("kind") == "pack" for line in lines):
        return 0, 0
    minimum = minimums(db)[mode]
    if not lines:
        return minimum, 0
    return minimum, max(0, minimum - sum(line["unit_pence"] * line["qty"] for line in lines))


def short_text(db: Session, short: int, mode: str) -> str:
    m = minimums(db)
    if mode == "dropoff":
        return f"Add {pounds(short)} more to book a drop-off: the minimum order is {pounds(m['dropoff'])}."
    return f"Add {pounds(short)} more to book a home collection: the minimum order is {pounds(m['home'])}."


def pounds(pence: int) -> str:
    return f"£{pence / 100:.2f}".removesuffix(".00")


def dropoff_offered(db: Session) -> bool:
    """Atelier drop-off is switched on and there's at least one active atelier."""
    from app.models import AtelierLocation
    from app.services import delivery
    return bool(delivery.config(db)["dropoff_enabled"]
                and db.scalar(select(AtelierLocation.id).where(AtelierLocation.status == "active").limit(1)))


def summarise(db: Session, entries: dict[str, int]) -> ListSummary:
    r = rules(db)
    out = ListSummary(free_delivery_from_pence=r["free_delivery_from_pence"])
    ids = [int(k[1:]) for k in entries if k[0] == "i"]
    by_id = {s.id: s for s in db.scalars(select(Service).where(Service.id.in_(ids)))} if ids else {}
    pack_ids = [int(k[1:]) for k in entries if k[0] == "p"]
    pack_map = {p.id: p for p in db.scalars(select(Pack).where(Pack.id.in_(pack_ids)))} if pack_ids else {}
    if pack_map:
        member_ids = {line["service_id"] for p in pack_map.values() for line in p.items or []}
        by_id.update({s.id: s for s in db.scalars(select(Service).where(Service.id.in_(member_ids)))})
    for key, qty in entries.items():
        kind, ident = key[0], int(key[1:])
        if kind == "i" and (s := by_id.get(ident)) and s.active and s.show_online:
            out.lines.append(ListLine(key, "item", s.id, s.name, qty, s.price_pence, s.sale_mode, s.sale_mode in PRICED_LATER))
        elif kind == "p" and (p := pack_map.get(ident)) and p.active and p.show_online:
            fig = pack_figures(p, by_id)
            if not fig["unavailable"]:
                out.lines.append(ListLine(key, "pack", p.id, p.name, qty, fig["price_pence"], "pack_bundle", False,
                                          "; ".join(f"{q} × {s.name}" for s, q in fig["lines"])))
    out.estimate_pence = sum(line.total_pence for line in out.lines)
    out.count = sum(line.qty for line in out.lines)
    out.counted_pence = sum(line.counted_pence for line in out.lines)
    if not any(line.kind == "pack" for line in out.lines):
        out.minimums = minimums(db)
    if short := out.short_pence("home"):
        out.warnings.append(short_text(db, short, "home") + (
            f" For members dropping off at a LAVE atelier, it's {pounds(out.minimums['dropoff'])}." if dropoff_offered(db) else ""))
        by_name = {s.name: s for s in db.scalars(select(Service).where(Service.name.in_([n for _, n in QUICK_ADD]),
                                                                      Service.active.is_(True)))}
        out.quick_add = [{"label": label, "id": by_name[name].id, "price_pence": by_name[name].price_pence}
                         for label, name in QUICK_ADD if name in by_name]
    if out.lines and all(by_id.get(line.id) and by_id[line.id].service_type == "Press only" for line in out.lines if line.kind == "item") \
            and not any(line.kind == "pack" for line in out.lines):
        out.warnings.append("Pressing on its own is an add-on to a cleaning order. Add at least one item to clean.")
    return out


def snapshot(summary: ListSummary) -> list[dict]:
    """What's stored on the order, so later price changes don't rewrite what the client saw."""
    return [{"kind": line.kind, "id": line.id, "name": line.name, "qty": line.qty, "unit_pence": line.unit_pence,
             "priced_later": line.priced_later, "detail": line.detail} for line in summary.lines]


# Client-facing views

def client_price(s: Service) -> dict:
    """How an item's price reads on the website."""
    p = s.price_pence
    if s.sale_mode == "quote":
        return {"main": p, "prefix": "from", "suffix": "", "note": "Quoted after inspection", "pack": None}
    if s.sale_mode in ("per_m2", "per_kg"):
        return {"main": p, "prefix": "", "suffix": "per m²" if s.sale_mode == "per_m2" else "per kg", "note": "Measured at the atelier", "pack": None}
    if s.sale_mode == "pack":
        return {"main": p, "prefix": "", "suffix": "each", "note": "Best value in packs of 5", "pack": p * 5}
    if s.sale_mode == "single_or_pack":
        return {"main": p, "prefix": "", "suffix": "", "note": "", "pack": p * 5}
    return {"main": p, "prefix": "", "suffix": "", "note": "", "pack": None}


def catalogue(db: Session, collection: str | None = None) -> list[dict]:
    """Departments → categories → items, as shown on the website."""
    shown = [s for s in items(db, active_only=True) if s.show_online and (collection is None or collection in (s.collections or []))]
    cats: dict[str, list[Service]] = {}
    for s in shown:
        cats.setdefault(s.product_category, []).append(s)
    out = []
    photos = category_images(db)
    for key, title, blurb in DEPARTMENTS:
        group = [{"name": c, "slug": slugify(c), "items": its, "image": photos.get(c, ""), "thumbs": any(s.image for s in its)}
                 for c, its in cats.items() if department_of(c) == key]
        if group:
            out.append({"key": key, "title": title, "blurb": blurb, "categories": group})
    return out


def collection_counts(db: Session) -> dict[str, int]:
    out = dict.fromkeys(COLLECTION_PAGES, 0)
    for s in items(db, active_only=True):
        if s.show_online:
            for c in s.collections or []:
                if c in out:
                    out[c] += 1
    return out


def search(db: Session, needle: str) -> list[Service]:
    needle = needle.lower()
    return [s for s in items(db, active_only=True) if s.show_online and
            (needle in s.name.lower() or needle in s.product_category.lower() or needle in (s.summary or "").lower())][:30]


# Photos: category banners (a setting) and the bundled photo set (app/site/data/images, built by scripts/catalogue_images.py)

IMAGES_DIR = DATA / "images"
IMAGES_VERSION = "4"


def category_images(db: Session) -> dict[str, str]:
    try:
        return json.loads(setting(db, "category_images", "{}")) or {}
    except ValueError:
        return {}


def set_category_image(db: Session, category: str, url: str) -> dict[str, str]:
    images = category_images(db)
    if url:
        images[category] = url
    else:
        images.pop(category, None)
    set_setting(db, "category_images", json.dumps(images, ensure_ascii=False))
    return images


def load_bundled_images(db: Session) -> dict | None:
    """Add the bundled photos to the image library, and (once) put them on items, packs and categories that have none.
    The files themselves ship with the code and are sent from there (see storage.find).

    Photos chosen in /admin are never replaced; photos carried over from the old WordPress listings are, because the
    studio set is consistent.
    """
    from app.models import Media

    manifest_path = IMAGES_DIR / "manifest.json"
    if not manifest_path.exists():
        return None
    manifest = json.loads(manifest_path.read_text())
    have = {m.source_url: m for m in db.scalars(select(Media).where(Media.source_url.like("bundle:%")))}
    added = 0
    urls = {}
    for entry in manifest:
        key = "bundle:" + entry["file"]
        m = have.get(key)
        size = (IMAGES_DIR / entry["file"]).stat().st_size
        if m:
            m.size_bytes = size
        else:
            m = Media(url=f"/media/{entry['file']}", filename=entry["source"][:200], alt=entry["alt"][:300], source_url=key,
                      size_bytes=size)
            db.add(m)
            added += 1
        urls[entry["file"]] = m.url
    assigned = {"items": 0, "packs": 0, "categories": 0}
    if setting(db, "images_applied", "") != IMAGES_VERSION:
        # Photos placed by an earlier bundle are refreshed; photos chosen in /admin are left alone.
        try:
            before = json.loads(setting(db, "images_assigned", "{}"))
        except ValueError:
            before = {}
        bundle_urls = set(urls.values()) | {m.url for m in have.values()}
        legacy = {s.image for s in db.scalars(select(Service).where(Service.product_category == "", Service.image != ""))}
        want = {"items": {}, "packs": {}, "categories": {}}
        for entry in manifest:
            for kind in want:
                for name in entry[kind]:
                    want[kind][name] = urls[entry["file"]]

        def ours(kind: str, name: str, current: str) -> bool:
            if not current or current in legacy:
                return True
            if kind in before:
                return before[kind].get(name) == current
            return current in bundle_urls  # first refresh before records were kept

        record = {"items": {}, "packs": {}, "categories": {}}
        for s in items(db):
            if ours("items", s.name, s.image or ""):
                new = want["items"].get(s.name, "")
                if (s.image or "") != new:
                    s.image, assigned["items"] = new, assigned["items"] + bool(new)
                if new:
                    record["items"][s.name] = new
        for p in packs(db):
            if ours("packs", p.name, p.image or ""):
                new = want["packs"].get(p.name, "")
                if (p.image or "") != new:
                    p.image, assigned["packs"] = new, assigned["packs"] + bool(new)
                if new:
                    record["packs"][p.name] = new
        cats = category_images(db)
        for cat in {s.product_category for s in items(db)}:
            if ours("categories", cat, cats.get(cat, "")):
                new = want["categories"].get(cat, "")
                if cats.get(cat, "") != new:
                    assigned["categories"] += bool(new)
                if new:
                    cats[cat] = record["categories"][cat] = new
                else:
                    cats.pop(cat, None)
        set_setting(db, "category_images", json.dumps(cats, ensure_ascii=False))
        set_setting(db, "images_assigned", json.dumps(record, ensure_ascii=False))
        set_setting(db, "images_applied", IMAGES_VERSION)
    db.commit()
    return {"added": added, **assigned}
