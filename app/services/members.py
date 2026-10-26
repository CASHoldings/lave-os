"""Members' experience: "Tell us about you", the dates that matter, and birthday gestures.

Everything a member tells us is optional and theirs to change or delete. LAVE OS suggests a birthday gesture from
what it knows (tier, what they send us most, care preferences, interests, household, occasions); the founder
approves it, changes it or skips it. Only an approved gesture reaches the member, by email on the day.
"""
from collections import Counter
from datetime import date, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (Client, ClientGesture, ClientOccasion, Garment, Membership, MembershipStatus, Order,
                        OrderStatus, Product, Service)
from app.services.clock import local_now

INTERESTS = ["Running", "Yoga", "Wellbeing", "Founder evenings", "Family outings", "Art & culture", "Food & coffee"]
CHANNELS = {"": "No preference", "text": "Text message", "email": "Email", "phone": "Phone call"}
LOOK_AHEAD_DAYS = 14   # what Today shows as coming up
REMIND_DAYS = 10       # the founder is emailed this many days before a birthday
# A birthday gesture's rough budget, by tier.
BUDGET = {"essence": 1500, "elevate": 3000, "eclat": 5000}


# "Tell us about you"

def _text(v, n: int) -> str:
    return str(v or "").strip()[:n]


def clean_about(data: dict) -> dict:
    household = []
    for h in (data.get("household") or [])[:8]:
        name = _text(h.get("name"), 60)
        if name:
            household.append({"name": name, "relation": _text(h.get("relation"), 40), "age": _text(h.get("age"), 10)})
    return {
        "preferred_name": _text(data.get("preferred_name"), 60),
        "contact_channel": data.get("contact_channel") if data.get("contact_channel") in CHANNELS else "",
        "contact_times": _text(data.get("contact_times"), 120),
        "household": household,
        "interests": [i for i in (data.get("interests") or []) if i in INTERESTS],
        "dietary": _text(data.get("dietary"), 300),
        "allergies": _text(data.get("allergies"), 300),
        "special_pieces": _text(data.get("special_pieces"), 800),
        "feature_ok": bool(data.get("feature_ok")),
    }


def valid_birthday(day, month) -> tuple[int | None, int | None]:
    if not day and not month:
        return None, None
    try:
        date(2000, int(month), int(day))  # 2000 is a leap year: 29 February is allowed
    except (TypeError, ValueError):
        raise HTTPException(400, "Choose a real day and month for your birthday.")
    return int(day), int(month)


def about(db: Session, client: Client) -> dict:
    occasions = db.scalars(select(ClientOccasion).where(ClientOccasion.client_id == client.id,
                                                        ClientOccasion.day >= local_now().date() - timedelta(days=1))
                           .order_by(ClientOccasion.day)).all()
    return {**clean_about(client.about or {}), "birthday_day": client.birthday_day, "birthday_month": client.birthday_month,
            "completed": bool(client.about_completed_at), "interest_options": INTERESTS, "channel_options": CHANNELS,
            "occasions": [{"id": o.id, "day": o.day.isoformat(), "title": o.title, "note": o.note} for o in occasions]}


def save_about(db: Session, client: Client, data: dict, by_member: bool = True) -> dict:
    client.birthday_day, client.birthday_month = valid_birthday(data.get("birthday_day"), data.get("birthday_month"))
    client.about = clean_about(data)
    if by_member:
        client.about_completed_at = client.about_completed_at or local_now()
    db.commit()
    return about(db, client)


def forget_about(db: Session, client: Client) -> None:
    """Delete everything from "Tell us about you" (the member asked)."""
    client.birthday_day = client.birthday_month = None
    client.about = {}
    for o in db.scalars(select(ClientOccasion).where(ClientOccasion.client_id == client.id)):
        db.delete(o)
    db.commit()


def add_occasion(db: Session, client: Client, day: date, title: str, note: str = "") -> ClientOccasion:
    if not title.strip():
        raise HTTPException(400, "Tell us what the occasion is.")
    o = ClientOccasion(client_id=client.id, day=day, title=title.strip()[:160], note=note.strip()[:1000])
    db.add(o)
    db.commit()
    return o


# The dates that matter

def is_member(client: Client) -> bool:
    m = client.membership
    return bool(m and m.status == MembershipStatus.active)


def next_birthday(client: Client, today: date) -> date | None:
    if not client.birthday_day or not client.birthday_month:
        return None
    for year in (today.year, today.year + 1):
        try:
            d = date(year, client.birthday_month, client.birthday_day)
        except ValueError:  # 29 February in a non-leap year: celebrate on the 28th
            d = date(year, 2, 28)
        if d >= today:
            return d
    return None


def upcoming(db: Session, today: date | None = None, days: int = LOOK_AHEAD_DAYS) -> list[dict]:
    """Members' birthdays, membership anniversaries and occasions in the next `days` days, soonest first."""
    today = today or local_now().date()
    end = today + timedelta(days=days)
    out = []
    members = db.scalars(select(Client).join(Membership).where(Membership.status == MembershipStatus.active)).all()
    for c in members:
        if (b := next_birthday(c, today)) and b <= end:
            g = ensure_gesture(db, c, b)
            out.append({"kind": "birthday", "day": b.isoformat(), "client": _who(c), "gesture": describe(g)})
        start = c.membership.created_at.date() if c.membership.created_at else None
        if start:
            for year in (today.year, today.year + 1):
                try:
                    ann = start.replace(year=year)
                except ValueError:
                    ann = date(year, 2, 28)
                if today <= ann <= end and year > start.year:
                    out.append({"kind": "anniversary", "day": ann.isoformat(), "client": _who(c),
                                "years": year - start.year})
    for o in db.scalars(select(ClientOccasion).where(ClientOccasion.day >= today, ClientOccasion.day <= end)):
        c = db.get(Client, o.client_id)
        out.append({"kind": "occasion", "day": o.day.isoformat(), "client": _who(c), "title": o.title, "note": o.note})
    db.commit()
    return sorted(out, key=lambda e: (e["day"], e["kind"]))


def _who(c: Client) -> dict:
    name = (c.about or {}).get("preferred_name") or c.first_name or c.email
    return {"id": c.id, "name": name, "full_name": c.full_name, "email": c.email,
            "plan": c.membership.plan.value if c.membership else None}


# Birthday gestures

def _pounds(p: int) -> str:
    return f"£{p / 100:.2f}".removesuffix(".00")


def _history(db: Session, client: Client) -> tuple[Counter, int]:
    """What the member sends us most (price-list categories), and how many orders they've had."""
    rows = db.execute(select(Service.product_category, Service.name).join(Garment, Garment.service_id == Service.id)
                      .join(Order, Order.id == Garment.order_id)
                      .where(Order.client_id == client.id, Order.status != OrderStatus.cancelled)).all()
    count = db.scalar(select(func.count()).select_from(Order).where(Order.client_id == client.id,
                                                                   Order.status != OrderStatus.cancelled)) or 0
    return Counter(cat or "Other" for cat, _ in rows), count


def _price(db: Session, name: str, fallback: int) -> int:
    return db.scalar(select(Service.price_pence).where(Service.name == name)) or fallback


def _gift(db: Session, unscented: bool) -> dict | None:
    """An Apothecary piece, unscented if that's what they prefer."""
    for name in ("Delicate Wash", "Laundry Detergent", "Fabric Spray"):
        p = db.scalar(select(Product).where(Product.name == name, Product.active.is_(True)))
        if not p:
            continue
        variants = [v for v in p.variants if v.active] or list(p.variants)
        if unscented:
            variants = [v for v in variants if "unscented" in (v.scent or v.size).lower()] or variants
        if variants:
            v = min(variants, key=lambda x: x.price_pence)
            label = f"{p.name} ({v.size}{' · ' + v.scent if v.scent and v.scent not in v.size else ''})"
            return {"kind": "gift", "title": f"A bottle of {label}", "value_pence": v.price_pence,
                    "detail": f"Delivered with their next collection, with a handwritten card."}
    return None


def suggest(db: Session, client: Client, on_day: date) -> dict:
    """A gesture that fits this member, the reasons for it, and alternatives to choose from."""
    a = clean_about(client.about or {})
    plan = client.membership.plan.value if client.membership else "essence"
    budget = BUDGET.get(plan, 1500)
    cats, orders = _history(db, client)
    prefs = client.preferences or {}
    unscented = prefs.get("fragrance") == "Unscented" or bool(a["allergies"]) or prefs.get("detergent") == "Sensitive skin"
    since = client.membership.created_at if client.membership else None
    months = max(1, (local_now() - since).days // 30) if since else 0
    reasons = [f"{plan.capitalize() if plan != 'eclat' else 'Éclat'} member"
               + (f" for {months} month{'s' if months != 1 else ''}" if since else "")]
    if orders:
        reasons.append(f"{orders} order{'s' if orders != 1 else ''} so far")

    # What they send most decides the main suggestion.
    top = cats.most_common(1)[0] if cats else None
    if top:
        total = sum(cats.values())
        reasons.append(f"Sends us mostly {top[0].lower()} ({top[1]} of {total} pieces)")
    category = top[0] if top else ""
    if "shirt" in category.lower() or "tops" in category.lower():
        value = 5 * _price(db, "Shirt, non-member hung", 599)
        main = {"kind": "credit", "title": "A pack of 5 shirts, on us",
                "detail": f"{_pounds(value)} of LAVE credit, enough for five shirts washed and pressed."}
    elif "knit" in category.lower():
        value = 2 * _price(db, "Knitwear, light", 1299)
        main = {"kind": "credit", "title": "A knitwear refresh, on us",
                "detail": f"{_pounds(value)} of LAVE credit: two knits cleaned and finished by hand."}
    elif "bed" in category.lower() or "duvet" in category.lower():
        value = _price(db, "Duvet, double", 3499)
        main = {"kind": "credit", "title": "Fresh bedding, on us",
                "detail": f"{_pounds(value)} of LAVE credit towards their bedding."}
    elif category:
        value = budget
        main = {"kind": "credit", "title": f"Their next {category.lower()} piece, on us",
                "detail": f"{_pounds(value)} of LAVE credit towards it."}
    else:
        value = budget
        main = {"kind": "credit", "title": "A birthday treat on their LAVE account",
                "detail": f"{_pounds(value)} of LAVE credit, used on their next booking."}
    main["value_pence"] = min(value, budget * 2)

    alternatives = []
    if gift := _gift(db, unscented):
        alternatives.append(gift)
        if unscented:
            reasons.append("Prefers unscented products or has sensitive skin")
    nearby = db.scalars(select(ClientOccasion).where(ClientOccasion.client_id == client.id,
                                                     ClientOccasion.day >= on_day - timedelta(days=7),
                                                     ClientOccasion.day <= on_day + timedelta(days=21))).first()
    if nearby:
        reasons.append(f"Preparing for {nearby.title} on {nearby.day:%d %B}")
        alternatives.insert(0, {"kind": "experience", "title": f"Priority care for {nearby.title}", "value_pence": 0,
                                "detail": "Their outfit cleaned, pressed and returned first, with a birthday card."})
    for interest, title in (("Running", "A guest place at the next Run Club, with a birthday coffee"),
                            ("Yoga", "A guest place at the next yoga session"),
                            ("Founder evenings", "A seat at the next Founders Lab evening")):
        if interest in a["interests"]:
            alternatives.append({"kind": "experience", "title": title, "value_pence": 0,
                                 "detail": "Invitation sent with their birthday note."})
            reasons.append(f"Enjoys {interest.lower()}")
            break
    children = [h["name"] for h in a["household"] if h["relation"].lower() in ("son", "daughter", "child")]
    if plan == "eclat" and children:
        alternatives.append({"kind": "experience", "title": "A LAVE Family visit for the household", "value_pence": 0,
                             "detail": f"A city visit for {', '.join(children)} and family."})
    if a["special_pieces"]:
        reasons.append("Has special pieces: " + a["special_pieces"][:80])
    alternatives.append({"kind": "note", "title": "A handwritten birthday card", "value_pence": 0,
                         "detail": "Tucked into their next delivery."})
    return {**main, "reasons": reasons, "alternatives": alternatives[:4]}


def ensure_gesture(db: Session, client: Client, on_day: date) -> ClientGesture:
    g = db.scalar(select(ClientGesture).where(ClientGesture.client_id == client.id, ClientGesture.occasion == "birthday",
                                              ClientGesture.year == on_day.year))
    if g and g.status != "suggested":
        return g  # decided: keep the founder's choice
    s = suggest(db, client, on_day)  # still waiting for review: follow what we know now
    if not g:
        g = ClientGesture(client_id=client.id, occasion="birthday", year=on_day.year, on_day=on_day)
        db.add(g)
    g.kind, g.title, g.detail, g.value_pence = s["kind"], s["title"], s["detail"], s["value_pence"]
    g.reasons, g.alternatives = s["reasons"], s["alternatives"]
    db.flush()
    return g


def describe(g: ClientGesture) -> dict:
    return {"id": g.id, "on_day": g.on_day.isoformat(), "kind": g.kind, "title": g.title, "detail": g.detail,
            "value_pence": g.value_pence, "reasons": g.reasons or [], "alternatives": g.alternatives or [],
            "status": g.status, "decided_by": g.decided_by, "sent": bool(g.sent_at)}


def decide(db: Session, g: ClientGesture, action: str, by: str, change: dict | None = None) -> ClientGesture:
    """approve (as suggested, or with changes) or skip. Nothing reaches the member until approved."""
    if g.sent_at:
        raise HTTPException(409, "This birthday has already been celebrated.")
    if action == "skip":
        g.status = "skipped"
    elif action == "approve":
        for k in ("kind", "title", "detail"):
            if change and change.get(k):
                setattr(g, k, str(change[k])[:2000] if k == "detail" else str(change[k])[:200])
        if change and change.get("value_pence") is not None:
            g.value_pence = max(0, int(change["value_pence"]))
        if g.kind not in ("credit", "gift", "experience", "note"):
            raise HTTPException(400, "Choose credit, gift, experience or note.")
        g.status = "approved"
    else:
        raise HTTPException(400, "Approve or skip.")
    g.decided_by, g.decided_at = by, local_now()
    db.commit()
    return g


def celebrate(db: Session, today: date | None = None) -> dict:
    """Runs daily: suggest gestures for birthdays coming up, remind the founder, and on the day send the approved
    gesture to the member (adding credit to their LAVE account where that's the gesture)."""
    from app.config import get_settings
    from app.services import billing, letters, mailer
    today = today or local_now().date()
    events = upcoming(db, today)
    due = db.scalars(select(ClientGesture).where(ClientGesture.status == "suggested", ClientGesture.reminded_at.is_(None),
                                                 ClientGesture.on_day <= today + timedelta(days=REMIND_DAYS),
                                                 ClientGesture.on_day >= today)).all()
    if due:
        lines = [f"{g.on_day:%A %d %B}: {_who(g.client)['full_name']} ({(g.client.membership.plan.value if g.client.membership else '').capitalize()})\n"
                 f"  Suggested: {g.title}. {g.detail}\n  Why: {'; '.join(g.reasons or [])}" for g in due]
        mailer.send(get_settings().contact_address, f"Members' birthdays coming up ({len(due)})",
                    "These birthdays are coming up. Approve the suggested gesture, choose another, or skip, in "
                    f"LAVE OS → Today:\n{get_settings().site_url}/admin#/today\n\n" + "\n\n".join(lines))
        for g in due:
            g.reminded_at = local_now()
    sent = 0
    for g in db.scalars(select(ClientGesture).where(ClientGesture.status == "approved", ClientGesture.sent_at.is_(None),
                                                    ClientGesture.on_day <= today)):
        c = g.client
        if g.kind == "credit" and g.value_pence:
            billing.add_credit(db, c, g.value_pence, f"Happy birthday from LAVE: {g.title}", by=g.decided_by)
        name = (c.about or {}).get("preferred_name") or c.first_name
        gift_line = (f"We've added {_pounds(g.value_pence)} to your LAVE account: {g.title.lower().removeprefix('a ')}. "
                     "It's used automatically on your next booking." if g.kind == "credit" else f"{g.title}. {g.detail}")
        letters.send(c.email, f"Happy birthday, {name}" if name else "Happy birthday from LAVE", name, [
            "Happy birthday from all of us at LAVE.",
            "Thank you for trusting us with the pieces you love. We'd like to mark your day with something small.",
            gift_line,
            letters.Button("Book a collection", f"{get_settings().site_url}/book/"),
        ], f"{letters.CARE} We look forward to caring for yours.")
        g.sent_at = local_now()
        sent += 1
    db.commit()
    return {"coming_up": len(events), "reminded": len(due), "sent": sent}
