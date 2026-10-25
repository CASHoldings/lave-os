"""Public website, rendered on the server so pages arrive complete and fast."""
import re
from datetime import date
from pathlib import Path

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from fastapi.templating import Jinja2Templates
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import CLIENT_COOKIE, peek_client
from app.plans import gbp
from app.services import shop

BASKET_COOKIE = "lave_basket"
from app.config import get_settings
from app.db import get_db
from app.models import WaitlistEntry
from app.site import catalogue, content
from app.site.content import slugify
from app.services.media import small_url
from app.site.store import site_dependency

TEMPLATES = Jinja2Templates(directory=Path(__file__).resolve().parent.parent / "templates")
TEMPLATES.env.filters["gbp"] = gbp
TEMPLATES.env.filters["gbp_whole"] = lambda pence: f"£{pence / 100:,.2f}"


def _bold(text: str):
    """Escape text, then turn **words** into bold. Used for short editable lines like the footer."""
    from markupsafe import Markup, escape
    return Markup(re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", str(escape(text or ""))))


TEMPLATES.env.filters["bold"] = _bold
TEMPLATES.env.filters["small"] = small_url  # the light copy of a photo, for cards, menus and tiles
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
ASSET_VERSION = "47"

PERSONALS = ["women", "men", "children", "pets"]
HOMES = ["bedding", "drapery", "tableware", "furnishings"]
HOME_INTROS = {
    "bedding": "Sheets, duvets, pillows and blankets, laundered and finished to hotel standard.",
    "drapery": "Curtains and blinds, measured and cleaned with care for lining and fabric.",
    "tableware": "Table cloths, napkins and runners, crisply pressed for the next occasion.",
    "furnishings": "Sofa and chair covers, cushions, throws and rugs, refreshed for the home.",
}

router = APIRouter(include_in_schema=False, dependencies=[Depends(site_dependency)])
SOCIAL_ICONS = {name: icon for name, _url, icon in content.FOOTER["social"]}


def breadcrumbs(request: Request, ctx: dict) -> list[tuple[str, str]]:
    """Home / section / menu / page: every step is a link, and the last one is the page itself.

    Built from the page's section, sub-menu and title; a route can pass `crumb` (the page's own label) or a full
    `crumbs` list for pages outside the menus. The home page has none.
    """
    path = request.url.path
    if path == "/":
        return []
    if ctx.get("crumbs"):
        trail = list(ctx["crumbs"])
    else:
        trail = [("Home", "/")]
        section, sub = ctx.get("section"), ctx.get("subnav")
        if section:
            trail.append((section.title, section.path))
            if sub:
                trail.append((sub.title, f"{section.path}{sub.slug}/"))
    if trail[-1][1] != path:
        page = ctx.get("post") or ctx.get("product") or ctx.get("page")
        leaf = (ctx.get("crumb") or ctx.get("item") or ctx.get("heading")
                or getattr(page, "title", None) or getattr(page, "name", None))
        if leaf:
            trail.append((str(leaf), path))
    return trail


def render(request: Request, template: str, status_code: int = 200, **ctx) -> HTMLResponse:
    viewer = peek_client(request.cookies.get(CLIENT_COOKIE))
    basket_count = sum(shop.parse_basket(request.cookies.get(BASKET_COOKIE)).values())
    from app.services.repository import LIST_COOKIE, parse_list
    list_count = sum(parse_list(request.cookies.get(LIST_COOKIE)).values())
    site = request.state.site
    footer = dict(site.docs["footer"], social=[dict(x, icon=SOCIAL_ICONS.get(x["name"], "")) for x in site.docs["footer"]["social"]],
                  anagram=site.brand["anagram"])
    base = {
        "site": site,
        "viewer": {"first_name": viewer.get("fn", "")} if viewer else None,
        "basket_count": basket_count, "list_count": list_count,
        "sections": site.sections, "section": None, "subnav": None, "slug": slugify, "footer": footer,
        "logo_navy": site.brand["logo_navy"], "logo_white": site.brand["logo_white"], "favicon": site.brand["favicon"],
        "year": date.today().year,
        "asset_version": ASSET_VERSION, "image_url": catalogue.image_url,
        "site_url": get_settings().site_url.rstrip("/"),
    }
    base["crumbs"] = breadcrumbs(request, ctx)
    return TEMPLATES.TemplateResponse(request, template, {**base, **{k: v for k, v in ctx.items() if k != "crumbs"}},
                                      status_code=status_code)


def _section(request: Request, key: str):
    section = request.state.site.by_path.get(key)
    if not section:
        raise HTTPException(404)
    return section


@router.get("/", response_class=HTMLResponse)
def home(request: Request):
    return render(request, "site/home.html", home=request.state.site.docs["home"])


@router.get("/robots.txt")
def robots():
    base = get_settings().site_url.rstrip("/")
    text = ("User-agent: *\nDisallow: /admin\nDisallow: /api/\nDisallow: /account/\nDisallow: /basket/\n"
            "Disallow: /checkout/\nDisallow: /search/\n\nSitemap: " + base + "/sitemap.xml\n")
    return Response(text, media_type="text/plain")


@router.get("/sitemap.xml")
def sitemap(request: Request, db: Session = Depends(get_db)):
    from xml.sax.saxutils import escape

    from app.models import Service
    from app.services import content as cms

    site = request.state.site
    paths = ["/", "/book/", "/contact/", "/policies/", "/laveworld/knowledge/"]
    for s in site.sections:
        paths.append(s.path)
        for n in s.subnav:
            paths.append(f"{s.path}{n.slug}/")
    from app.services import repository as repo
    paths += ["/atelier/prices/", "/atelier/packs/"]
    counts = repo.collection_counts(db)
    paths += [f"/atelier/clean/{c}/" for c in repo.COLLECTION_PAGES if counts.get(c)]
    paths += [f"/apothecary/products/{p.slug}/" for p in shop.products(db)]
    paths += [f"/journal/{p.slug}/" for p in cms.published(db, limit=1000)]
    base = get_settings().site_url.rstrip("/")
    urls = "".join(f"<url><loc>{escape(base + p)}</loc></url>" for p in dict.fromkeys(paths))
    return Response('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
                    + urls + "</urlset>", media_type="application/xml")


@router.get("/search/", response_class=HTMLResponse)
def search(request: Request, q: str = "", db: Session = Depends(get_db)):
    """Search services and menu pages by name."""
    q = q.strip()
    services, pages = [], []
    if len(q) >= 2:
        needle = q.lower()
        from app.services import repository as repo
        services = repo.search(db, needle)
        for sec in request.state.site.sections:
            for sub in sec.subnav:
                for col in sub.columns:
                    for label, href in col.items(sec.path, sub.slug):
                        if needle in label.lower() or needle in col.title.lower():
                            pages.append((f"{sec.title} · {sub.title}", label, href))
    return render(request, "site/search.html", q=q, services=services, pages=pages[:12], crumb="Search")


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


@router.get("/atelier/services/{slug}/")
def service_page(slug: str, db: Session = Depends(get_db)):
    """Items live on the price list now; old service pages point at the item that replaced them."""
    from app.models import Service
    service = db.scalar(select(Service).where(Service.slug == slug))
    if service and service.replaced_by_id:
        service = db.get(Service, service.replaced_by_id)
    if not service or not service.product_category or not service.active or not service.show_online:
        raise HTTPException(404)
    return RedirectResponse(f"/atelier/prices/#{service.slug}", status_code=301)


@router.get("/{section_key}/", response_class=HTMLResponse)
def section_page(request: Request, section_key: str, waitlist: str = "", db: Session = Depends(get_db)):
    section = _section(request, section_key)
    site = request.state.site
    if section.key == "membership":
        return render(request, "site/membership.html", section=section, page=site.page("membership"), plans=site.plans,
                      compare=site.docs["plans"]["compare"], extras=site.docs["plans"]["extras"])
    if section.key == "atelier":
        from app.services import repository as repo
        return render(request, "site/atelier.html", section=section, page=site.page("atelier"), plans=site.plans,
                      counts=repo.collection_counts(db))
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
    from app.services import repository as repo
    if section.key == "atelier" and sub_slug == "clean" and item_slug in repo.COLLECTION_PAGES:
        personal = item_slug in PERSONALS
        intros = request.state.site.page("atelier")["collections"]
        entries = repo.parse_list(request.cookies.get(repo.LIST_COOKIE))
        return render(request, "site/collection.html", section=section, subnav=section.subnav[0], item=item_slug.capitalize(),
                      current=item_slug, collections=PERSONALS if personal else HOMES, personal=personal,
                      intro=intros.get(item_slug) or HOME_INTROS.get(item_slug, ""),
                      departments=repo.catalogue(db, item_slug), price_of=repo.client_price, in_list=entries,
                      summary=repo.summarise(db, entries))
    sub = next((s for s in section.subnav if s.slug == sub_slug), None)
    item = next((link for s in ([sub] if sub else []) for c in s.columns for link in c.labels if slugify(link) == item_slug), None)
    if not item:
        raise HTTPException(404)
    return render(request, "site/subnav.html", section=section, subnav=sub, item=item)
