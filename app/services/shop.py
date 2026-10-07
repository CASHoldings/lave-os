"""The Apothecary shop: products, the basket, checkout through Stripe, and the selling switch."""
import json
from dataclasses import dataclass
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import (
    Client,
    MembershipStatus,
    Product,
    ProductVariant,
    ShopOrder,
    ShopOrderLine,
    ShopOrderStatus,
    SiteSetting,
    WaitlistEntry,
)
from app.services import mailer
from app.services.clock import local_now

SAMPLE = Path(__file__).resolve().parent.parent / "site" / "data" / "apothecary_products.json"
WP = "https://lavelondon.com/wp-content/uploads/"
MAX_QTY = 10


# Settings

def setting(db: Session, key: str, default: str = "") -> str:
    row = db.get(SiteSetting, key)
    return row.value if row else default


def set_setting(db: Session, key: str, value: str) -> None:
    row = db.get(SiteSetting, key) or SiteSetting(key=key)
    row.value = value
    db.add(row)


def selling(db: Session) -> bool:
    return setting(db, "shop_selling") == "on"


def set_selling(db: Session, on: bool) -> int:
    """Turn selling on or off. The first time it goes on, email everyone on the waitlist. Returns emails sent."""
    set_setting(db, "shop_selling", "on" if on else "off")
    sent = 0
    if on:
        url = get_settings().site_url + "/apothecary/"
        for entry in db.scalars(select(WaitlistEntry).where(WaitlistEntry.notified_at.is_(None))):
            mailer.send(entry.email, "The LAVE Apothecary is open",
                        f"Hello {entry.first_name},\n\nThank you for waiting. The LAVE Apothecary is now open: detergents, "
                        f"treatments and tools from the atelier.\n\n{url}\n\nLAVE")
            entry.notified_at = local_now()
            sent += 1
    db.commit()
    return sent


# Catalogue

def load_sample_products(db: Session, stock: int = 24) -> int:
    if db.scalar(select(Product).limit(1)):
        return 0
    data = json.loads(SAMPLE.read_text())
    scents = data["scents"]
    for i, p in enumerate(data["products"]):
        prod = Product(slug=p["slug"], name=p["name"], summary=p["summary"], image=p["image"],
                       menu_sub=p["menu"][0], menu_item=p["menu"][1], sort=i)
        for size in p["options"]["size"]:
            for scent_key in p["options"]["scent"] or [""]:
                scent = scents.get(scent_key, "")
                sku = "-".join(x for x in [p["slug"], size, scent_key] if x).upper().replace(" ", "")[:60]
                prod.variants.append(ProductVariant(sku=sku, size=size, scent=scent, price_pence=p["prices"][size], stock=stock))
        db.add(prod)
    db.commit()
    return len(data["products"])


def image_url(product: Product) -> str:
    return product.image if product.image.startswith(("http", "/")) or not product.image else WP + product.image


def products(db: Session, menu_sub: str | None = None, menu_item: str | None = None) -> list[Product]:
    q = select(Product).where(Product.active.is_(True))
    if menu_sub:
        q = q.where(Product.menu_sub == menu_sub)
    if menu_item:
        q = q.where(Product.menu_item == menu_item)
    return list(db.scalars(q.order_by(Product.sort, Product.name)))


def product_by_slug(db: Session, slug: str) -> Product | None:
    return db.scalar(select(Product).where(Product.slug == slug, Product.active.is_(True)))


def options(product: Product) -> dict:
    live = [v for v in product.variants if v.active]
    sizes = list(dict.fromkeys(v.size for v in live))
    scents = list(dict.fromkeys(v.scent for v in live if v.scent))
    return {
        "sizes": sizes, "scents": scents,
        "from_pence": min((v.price_pence for v in live), default=0),
        "variants": [{"id": v.id, "size": v.size, "scent": v.scent, "price_pence": v.price_pence, "in_stock": v.stock > 0}
                     for v in live],
    }


def find_variant(product: Product, size: str, scent: str) -> ProductVariant | None:
    return next((v for v in product.variants if v.active and v.size == size and (v.scent or "") == (scent or "")), None)


# Basket (kept in a cookie as {variant_id: qty}; prices always come from the database)

def parse_basket(raw: str | None) -> dict[int, int]:
    try:
        data = json.loads(raw or "{}")
        return {int(k): max(1, min(MAX_QTY, int(v))) for k, v in data.items() if int(v) > 0}
    except (ValueError, TypeError, AttributeError):
        return {}


def dump_basket(basket: dict[int, int]) -> str:
    return json.dumps({str(k): v for k, v in basket.items()}, separators=(",", ":"))


@dataclass
class Line:
    variant: ProductVariant
    qty: int

    @property
    def total(self) -> int:
        return self.variant.price_pence * self.qty


@dataclass
class Totals:
    lines: list[Line]
    subtotal: int
    shipping: int
    total: int
    shipping_note: str

    @property
    def count(self) -> int:
        return sum(l.qty for l in self.lines)


def is_member(client: Client | None) -> bool:
    return bool(client and client.membership and client.membership.status == MembershipStatus.active)


def totals(db: Session, basket: dict[int, int], client: Client | None, fulfilment: str = "delivery") -> Totals:
    lines = []
    for vid, qty in basket.items():
        v = db.get(ProductVariant, vid)
        if v and v.active and v.product.active:
            lines.append(Line(v, qty))
    subtotal = sum(l.total for l in lines)
    s = get_settings()
    if fulfilment == "collect":
        shipping, note = 0, "Collect from the atelier"
    elif is_member(client):
        shipping, note = 0, "Free delivery for members"
    elif subtotal >= s.shop_free_shipping_over_pence:
        shipping, note = 0, f"Free delivery over £{s.shop_free_shipping_over_pence / 100:.0f}"
    else:
        shipping, note = s.shop_shipping_pence, f"UK delivery. Free over £{s.shop_free_shipping_over_pence / 100:.0f}"
    if not lines:
        shipping = 0
    return Totals(lines, subtotal, shipping, subtotal + shipping, note)


# Checkout

def create_order(db: Session, basket: dict[int, int], client: Client | None, fulfilment: str) -> ShopOrder:
    t = totals(db, basket, client, fulfilment)
    if not t.lines:
        raise HTTPException(400, "Your basket is empty.")
    short = [l for l in t.lines if l.variant.stock < l.qty]
    if short:
        names = ", ".join(f"{l.variant.product.name} ({l.variant.label})" for l in short)
        raise HTTPException(409, f"Not enough stock for {names}. Reduce the quantity and try again.")
    order = ShopOrder(client_id=client.id if client else None, email=client.email if client else "",
                      fulfilment=fulfilment, subtotal_pence=t.subtotal, shipping_pence=t.shipping, total_pence=t.total)
    for l in t.lines:
        order.lines.append(ShopOrderLine(variant_id=l.variant.id, name=l.variant.product.name, variant_label=l.variant.label,
                                         unit_price_pence=l.variant.price_pence, quantity=l.qty))
    db.add(order)
    db.commit()
    return order


def stripe_checkout_url(db: Session, order: ShopOrder) -> str:
    from app.services.payments import _stripe  # raises a friendly 503 when Stripe isn't configured
    s = get_settings()
    params = {
        "mode": "payment",
        "line_items": [{"quantity": l.quantity, "price_data": {
            "currency": "gbp", "unit_amount": l.unit_price_pence,
            "product_data": {"name": l.name + (f" ({l.variant_label})" if l.variant_label else "")}}} for l in order.lines],
        "success_url": f"{s.site_url}/checkout/done/{order.ref}/?key={order.view_key}&session={{CHECKOUT_SESSION_ID}}",
        "cancel_url": f"{s.site_url}/basket/",
        "metadata": {"lave_shop_order": order.ref},
        "payment_intent_data": {"metadata": {"lave_shop_order": order.ref}},
    }
    if order.shipping_pence:
        params["line_items"].append({"quantity": 1, "price_data": {"currency": "gbp", "unit_amount": order.shipping_pence,
                                                                   "product_data": {"name": "UK delivery"}}})
    if order.fulfilment == "delivery":
        params["shipping_address_collection"] = {"allowed_countries": ["GB"]}
    if order.email:
        params["customer_email"] = order.email
    session = _stripe().v1.checkout.sessions.create(params=params)
    order.stripe_session_id = session.id
    db.commit()
    return session.url


def mark_paid(db: Session, order: ShopOrder, email: str = "", address: dict | None = None) -> None:
    """Record payment once (webhook and return page may both call this) and take the stock."""
    if order.status != ShopOrderStatus.pending_payment:
        return
    order.status = ShopOrderStatus.paid
    order.paid_at = local_now()
    if email and not order.email:
        order.email = email
    if address:
        order.shipping_address = address
    short = []
    for line in order.lines:
        v = db.get(ProductVariant, line.variant_id) if line.variant_id else None
        if v:
            if v.stock < line.quantity:
                short.append(f"{line.name} ({line.variant_label}): paid for {line.quantity}, {v.stock} in stock")
            v.stock = max(0, v.stock - line.quantity)
    order.stock_issue = "; ".join(short)
    db.commit()
    if order.email:
        lines = "\n".join(f"  {l.quantity} × {l.name} {('(' + l.variant_label + ')') if l.variant_label else ''}  £{l.unit_price_pence * l.quantity / 100:.2f}"
                          for l in order.lines)
        how = "We'll email you when it's on its way." if order.fulfilment == "delivery" else "We'll let you know when it's ready to collect from the atelier."
        mailer.send(order.email, f"Your LAVE Apothecary order {order.ref}",
                    f"Thank you for your order.\n\n{lines}\n  Delivery £{order.shipping_pence / 100:.2f}\n  Total £{order.total_pence / 100:.2f}\n\n{how}\n\nLAVE")


def by_ref(db: Session, ref: str) -> ShopOrder | None:
    return db.scalar(select(ShopOrder).where(ShopOrder.ref == ref.upper()))
