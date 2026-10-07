"""Create tables and load starting data.

    python -m app.seed                       # tables, slot templates, price list
    python -m app.seed --admin you@lave.com  # also create an admin (prompts for a password)

Safe to re-run: it only adds what is missing.
"""
import argparse
import getpass
from datetime import time

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import hash_password
from app.db import Base, SessionLocal, engine
from app.services.content import load_starter_content
from app.services.shop import load_sample_products
from app.site.catalogue import load_starting_catalogue
from app.models import (
    BookingMode,
    Service,
    ServiceCategory,
    SlotTemplate,
    StaffRole,
    StaffUser,
    WindowType,
)

# Starting price list. Replace these with LAVE's real prices from the dashboard (Settings → Services).
SERVICES = [
    ("WASH_FOLD_KG", "Wash & fold", ServiceCategory.clean, "kg", 450),
    ("SHIRT_HUNG", "Shirt, washed & pressed", ServiceCategory.clean, "item", 450),
    ("DC_SUIT_2PC", "Suit, two-piece", ServiceCategory.clean, "item", 2200),
    ("DC_DRESS", "Dress", ServiceCategory.clean, "item", 1800),
    ("DC_COAT", "Coat", ServiceCategory.clean, "item", 2500),
    ("DC_KNIT", "Knitwear", ServiceCategory.clean, "item", 1100),
    ("HAND_SILK", "Silk, hand wash", ServiceCategory.clean, "item", 1600),
    ("PRESS_ITEM", "Press only", ServiceCategory.press, "item", 600),
    ("BED_DUVET", "Duvet", ServiceCategory.refresh, "item", 3200),
    ("BED_SET", "Bed linen set", ServiceCategory.refresh, "item", 2400),
    ("TOWEL_BUNDLE", "Towels (bundle of 5)", ServiceCategory.refresh, "bundle", 1500),
    ("CURTAIN_PANEL", "Curtain panel", ServiceCategory.refresh, "item", 2800),
    ("PRESERVE_GOWN", "Wedding gown preservation", ServiceCategory.preserve, "item", 29500),
    ("REPAIR_MINOR", "Minor repair", ServiceCategory.repair, "item", 900),
    ("VAULT_MONTH", "Vault storage, per item per month", ServiceCategory.vault, "month", 500),
]

HOUR_FEE_PENCE = 400  # matches the £4 one-hour slots on lavelondon.com
SAVER_FEE_PENCE = 0
WORKING_DAYS = range(0, 6)  # Monday to Saturday


def seed_slots(db: Session) -> int:
    if db.scalar(select(SlotTemplate).limit(1)):
        return 0
    rows = []
    for wd in WORKING_DAYS:
        for h in range(6, 22):  # 6am–10pm, one-hour windows
            rows.append(SlotTemplate(weekday=wd, start=time(h), end=time(h + 1), window_type=WindowType.hour,
                                     mode=BookingMode.lave_collects, capacity=4, fee_pence=HOUR_FEE_PENCE))
        for h in range(7, 22, 3):  # three-hour Saver windows
            rows.append(SlotTemplate(weekday=wd, start=time(h), end=time(min(h + 3, 22)), window_type=WindowType.saver,
                                     mode=BookingMode.lave_collects, capacity=8, fee_pence=SAVER_FEE_PENCE))
        for h in range(8, 20):  # atelier counter for drop-off and pick-up
            rows.append(SlotTemplate(weekday=wd, start=time(h), end=time(h + 1), window_type=WindowType.hour,
                                     mode=BookingMode.drop_off, capacity=6, fee_pence=0))
    db.add_all(rows)
    return len(rows)


def seed_services(db: Session) -> int:
    existing = set(db.scalars(select(Service.code)))
    new = [Service(code=c, name=n, category=cat, unit=u, price_pence=p) for c, n, cat, u, p in SERVICES if c not in existing]
    db.add_all(new)
    return len(new)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--admin", help="email for an admin account to create")
    parser.add_argument("--name", default="LAVE Admin")
    parser.add_argument("--password", help="omit to be prompted")
    args = parser.parse_args()

    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        n_slots = seed_slots(db)
        n_services = seed_services(db)
        n_catalogue = load_starting_catalogue(db)
        load_sample_products(db)
        load_starter_content(db)
        if args.admin:
            email = args.admin.lower()
            if db.scalar(select(StaffUser).where(StaffUser.email == email)):
                print(f"Admin {email} already exists.")
            else:
                pw = args.password or getpass.getpass("Password for the new admin (10+ characters): ")
                if len(pw) < 10:
                    raise SystemExit("Password must be at least 10 characters.")
                db.add(StaffUser(email=email, name=args.name, role=StaffRole.admin, password_hash=hash_password(pw)))
                print(f"Created admin {email}.")
        db.commit()
    print(f"Seeded {n_slots} slot templates, {n_services} price-list services and {n_catalogue} website services.")


if __name__ == "__main__":
    main()
