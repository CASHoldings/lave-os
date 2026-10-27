"""Profitability: what orders earn, what route days cost, and the levers that move both.

A job is one collection and its return (two stops). The route day (driver and charging) is paid however many stops it
has, so the trip cost per job falls as days fill: about £14 at 8 jobs a day, under £10 at 12. Contribution is what an
order leaves after cleaning, packaging and card fees, before route and fixed costs. The cost figures are the founder's
estimates, editable in /admin → Profitability.
"""
import json
from datetime import date, datetime, time, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import (AtelierLocation, Booking, BookingKind, BookingMode, BookingStatus, Order, OrderStatus,
                        SiteSetting, SlotTemplate)
from app.services import delivery, repository as repo
from app.services.clock import local_now

KEY = "profit.assumptions"
ASSUMPTIONS = {
    "margin_pct": 70,                  # item price left after cleaning (about 30% of price, from the price list's costs)
    "route_day_pence": 10800,          # driver (about £105) and charging (about £3) for one route day
    "packaging_pence": 75,             # tag, hangers, garment cover per order
    "card_fee_pct": 1.5,
    "card_fee_fixed_pence": 20,
    "fixed_month_pence": 211000,       # overheads (£1,350) plus the van lease (about £760)
    "target_jobs_per_day": 12,         # rule 14: open another route day at about this
    "min_jobs_per_day": 8,             # the fewest jobs that make a route day worth running
    "target_order_pence": 4000,
    "target_contribution_pence": 2800,
}
WEEKS = 8


def assumptions(db: Session) -> dict:
    row = db.get(SiteSetting, KEY)
    saved = json.loads(row.value) if row and row.value else {}
    return {**ASSUMPTIONS, **{k: type(ASSUMPTIONS[k])(v) for k, v in saved.items() if k in ASSUMPTIONS}}


def save_assumptions(db: Session, changes: dict) -> dict:
    current = assumptions(db)
    for k, v in changes.items():
        if k in ASSUMPTIONS and v is not None:
            current[k] = type(ASSUMPTIONS[k])(v)
    row = db.get(SiteSetting, KEY) or SiteSetting(key=KEY)
    row.value = json.dumps(current)
    db.add(row)
    db.commit()
    return current


def card_fee(a: dict, charged_pence: int) -> int:
    return round(charged_pence * a["card_fee_pct"] / 100) + a["card_fee_fixed_pence"] if charged_pence > 0 else 0


def contribution(a: dict, items_pence: int, top_up_pence: int = 0, fees_pence: int = 0, discount_pence: int = 0) -> int:
    """What an order leaves after cleaning, packaging and card fees. A top-up to the minimum has no cleaning cost."""
    charged = max(0, items_pence + top_up_pence + fees_pence - discount_pence)
    return round(items_pence * a["margin_pct"] / 100) + top_up_pence + fees_pence - discount_pence \
        - card_fee(a, charged) - a["packaging_pence"]


def order_value(o: Order) -> int:
    """Counted items once itemised; until then, the fixed-price items booked."""
    if o.items:
        return o.items_total_pence
    return sum(line["unit_pence"] * line["qty"] for line in o.requested_items or [] if not line.get("priced_later"))


def examples(db: Session, a: dict) -> list[dict]:
    """What one order earns at the current settings, against the trip cost of a job."""
    cfg = delivery.config(db)
    home, drop, free = cfg["home_minimum_pence"], cfg["dropoff_minimum_pence"], cfg["free_saver_threshold_pence"]
    rows = [
        ("Smallest home order, member", home, 0),
        ("Smallest home order, non-member", home, delivery.charge(cfg, None, home, False)),
        ("Smallest drop-off, member", drop, 0),
        (f"{repo.pounds(free)} order, non-member (free Saver)", free, delivery.charge(cfg, None, free, False)),
        (f"{repo.pounds(free - 100)} order, non-member", free - 100, delivery.charge(cfg, None, free - 100, False)),
    ]
    return [{"label": label, "items_pence": items, "fee_pence": fee, "contribution_pence": contribution(a, items, 0, fee)}
            for label, items, fee in rows]


def trip_costs(a: dict) -> list[dict]:
    return [{"jobs": n, "per_job_pence": round(a["route_day_pence"] / n) + a["packaging_pence"]} for n in (8, 12, 16, 26)]


def _week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())


def weekly(db: Session, a: dict, weeks: int = WEEKS) -> list[dict]:
    today = local_now().date()
    first = _week_start(today) - timedelta(weeks=weeks - 1)
    start = datetime.combine(first, time.min)
    end = datetime.combine(_week_start(today) + timedelta(days=7), time.min)
    free = delivery.config(db)["free_saver_threshold_pence"]

    stops = db.scalars(select(Booking).where(Booking.mode == BookingMode.lave_collects, Booking.status != BookingStatus.cancelled,
                                             Booking.starts_at >= start, Booking.starts_at < end)).all()
    firsts = db.scalars(select(Booking).where(Booking.kind == BookingKind.collection, Booking.status != BookingStatus.cancelled,
                                              Booking.order_id.is_not(None), Booking.starts_at >= start, Booking.starts_at < end)
                        .options(selectinload(Booking.order).selectinload(Order.items))).all()
    out = []
    for i in range(weeks):
        wk = first + timedelta(weeks=i)
        in_week = lambda dt: wk <= dt.date() < wk + timedelta(days=7)  # noqa: E731
        days = {b.starts_at.date() for b in stops if in_week(b.starts_at)}
        n_stops = sum(1 for b in stops if in_week(b.starts_at))
        orders = {b.order.id: b.order for b in firsts if in_week(b.starts_at) and b.order.status != OrderStatus.cancelled}
        # Orders booked without a list have no value until they're itemised: left out of the averages until then.
        valued = [o for o in orders.values() if o.items or order_value(o)]
        values = [order_value(o) for o in valued]
        contribs = [contribution(a, order_value(o), o.minimum_top_up_pence, o.fees_pence, o.discount_pence) for o in valued]
        jobs = n_stops / 2
        route_cost = len(days) * a["route_day_pence"]
        total = sum(contribs)
        out.append({
            "week": wk.isoformat(), "route_days": len(days), "stops": n_stops, "jobs": round(jobs, 1),
            "jobs_per_route_day": round(jobs / len(days), 1) if days else None,
            "trip_cost_per_job_pence": round(route_cost / jobs) if jobs else None,
            "orders": len(orders), "valued_orders": len(valued), "average_order_pence": round(sum(values) / len(values)) if values else None,
            "under_free_share": round(100 * sum(1 for v in values if v < free) / len(values)) if values else None,
            "contribution_per_order_pence": round(total / len(contribs)) if contribs else None,
            "contribution_pence": total, "route_cost_pence": route_cost,
            "after_route_pence": total - route_cost,
            "after_fixed_pence": total - route_cost - round(a["fixed_month_pence"] * 12 / 52),
            "current": wk == _week_start(today),
        })
    return out


def levers(db: Session) -> dict:
    """The settings that move profit, as they are now."""
    cfg = delivery.config(db)
    homes = db.scalars(select(SlotTemplate).where(SlotTemplate.mode == BookingMode.lave_collects, SlotTemplate.active.is_(True),
                                                  SlotTemplate.capacity > 0)).all()
    open_days = sorted({t.weekday for t in homes})
    margins = [repo.margin(s.price_pence, s.cost_pence) for s in repo.items(db, active_only=True)]
    floor = repo.rules(db)["minimum_margin"]
    return {
        "home_minimum_pence": cfg["home_minimum_pence"], "dropoff_minimum_pence": cfg["dropoff_minimum_pence"],
        "free_saver_threshold_pence": cfg["free_saver_threshold_pence"], "nonmember_saver_under_pence": cfg["nonmember_saver_under_pence"],
        "nonmember_one_hour_pence": cfg["nonmember_one_hour_pence"], "essence_one_hour_pence": cfg["essence_one_hour_pence"],
        "dropoff_enabled": cfg["dropoff_enabled"],
        "ateliers_active": len(db.scalars(select(AtelierLocation.id).where(AtelierLocation.status == "active")).all()),
        "route_weekdays": open_days, "weekly_home_capacity": sum(t.capacity for t in homes),
        "items_missing_cost": sum(1 for m in margins if m is None),
        "items_below_margin": sum(1 for m in margins if m is not None and m < floor), "minimum_margin": floor,
    }


def overview(db: Session) -> dict:
    a = assumptions(db)
    return {"assumptions": a, "levers": levers(db), "examples": examples(db, a), "trip_costs": trip_costs(a),
            "weeks": weekly(db, a)}
