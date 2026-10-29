"""Journal posts and LAVEWorld pages: Markdown rendering, queries and starter content."""
import html
import json
from pathlib import Path
import re

import markdown
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import PageContent, Post, PostStatus, SiteContent
from app.services.clock import local_now
from app.site.content import SERVICE_MESSAGE, SLOGAN, TAGLINE, WP, slugify

KINDS = {"thread": "THREAD by LAVE", "event": "Events", "press": "Press"}
SAFE_URL = re.compile(r'(href|src)="(?!https?://|/|#|mailto:)[^"]*"', re.I)


def render_markdown(text: str) -> str:
    """Markdown to HTML. Raw HTML in the source is shown as text, and only web, site and mailto links survive."""
    escaped = html.escape(text or "", quote=False)
    out = markdown.markdown(escaped, extensions=["extra", "sane_lists"], output_format="html")
    return SAFE_URL.sub(r'\1="#"', out)


def unique_slug(db: Session, title: str, model=Post, current_id: int | None = None) -> str:
    base = slugify(title)[:150] or "post"
    slug, n = base, 2
    while (row := db.scalar(select(model).where(model.slug == slug))) and row.id != current_id:
        slug, n = f"{base}-{n}", n + 1
    return slug


def published(db: Session, kind: str | None = None, limit: int = 50) -> list[Post]:
    q = select(Post).where(Post.status == PostStatus.published, Post.published_at <= local_now())
    if kind:
        q = q.where(Post.kind == kind)
    return list(db.scalars(q.order_by(Post.published_at.desc()).limit(limit)))


def upcoming_events(db: Session, theme: str | None = None) -> list[Post]:
    q = select(Post).where(Post.kind == "event", Post.status == PostStatus.published, Post.event_starts_at >= local_now())
    if theme:
        q = q.where(Post.event_theme == theme)
    return list(db.scalars(q.order_by(Post.event_starts_at)))


def post_by_slug(db: Session, slug: str, include_drafts: bool = False) -> Post | None:
    post = db.scalar(select(Post).where(Post.slug == slug))
    if not post:
        return None
    if not include_drafts and (post.status != PostStatus.published or not post.published_at or post.published_at > local_now()):
        return None
    return post


def page(db: Session, path: str, include_drafts: bool = False) -> PageContent | None:
    row = db.scalar(select(PageContent).where(PageContent.path == path))
    return row if row and (row.published or include_drafts) else None


def image(url: str) -> str:
    return url if not url or url.startswith(("http", "/")) else WP + url


# Starter content. Pages are published only where the copy comes from LAVE's own words; the rest wait as drafts.
STARTER_PAGES = [
    ("/laveworld/impact/people/", "People", "Intentional care for the people who wear, use and look after textiles.",
     "Intentional care for the **people** and textiles you love.", True),
    ("/laveworld/impact/planet/", "Planet", "Extending the life of what you own is the most sustainable choice.",
     "We extend the life of what you treasure, from heirloom silks to everyday essentials, with expert cleaning, "
     "bespoke formulations, restoration and climate-conscious storage.", True),
    ("/laveworld/impact/principles/", "Principles", f"{SLOGAN}. {TAGLINE}.", f"{SERVICE_MESSAGE}.", True),
    ("/laveworld/story/purpose/", "Purpose", "LAVE cares for, manages and extends the life of wardrobes, home and business textiles.",
     "LAVE is a technology-enabled Textile Care Atelier that cares for, manages and extends the life of wardrobes, "
     "home and business textiles.", True),
    ("/laveworld/story/creation/", "Creation", "How LAVE began.", "", False),
    ("/laveworld/story/heritage/", "Heritage", "The craft behind LAVE.", "", False),
]

STARTER_POST = {
    "title": "How to store cashmere for the summer",
    "excerpt": "Clean it, fold it, let it breathe. A short guide to putting knitwear away so it comes back perfect.",
    "body": "Moths are drawn to body oils and food traces, so **clean every piece before it goes away**, even if it looks fresh.\n\n"
            "## Fold, never hang\n\nHanging stretches knitwear at the shoulders. Fold along the seams with acid-free tissue between layers.\n\n"
            "## Let it breathe\n\nUse cotton bags or boxes rather than plastic, which traps moisture. Keep them somewhere cool, dark and dry.\n\n"
            "## Or let us keep it\n\nThe [LAVE Vault](/atelier/vault/) cleans and stores your knitwear in climate-conscious conditions until you need it.",
    "cover_image": "2024/07/LAVE-Atelier-Store-Couture.avif",
}


# Earlier wording of the brand lines. Each deploy swaps it for the current lines wherever saved content still uses it
# word for word; anything rewritten in /admin is left alone.
OLD_BRAND_WORDING = [
    ("Care better.  Preserve what you treasure.", f"{SLOGAN}. {TAGLINE}."),
    ("Care better. Preserve what you treasure.", f"{SLOGAN}. {TAGLINE}."),
    ("Our values guide every choice: intentional care for **people**, **planet**, and the **textiles** you treasure.",
     "Intentional care for the **people** and **textiles** you love."),
    ("Our values guide every choice: intentional care for **people**, planet, and the textiles you treasure.",
     "Intentional care for the **people** and textiles you love."),
    ("Our values guide every choice: intentional care for people, planet, and the textiles you treasure.", f"{SERVICE_MESSAGE}."),
    ("Our values guide every choice: intentional care for people, planet and the textiles you treasure.", f"{SERVICE_MESSAGE}."),
    # Collection & delivery rules v1.4: no "2-hour" or "standard" windows, no return faster than 48 hours promised.
    ("A 2-hour collection and return window", "Saver collection and return included. One-hour windows £4.95."),
    ("Standard return", "Drop off at any LAVE atelier"),
    ("A 1-hour collection and return window", "Collection and return included, including one-hour windows"),
    ("Priority return", "Drop off at any LAVE atelier"),
    ("Fortnightly collection, 2-hour window", "Fortnightly collection, Saver window included"),
    ("Weekly collection, 1-hour window", "Weekly collection, one-hour windows included"),
    ("Fortnightly, 2-hour window", "Fortnightly, Saver window included"),
    ("Weekly, 1-hour window, +1 extra a month", "Weekly, one-hour windows included, +1 extra a month"),
    ('{"label": "Return", "values": ["Standard", "Priority", "Priority"]}',
     '{"label": "Collection windows", "values": ["Saver included, one-hour £4.95", "Saver and one-hour included", '
     '"Saver and one-hour included"]}'),
    ("Choose a one-hour or Saver collection window, or drop off at the atelier.",
     "Choose a one-hour or Saver collection window or, as a member, drop off at a LAVE atelier."),
    # Essence collection: two clear lines instead of one.
    ('{"text": "Saver collection and return included. One-hour windows £4.95.", "soon": false}',
     '{"text": "Complimentary Saver collection and return", "soon": false}, '
     '{"text": "One-hour collection windows: £4.95", "soon": false}'),
    ('"Saver included, one-hour £4.95"', '"Saver complimentary, one-hour £4.95"'),
]


def update_brand_wording(db: Session) -> int:
    """Bring saved pages, footer and page wording up to the current brand lines. Returns how many were changed."""
    def swap(text: str) -> str:
        for old, new in OLD_BRAND_WORDING:
            text = text.replace(old, new)
        return text

    changed = 0
    for row in db.scalars(select(SiteContent)):
        new = json.loads(swap(json.dumps(row.value, ensure_ascii=False)))
        if new != row.value:
            row.value, row.updated_by = new, "Brand lines"
            changed += 1
    for page_row in db.scalars(select(PageContent)):
        intro, body = swap(page_row.intro or ""), swap(page_row.body or "")
        if (intro, body) != (page_row.intro or "", page_row.body or ""):
            page_row.intro, page_row.body = intro, body
            changed += 1
    if changed:
        db.commit()
        from app.site import store
        store._cache["stamp"] = None
    return changed


# Legal pages, from app/site/data/policies/*.md. Added once; after that they're edited in /admin → Website → Pages.
POLICIES_DIR = Path(__file__).resolve().parent.parent / "site" / "data" / "policies"
POLICIES_UPDATED = "27 October 2026"
POLICY_DATES = {"terms": "28 October 2026"}  # pages changed since they first went live
POLICIES = [
    ("/policies/", "index", "Policies", "Our terms, and how we look after your pieces, your money and your information."),
    ("/policies/terms/", "terms", "Terms & conditions",
     "The agreement between you and LAVE when you book a collection, become a member, store pieces in the Vault or buy from the Apothecary."),
    ("/policies/cancellation/", "cancellation", "Cancellation & refunds", "How to change your mind, and how and when we refund you."),
    ("/policies/garment-care/", "garment-care", "Garment care & liability",
     "How we look after your pieces, what we ask of you, and what happens if something goes wrong."),
    ("/policies/privacy/", "privacy", "Privacy policy", "What personal information we collect, why, who we share it with, and your rights."),
    ("/policies/cookies/", "cookies", "Cookie notice",
     "We use only the cookies our website needs to work. We don't use advertising or tracking cookies, so we don't ask you to accept cookies."),
]


def load_policies(db: Session) -> int:
    """Add any policy page the site doesn't have yet. Runs on every deploy; pages already there (and any edits made
    in the admin) are left alone. Returns how many were added. Caller commits."""
    added = 0
    for path, name, title, intro in POLICIES:
        if not db.scalar(select(PageContent).where(PageContent.path == path)):
            body = (POLICIES_DIR / f"{name}.md").read_text()
            if name != "index":
                body += f"\n\n*Last updated {POLICY_DATES.get(name, POLICIES_UPDATED)}.*\n"
            db.add(PageContent(path=path, title=title, intro=intro, body=body, published=True))
            added += 1
    return added


# Changes to policy wording since the pages went live: (page, old text, new text, date). Applied on deploy where the
# page still has the old text word for word; a page rewritten in the admin is left alone.
POLICY_CHANGES = [
    ("/policies/terms/",
     "The first missed visit is rebooked free. After that, the collection and delivery charge applies again for each extra visit.",
     "Your first missed visit in any 12 months is rebooked free. After that, a charge applies for each missed visit: "
     "the collection and delivery charge for that window, or £4.95 for members.",
     "28 October 2026"),
]


# Menu photos changed since launch: (column title, old photo, new photo). Applied on deploy to saved menus where the
# column still has the old photo; a photo chosen in the admin is left alone.
MENU_PHOTO_CHANGES = [
    ("Pass On", WP + "2024/07/LAVE-Atelier-Preserve-Renew.avif", "/media/rehome-pass-on.webp"),
]


def update_menu_photos(db: Session) -> int:
    """Apply MENU_PHOTO_CHANGES to the saved menus (old WordPress photos may since have moved into the library).
    Returns how many columns changed."""
    from app.models import Media
    row = db.get(SiteContent, "menus")
    if not row or not row.value:
        return 0
    menus, changed = json.loads(json.dumps(row.value)), 0
    for title, old, new in MENU_PHOTO_CHANGES:
        olds = {old, *db.scalars(select(Media.url).where(Media.source_url == old))}
        for section in menus.get("sections", []):
            for sub in section.get("subnav", []):
                for col in sub.get("columns", []):
                    if col.get("title") == title and col.get("image") in olds:
                        col["image"], changed = new, changed + 1
    if changed:
        row.value, row.updated_by = menus, "Menu photos"
        db.commit()
        from app.site import store
        store._cache["stamp"] = None
    return changed


def update_policies(db: Session) -> int:
    """Apply POLICY_CHANGES to live pages, and move their "Last updated" date. Returns how many pages changed."""
    changed = 0
    for path, old, new, day in POLICY_CHANGES:
        page_row = db.scalar(select(PageContent).where(PageContent.path == path))
        if page_row and old in (page_row.body or ""):
            body = page_row.body.replace(old, new)
            page_row.body = re.sub(r"\*Last updated [^*]+\.\*", f"*Last updated {day}.*", body)
            changed += 1
    if changed:
        db.commit()
    return changed


def load_starter_content(db: Session) -> None:
    for path, title, intro, body, is_published in STARTER_PAGES:
        if not db.scalar(select(PageContent).where(PageContent.path == path)):
            db.add(PageContent(path=path, title=title, intro=intro, body=body, published=is_published))
    load_policies(db)
    if not db.scalar(select(Post).limit(1)):
        db.add(Post(slug=slugify(STARTER_POST["title"]), kind="thread", status=PostStatus.draft, **STARTER_POST))
    db.commit()
