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
from app.site.account_routes import current_site_client
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
    if post.kind == "event":
        from app.services import experiences as exp
        return RedirectResponse(exp.url(post), status_code=301)
    more = [p for p in cms.published(db, post.kind, limit=4) if p.id != post.id][:3]
    return render(request, "site/post.html", section=LAVEWORLD, subnav=LAVEWORLD.subnav[1], post=post, more=more,
                  is_draft=post.status.value != "published", **_ctx())


@router.get("/memberships/access/{item_slug}/", response_class=HTMLResponse)
def experiences(request: Request, item_slug: str, db: Session = Depends(get_db)):
    MEMBERSHIP = request.state.site.by_key["membership"]
    if item_slug in ("lifestyle", "sport"):  # the tabs before experiences were grouped by who they're for
        return RedirectResponse("/memberships/access/upcoming-events/", status_code=301)
    if item_slug in cms.OLD_AUDIENCES:  # Families, Founders… (12 November 2026): to the group they belong to now
        return RedirectResponse(f"/memberships/access/{cms.OLD_AUDIENCES[item_slug]}/", status_code=301)
    if item_slug != "upcoming-events" and item_slug not in cms.AUDIENCES:
        return item_page(request, "memberships", "access", item_slug, db)
    from app.services import experiences as exp
    group = None if item_slug == "upcoming-events" else item_slug
    page = request.state.site.page("experiences")
    # One row per experience, photo on the left: dated events from the Journal first, then those that run all year.
    dated = [{"title": p.title, "eyebrow": (p.event_theme or "LAVE Experiences").capitalize(), "members": p.members_only,
              "when": cms.event_when(p.event_starts_at, p.event_ends_at), "where": p.event_location, "who": "",
              "text": p.excerpt, "note": p.event_note, "image": p.cover_image,
              "link_label": "Find out more", "link_href": exp.url(p)} for p in cms.upcoming_events(db, group)]
    ongoing = [{**o, "members": False, "where": "", "note": ""} for o in page["ongoing"]
               if not group or group in cms.audiences(o.get("groups", ""))]
    return render(request, "site/experiences.html", section=MEMBERSHIP, subnav=MEMBERSHIP.subnav[3], page=page,
                  heading=page["title"] + (f": {cms.AUDIENCES[group]}" if group else ""), group=group or "",
                  audiences=cms.AUDIENCES, dated=dated, ongoing=ongoing, **_ctx())


# One experience: its page, reserving a place, giving it up, and its calendar file (services/experiences.py)

def _event(db: Session, slug: str, include_drafts: bool = False):
    p = cms.post_by_slug(db, slug, include_drafts=include_drafts)
    if not p or p.kind != "event" or not p.event_starts_at:
        raise HTTPException(404)
    return p


@router.get("/memberships/access/upcoming-events/{slug}/", response_class=HTMLResponse)
def event_page(request: Request, slug: str, lave_staff: str | None = Cookie(default=None),
               client=Depends(current_site_client), db: Session = Depends(get_db)):
    from app.services import experiences as exp, members
    preview = _is_staff(db, lave_staff)
    p = _event(db, slug, include_drafts=preview)
    MEMBERSHIP = request.state.site.by_key["membership"]
    mine = exp.mine(db, p, client)
    image = cms.image(p.cover_image)
    more = [{"title": x.title, "eyebrow": (x.event_theme or "LAVE Experiences").capitalize(), "members": x.members_only,
             "when": cms.event_when(x.event_starts_at, x.event_ends_at), "where": x.event_location, "who": "",
             "text": x.excerpt, "note": "", "image": x.cover_image, "link_label": "Find out more", "link_href": exp.url(x)}
            for x in exp.more(db, p)]
    for_whom = [cms.AUDIENCES[a] for a in cms.audiences(p.event_audiences)]
    return render(request, "site/event.html", section=MEMBERSHIP, subnav=MEMBERSHIP.subnav[3], crumb=p.title,
                  crumbs=[("Home", "/"), (MEMBERSHIP.title, MEMBERSHIP.path), ("LAVE Experiences", "/memberships/access/upcoming-events/"),
                          (p.title, exp.url(p))],
                  e=p, when=cms.event_when(p.event_starts_at, p.event_ends_at), image=image, for_whom=for_whom,
                  past=exp.is_past(p), left=exp.places_left(db, p), mine=mine,
                  show_address=bool(p.event_address) and (not p.event_address_private or (mine and mine.status == exp.CONFIRMED)),
                  signed_in=bool(client), member=bool(client and members.is_member(client)),
                  included=exp.lines(p.event_included), bring=exp.lines(p.event_bring), timings=exp.timings(p.event_timings),
                  good_to_know=exp.lines(p.event_good_to_know), page=request.state.site.page("experiences"),
                  more=more, is_draft=p.status.value != "published", event_ld=exp.jsonld(p, image),
                  notice=request.query_params.get("done", ""), error=request.query_params.get("error", "")[:200], **_ctx())


@router.post("/memberships/access/upcoming-events/{slug}/reserve")
def event_reserve(slug: str, places: int = Form(1), note: str = Form(""), client=Depends(current_site_client),
                  db: Session = Depends(get_db)):
    from app.services import experiences as exp
    p = _event(db, slug)
    if not client:
        return RedirectResponse(f"/account/login/?next={exp.url(p)}", status_code=303)
    try:
        res = exp.reserve(db, p, client, places, note)
    except HTTPException as e:  # full, members only, already reserved: say so on the page
        from urllib.parse import quote
        return RedirectResponse(f"{exp.url(p)}?error={quote(str(e.detail))}#reserve", status_code=303)
    db.commit()
    exp.notify(res, res.status)
    return RedirectResponse(f"{exp.url(p)}?done={res.status}#reserve", status_code=303)


@router.post("/memberships/access/upcoming-events/{slug}/cancel")
def event_cancel(slug: str, client=Depends(current_site_client), db: Session = Depends(get_db)):
    from app.services import experiences as exp
    p = _event(db, slug)
    res = exp.mine(db, p, client)
    if not res:
        return RedirectResponse(exp.url(p), status_code=303)
    moved = exp.cancel(db, res)
    db.commit()
    exp.notify(res, "cancelled")
    for m in moved:
        exp.notify(m, "promoted")
    return RedirectResponse(f"{exp.url(p)}?done=cancelled#reserve", status_code=303)


@router.get("/memberships/access/upcoming-events/{slug}/calendar.ics")
def event_calendar(slug: str, client=Depends(current_site_client), db: Session = Depends(get_db)):
    from app.services import experiences as exp
    p = _event(db, slug)
    mine = exp.mine(db, p, client)
    return Response(exp.ics(p, bool(mine and mine.status == exp.CONFIRMED)), media_type="text/calendar",
                    headers={"Content-Disposition": f'attachment; filename="LAVE-{p.slug}.ics"'})


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

TOPICS = ["Booking or an order", "Membership", "LAVE Privé", "Resell enquiry", "Consign a piece", "Business enquiry", "Press",
          "Something else"]
TOPIC_LINKS = {"membership": "Membership", "prive": "LAVE Privé", "resell": "Resell enquiry", "consign": "Consign a piece"}


@router.get("/contact/", response_class=HTMLResponse)
def contact_form(request: Request, topic: str = "", sent: str = "", piece: str = "", ask: str = "",
                 db: Session = Depends(get_db)):
    preset = TOPIC_LINKS.get(topic, "")
    form = {}
    if piece:  # "Enquire about this piece" on a Resell piece
        from app.services import resell
        if found := resell.by_slug(db, piece):
            name = " ".join(x for x in (found.designer, found.title) if x)
            question = "Could we arrange a private viewing?" if ask == "viewing" else "Could you tell me more about it?"
            form["message"] = (f"I'm interested in the {name}"
                               f" (lavelondon.com/atelier/rehome/resell/{found.slug}/). {question}")
    return render(request, "site/contact.html", crumb="Contact", topics=TOPICS, preset=preset, sent=bool(sent), error="", form=form)


@router.post("/contact/", response_class=HTMLResponse)
def contact_send(request: Request, name: str = Form(""), email: str = Form(""), topic: str = Form(""), message: str = Form(""),
                 website: str = Form(""), db: Session = Depends(get_db)):
    form = {"name": name, "email": email, "topic": topic, "message": message}
    if website:  # honeypot
        return RedirectResponse("/contact/?sent=1", status_code=303)
    email = email.strip().lower()
    if not name.strip() or not valid_email(email) or len(message.strip()) < 5:
        return render(request, "site/contact.html", crumb="Contact", status_code=400, topics=TOPICS, preset=topic, sent=False, form=form,
                      error="Enter your name, a valid email and a message.")
    ip = request.client.host if request.client else "unknown"
    if not allow(f"contact:{ip}", limit=5, window_seconds=3600):
        return render(request, "site/contact.html", crumb="Contact", status_code=429, topics=TOPICS, preset=topic, sent=False, form=form,
                      error="You've sent several messages already. We'll be in touch soon.")
    db.add(ContactMessage(name=name.strip()[:120], email=email[:255], topic=(topic if topic in TOPICS else "Something else"),
                          message=message.strip()[:5000]))
    db.commit()
    mailer.send(get_settings().contact_address, f"Website message: {topic or 'General'} from {name.strip()}",
                f"From: {name.strip()} <{email}>\nTopic: {topic}\n\n{message.strip()}", reply_to=email)
    return RedirectResponse("/contact/?sent=1", status_code=303)


@router.get("/policies/", response_class=HTMLResponse)
def policies(request: Request, db: Session = Depends(get_db)):
    page = cms.page(db, "/policies/")
    return render(request, "site/content_page.html", section=None, subnav=None, page=page, crumb=page.title if page else "Policies", policies_fallback=page is None, **_ctx())


@router.get("/policies/{slug}/", response_class=HTMLResponse)
def policy(request: Request, slug: str, db: Session = Depends(get_db)):
    page = cms.page(db, f"/policies/{slug}/")
    if not page:
        from starlette.exceptions import HTTPException as StarletteHTTPException
        raise StarletteHTTPException(404)
    return render(request, "site/content_page.html", section=None, subnav=None, page=page,
                  crumbs=[("Home", "/"), ("Policies", "/policies/"), (page.title, f"/policies/{slug}/")], **_ctx())


@router.get("/memberships/living/", response_class=HTMLResponse)
def lave_living(request: Request, db: Session = Depends(get_db)):
    page = cms.page(db, "/memberships/living/")
    if not page:
        from starlette.exceptions import HTTPException as StarletteHTTPException
        raise StarletteHTTPException(404)
    section = request.state.site.by_key["membership"]
    benefits = next((s for s in section.subnav if s.slug == "benefits"), None)
    plan_links = {p["name"]: f"/memberships/#{p['code']}" for p in request.state.site.plans}
    return render(request, "site/living.html", section=section, subnav=benefits, page=page, layout=cms.landing(page.body),
                  plan_links=plan_links, **_ctx())


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
