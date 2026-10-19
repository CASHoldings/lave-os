"""Client-facing prices, packs and the client's list (what they plan to send with their next collection)."""
from datetime import date

from fastapi import APIRouter, Cookie, Depends, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Service
from app.services import repository as repo
from app.site.routes import render
from app.site.store import site_dependency

router = APIRouter(include_in_schema=False, dependencies=[Depends(site_dependency)])

PACK_GROUPS = [
    ("starter", "Everyday packs", "The week's essentials, cleaned together."),
    ("wardrobe", "Wardrobe packs", "Sets for the way you dress, season by season."),
    ("home", "Home packs", "Bedding, table linen and soft furnishings, refreshed together."),
    ("addon", "Add-ons", "Small extras to put with any order."),
]


def _atelier(request: Request):
    atelier = request.state.site.by_key["atelier"]
    return atelier, atelier.subnav[0]


def _list_entries(raw: str | None) -> dict[str, int]:
    return repo.parse_list(raw)


def _pack_group(pack, figures) -> str:
    if pack.kind == "starter":
        return "starter"
    if "add-on" in (pack.note or "").lower():
        return "addon"
    homes = [repo.department_of(s.product_category) == "home" for s, _ in figures["lines"]]
    return "home" if homes and all(homes) else "wardrobe"


def pack_view(db: Session) -> tuple[list[dict], list[dict]]:
    """Packs grouped for the website, plus the ones in season this month."""
    all_items = {s.id: s for s in repo.items(db, active_only=True)}
    month = date.today().month
    groups = {key: [] for key, *_ in PACK_GROUPS}
    in_season = []
    for p in repo.packs(db, online_only=True):
        fig = repo.pack_figures(p, all_items)
        if fig["unavailable"] or not fig["lines"] or len(fig["lines"]) < len(p.items or []):
            continue
        card = {"pack": p, **fig}
        groups[_pack_group(p, fig)].append(card)
        if month in (p.months or []):
            in_season.append(card)
    return [{"key": k, "title": t, "blurb": b, "cards": groups[k]} for k, t, b in PACK_GROUPS if groups[k]], in_season


@router.get("/prices/")
def prices_short():
    return RedirectResponse("/atelier/prices/", status_code=301)


@router.get("/packs/")
def packs_short():
    return RedirectResponse("/atelier/packs/", status_code=301)


@router.get("/atelier/prices/", response_class=HTMLResponse)
def prices(request: Request, lave_list: str | None = Cookie(default=None), db: Session = Depends(get_db)):
    atelier, clean = _atelier(request)
    entries = _list_entries(lave_list)
    return render(request, "site/prices.html", section=atelier, subnav=clean, departments=repo.catalogue(db),
                  price_of=repo.client_price, rules=repo.rules(db), in_list=entries, summary=repo.summarise(db, entries))


@router.get("/atelier/packs/", response_class=HTMLResponse)
def packs(request: Request, lave_list: str | None = Cookie(default=None), db: Session = Depends(get_db)):
    atelier, clean = _atelier(request)
    groups, in_season = pack_view(db)
    entries = _list_entries(lave_list)
    return render(request, "site/packs.html", section=atelier, subnav=clean, groups=groups, in_season=in_season,
                  rules=repo.rules(db), in_list=entries, summary=repo.summarise(db, entries),
                  month_name=date.today().strftime("%B"))


@router.get("/atelier/list/", response_class=HTMLResponse)
def my_list(request: Request, lave_list: str | None = Cookie(default=None), db: Session = Depends(get_db)):
    atelier, clean = _atelier(request)
    summary = repo.summarise(db, _list_entries(lave_list))
    return render(request, "site/list.html", section=atelier, subnav=clean, summary=summary, rules=repo.rules(db))


@router.post("/atelier/list/")
def change_list(request: Request, action: str = Form("add"), kind: str = Form("item"), id: int = Form(0), qty: int = Form(1),
                back: str = Form("/atelier/list/"), lave_list: str | None = Cookie(default=None), db: Session = Depends(get_db)):
    entries = _list_entries(lave_list)
    key = ("p" if kind == "pack" else "i") + str(id)
    if action == "clear":
        entries = {}
    elif action == "remove":
        entries.pop(key, None)
    elif action in ("add", "set"):
        if kind == "pack":
            from app.models import Pack
            ok = db.scalar(select(Pack.id).where(Pack.id == id, Pack.active.is_(True), Pack.show_online.is_(True)))
        else:
            ok = db.scalar(select(Service.id).where(Service.id == id, Service.active.is_(True), Service.show_online.is_(True),
                                                    Service.product_category != ""))
        if not ok:
            raise HTTPException(404, "That item isn't available.")
        qty = max(0, min(99, qty))
        entries[key] = min(99, entries.get(key, 0) + qty) if action == "add" else qty
        if entries[key] <= 0:
            entries.pop(key)
    summary = repo.summarise(db, entries)
    if "application/json" in request.headers.get("accept", ""):
        response = JSONResponse({"count": summary.count, "estimate_pence": summary.estimate_pence,
                                 "qty": entries.get(key, 0), "warnings": summary.warnings})
    else:
        safe_back = back if back.startswith("/") and not back.startswith("//") else "/atelier/list/"
        response = RedirectResponse(safe_back, status_code=303)
    if entries:
        response.set_cookie(repo.LIST_COOKIE, repo.dump_list(entries), max_age=60 * 60 * 24 * 60, httponly=True, samesite="lax",
                            secure=request.url.scheme == "https", path="/")
    else:
        response.delete_cookie(repo.LIST_COOKIE, path="/")
    return response
