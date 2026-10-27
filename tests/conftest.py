import os
from datetime import datetime, timedelta, timezone

os.environ["LAVE_DATABASE_URL"] = "sqlite://"
os.environ["LAVE_WP_SSO_SECRET"] = "test-wp-secret-0123456789abcdef0123456789"
os.environ["LAVE_SECRET_KEY"] = "test-secret-0123456789abcdef0123456789abcd"
os.environ["LAVE_ENV"] = "test"

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import hash_password
from app.db import Base, get_db
from app.main import create_app
from app.models import StaffRole, StaffUser
from app.seed import seed_services, seed_slots
from app.services.content import load_starter_content
from app.services.shop import load_sample_products
from app.site.catalogue import load_starting_catalogue
from app.services import clock

# Monday 5 October 2026, 08:00 London time.
NOW = datetime(2026, 10, 5, 8, 0)


@pytest.fixture
def db_session():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    with Session() as s:
        seed_slots(s)
        seed_services(s)
        load_starting_catalogue(s)
        load_sample_products(s)
        load_starter_content(s)
        from app.services.repository import load_repository
        load_repository(s)
        from app.services import area, delivery
        area.load_launch_zone(s)
        delivery.retire_counter_slots(s)
        s.add(StaffUser(email="admin@lavelondon.com", name="Ada", role=StaffRole.admin, password_hash=hash_password("admin-password")))
        s.add(StaffUser(email="driver@lavelondon.com", name="Dev", role=StaffRole.driver, password_hash=hash_password("driver-password")))
        s.commit()
    yield Session
    engine.dispose()


@pytest.fixture
def api(db_session):
    clock.freeze(NOW)
    app = create_app()

    def _db():
        s = db_session()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = _db
    with TestClient(app) as c:
        yield c
    clock.freeze(None)


def wp_token(wp_id=42, email="client@example.com", **extra):
    now = datetime.now(timezone.utc)
    return jwt.encode({"iss": "lave-wp", "sub": str(wp_id), "email": email, "iat": now,
                       "exp": now + timedelta(minutes=10), **extra}, "test-wp-secret-0123456789abcdef0123456789", algorithm="HS256")


@pytest.fixture
def client_headers(api):
    r = api.post("/api/auth/wp-exchange", json={"token": wp_token(first_name="Celia", last_name="Moss")})
    assert r.status_code == 200, r.text
    headers = {"Authorization": f"Bearer {r.json()['token']}"}
    api.patch("/api/me", headers=headers, json={"phone": "07700 900123"})  # needed to book
    return headers


@pytest.fixture
def staff_headers(api):
    r = api.post("/api/staff/auth/login", json={"email": "admin@lavelondon.com", "password": "admin-password"})
    assert r.status_code == 200, r.text
    api.cookies.clear()
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(autouse=True)
def photo_folder(tmp_path_factory, monkeypatch):
    """Every test keeps its photos in a fresh folder, never in this machine's media folder."""
    from app.services import storage
    monkeypatch.setattr(storage, "_store", storage.Folder(tmp_path_factory.mktemp("media")))



@pytest.fixture(autouse=True)
def human_speed(monkeypatch):
    """Tests fill forms in instantly; the bot check's 3-second minimum is tested on its own (test_bots.py)."""
    from app.services import bot_guard
    monkeypatch.setattr(bot_guard, "MIN_SECONDS", 0)


def form_fields() -> dict:
    """What a person's browser sends with the sign-up and sign-in-link forms."""
    from app.services import bot_guard
    return {"website": "", "t": bot_guard.form_token()}
