from datetime import date, datetime

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import serializers as ser
from app.auth import decode_wp_sso, issue_client_token
from app.config import get_settings
from app.db import get_db
from app.models import BookingMode, Client, Service, WindowType
from app.site import store
from app.schemas import WpExchange
from app.services import payments
from app.services.slots import available_slots

router = APIRouter(prefix="/api", tags=["public"])


@router.get("/config")
def config(db: Session = Depends(get_db)):
    s = get_settings()
    PLANS = store.load(db).plans
    return {
        "stripe_publishable_key": s.stripe_publishable_key or None,
        "wp_login_url": s.wp_login_url,
        "booking_horizon_days": s.booking_horizon_days,
        "plans": [
            {"code": p["code"], "name": p["name"], "tier": p["tier"], "tagline": p["tagline"],
             "price_pence": p["price_pence"], "annual_pence": p["annual_pence"], "includes": p["headline"],
             "builds_on": p["builds_on"] or None,
             "available": bool(s.stripe_price_for(p["code"])),
             "annual_available": bool(s.stripe_price_for(p["code"], "year"))}
            for p in PLANS
        ],
    }


@router.get("/services")
def services(db: Session = Depends(get_db)):
    rows = db.scalars(select(Service).where(Service.active.is_(True)).order_by(Service.category, Service.name))
    return [ser.service(s) for s in rows]


@router.get("/slots")
def slots(
    start: date,
    days: int = Query(5, ge=1, le=14),
    window: WindowType = WindowType.hour,
    mode: BookingMode = BookingMode.lave_collects,
    after: datetime | None = None,
    db: Session = Depends(get_db),
):
    return [ser.slot(s) for s in available_slots(db, start, days, window, mode, not_before=after)]


@router.post("/auth/wp-exchange")
def wp_exchange(body: WpExchange, db: Session = Depends(get_db)):
    """Swap a WordPress-signed token for a LAVE OS client session, creating the client on first visit."""
    claims = decode_wp_sso(body.token)
    wp_id = int(claims["sub"])
    email = claims["email"].lower().strip()

    client = db.scalar(select(Client).where(Client.wp_user_id == wp_id))
    if not client:
        # Never attach a WordPress login to an existing LAVE account by email alone: WordPress doesn't prove the
        # person owns that email. They sign in on the LAVE site instead, which does.
        if db.scalar(select(Client).where(Client.email == email)):
            raise HTTPException(409, "There's already a LAVE account for this email. Sign in on lavelondon.com to continue.")
        client = Client(email=email, wp_user_id=wp_id)
        db.add(client)
    if not client.first_name:
        client.first_name = claims.get("first_name", "")
    if not client.last_name:
        client.last_name = claims.get("last_name", "")
    db.commit()
    db.refresh(client)
    return {"token": issue_client_token(client), "client": ser.client(client)}


@router.post("/stripe/webhook", include_in_schema=False)
async def stripe_webhook(request: Request, stripe_signature: str | None = Header(default=None), db: Session = Depends(get_db)):
    payload = await request.body()
    return {"handled": payments.handle_webhook(db, payload, stripe_signature)}
