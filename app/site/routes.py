"""Public website, rendered on the server so pages arrive complete and fast."""
import re
from datetime import date
from pathlib import Path

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import CLIENT_COOKIE, peek_client
from app.plans import gbp
from app.services import shop

BASKET_COOKIE = "lave_basket"
from app.db import get_db
from app.models import WaitlistEntry
from app.site import catalogue, content
from app.site.content import slugify
from app.site.store import site_dependency

TEMPLATES = Jinja2Templates(directory=Path(__file__).resolve().parent.parent / "templates")
TEMPLATES.env.filters["gbp"] = gbp
TEMPLATES.env.filters["gbp_whole"] = lambda pence: f"£{pence / 100:,.2f}"


def _bold(text: str):
    """Escape text, then turn **words** into bold. Used for short editable lines like the footer."""
    from markupsafe import Markup, escape
    return Markup(re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", str(escape(text or ""))))


TEMPLATES.env.filters["bold"] = _bold
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
ASSET_VERSION = "30"

router = APIRouter(include_in_schema=False, dependencies=[Depends(site_dependency)])
SOCIAL_ICONS = {name: icon for name, _url, icon in content.FOOTER["social"]}


def render(request: Request, template: str, status_code: int = 200, **ctx) -> HTMLResponse:
    viewer = peek_client(request.cookies.get(CLIENT_COOKIE))
    basket_count = sum(shop.parse_basket(request.cookies.get(BASKET_COOKIE)).values())
    site = request.state.site
    footer = dict(site.docs["footer"], social=[dict(x, icon=SOCIAL_ICONS.get(x["name"], "")) for x in site.docs["footer"]["social"]],
                  anagram=content.FOOTER["anagram"])
    base = {
        "site": site,
        "viewer": {"first_name": viewer.get("fn", "")} if viewer else None,
        "basket_count": basket_count,
        "sections": site.sections, "section": None, "subnav": None, "slug": slugify, "footer": footer,
        "logo_navy": content.LOGO_NAVY, "logo_white": content.LOGO_WHITE, "year": date.today().year,
        "asset_version": ASSET_VERSION, "image_url": catalogue.image_url,
    }
    return TEMPLATES.TemplateResponse(request, template, {**base, **ctx}, status_code=status_code)


def _section(request: Request, key: str):
    section = request.state.site.by_path.get(key)
    if not section:
        raise HTTPException(404)
    return section


@router.get("/", response_class=HTMLResponse)
def home(request: Request):
    return render(request, "site/home.html", home=request.state.site.docs["home"])


@router.get("/search/", response_class=HTMLResponse)
def search(request: Request, q: str = "", db: Session = Depends(get_db)):
    """Search services and menu pages by name."""
    q = q.strip()
    services, pages = [], []
    if len(q) >= 2:
        needle = q.lower()
        services = [s for s in catalogue.search(db, needle)]
        for sec in request.state.site.sections:
            for sub in sec.subnav:
                for col in sub.columns:
                    for label, href in col.items(sec.path, sub.slug):
                        if needle in label.lower() or needle in col.title.lower():
                            pages.append((f"{sec.title} · {sub.title}", label, href))
    return render(request, "site/search.html", q=q, services=services, pages=pages[:12])


@router.post("/waitlist/")
def join_waitlist(first_name: str = Form(""), surname: str = Form(""), email: str = Form(""), source: str = Form(""),
                  website: str = Form(""), db: Session = Depends(get_db)):
    if website:  # honeypot filled in: a bot
        return RedirectResponse("/apothecary/?waitlist=joined#waitlist", status_code=303)
    email = email.strip().lower()
    if not first_name.strip() or not EMAIL_RE.match(email):
        return RedirectResponse("/apothecary/?waitlist=error#waitlist", status_code=303)
    if not db.scalar(select(WaitlistEntry).where(WaitlistEntry.email == email)):
        db.add(WaitlistEntry(first_name=first_name.strip()[:120], surname=surname.strip()[:120], email=email[:255],
                             source=source.strip()[:60]))
        db.commit()
    return RedirectResponse("/apothecary/?waitlist=joined#waitlist", status_code=303)


@router.get("/atelier/services/{slug}/", response_class=HTMLResponse)
def service_page(request: Request, slug: str, db: Session = Depends(get_db)):
    service = catalogue.by_slug(db, slug)
    if not service:
        raise HTTPException(404)
    collection = (service.collections or [None])[0]
    group = catalogue.group_of(service)
    related = []
    if collection:
        related = [s for g, items in catalogue.for_collection(db, collection) if g == group for s in items if s.id != service.id][:4]
    atelier = request.state.site.by_key["atelier"]
    return render(request, "site/service.html", section=atelier, subnav=atelier.subnav[0],
                  service=service, image=catalogue.image_url(service), collection=collection, group=group, related=related)


@router.get("/{section_key}/", response_class=HTMLResponse)
def section_page(request: Request, section_key: str, waitlist: str = "", db: Session = Depends(get_db)):
    section = _section(request, section_key)
    site = request.state.site
    if section.key == "membership":
        return render(request, "site/membership.html", section=section, page=site.page("membership"), plans=site.plans,
                      compare=site.docs["plans"]["compare"], extras=site.docs["plans"]["extras"])
    if section.key == "atelier":
        return render(request, "site/atelier.html", section=section, page=site.page("atelier"), plans=site.plans,
                      counts=catalogue.counts(db))
    if section.key == "laveworld":
        raise HTTPException(404)  # served by journal_routes
    raise HTTPException(404)


@router.get("/{section_key}/{sub_slug}/", response_class=HTMLResponse)
def subnav_page(request: Request, section_key: str, sub_slug: str):
    section = _section(request, section_key)
    sub = next((s for s in section.subnav if s.slug == sub_slug), None)
    if not sub:
        raise HTTPException(404)
    return render(request, "site/subnav.html", section=section, subnav=sub, item=None)


@router.get("/{section_key}/{sub_slug}/{item_slug}/", response_class=HTMLResponse)
def item_page(request: Request, section_key: str, sub_slug: str, item_slug: str, db: Session = Depends(get_db)):
    section = _section(request, section_key)
    if section.key == "atelier" and sub_slug == "clean" and item_slug in catalogue.PERSONALS:
        return render(request, "site/collection.html", section=section, subnav=section.subnav[0], item=item_slug.capitalize(),
                      current=item_slug, collections=catalogue.PERSONALS, intro=request.state.site.page("atelier")["collections"][item_slug],
                      groups=catalogue.for_collection(db, item_slug))
    sub = next((s for s in section.subnav if s.slug == sub_slug), None)
    item = next((link for s in ([sub] if sub else []) for c in s.columns for link in c.labels if slugify(link) == item_slug), None)
    if not item:
        raise HTTPException(404)
    return render(request, "site/subnav.html", section=section, subnav=sub, item=item)
