"""Journal posts and LAVEWorld pages: Markdown rendering, queries and starter content."""
import html
import json
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


def load_starter_content(db: Session) -> None:
    for path, title, intro, body, is_published in STARTER_PAGES:
        if not db.scalar(select(PageContent).where(PageContent.path == path)):
            db.add(PageContent(path=path, title=title, intro=intro, body=body, published=is_published))
    if not db.scalar(select(Post).limit(1)):
        db.add(Post(slug=slugify(STARTER_POST["title"]), kind="thread", status=PostStatus.draft, **STARTER_POST))
    db.commit()
