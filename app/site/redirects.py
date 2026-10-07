"""Old WordPress addresses → their new home, so links in Google, Instagram and old emails keep working.

Only used when nothing else answers the address (see the 404 handler in app/main.py), so a real page
always wins over a redirect. Taken from lavelondon.com's sitemaps on 7 October 2026.
"""
import re
from urllib.parse import quote

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Media, Service
from app.services.content import post_by_slug

EXACT = {
    # Pages
    "/about-lave/": "/laveworld/story/",
    "/about-us-3/": "/laveworld/story/",
    "/the-better-life-pathways/": "/laveworld/",
    "/clean/": "/atelier/clean/",
    "/best-personalised-dry-cleaning/": "/atelier/clean/",
    "/family-laundry-dry-cleaning/": "/atelier/clean/",
    "/product-category/atelier/": "/atelier/clean/",
    "/premium-dry-cleaning-for-her/": "/atelier/clean/women/",
    "/premium-dry-cleaning-for-him/": "/atelier/clean/men/",
    "/all-his-shirts/": "/atelier/clean/men/",
    "/premium-dry-cleaning-for-girls/": "/atelier/clean/children/",
    "/premium-dry-cleaning-for-boys/": "/atelier/clean/children/",
    "/schools-out-uniform-refresh/": "/atelier/clean/children/",
    "/shipping-area/": "/atelier/",
    "/shop/": "/apothecary/",
    "/newsletter/": "/apothecary/#waitlist",
    "/contact-us/": "/contact/",
    "/store/": "/contact/",
    "/careers/": "/contact/",
    "/privacy-policy/": "/policies/",
    "/terms-and-conditions/": "/policies/",
    "/blog/": "/laveworld/knowledge/",
    "/category/laved/": "/laveworld/knowledge/",
    "/events/": "/laveworld/knowledge/events/",
    "/feed/": "/journal/feed.xml",
    # Booking
    "/book-a-slot-for-your-dry-cleaning/": "/book/",
    "/lave-collects/": "/book/",
    "/you-collect/": "/book/",
    "/you-drop-off/": "/book/",
    "/collection/": "/book/",
    # Accounts and membership (Paid Memberships Pro, WooCommerce)
    "/login/": "/account/login/",
    "/my-account/": "/account/",
    "/address-from/": "/account/profile/",
    "/membership-account/": "/account/membership/",
    "/membership-account/membership-billing/": "/account/membership/",
    "/membership-account/membership-cancel/": "/account/membership/",
    "/membership-account/membership-invoice/": "/account/membership/",
    "/membership-account/your-profile/": "/account/profile/",
    "/membership-account/membership-checkout/": "/memberships/plans/",
    "/membership-account/membership-confirmation/": "/account/membership/",
    "/membership-account/membership-levels/": "/memberships/plans/",
    "/product-tag/membership/": "/memberships/plans/",
    "/product/lave-essence-your-gateway-to-seamless-fabric-care/": "/memberships/plans/",
    "/product/lave-elevate/": "/memberships/plans/",
    "/product/lave-eclat/": "/memberships/plans/",
    "/product/lave-care/": "/atelier/clean/",
    "/product/on-demand-refresh/": "/atelier/clean/",
    "/product/beds-bulks/": "/atelier/clean/bedding/",
    "/cart/": "/basket/",
    "/checkout/": "/basket/",
}

# Whole folders. First match wins.
PREFIXES = [
    ("/collection/", "/book/"),
    ("/booking/", "/book/"),
    ("/booking-return/", "/book/"),
    ("/saver-booking/", "/book/"),
    ("/saver-booking-return/", "/book/"),
    ("/collection-return/", "/book/"),
    ("/careers/", "/contact/"),
    ("/store/", "/contact/"),
    ("/shipping-area/", "/atelier/"),
    ("/membership-account/", "/account/"),
    # Theme demo pages that came with WordPress
    ("/portfolio/", "/"),
    ("/project-cat/", "/"),
    ("/bdt-ep-megamenu-content/", "/"),
]
DEMO_PAGES = {"/blog-element/", "/button-with-popup/", "/sample-page/", "/test/", "/maintenance-3/", "/featured-products/",
              "/products-categories/", "/compare/", "/wishlist/", "/user-data/", "/fabric-cards/",
              "/page-not-found-but-care-is-always-here/"}

CHILD_TAGS = {"baby", "boys", "child", "children", "co-ords-boys"}
WOMEN_TAGS = {"women", "women-coat", "women-shirts", "women-shirts-trousers", "womenbundle", "herjackets"}

PRODUCT = re.compile(r"^/product/([a-z0-9-]+)/$")
TAG = re.compile(r"^/product-tag/([a-z0-9-]+)/$")
BLOG = re.compile(r"^/(?:blog/)?([a-z0-9-]+)/$")


def resolve(path: str, db: Session) -> str | None:
    """The new address for an old one, or None."""
    if path.startswith("/wp-content/uploads/"):
        # An image that was copied into the library (Website → Images).
        return db.scalar(select(Media.url).where(Media.source_url == "https://lavelondon.com" + path).limit(1))
    if not path.endswith("/") and "." not in path.rsplit("/", 1)[-1]:
        path += "/"
    if path in EXACT:
        return EXACT[path]
    if path in DEMO_PAGES:
        return "/"
    if m := PRODUCT.match(path):
        slug = db.scalar(select(Service.slug).where(Service.slug == m.group(1), Service.show_online.is_(True)))
        return f"/atelier/services/{slug}/" if slug else "/atelier/clean/"
    if m := TAG.match(path):
        tag = m.group(1)
        if tag in CHILD_TAGS:
            return "/atelier/clean/children/"
        if tag in WOMEN_TAGS:
            return "/atelier/clean/women/"
        if tag == "laundry":
            return "/atelier/clean/"
        return "/search/?q=" + quote(tag.replace("-", " "))
    for prefix, target in PREFIXES:
        if path.startswith(prefix):
            return target
    if m := BLOG.match(path):
        # Old blog posts: their THREAD article if it has been brought across under the same address.
        if post_by_slug(db, m.group(1)):
            return f"/journal/{m.group(1)}/"
        if path.startswith("/blog/") or m.group(1) in ("the-fabric-of-care-why-quality-matters",):
            return "/laveworld/knowledge/"
    return None
