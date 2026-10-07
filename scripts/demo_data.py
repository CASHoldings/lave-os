"""Load demo clients, orders, bookings and Vault items into a LOCAL development database.

    python -m scripts.demo_data

Refuses to run unless LAVE_ENV=development. Demo clients use @example.com emails.
Creates the dev admin from LAVE_DEV_ADMIN_EMAIL / LAVE_DEV_ADMIN_PASSWORD in .env.
"""
import os
import random
from datetime import datetime, time, timedelta

from pathlib import Path

from sqlalchemy import select

from app.auth import hash_password
from app.config import get_settings
from app.db import Base, SessionLocal, engine
from app.models import (
    Address,
    Booking,
    BookingKind,
    BookingMode,
    BookingStatus,
    Client,
    Garment,
    ItemStatus,
    Membership,
    MembershipPlan,
    MembershipStatus,
    Order,
    OrderEvent,
    OrderStatus,
    PaymentStatus,
    Service,
    SlotTemplate,
    StaffRole,
    StaffUser,
    VaultItem,
    WindowType,
)
from app.seed import seed_services, seed_slots
from app.services.clock import local_now

PEOPLE = [
    ("Amara", "Okafor", "Flat 4, 12 Prince of Wales Drive", "SW11 4SB", "Concierge desk, ask for Tom"),
    ("Henry", "Whitcombe", "1 Haydon Way", "SW11 1YF", ""),
    ("Sofia", "Lindqvist", "27 Elm Park Gardens", "SW10 9NZ", "Side gate code 2208"),
    ("Rahul", "Mehta", "9 Cadogan Square", "SW1X 0HT", ""),
    ("Isabelle", "Moreau", "44 Ladbroke Grove", "W11 2PA", "Leave with porter if out"),
    ("James", "Achterberg", "3 Clapham Common North Side", "SW4 0QW", ""),
]
ITEMS = [
    ("Silk blouse", "HAND_SILK", "Ivory", "Silk"), ("Two-piece suit", "DC_SUIT_2PC", "Navy", "Wool"),
    ("Cashmere jumper", "DC_KNIT", "Camel", "Cashmere"), ("Shirt", "SHIRT_HUNG", "White", "Cotton"),
    ("Wool overcoat", "DC_COAT", "Charcoal", "Wool"), ("Evening dress", "DC_DRESS", "Black", "Silk crepe"),
    ("Duvet", "BED_DUVET", "White", "Goose down"), ("Linen trousers", "PRESS_ITEM", "Sand", "Linen"),
]
STAGE_ORDER = [OrderStatus.awaiting_collection, OrderStatus.collected, OrderStatus.inspected, OrderStatus.in_care,
               OrderStatus.quality_check, OrderStatus.ready, OrderStatus.delivered]
ITEM_FOR = {OrderStatus.inspected: ItemStatus.inspected, OrderStatus.in_care: ItemStatus.in_care,
            OrderStatus.quality_check: ItemStatus.quality_check, OrderStatus.ready: ItemStatus.ready,
            OrderStatus.delivered: ItemStatus.returned}


def template_for(db, day, hour, window=WindowType.hour, mode=BookingMode.lave_collects):
    return db.scalar(select(SlotTemplate).where(SlotTemplate.weekday == day.weekday(), SlotTemplate.start == time(hour),
                                                SlotTemplate.window_type == window, SlotTemplate.mode == mode))


def load_dotenv(path=Path(".env")):
    if path.exists():
        for line in path.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


def main():
    load_dotenv()
    s = get_settings()
    if not s.is_dev:
        raise SystemExit("Demo data only loads when LAVE_ENV=development.")
    random.seed(7)
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        seed_slots(db)
        seed_services(db)
        email, pw = os.environ.get("LAVE_DEV_ADMIN_EMAIL"), os.environ.get("LAVE_DEV_ADMIN_PASSWORD")
        if email and pw and not db.scalar(select(StaffUser).where(StaffUser.email == email)):
            db.add(StaffUser(email=email, name="Stanley", role=StaffRole.admin, password_hash=hash_password(pw)))
        for name, role in [("Marcus (driver)", StaffRole.driver), ("Priya (atelier)", StaffRole.operator)]:
            em = name.split()[0].lower() + "@example.com"
            if not db.scalar(select(StaffUser).where(StaffUser.email == em)):
                db.add(StaffUser(email=em, name=name.split(" (")[0], role=role, password_hash=hash_password(os.urandom(16).hex())))
        db.flush()
        if db.scalar(select(Client).where(Client.email.like("%@example.com"))):
            db.commit()
            print("Demo data already loaded.")
            return

        svc = {x.code: x for x in db.scalars(select(Service))}
        driver = db.scalar(select(StaffUser).where(StaffUser.role == StaffRole.driver))
        now = local_now()
        today = now.date()
        # Next working day (Mon–Sat).
        def workday(offset):
            d = today + timedelta(days=offset)
            while d.weekday() == 6:
                d += timedelta(days=1)
            return d

        clients = []
        for i, (fn, ln, line1, pc, instr) in enumerate(PEOPLE):
            c = Client(email=f"{fn.lower()}.{ln.lower()}@example.com", first_name=fn, last_name=ln,
                       phone=f"07700 900{100 + i}", preferences={"shirts": random.choice(["Hung", "Folded"]), "starch": random.choice(["None", "Light"])},
                       has_card_on_file=i % 3 != 2)
            c.addresses.append(Address(label="Home", line1=line1, postcode=pc, instructions=instr, is_default=True))
            db.add(c)
            clients.append(c)
        db.flush()
        db.add(Membership(client_id=clients[0].id, plan=MembershipPlan.elevate, status=MembershipStatus.active,
                          current_period_end=now + timedelta(days=19)))
        db.add(Membership(client_id=clients[3].id, plan=MembershipPlan.eclat, status=MembershipStatus.active,
                          current_period_end=now + timedelta(days=8)))

        # One order per pipeline stage, plus a couple of extras.
        plan = [(clients[1], OrderStatus.awaiting_collection, workday(0), 14), (clients[4], OrderStatus.awaiting_collection, workday(0), 17),
                (clients[2], OrderStatus.collected, workday(-1), 9), (clients[5], OrderStatus.inspected, workday(-2), 11),
                (clients[0], OrderStatus.in_care, workday(-2), 8), (clients[3], OrderStatus.quality_check, workday(-3), 10),
                (clients[1], OrderStatus.ready, workday(-3), 12), (clients[2], OrderStatus.delivered, workday(-7), 16)]
        for client, status, coll_day, hour in plan:
            o = Order(client_id=client.id, status=status, requested_services=random.sample(["laundry", "dry_cleaning", "pressing", "delicates"], 2),
                      client_notes=random.choice(["", "Red wine on the cuff of the white shirt", "Please hang the blouses"]))
            db.add(o)
            db.flush()
            addr = client.addresses[0]
            t = template_for(db, coll_day, hour)
            coll = Booking(client_id=client.id, order_id=o.id, template_id=t.id if t else None, kind=BookingKind.collection, mode=BookingMode.lave_collects,
                           window_type=WindowType.hour, address_id=addr.id, starts_at=datetime.combine(coll_day, time(hour)),
                           ends_at=datetime.combine(coll_day, time(hour + 1)), fee_pence=400,
                           status=BookingStatus.scheduled if status == OrderStatus.awaiting_collection else BookingStatus.completed,
                           driver_id=driver.id if status != OrderStatus.awaiting_collection else None)
            db.add(coll)
            fees = 400
            if status in (OrderStatus.ready, OrderStatus.quality_check, OrderStatus.in_care, OrderStatus.delivered):
                del_day = workday(0) if status == OrderStatus.ready else workday(1) if status != OrderStatus.delivered else workday(-5)
                dh = 18 if status == OrderStatus.ready else 10
                t2 = template_for(db, del_day, dh)
                db.add(Booking(client_id=client.id, order_id=o.id, template_id=t2.id if t2 else None, kind=BookingKind.delivery, mode=BookingMode.lave_collects,
                               window_type=WindowType.hour, address_id=addr.id, starts_at=datetime.combine(del_day, time(dh)),
                               ends_at=datetime.combine(del_day, time(dh + 1)), fee_pence=400,
                               status=BookingStatus.completed if status == OrderStatus.delivered else BookingStatus.scheduled))
                fees += 400
            o.fees_pence = fees
            reached = STAGE_ORDER[:STAGE_ORDER.index(status) + 1]
            at = datetime.combine(coll_day, time(hour)) - timedelta(days=1)
            for st in reached:
                db.add(OrderEvent(order_id=o.id, status=st.value, at=at))
                at += timedelta(hours=random.randint(3, 20))
            if STAGE_ORDER.index(status) >= STAGE_ORDER.index(OrderStatus.inspected):
                for n, (desc, code, colour, fibre) in enumerate(random.sample(ITEMS, random.randint(2, 5)), start=1):
                    db.add(Garment(order_id=o.id, tag_code=f"{o.ref}-{n:02d}", service_id=svc[code].id, description=desc, colour=colour,
                                   fibre=fibre, price_pence=svc[code].price_pence, status=ITEM_FOR.get(status, ItemStatus.received)))
            if status in (OrderStatus.delivered,):
                o.payment_status, o.paid_at = PaymentStatus.paid, at
            if status == OrderStatus.ready and client.id == clients[1].id:
                o.payment_status = PaymentStatus.unpaid

        # Vault
        for client, desc, loc, season in [(clients[0], "Camel cashmere overcoat", "R1-S2-B04", "Autumn/Winter"),
                                          (clients[0], "Ivory silk wedding gown", "R3-S1-B01", "All year"),
                                          (clients[3], "Navy wool suit", "R1-S3-B11", "Autumn/Winter"),
                                          (clients[4], "Linen summer dresses (3)", "R2-S1-B07", "Spring/Summer")]:
            db.add(VaultItem(client_id=client.id, tag_code=f"VLT-{random.randint(1000, 9999)}", description=desc, location=loc,
                             season=season, stored_at=now - timedelta(days=random.randint(20, 200))))
        db.commit()
    print("Demo data loaded.")


if __name__ == "__main__":
    main()
