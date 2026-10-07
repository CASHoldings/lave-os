"""The Apothecary on the website: product listings, product pages, basket and checkout."""
from fastapi import APIRouter, Cookie, Depends, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import Client, ShopOrderStatus
from app.services import shop
from app.site import content
from app.site.account_routes import current_site_client
from app.site.content import slugify
from app.site.routes import BASKET_COOKIE, render
from app.site.store import site_dependency

router = APIRouter(include_in_schema=False, dependencies=[Depends(site_dependency)])


def _apothecary(request: Request):
    return request.state.site.by_key["apothecary"]


def _with_basket(response, basket: dict[int, int]):
    response.set_cookie(BASKET_COOKIE, shop.dump_basket(basket), max_age=60 * 60 * 24 * 30, httponly=True, samesite="lax",
                        secure=get_settings().site_url.startswith("https"), path="/")
    return response


def _listing_ctx(db: Session):
    selling = shop.selling(db)
    return {"selling": selling, "img": shop.image_url, "opts": shop.options}


@router.get("/apothecary/", response_class=HTMLResponse)
def apothecary(request: Request, waitlist: str = "", db: Session = Depends(get_db)):
    apothecary = _apothecary(request)
    return render(request, "site/apothecary.html", section=apothecary, page=request.state.site.page("apothecary"),
                  waitlist_status=waitlist, groups=[(sub, shop.products(db, menu_sub=sub.slug)) for sub in apothecary.subnav],
                  **_listing_ctx(db))


@router.get("/apothecary/products/{slug}/", response_class=HTMLResponse)
def product_page(request: Request, slug: str, db: Session = Depends(get_db)):
    product = shop.product_by_slug(db, slug)
    if not product:
        raise HTTPException(404)
    APOTHECARY = _apothecary(request)
    sub = next((s for s in APOTHECARY.subnav if s.slug == product.menu_sub), APOTHECARY.subnav[0])
    related = [p for p in shop.products(db, menu_sub=product.menu_sub) if p.id != product.id][:4]
    return render(request, "site/product.html", section=APOTHECARY, subnav=sub, product=product, o=shop.options(product),
                  related=related, **_listing_ctx(db))


@router.get("/apothecary/{sub_slug}/", response_class=HTMLResponse)
def apothecary_sub(request: Request, sub_slug: str, db: Session = Depends(get_db)):
    APOTHECARY = _apothecary(request)
    sub = next((s for s in APOTHECARY.subnav if s.slug == sub_slug), None)
    if not sub:
        raise HTTPException(404)
    return render(request, "site/shop_list.html", section=APOTHECARY, subnav=sub, heading=sub.title, item=None,
                  products=shop.products(db, menu_sub=sub.slug), **_listing_ctx(db))


@router.get("/apothecary/{sub_slug}/{item_slug}/", response_class=HTMLResponse)
def apothecary_item(request: Request, sub_slug: str, item_slug: str, db: Session = Depends(get_db)):
    APOTHECARY = _apothecary(request)
    sub = next((s for s in APOTHECARY.subnav if s.slug == sub_slug), None)
    item = next((l for c in (sub.columns if sub else []) for l in c.labels if slugify(l) == item_slug), None)
    if not item:
        raise HTTPException(404)
    return render(request, "site/shop_list.html", section=APOTHECARY, subnav=sub, heading=item, item=item,
                  products=shop.products(db, menu_sub=sub.slug, menu_item=item_slug), **_listing_ctx(db))


# Basket

@router.post("/basket/add/")
def basket_add(product_id: int = Form(...), size: str = Form(""), scent: str = Form(""), qty: int = Form(1),
               lave_basket: str | None = Cookie(default=None), db: Session = Depends(get_db)):
    if not shop.selling(db):
        return RedirectResponse("/apothecary/#waitlist", status_code=303)
    from app.models import Product
    product = db.get(Product, product_id)
    variant = shop.find_variant(product, size, scent) if product else None
    if not variant:
        return RedirectResponse(f"/apothecary/products/{product.slug}/?error=option" if product else "/apothecary/", status_code=303)
    if variant.stock <= 0:
        return RedirectResponse(f"/apothecary/products/{product.slug}/?error=stock", status_code=303)
    basket = shop.parse_basket(lave_basket)
    basket[variant.id] = min(shop.MAX_QTY, variant.stock, basket.get(variant.id, 0) + max(1, qty))
    return _with_basket(RedirectResponse("/basket/?added=1", status_code=303), basket)


@router.get("/basket/", response_class=HTMLResponse)
def basket_page(request: Request, added: str = "", fulfilment: str = "delivery", error: str = "",
                lave_basket: str | None = Cookie(default=None), client: Client | None = Depends(current_site_client),
                db: Session = Depends(get_db)):
    fulfilment = "collect" if fulfilment == "collect" else "delivery"
    t = shop.totals(db, shop.parse_basket(lave_basket), client, fulfilment)
    return render(request, "site/basket.html", t=t, img=shop.image_url, added=bool(added), fulfilment=fulfilment,
                  selling=shop.selling(db), member=shop.is_member(client), error=error)


@router.post("/basket/update/")
def basket_update(variant_id: int = Form(...), qty: int = Form(0), lave_basket: str | None = Cookie(default=None)):
    basket = shop.parse_basket(lave_basket)
    if qty <= 0:
        basket.pop(variant_id, None)
    else:
        basket[variant_id] = min(shop.MAX_QTY, qty)
    return _with_basket(RedirectResponse("/basket/", status_code=303), basket)


# Checkout

@router.post("/checkout/")
def checkout(request: Request, fulfilment: str = Form("delivery"), lave_basket: str | None = Cookie(default=None),
             client: Client | None = Depends(current_site_client), db: Session = Depends(get_db)):
    if not shop.selling(db):
        return RedirectResponse("/apothecary/#waitlist", status_code=303)
    fulfilment = "collect" if fulfilment == "collect" else "delivery"
    try:
        order = shop.create_order(db, shop.parse_basket(lave_basket), client, fulfilment)
    except HTTPException as e:
        from urllib.parse import quote
        return RedirectResponse(f"/basket/?fulfilment={fulfilment}&error={quote(str(e.detail))}", status_code=303)
    if get_settings().stripe_enabled:
        return RedirectResponse(shop.stripe_checkout_url(db, order), status_code=303)
    if get_settings().is_dev:
        return render(request, "site/checkout_dev.html", order=order)
    from urllib.parse import quote
    return RedirectResponse("/basket/?error=" + quote("Card payments aren't switched on yet. Please try again soon."), status_code=303)


@router.post("/checkout/dev-pay/{ref}/")
def dev_pay(ref: str, db: Session = Depends(get_db)):
    """Development only: stand in for Stripe so the whole flow can be tried locally."""
    if not get_settings().is_dev:
        raise HTTPException(404)
    order = shop.by_ref(db, ref)
    if not order:
        raise HTTPException(404)
    shop.mark_paid(db, order, email=order.email or "test@example.com",
                   address={"name": "Test Client", "line1": "1 Haydon Way", "city": "London", "postal_code": "SW11 1YF"}
                   if order.fulfilment == "delivery" else {})
    return _with_basket(RedirectResponse(f"/checkout/done/{order.ref}/?key={order.view_key}", status_code=303), {})


@router.get("/checkout/done/{ref}/", response_class=HTMLResponse)
def checkout_done(request: Request, ref: str, session: str = "", key: str = "",
                  client: Client | None = Depends(current_site_client), db: Session = Depends(get_db)):
    import secrets as _secrets
    order = shop.by_ref(db, ref)
    # Only the buyer: the secret from their confirmation link, or the signed-in client who placed it.
    owner = client is not None and order is not None and order.client_id == client.id
    if not order or not (owner or (key and order.view_key and _secrets.compare_digest(key, order.view_key))):
        raise HTTPException(404)
    # Don't wait for the webhook: confirm with Stripe directly when the client lands here.
    if order.status == ShopOrderStatus.pending_payment and session and session == order.stripe_session_id \
            and get_settings().stripe_enabled:
        from app.services.payments import _stripe
        s = _stripe().v1.checkout.sessions.retrieve(session)
        if s.payment_status == "paid":
            details = s.get("customer_details") or {}
            shipping = s.get("shipping_details") or (s.get("collected_information") or {}).get("shipping_details") or {}
            shop.mark_paid(db, order, email=details.get("email", ""), address=dict(shipping.get("address") or {}, name=shipping.get("name", "")))
    paid = order.status != ShopOrderStatus.pending_payment
    response = render(request, "site/checkout_done.html", order=order, paid=paid)
    if paid:
        response.delete_cookie(BASKET_COOKIE, path="/")
    return response
