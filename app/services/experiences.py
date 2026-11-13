"""LAVE Experiences: each event's own page, and reserving a place.

An event is a Journal post (kind "event"). Its page is /memberships/access/upcoming-events/<slug>/. Without a
booking link of its own, members reserve here: a place is confirmed while there's room (event_capacity; 0 means no
limit), otherwise they join the waiting list, and a place given up goes to the first on the list who fits. Each step
sends an email; confirmations carry a calendar invite. Reminders go the evening before, with the booking reminders.
"""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Client, EventReservation, Post, PostStatus
from app.services import content as cms
from app.services import letters
from app.services.clock import local_now

LONDON = ZoneInfo("Europe/London")
CONFIRMED, WAITLIST, CANCELLED = "confirmed", "waitlist", "cancelled"
REMIND_FROM_HOUR = 17


def url(p: Post) -> str:
    return f"/memberships/access/upcoming-events/{p.slug}/"


def lines(text: str) -> list[str]:
    return [x.strip() for x in (text or "").splitlines() if x.strip()]


def timings(text: str) -> list[tuple[str, str]]:
    """"6.30pm  Arrival" (two spaces or a tab between) as ("6.30pm", "Arrival"); a line without a time keeps it all."""
    import re
    out = []
    for line in lines(text):
        parts = re.split(r"\s{2,}|\t", line, maxsplit=1)
        out.append((parts[0], parts[1]) if len(parts) == 2 else ("", line))
    return out


def is_past(p: Post, now: datetime | None = None) -> bool:
    end = p.event_ends_at or p.event_starts_at
    return bool(end and end < (now or local_now()))


def has_started(p: Post, now: datetime | None = None) -> bool:
    """Attendance can be marked from the day the event starts, so staff can tick guests off at the door."""
    return bool(p.event_starts_at and p.event_starts_at.date() <= (now or local_now()).date())


def mark_attendance(res: EventReservation, attended: bool | None) -> None:
    if res.status == CANCELLED:
        raise HTTPException(409, "This place was cancelled.")
    if not has_started(res.post):
        raise HTTPException(409, "Attendance can be marked from the day of the event.")
    res.attended = attended
    res.attendance_marked_at = local_now() if attended is not None else None


def add_walk_in(db: Session, p: Post, client: Client, places: int = 1) -> EventReservation:
    """Record a guest who came without reserving. They count as confirmed and attended; capacity and the
    members-only rule don't apply (they're already in the room) and nobody is emailed. Caller commits."""
    if not has_started(p):
        raise HTTPException(409, "Walk-in guests can be added from the day of the event.")
    res = db.scalar(select(EventReservation).where(EventReservation.post_id == p.id, EventReservation.client_id == client.id))
    if res is not None and res.status != CANCELLED:
        raise HTTPException(409, f"{client.full_name} is already on the guest list. Mark them as Came instead.")
    if res is None:
        res = EventReservation(post_id=p.id, client_id=client.id)
        db.add(res)
    now = local_now()
    res.places, res.note, res.status, res.walk_in = places, "", CONFIRMED, True
    res.created_at, res.confirmed_at, res.cancelled_at = now, now, None
    res.attended, res.attendance_marked_at = True, now
    db.flush()
    return res


def attendance_label(res: EventReservation, now: datetime | None = None) -> str:
    """How a reservation reads on the client's profile."""
    if res.status == CANCELLED:
        return "Cancelled"
    if res.attended is True:
        return "Attended"
    if res.attended is False:
        return "Didn't come"
    if not has_started(res.post, now):
        return "Going" if res.status == CONFIRMED else "Waiting list"
    return "Not marked" if res.status == CONFIRMED else "Waiting list"


def taken(db: Session, p: Post) -> int:
    return db.scalar(select(func.coalesce(func.sum(EventReservation.places), 0)).where(
        EventReservation.post_id == p.id, EventReservation.status == CONFIRMED)) or 0


def places_left(db: Session, p: Post) -> int | None:
    """None when there's no limit."""
    return max(0, p.event_capacity - taken(db, p)) if p.event_capacity else None


def mine(db: Session, p: Post, client: Client | None) -> EventReservation | None:
    if not client:
        return None
    return db.scalar(select(EventReservation).where(EventReservation.post_id == p.id, EventReservation.client_id == client.id,
                                                    EventReservation.status != CANCELLED))


def may_reserve(p: Post, client: Client) -> None:
    from app.services import members
    if p.status != PostStatus.published or p.kind != "event":
        raise HTTPException(404, "Experience not found.")
    if p.event_link:
        raise HTTPException(409, "Places for this experience are booked through its own link.")
    if is_past(p):
        raise HTTPException(409, "This experience has already taken place.")
    if p.members_only and not members.is_member(client):
        raise HTTPException(403, "This experience is for LAVE members.")


def reserve(db: Session, p: Post, client: Client, places: int = 1, note: str = "") -> EventReservation:
    """A place if there's room, else the waiting list. Caller commits, then sends `notify(res)`."""
    may_reserve(p, client)
    each = max(1, p.event_places_each or 1)
    if not 1 <= places <= each:
        raise HTTPException(400, f"You can reserve up to {each} place{'s' if each > 1 else ''}.")
    if mine(db, p, client):
        raise HTTPException(409, "You already have a place, or a place on the waiting list.")
    res = db.scalar(select(EventReservation).where(EventReservation.post_id == p.id, EventReservation.client_id == client.id))
    if res is None:
        res = EventReservation(post_id=p.id, client_id=client.id)
        db.add(res)
    left = places_left(db, p)
    res.places, res.note, res.cancelled_at, res.reminded_at = places, note.strip()[:300], None, None
    res.created_at = local_now()
    if left is None or left >= places:
        res.status, res.confirmed_at = CONFIRMED, local_now()
    else:
        res.status, res.confirmed_at = WAITLIST, None
    db.flush()
    return res


def cancel(db: Session, res: EventReservation) -> list[EventReservation]:
    """Give up a place (or leave the waiting list). Returns those moved up from the waiting list, to email.
    Caller commits."""
    was_confirmed = res.status == CONFIRMED
    res.status, res.cancelled_at = CANCELLED, local_now()
    db.flush()
    return promote(db, res.post) if was_confirmed else []


def promote(db: Session, p: Post) -> list[EventReservation]:
    """Fill free places from the waiting list, first come first served (stopping at the first who doesn't fit)."""
    if is_past(p):
        return []
    moved = []
    waiting = db.scalars(select(EventReservation).where(EventReservation.post_id == p.id, EventReservation.status == WAITLIST)
                         .order_by(EventReservation.created_at, EventReservation.id)).all()
    for res in waiting:
        left = places_left(db, p)
        if left is not None and left < res.places:
            break
        res.status, res.confirmed_at = CONFIRMED, local_now()
        db.flush()
        moved.append(res)
    return moved


# Calendar invites

def _ics_text(s: str) -> str:
    return (s or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def _fold(line: str) -> list[str]:
    out, raw = [], line.encode()
    while len(raw) > 74:
        cut = 74
        while (raw[cut] & 0xC0) == 0x80:  # don't split a character
            cut -= 1
        out.append(raw[:cut].decode())
        raw = b" " + raw[cut:]
    return out + [raw.decode()]


def ics(p: Post, with_address: bool) -> str:
    """One event, for Apple, Google and Outlook calendars. The address only where it may be shown."""
    start, end = p.event_starts_at, p.event_ends_at
    all_day = not (start.hour or start.minute) and not (end and (end.hour or end.minute))
    if all_day:
        when = [f"DTSTART;VALUE=DATE:{start:%Y%m%d}", f"DTEND;VALUE=DATE:{((end or start) + timedelta(days=1)):%Y%m%d}"]
    else:
        def utc(d):
            return d.replace(tzinfo=LONDON).astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        when = [f"DTSTART:{utc(start)}", f"DTEND:{utc(end if end and end > start else start + timedelta(hours=2))}"]
    site = get_settings().site_url.rstrip("/")
    place = ", ".join(x for x in (p.event_location, p.event_address if with_address or not p.event_address_private else "") if x)
    body = [
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//LAVE//LAVE Experiences//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
        "BEGIN:VEVENT", f"UID:lave-experience-{p.id}@lavelondon.com",
        f"DTSTAMP:{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}", *when,
        f"SUMMARY:{_ics_text(p.title)}", f"DESCRIPTION:{_ics_text((p.excerpt + chr(10) + chr(10) if p.excerpt else '') + site + url(p))}",
        *([f"LOCATION:{_ics_text(place)}"] if place else []), f"URL:{site}{url(p)}",
        "END:VEVENT", "END:VCALENDAR",
    ]
    return "\r\n".join(part for line in body for part in _fold(line)) + "\r\n"


# Emails

def _when(p: Post) -> str:
    return cms.event_when(p.event_starts_at, p.event_ends_at)


def _where(p: Post) -> str:
    return ", ".join(x for x in (p.event_location, p.event_address) if x)


def notify(res: EventReservation, kind: str) -> bool:
    """kind: confirmed | waitlist | promoted | cancelled | cancelled_by_lave | reminder."""
    p, c = res.post, res.client
    if not c.email:
        return False
    site = get_settings().site_url.rstrip("/")
    page = letters.Button("View the experience", site + url(p))
    places = f"{res.places} place{'s' if res.places > 1 else ''}"
    details = letters.Table([("When", _when(p)), *([("Where", _where(p))] if _where(p) else []), ("Places", str(res.places))])
    invite = [(f"LAVE-{p.slug}.ics", ics(p, True).encode(), "text/calendar")]
    if kind in ("confirmed", "promoted"):
        first = (f"Good news: a place has opened up, and {places} at {p.title} are now yours." if kind == "promoted"
                 else f"Your {places} at {p.title} {'is' if res.places == 1 else 'are'} confirmed.")
        return letters.send(c.email, f"Your place at {p.title}", c.first_name, [
            first, details, "The calendar invite is attached. If your plans change, please give up your place from the "
            "experience's page, so someone on the waiting list can come.", page,
        ], letters.SOON, attachments=invite)
    if kind == "waitlist":
        return letters.send(c.email, f"You're on the waiting list for {p.title}", c.first_name, [
            f"{p.title} is full for now, so we've added you to the waiting list for {places}.",
            "If a place opens up, it's yours automatically and we'll email you straight away.", page,
        ], letters.SOON)
    if kind == "reminder":
        return letters.send(c.email, f"Tomorrow: {p.title}", c.first_name, [
            f"A reminder that {p.title} is tomorrow. We look forward to seeing you.", details,
            *(["What to bring: " + "; ".join(lines(p.event_bring)) + "."] if lines(p.event_bring) else []),
            "If you can no longer come, please give up your place from the experience's page.", page,
        ], letters.SOON, attachments=invite)
    if kind in ("cancelled", "cancelled_by_lave"):
        first = ("We've cancelled your reservation" if kind == "cancelled_by_lave" else "You've given up your reservation")
        return letters.send(c.email, f"Your reservation for {p.title} is cancelled", c.first_name, [
            f"{first} for {p.title} on {_when(p)}.", "We hope to see you at another LAVE Experience soon.",
            letters.Button("See LAVE Experiences", site + "/memberships/access/upcoming-events/"),
        ], letters.SOON)
    raise ValueError(kind)


def send_reminders(db: Session, now: datetime | None = None) -> int:
    """From 5pm, remind confirmed guests about tomorrow's experiences, once each."""
    now = now or local_now()
    if now.hour < REMIND_FROM_HOUR:
        return 0
    tomorrow = datetime.combine(now.date() + timedelta(days=1), datetime.min.time())
    due = db.scalars(select(EventReservation).join(Post).where(
        EventReservation.status == CONFIRMED, EventReservation.reminded_at.is_(None),
        Post.event_starts_at >= tomorrow, Post.event_starts_at < tomorrow + timedelta(days=1))).all()
    sent = 0
    for res in due:
        # Claim it first, so two copies of the website running side by side during a deploy can't both send it.
        claimed = db.execute(update(EventReservation).where(EventReservation.id == res.id, EventReservation.reminded_at.is_(None))
                             .values(reminded_at=now)).rowcount
        db.commit()
        if claimed == 1:
            notify(res, "reminder")
            sent += 1
    return sent


# The page

def jsonld(p: Post, image: str) -> dict:
    """schema.org Event, so search engines can list it with its date."""
    site = get_settings().site_url.rstrip("/")
    place = {"@type": "Place", "name": p.event_location or "London",
             "address": p.event_address if p.event_address and not p.event_address_private else "London, United Kingdom"}
    out = {"@context": "https://schema.org", "@type": "Event", "name": p.title, "description": p.excerpt,
           "startDate": p.event_starts_at.replace(tzinfo=LONDON).isoformat(),
           "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode",
           "eventStatus": "https://schema.org/EventScheduled", "location": place, "url": site + url(p),
           "organizer": {"@type": "Organization", "name": "LAVE", "url": site}}
    if p.event_ends_at:
        out["endDate"] = p.event_ends_at.replace(tzinfo=LONDON).isoformat()
    if image:
        out["image"] = [image if image.startswith("http") else site + image]
    return out


def more(db: Session, p: Post, limit: int = 3) -> list[Post]:
    return [x for x in cms.upcoming_events(db) if x.id != p.id][:limit]
