"""LAVE atelier locations, where members drop items off instead of booking a home collection (spec §5).

A location is offered on a date only if it's active, the date is within its available range, it has opening hours
that weekday and isn't a closure date, and (if it has a daily capacity) it isn't full. Locations with bookings are
retired, never deleted, so past orders keep their record. Every change is logged.
"""
from datetime import date, datetime, time, timedelta

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import AtelierChange, AtelierLocation, Booking, BookingStatus

STATUSES = ("active", "paused", "retired")
FIELDS = ("name", "address", "postcode", "map_link", "access_instructions", "status", "available_from", "available_to",
          "weekly_hours", "closure_dates", "daily_capacity", "members_only")
WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def hours_on(loc: AtelierLocation, day: date) -> tuple[time, time] | None:
    h = (loc.weekly_hours or {}).get(str(day.weekday()))
    if not h or not h[0] or not h[1]:
        return None
    return time.fromisoformat(h[0]), time.fromisoformat(h[1])


def bookings_on(db: Session, loc_id: int, day: date) -> list[Booking]:
    start = datetime.combine(day, time.min)
    return db.scalars(select(Booking).where(Booking.atelier_id == loc_id, Booking.status != BookingStatus.cancelled,
                                            Booking.starts_at >= start, Booking.starts_at < start + timedelta(days=1))).all()


def open_on(loc: AtelierLocation, day: date) -> bool:
    return (loc.status == "active"
            and (loc.available_from is None or day >= loc.available_from)
            and (loc.available_to is None or day <= loc.available_to)
            and day.isoformat() not in (loc.closure_dates or [])
            and hours_on(loc, day) is not None)


def full_on(db: Session, loc: AtelierLocation, day: date) -> bool:
    return bool(loc.daily_capacity) and len(bookings_on(db, loc.id, day)) >= loc.daily_capacity


def offered(db: Session, start: date, days: int) -> list[dict]:
    """Active locations with the dates they're open (and whether each is full), nearest first."""
    out = []
    for loc in db.scalars(select(AtelierLocation).where(AtelierLocation.status == "active").order_by(AtelierLocation.name)):
        dates = []
        for offset in range(days):
            day = start + timedelta(days=offset)
            if open_on(loc, day):
                opens, closes = hours_on(loc, day)
                dates.append({"day": day.isoformat(), "opens": opens.strftime("%H:%M"), "closes": closes.strftime("%H:%M"),
                              "full": full_on(db, loc, day)})
        if dates:
            out.append({**describe(loc), "dates": dates})
    return out


def check_open(db: Session, loc: AtelierLocation | None, day: date) -> AtelierLocation:
    if not loc or not open_on(loc, day):
        raise HTTPException(409, "That atelier isn't open for drop-offs on that day. Choose another day or location.")
    if full_on(db, loc, day):
        raise HTTPException(409, "That atelier is fully booked for drop-offs that day. Choose another day or location.")
    return loc


def describe(loc: AtelierLocation, staff_view: bool = False) -> dict:
    out = {"id": loc.id, "name": loc.name, "address": loc.address, "postcode": loc.postcode, "map_link": loc.map_link,
           "access_instructions": loc.access_instructions, "weekly_hours": loc.weekly_hours or {},
           "hours_text": hours_text(loc)}
    if staff_view:
        out.update(status=loc.status, available_from=loc.available_from.isoformat() if loc.available_from else None,
                   available_to=loc.available_to.isoformat() if loc.available_to else None,
                   closure_dates=loc.closure_dates or [], daily_capacity=loc.daily_capacity, members_only=loc.members_only)
    return out


def _t(hhmm: str) -> str:
    t = time.fromisoformat(hhmm)
    h = t.hour % 12 or 12
    return (f"{h}" if not t.minute else f"{h}:{t.minute:02d}") + ("am" if t.hour < 12 else "pm")


def hours_text(loc: AtelierLocation) -> str:
    """"Mon–Fri 8am–8pm, Sun 10am–4pm"."""
    parts, run = [], []
    days = [(wd, tuple((loc.weekly_hours or {}).get(str(wd)) or ())) for wd in range(7)]
    for wd, h in days + [(7, ())]:
        if run and (not h or h != run[-1][1] or wd != run[-1][0] + 1):
            first, last, hh = run[0][0], run[-1][0], run[0][1]
            label = WEEKDAYS[first][:3] + ("" if first == last else "–" + WEEKDAYS[last][:3])
            parts.append(f"{label} {_t(hh[0])}–{_t(hh[1])}")
            run = []
        if h and len(h) == 2 and h[0] and h[1]:
            run.append((wd, h))
    return ", ".join(parts)


def _clean(data: dict) -> dict:
    out = {}
    for k in FIELDS:
        if k not in data:
            continue
        v = data[k]
        if k in ("available_from", "available_to"):
            v = date.fromisoformat(v) if v else None
        elif k == "status":
            if v not in STATUSES:
                raise HTTPException(400, "Status must be active, paused or retired.")
        elif k == "weekly_hours":
            hours = {}
            for wd, h in (v or {}).items():
                if h and h[0] and h[1]:
                    opens, closes = time.fromisoformat(h[0]), time.fromisoformat(h[1])
                    if closes <= opens:
                        raise HTTPException(400, f"{WEEKDAYS[int(wd)]}: closing time must be after opening time.")
                    hours[str(int(wd))] = [opens.strftime("%H:%M"), closes.strftime("%H:%M")]
            v = hours
        elif k == "closure_dates":
            v = sorted({date.fromisoformat(d).isoformat() for d in v or [] if d})
        elif k == "daily_capacity":
            v = int(v) if v not in (None, "", 0, "0") else None
        elif k == "members_only":
            v = bool(v)
        else:
            v = str(v or "").strip()
        out[k] = v
    if "name" in out and not out["name"]:
        raise HTTPException(400, "Give the atelier a name.")
    return out


def _log(db: Session, loc: AtelierLocation, by: str, what: str) -> None:
    db.add(AtelierChange(atelier_id=loc.id, by=by, what=what))


def create(db: Session, data: dict, by: str) -> AtelierLocation:
    loc = AtelierLocation(**_clean(data))
    db.add(loc)
    db.flush()
    _log(db, loc, by, "Created")
    db.commit()
    return loc


def affected(db: Session, loc: AtelierLocation, new: dict) -> list[dict]:
    """Upcoming drop-offs this change would cancel out: pausing, retiring, closing a date, or shortening the range."""
    from app.services.clock import local_now
    upcoming = db.scalars(select(Booking).where(Booking.atelier_id == loc.id, Booking.status == BookingStatus.scheduled,
                                                Booking.starts_at >= datetime.combine(local_now().date(), time.min))
                          .order_by(Booking.starts_at)).all()
    trial = AtelierLocation(**{k: getattr(loc, k) for k in FIELDS})
    for k, v in new.items():
        setattr(trial, k, v)
    trial.status = trial.status or "active"
    return [{"booking_id": b.id, "ref": b.order.ref if b.order else b.ref, "day": b.starts_at.date().isoformat(),
             "client": b.client.full_name, "email": b.client.email, "phone": b.client.phone}
            for b in upcoming if not open_on(trial, b.starts_at.date())]


def update(db: Session, loc: AtelierLocation, data: dict, by: str, confirmed: bool = False) -> dict:
    """Apply a change. If it affects booked drop-offs and isn't confirmed yet, nothing changes and the members are
    listed, so admin can offer them another location or a home collection."""
    new = _clean(data)
    hit = affected(db, loc, new)
    if hit and not confirmed:
        return {"applied": False, "affected": hit}
    changes = []
    for k, v in new.items():
        if getattr(loc, k) != v:
            changes.append(f"{k}: {getattr(loc, k)!r} → {v!r}")
            setattr(loc, k, v)
    if changes:
        _log(db, loc, by, "; ".join(changes) + (f" ({len(hit)} booked drop-offs affected)" if hit else ""))
    db.commit()
    return {"applied": True, "affected": hit}


def remove(db: Session, loc: AtelierLocation, by: str) -> None:
    used = db.scalar(select(func.count()).select_from(Booking).where(Booking.atelier_id == loc.id))
    if used:
        raise HTTPException(409, "This atelier has bookings, so it can't be deleted. Retire it instead: it's hidden "
                                 "from new bookings and past orders keep their record.")
    db.delete(loc)
    db.commit()


def history(db: Session, loc: AtelierLocation) -> list[dict]:
    rows = db.scalars(select(AtelierChange).where(AtelierChange.atelier_id == loc.id).order_by(AtelierChange.id.desc()).limit(100))
    return [{"at": r.at.isoformat() if r.at else None, "by": r.by, "what": r.what} for r in rows]
