"""Collection, delivery and turnaround rules (spec "LAVE — Collection, Delivery & Turnaround Rules", v1.4).

- One collection & delivery charge per booking, covering both legs. One-hour applies if any leg is one-hour.
- Non-members: Saver free from £45 (inclusive), otherwise £4.95; one-hour £6.95 flat.
  Essence: Saver free, one-hour £4.95. Elevate and Éclat: always included.
- Membership is read when the booking is placed and kept on the order (Order.delivery_basis).
- Returns open 48 hours after the collection window ends, on operating days only (Monday–Saturday, not bank holidays
  or days the founder closes). Atelier drop-offs count as collected at the end of the next Saver window.
- Minimum order (items): £29.95 for a home collection (a 5-shirt pack), £20 for an atelier drop-off (repository.py, "Minimum order").
- Every amount here is editable in /admin → Settings → Collection & delivery, without a deploy.
"""
import json
from datetime import date, datetime, timedelta
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (Booking, BookingMode, BookingStatus, Client, MembershipPlan, Order, Service, SiteSetting,
                        SlotBlackout, SlotTemplate, WindowType)

BANK_HOLIDAYS_FILE = Path(__file__).resolve().parent.parent / "site" / "data" / "bank_holidays.json"
BANK_HOLIDAYS_URL = "https://www.gov.uk/bank-holidays.json"

DEFAULTS = {
    "nonmember_saver_under_pence": 495,   # non-members, Saver, order under the free threshold
    "nonmember_one_hour_pence": 695,      # non-members, any one-hour leg (flat, never added to the Saver charge)
    "essence_saver_pence": 0,
    "essence_one_hour_pence": 495,
    "elevate_eclat_saver_pence": 0,
    "elevate_eclat_one_hour_pence": 0,
    "turnaround_hours": 48,
    "member_missed_visit_pence": 495,     # members, each missed visit after their free one in 12 months (Terms, 10)
    # Price-list categories outside the 48-hour promise (as well as anything sold as a quote).
    "confirmed_categories": ["Alterations", "Repairs", "Curtains & blinds", "Rugs"],
    "dropoff_enabled": True,
}
LONGER_NOTE = "Some items in your order need longer. We'll confirm their return date after we've inspected them."
ONE_CHARGE_NOTE = "One charge covers both collection and return."


# Settings

def config(db: Session) -> dict:
    from app.services.repository import rules
    row = db.get(SiteSetting, "delivery.config")
    saved = json.loads(row.value) if row and row.value else {}
    cfg = {**DEFAULTS, **{k: v for k, v in saved.items() if k in DEFAULTS}}
    r = rules(db)
    cfg["free_saver_threshold_pence"] = r["free_delivery_from_pence"]  # one setting, shared with the price list
    cfg["home_minimum_pence"], cfg["dropoff_minimum_pence"] = r["home_minimum_pence"], r["dropoff_minimum_pence"]
    return cfg


def save_config(db: Session, changes: dict) -> dict:
    from app.services.repository import set_setting
    cfg = config(db)
    for k, v in changes.items():
        if k == "free_saver_threshold_pence":
            set_setting(db, "free_delivery_from_pence", int(v))
        elif k in ("home_minimum_pence", "dropoff_minimum_pence"):
            set_setting(db, k, int(v))
        elif k in DEFAULTS:
            cfg[k] = type(DEFAULTS[k])(v) if not isinstance(DEFAULTS[k], list) else [str(x).strip() for x in v if str(x).strip()]
    row = db.get(SiteSetting, "delivery.config") or SiteSetting(key="delivery.config")
    row.value = json.dumps({k: cfg[k] for k in DEFAULTS})
    db.add(row)
    db.commit()
    return config(db)


# Charges

def member_level(client: Client | None) -> str | None:
    """essence | elevate | eclat for an active (not paused) membership, otherwise None."""
    m = client.membership if client else None
    return m.plan.value if m and m.is_active else None


def charge(cfg: dict, level: str | None, order_value_pence: int, one_hour: bool) -> int:
    """The single collection & delivery charge for a booking (spec §2.3)."""
    if level in (MembershipPlan.elevate.value, MembershipPlan.eclat.value):
        return cfg["elevate_eclat_one_hour_pence"] if one_hour else cfg["elevate_eclat_saver_pence"]
    if level == MembershipPlan.essence.value:
        return cfg["essence_one_hour_pence"] if one_hour else cfg["essence_saver_pence"]
    if one_hour:
        return cfg["nonmember_one_hour_pence"]
    return 0 if order_value_pence >= cfg["free_saver_threshold_pence"] else cfg["nonmember_saver_under_pence"]


def pounds(pence: int) -> str:
    return f"£{pence / 100:.2f}"


def cell_labels(cfg: dict, level: str | None, order_value_pence: int) -> dict:
    """What each slot cell says for this customer (spec §7): {"saver": …, "hour": …}."""
    if level in (MembershipPlan.elevate.value, MembershipPlan.eclat.value):
        return {"saver": "Included", "hour": "Included"}
    saver = charge(cfg, level, order_value_pence, False)
    hour = charge(cfg, level, order_value_pence, True)
    return {"saver": pounds(saver) if saver else "Free", "hour": pounds(hour) if hour else "Free"}


def missed_visit_charge(db: Session, order: Order, b: Booking) -> int:
    """What a missed visit costs after the customer's free one (Terms, 10): for non-members, the collection & delivery
    charge for that window as for an order under the free threshold; for members, a flat charge (Settings)."""
    cfg = config(db)
    if (order.delivery_basis or {}).get("level"):
        return cfg["member_missed_visit_pence"]
    return charge(cfg, None, 0, is_one_hour(b))


def charge_text(order: Order) -> str:
    """For emails and summaries: Free | Included with your membership | £4.95 | £6.95."""
    if order.fees_pence:
        return pounds(order.fees_pence)
    return "Included with your membership" if (order.delivery_basis or {}).get("level") else "Free"


def _legs(order: Order) -> list[Booking]:
    return [b for b in order.bookings if b.status != BookingStatus.cancelled]


def is_one_hour(b: Booking) -> bool:
    return b.atelier_id is None and b.window_type == WindowType.hour


def recompute(db: Session, order: Order, order_value_pence: int | None = None) -> int:
    """Set the order's single collection & delivery charge from its legs. Staff overrides are kept. Caller commits."""
    basis = dict(order.delivery_basis or {})
    if basis.get("manual"):
        return order.fees_pence
    value = basis.get("value_pence", 0) if order_value_pence is None else order_value_pence
    one_hour = any(is_one_hour(b) for b in _legs(order))
    fee = charge(config(db), basis.get("level"), value, one_hour)
    for b in order.bookings:
        b.fee_pence = 0  # the charge lives on the order, once
    basis.update(value_pence=value, one_hour=one_hour, charge_pence=fee)
    order.delivery_basis = basis
    order.fees_pence = fee
    return fee


def settle(db: Session, order: Order) -> str | None:
    """Before the final charge: use the counted order value (it may cross £45 either way). Returns a note for the
    client when the charge changes. Caller commits."""
    basis = order.delivery_basis or {}
    if not basis or basis.get("manual"):
        return None
    before = order.fees_pence
    after = recompute(db, order, order.items_total_pence)
    if after == before:
        return None
    note = (f"Your order came to {pounds(order.items_total_pence)}, so Saver collection and delivery is free."
            if after == 0 else
            f"Your order came to {pounds(order.items_total_pence)}, under the "
            f"{pounds(config(db)['free_saver_threshold_pence'])} for free Saver collection and delivery, "
            f"so collection and delivery is {pounds(after)}.")
    from app.services import orders as order_svc
    order_svc.log(db, order, "payment", note)
    return note


def public_terms(db: Session) -> dict:
    """The current amounts, written for the website's copy: {"threshold": "£45", "under": "£4.95", …}."""
    cfg = config(db)
    short = lambda p: f"£{p / 100:.2f}".removesuffix(".00")  # noqa: E731
    return {"threshold": short(cfg["free_saver_threshold_pence"]), "under": short(cfg["nonmember_saver_under_pence"]),
            "hour": short(cfg["nonmember_one_hour_pence"]), "essence_hour": short(cfg["essence_one_hour_pence"]),
            "turnaround": cfg["turnaround_hours"], "home_minimum": short(cfg["home_minimum_pence"]),
            "dropoff_minimum": short(cfg["dropoff_minimum_pence"])}


# Days and times

def bank_holidays(db: Session) -> set[date]:
    row = db.get(SiteSetting, "delivery.bank_holidays")
    try:
        dates = json.loads(row.value) if row and row.value else json.loads(BANK_HOLIDAYS_FILE.read_text())["dates"]
    except (ValueError, KeyError, OSError):
        dates = []
    return {date.fromisoformat(d) for d in dates}


def refresh_bank_holidays(db: Session) -> int:
    """Fetch England & Wales bank holidays from gov.uk. Keeps the bundled list if gov.uk can't be reached."""
    import httpx
    events = httpx.get(BANK_HOLIDAYS_URL, timeout=15).json()["england-and-wales"]["events"]
    dates = sorted({e["date"] for e in events} | {d.isoformat() for d in bank_holidays(db)})
    row = db.get(SiteSetting, "delivery.bank_holidays") or SiteSetting(key="delivery.bank_holidays")
    row.value = json.dumps(dates)
    db.add(row)
    db.commit()
    return len(dates)


def closed_days(db: Session, start: date, end: date) -> set[date]:
    """Bank holidays and days the founder has closed, in [start, end). Sundays have no slots at all."""
    founder = set(db.scalars(select(SlotBlackout.day).where(SlotBlackout.day >= start, SlotBlackout.day < end)))
    return founder | {d for d in bank_holidays(db) if start <= d < end}


def earliest_return(db: Session, collected_by: datetime) -> datetime:
    """T = collection window end + 48 hours. Return slots starting at or after T can be chosen (spec §4.1)."""
    return collected_by + timedelta(hours=config(db)["turnaround_hours"])


def deemed_collection(db: Session, dropped_off: datetime) -> datetime:
    """A drop-off counts as collected at the end of the first Saver window, on an operating day, that ends after it."""
    savers = db.scalars(select(SlotTemplate).where(SlotTemplate.active.is_(True), SlotTemplate.window_type == WindowType.saver,
                                                   SlotTemplate.mode == BookingMode.lave_collects)).all()
    ends: dict[int, list] = {}
    for t in savers:
        ends.setdefault(t.weekday, []).append(t.end)
    start = dropped_off.date()
    closed = closed_days(db, start, start + timedelta(days=21))
    for offset in range(21):
        day = start + timedelta(days=offset)
        if day in closed:
            continue
        for end in sorted(ends.get(day.weekday(), [])):
            when = datetime.combine(day, end)
            if when > dropped_off:
                return when
    return dropped_off


# What's covered by the 48-hour promise

def longer_items(db: Session, requested_items: list[dict]) -> list[str]:
    """Names of the pieces in a client's list that are confirmed per order: quotes, and the confirmed categories."""
    ids = [line["id"] for line in requested_items or [] if line.get("kind") == "item"]
    if not ids:
        return []
    categories = set(config(db)["confirmed_categories"])
    services = {s.id: s for s in db.scalars(select(Service).where(Service.id.in_(ids)))}
    return [line["name"] for line in requested_items if line.get("kind") == "item" and (s := services.get(line["id"]))
            and (s.sale_mode == "quote" or s.product_category in categories)]


def retire_counter_slots(db: Session) -> int:
    """The old atelier counter (drop-off and pick-up by the hour) is replaced by atelier locations. Caller commits."""
    rows = db.scalars(select(SlotTemplate).where(SlotTemplate.mode == BookingMode.drop_off, SlotTemplate.active.is_(True))).all()
    for t in rows:
        t.active = False
    return len(rows)
