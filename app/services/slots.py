from dataclasses import dataclass
from datetime import date, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import (
    Booking,
    BookingKind,
    BookingMode,
    BookingStatus,
    SlotBlackout,
    SlotTemplate,
    WindowType,
)
from app.services.clock import local_now


@dataclass
class Slot:
    template_id: int
    day: date
    starts_at: datetime
    ends_at: datetime
    window_type: WindowType
    mode: BookingMode
    fee_pence: int
    remaining: int

    @property
    def key(self) -> str:
        return f"{self.template_id}@{self.day.isoformat()}"


def _booked_counts(db: Session, start: datetime, end: datetime) -> dict[tuple[int, datetime], int]:
    rows = db.execute(
        select(Booking.template_id, Booking.starts_at, func.count())
        .where(
            Booking.starts_at >= start,
            Booking.starts_at < end,
            Booking.status != BookingStatus.cancelled,
            Booking.template_id.is_not(None),
        )
        .group_by(Booking.template_id, Booking.starts_at)
    ).all()
    return {(tid, at): n for tid, at, n in rows}


def available_slots(
    db: Session,
    start_day: date,
    days: int,
    window_type: WindowType,
    mode: BookingMode,
    not_before: datetime | None = None,
) -> list[Slot]:
    """Slots in [start_day, start_day + days) that a client may still book.

    `not_before` lets the delivery picker hide slots earlier than the chosen collection.
    """
    settings = get_settings()
    now = local_now()
    earliest = now + timedelta(minutes=settings.booking_min_notice_minutes)
    if not_before and not_before > earliest:
        earliest = not_before
    horizon = now.date() + timedelta(days=settings.booking_horizon_days)

    templates = db.scalars(
        select(SlotTemplate).where(
            SlotTemplate.active.is_(True),
            SlotTemplate.window_type == window_type,
            SlotTemplate.mode == mode,
        ).order_by(SlotTemplate.start)
    ).all()
    by_weekday: dict[int, list[SlotTemplate]] = {}
    for t in templates:
        by_weekday.setdefault(t.weekday, []).append(t)

    end_day = start_day + timedelta(days=days)
    blackouts = set(db.scalars(select(SlotBlackout.day).where(SlotBlackout.day >= start_day, SlotBlackout.day < end_day)))
    booked = _booked_counts(db, datetime.combine(start_day, datetime.min.time()), datetime.combine(end_day, datetime.min.time()))

    slots: list[Slot] = []
    for offset in range(days):
        day = start_day + timedelta(days=offset)
        if day in blackouts or day > horizon:
            continue
        for t in by_weekday.get(day.weekday(), []):
            starts = datetime.combine(day, t.start)
            if starts < earliest:
                continue
            remaining = t.capacity - booked.get((t.id, starts), 0)
            slots.append(Slot(t.id, day, starts, datetime.combine(day, t.end), t.window_type, t.mode, t.fee_pence, max(0, remaining)))
    return slots


def reserve_slot(
    db: Session,
    *,
    template_id: int,
    day: date,
    client_id: int,
    kind: BookingKind,
    address_id: int | None,
    order_id: int | None = None,
    not_before: datetime | None = None,
    notes: str = "",
) -> Booking:
    """Create a booking if the slot is valid and has room. Caller commits."""
    # Lock the template row so two clients can't take the last place at once (Postgres; SQLite serialises writes).
    template = db.scalar(select(SlotTemplate).where(SlotTemplate.id == template_id).with_for_update())
    if not template or not template.active or template.weekday != day.weekday():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That time slot isn't offered on this day.")

    match = next(
        (s for s in available_slots(db, day, 1, template.window_type, template.mode, not_before) if s.template_id == template_id),
        None,
    )
    if not match:
        raise HTTPException(status.HTTP_409_CONFLICT, "That slot is no longer available. Pick another time.")
    if match.remaining <= 0:
        raise HTTPException(status.HTTP_409_CONFLICT, "That slot has just been fully booked. Pick another time.")
    if template.mode == BookingMode.lave_collects and not address_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Choose the address we should visit.")

    booking = Booking(
        client_id=client_id,
        order_id=order_id,
        template_id=template.id,
        kind=kind,
        mode=template.mode,
        window_type=template.window_type,
        address_id=address_id if template.mode == BookingMode.lave_collects else None,
        starts_at=match.starts_at,
        ends_at=match.ends_at,
        fee_pence=template.fee_pence,
        notes=notes,
    )
    db.add(booking)
    db.flush()
    return booking
