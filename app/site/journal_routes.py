"""LAVEWorld, the THREAD by LAVE journal, LAVE Experiences events, and the contact page."""
from datetime import timezone
from email.utils import format_datetime
from xml.sax.saxutils import escape

from fastapi import APIRouter, Cookie, Depends, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from sqlalchemy.orm import Session

from app.auth import current_staff
from app.config import get_settings
from app.db import get_db
from app.models import ContactMessage
from app.services import content as cms
from app.services import mailer
from app.services.accounts import valid_email, allow
from app.site import content
from app.site.routes import item_page, render
from app.site.store import site_dependency

router = APIRouter(include_in_schema=False, dependencies=[Depends(site_dependency)])
KIND_SLUGS = {"thread-by-lave": "thread", "events": "event", "press": "press"}


def _is_staff(db: Session, token: str | None) -> bool:
    if not token:
        return False
    try:
        current_staff(authorization=None, lave_staff=token, db=db)
        return True
    except HTTPException:
        return False


def _ctx():
    return {"md": cms.render_markdown, "cover": cms.image, "kinds": cms.KINDS}


@router.get("/laveworld/", response_class=HTMLResponse)
def laveworld(request: Request, db: Session = Depends(get_db)):
    LAVEWORLD = request.state.site.by_key["laveworld"]
    pages = [p for p in (cms.page(db, path) for path in [
        "/laveworld/story/purpose/", "/laveworld/impact/people/", "/laveworld/impact/planet/", "/laveworld/impact/principles/"]) if p]
    return render(request, "site/laveworld.html", section=LAVEWORLD, page=request.state.site.page("laveworld"), posts=cms.published(db, limit=3),
                  events=cms.upcoming_events(db)[:3], pages=pages, **_ctx())


@router.get("/laveworld/knowledge/", response_class=HTMLResponse)
def journal(request: Request, db: Session = Depends(get_db)):
    LAVEWORLD = request.state.site.by_key["laveworld"]
    return render(request, "site/journal.html", section=LAVEWORLD, subnav=LAVEWORLD.subnav[1], heading="Journal",
                  current="", posts=cms.published(db), **_ctx())


@router.get("/laveworld/knowledge/{kind_slug}/", response_class=HTMLResponse)
def journal_kind(request: Request, kind_slug: str, db: Session = Depends(get_db)):
    LAVEWORLD = request.state.site.by_key["laveworld"]
    kind = KIND_SLUGS.get(kind_slug)
    if not kind:
        raise HTTPException(404)
    if kind == "event":
        upcoming = cms.upcoming_events(db)
        posts = upcoming + [p for p in cms.published(db, "event") if p not in upcoming]
    else:
        posts = cms.published(db, kind)
    return render(request, "site/journal.html", section=LAVEWORLD, subnav=LAVEWORLD.subnav[1], heading=cms.KINDS[kind],
                  current=kind_slug, posts=posts, **_ctx())


@router.get("/journal/", include_in_schema=False)
def journal_index():
    return RedirectResponse("/laveworld/knowledge/", status_code=301)


@router.get("/journal/feed.xml")
def feed(db: Session = Depends(get_db)):
    site = get_settings().site_url
    items = "".join(
        f"<item><title>{escape(p.title)}</title><link>{site}/journal/{p.slug}/</link><guid>{site}/journal/{p.slug}/</guid>"
        f"<pubDate>{format_datetime(p.published_at.replace(tzinfo=timezone.utc))}</pubDate>"
        f"<description>{escape(p.excerpt)}</description></item>"
        for p in cms.published(db, limit=30))
    xml = (f'<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>THREAD by LAVE</title>'
           f"<link>{site}/laveworld/knowledge/</link><description>Notes on textile care from LAVE.</description>{items}</channel></rss>")
    return Response(xml, media_type="application/rss+xml")


@router.get("/journal/{slug}/", response_class=HTMLResponse)
def post_page(request: Request, slug: str, lave_staff: str | None = Cookie(default=None), db: Session = Depends(get_db)):
    LAVEWORLD = request.state.site.by_key["laveworld"]
    preview = _is_staff(db, lave_staff)
    post = cms.post_by_slug(db, slug, include_drafts=preview)
    if not post:
        raise HTTPException(404)
    more = [p for p in cms.published(db, post.kind, limit=4) if p.id != post.id][:3]
    return render(request, "site/post.html", section=LAVEWORLD, subnav=LAVEWORLD.subnav[1], post=post, more=more,
                  is_draft=post.status.value != "published", **_ctx())


@router.get("/memberships/access/{item_slug}/", response_class=HTMLResponse)
def experiences(request: Request, item_slug: str, db: Session = Depends(get_db)):
    MEMBERSHIP = request.state.site.by_key["membership"]
    themes = {"lifestyle": "lifestyle", "sport": "sport", "upcoming-events": None}
    if item_slug not in themes:
        return item_page(request, "memberships", "access", item_slug, db)
    theme = themes[item_slug]
    return render(request, "site/journal.html", section=MEMBERSHIP, subnav=MEMBERSHIP.subnav[3],
                  heading="LAVE Experiences" + (f": {theme.capitalize()}" if theme else ""), current="",
                  posts=cms.upcoming_events(db, theme), events_mode=True, **_ctx())


@router.get("/laveworld/{sub_slug}/{item_slug}/", response_class=HTMLResponse)
def laveworld_page(request: Request, sub_slug: str, item_slug: str, db: Session = Depends(get_db)):
    LAVEWORLD = request.state.site.by_key["laveworld"]
    if sub_slug == "connect" and item_slug == "events":
        return RedirectResponse("/laveworld/knowledge/events/", status_code=301)
    if sub_slug == "connect" and item_slug == "contact":
        return RedirectResponse("/contact/", status_code=301)
    page = cms.page(db, f"/laveworld/{sub_slug}/{item_slug}/")
    sub = next((s for s in LAVEWORLD.subnav if s.slug == sub_slug), None)
    if not page:
        # Hidden or not yet written: a holding page, as long as the menu links here.
        linked = sub and any(href == f"/laveworld/{sub_slug}/{item_slug}/" for c in sub.columns for _, href in c.items(LAVEWORLD.path, sub.slug))
        if linked:
            return render(request, "site/subnav.html", section=LAVEWORLD, subnav=sub, item=item_slug.replace("-", " ").capitalize())
        return item_page(request, "laveworld", sub_slug, item_slug, db)
    return render(request, "site/content_page.html", section=LAVEWORLD, subnav=sub, page=page, **_ctx())


# Contact and policies

TOPICS = ["Booking or an order", "Membership", "LAVE Privé", "Business enquiry", "Press", "Something else"]


@router.get("/contact/", response_class=HTMLResponse)
def contact_form(request: Request, topic: str = "", sent: str = ""):
    preset = "LAVE Privé" if topic == "prive" else ""
    return render(request, "site/contact.html", topics=TOPICS, preset=preset, sent=bool(sent), error="", form={})


@router.post("/contact/", response_class=HTMLResponse)
def contact_send(request: Request, name: str = Form(""), email: str = Form(""), topic: str = Form(""), message: str = Form(""),
                 website: str = Form(""), db: Session = Depends(get_db)):
    form = {"name": name, "email": email, "topic": topic, "message": message}
    if website:  # honeypot
        return RedirectResponse("/contact/?sent=1", status_code=303)
    email = email.strip().lower()
    if not name.strip() or not valid_email(email) or len(message.strip()) < 5:
        return render(request, "site/contact.html", status_code=400, topics=TOPICS, preset=topic, sent=False, form=form,
                      error="Enter your name, a valid email and a message.")
    ip = request.client.host if request.client else "unknown"
    if not allow(f"contact:{ip}", limit=5, window_seconds=3600):
        return render(request, "site/contact.html", status_code=429, topics=TOPICS, preset=topic, sent=False, form=form,
                      error="You've sent several messages already. We'll be in touch soon.")
    db.add(ContactMessage(name=name.strip()[:120], email=email[:255], topic=(topic if topic in TOPICS else "Something else"),
                          message=message.strip()[:5000]))
    db.commit()
    mailer.send("care@lavelondon.com", f"Website message: {topic or 'General'} from {name.strip()}",
                f"From: {name.strip()} <{email}>\nTopic: {topic}\n\n{message.strip()}", reply_to=email)
    return RedirectResponse("/contact/?sent=1", status_code=303)


@router.get("/policies/", response_class=HTMLResponse)
def policies(request: Request, db: Session = Depends(get_db)):
    page = cms.page(db, "/policies/")
    return render(request, "site/content_page.html", section=None, subnav=None, page=page, policies_fallback=page is None, **_ctx())


@router.get("/memberships/{sub_slug}/{item_slug}/")
def membership_item(request: Request, sub_slug: str, item_slug: str, db: Session = Depends(get_db)):
    """Membership menu links land on the right part of the Membership page."""
    from app.plans import gbp
    from app.site.content import slugify
    PLANS = request.state.site.plans
    if sub_slug == "plans":
        code = next((p["code"] for p in PLANS if item_slug in (slugify(p["name"]), slugify(gbp(p["price_pence"]) + " a month"),
                                                                 slugify(gbp(p["annual_pence"]) + " a year"))), None)
        return RedirectResponse(f"/memberships/#{code}" if code else "/memberships/#plans-overview", status_code=302)
    if sub_slug in ("benefits", "discover"):
        return RedirectResponse("/memberships/#compare" if sub_slug == "benefits" else "/memberships/#plans-overview", status_code=302)
    return item_page(request, "memberships", sub_slug, item_slug, db)
