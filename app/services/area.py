"""Where LAVE collects and delivers: the service area.

The launch zone is an imported list of postcodes (all SW11, plus the Wandsworth side of SW8). It's never inferred from
a prefix, because SW8 is only partly covered. Admin can add single postcodes or whole sectors ("SW4 9") without a
deploy. People outside the area can join a waitlist, kept by date and district so LAVE can see where demand is.
"""
import csv
import re
from pathlib import Path

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.models import AreaWaitlistEntry, ServicePostcode, ServiceSector

LAUNCH_ZONE = Path(__file__).resolve().parent.parent / "site" / "data" / "launch_zone.csv"
POSTCODE = re.compile(r"^[A-Z]{1,2}\d[A-Z\d]? \d[A-Z]{2}$")
SECTOR = re.compile(r"^[A-Z]{1,2}\d[A-Z\d]? \d$")
NOT_YET = "Not yet in our area"
OUT_OF_AREA = ("We're not in your area just yet. LAVE currently serves Battersea, Clapham Junction, Nine Elms and "
               "Battersea Power Station. Leave your details and we'll let you know as soon as we reach you.")


def normalise(postcode: str) -> str:
    """'sw116ab' → 'SW11 6AB': uppercase, one space before the last three characters."""
    compact = re.sub(r"\s+", "", postcode or "").upper()
    return f"{compact[:-3]} {compact[-3:]}" if len(compact) > 3 else compact


def district(postcode: str) -> str:
    return normalise(postcode).split(" ")[0]


def sector(postcode: str) -> str:
    pc = normalise(postcode)
    return pc[:-2] if POSTCODE.match(pc) else ""


def in_zone(db: Session, postcode: str) -> bool:
    pc = normalise(postcode)
    if not POSTCODE.match(pc):
        return False
    return bool(db.get(ServicePostcode, pc) or db.get(ServiceSector, sector(pc)))


def load_launch_zone(db: Session) -> int:
    """Add the launch-zone postcodes that aren't in the area yet. Safe on every deploy. Caller commits."""
    have = set(db.scalars(select(ServicePostcode.postcode)))
    added = 0
    with LAUNCH_ZONE.open(newline="") as f:
        for row in csv.DictReader(f):
            pc = normalise(row["postcode"])
            if pc not in have:
                db.add(ServicePostcode(postcode=pc, district=row["district"], sector=row["sector"], source="launch"))
                have.add(pc)
                added += 1
    return added


def add(db: Session, entries: str, by: str) -> dict:
    """Add postcodes ("SW4 9AS") and whole sectors ("SW4 9"), one per line or comma-separated."""
    added, sectors, skipped = [], [], []
    for raw in re.split(r"[\n,;]+", entries or ""):
        if not raw.strip():
            continue
        value = " ".join(raw.upper().split())
        if SECTOR.match(value):
            if not db.get(ServiceSector, value):
                db.add(ServiceSector(sector=value, added_by=by))
                sectors.append(value)
            continue
        pc = normalise(raw)
        if not POSTCODE.match(pc):
            skipped.append(raw.strip())
        elif not db.get(ServicePostcode, pc):
            db.add(ServicePostcode(postcode=pc, district=district(pc), sector=sector(pc), source="admin", added_by=by))
            added.append(pc)
    db.commit()
    return {"postcodes": added, "sectors": sectors, "skipped": skipped}


def remove(db: Session, entry: str) -> bool:
    value = " ".join(entry.upper().split())
    if SECTOR.match(value):
        n = db.execute(delete(ServiceSector).where(ServiceSector.sector == value)).rowcount
    else:
        n = db.execute(delete(ServicePostcode).where(ServicePostcode.postcode == normalise(value))).rowcount
    db.commit()
    return bool(n)


def summary(db: Session) -> dict:
    districts = db.execute(select(ServicePostcode.district, func.count()).group_by(ServicePostcode.district)
                           .order_by(ServicePostcode.district)).all()
    demand = db.execute(select(AreaWaitlistEntry.district, func.count()).group_by(AreaWaitlistEntry.district)
                        .order_by(func.count().desc())).all()
    added = db.scalars(select(ServicePostcode).where(ServicePostcode.source != "launch")
                       .order_by(ServicePostcode.created_at.desc()).limit(200)).all()
    return {
        "postcodes": sum(n for _, n in districts),
        "districts": [{"district": d, "postcodes": n} for d, n in districts],
        "sectors": [{"sector": s.sector, "added_by": s.added_by} for s in db.scalars(select(ServiceSector).order_by(ServiceSector.sector))],
        "added": [{"postcode": p.postcode, "added_by": p.added_by} for p in added],
        "waitlist_by_district": [{"district": d or "?", "people": n} for d, n in demand],
    }


def join_waitlist(db: Session, *, name: str, email: str, phone: str, postcode: str, services: list[str],
                  client_id: int | None = None) -> AreaWaitlistEntry:
    pc = normalise(postcode)
    entry = AreaWaitlistEntry(name=name.strip()[:160], email=email.strip().lower()[:255], phone=phone.strip()[:40],
                              postcode=pc[:10], district=district(pc)[:6], services=[s[:40] for s in services][:12],
                              client_id=client_id)
    db.add(entry)
    db.commit()
    return entry


def waitlist(db: Session, limit: int = 500) -> list[AreaWaitlistEntry]:
    return db.scalars(select(AreaWaitlistEntry).order_by(AreaWaitlistEntry.created_at.desc()).limit(limit)).all()
