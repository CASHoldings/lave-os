"""Runs before each new version goes live (Render's pre-deploy step): `python -m app.release`.

1. Brings the database up to date (new tables and columns).
2. On a brand-new database only, loads the starting slots, price list, catalogue, sample products and pages.
   After that it never touches content, so anything deleted or edited in /admin stays that way. The one exception:
   old wording of the brand lines is swapped for the current lines where it's still there word for word.
3. If there are no staff accounts yet, creates the first admin from LAVE_FIRST_ADMIN_EMAIL and
   LAVE_FIRST_ADMIN_PASSWORD. Remove the password from the host's settings once you've signed in.
"""
import time

from sqlalchemy import func, select, text
from sqlalchemy.exc import OperationalError

from app.auth import hash_password
from app.config import get_settings
from app.db import SessionLocal, engine
from app.migrate import upgrade
from app.models import SlotTemplate, StaffRole, StaffUser
from app.seed import seed_services, seed_slots
from app.services.content import load_starter_content, update_brand_wording
from app.services.shop import load_sample_products
from app.site.catalogue import load_starting_catalogue


def wait_for_database(timeout: float = 120, every: float = 5) -> None:
    """A brand-new database can still be starting when the first deploy runs, so keep trying for a while."""
    deadline = time.monotonic() + timeout
    while True:
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            return
        except OperationalError:
            if time.monotonic() >= deadline:
                raise
            print(f"Database not ready yet; trying again in {every:.0f}s.", flush=True)
            time.sleep(every)


def release() -> list[str]:
    notes = []
    wait_for_database()
    added = upgrade()
    notes.append(f"Database up to date ({len(added)} new columns)." if added else "Database up to date.")
    settings = get_settings()
    with SessionLocal() as db:
        if not db.scalar(select(SlotTemplate).limit(1)):
            seed_slots(db)
            seed_services(db)
            load_starting_catalogue(db)
            load_sample_products(db)
            load_starter_content(db)
            notes.append("New database: loaded the starting slots, price list, catalogue, products and pages.")
        # The product repository replaces the starting price list the first time it's deployed.
        from app.services import repository
        if loaded := repository.load_repository(db):
            notes.append(f"Product repository loaded: {loaded['added']} items, {loaded['packs']} packs; "
                         f"{loaded['retired_old']} old price-list entries retired.")
        if (photos := repository.load_bundled_images(db)) and (photos["added"] or photos["items"]):
            notes.append(f"Photos: {photos['added']} added to the image library; placed on {photos['items']} items, "
                         f"{photos['packs']} packs and {photos['categories']} categories.")
        if changed := update_brand_wording(db):
            notes.append(f"Brand lines: updated the wording in {changed} saved page(s).")
        if not db.scalar(select(func.count()).select_from(StaffUser)):
            email, password = settings.first_admin_email.strip().lower(), settings.first_admin_password
            if email and len(password) >= 12:
                db.add(StaffUser(email=email, name="LAVE Admin", role=StaffRole.admin, password_hash=hash_password(password)))
                notes.append(f"Created the first admin, {email}. You can now remove LAVE_FIRST_ADMIN_PASSWORD.")
            else:
                notes.append("No staff accounts yet: set LAVE_FIRST_ADMIN_EMAIL and LAVE_FIRST_ADMIN_PASSWORD "
                             "(12+ characters) and deploy again.")
        db.commit()
    return notes


if __name__ == "__main__":
    for line in release():
        print(line)
