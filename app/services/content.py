"""Journal posts and LAVEWorld pages: Markdown rendering, queries and starter content."""
import html
import json
from pathlib import Path
import re
from datetime import datetime

import markdown
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models import Pack, PageContent, Post, PostStatus, SiteContent
from app.services.clock import local_now
from app.site.content import SERVICE_MESSAGE, SLOGAN, TAGLINE, WP, slugify

KINDS = {"thread": "THREAD by LAVE", "event": "Events", "press": "Press"}
SAFE_URL = re.compile(r'(href|src)="(?!https?://|/|#|mailto:)[^"]*"', re.I)


def render_markdown(text: str) -> str:
    """Markdown to HTML. Raw HTML in the source is shown as text, and only web, site and mailto links survive."""
    escaped = html.escape(text or "", quote=False)
    out = markdown.markdown(escaped, extensions=["extra", "sane_lists"], output_format="html")
    return SAFE_URL.sub(r'\1="#"', out)


# Line icons for cards, picked by a word in the card's title (thin strokes, like the rest of the site's icons).
_ICON = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{}</svg>'
CARD_ICONS = [
    (("talk", "listen", "counsel"), '<path d="M4 5h16v11H10l-4 3.5V16H4z"/><path d="M8 9.5h8M8 12.5h5"/>'),
    (("home", "money", "household"), '<path d="M3.5 11 12 4l8.5 7"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>'),
    (("work", "career"), '<rect x="3.5" y="7.5" width="17" height="12" rx="1"/><path d="M9 7.5V5h6v2.5M3.5 12.5h17"/>'),
    (("step", "plan", "feel"), '<path d="M5 19c0-8 5.5-13 15-14 0 9.5-5.5 14-15 14z"/><path d="M5 19l8.5-8.5"/>'),
    (("app", "phone"), '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 17.5h2"/>'),
]
_DEFAULT_ICON = '<path d="M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.2a4.2 4.2 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z"/>'
_CARD_ITEM = re.compile(r"^[-*] \*\*([^*]+?)([.:])\*\*\s*(.*)$")
_PHOTO = re.compile(r"!\[[^\]]*\]\(((?:https?://|/)[^\s)]+)\)")
_SMALL_PRINT = re.compile(r"\n\s*\*([^*\n][^\n]*[^*\n])\*\s*$")


def card_icon(title: str) -> str:
    icon = next((svg for words, svg in CARD_ICONS if any(w in title.lower() for w in words)), _DEFAULT_ICON)
    return _ICON.format(icon)


def landing(body: str) -> dict:
    """Lay a page out like the LAVEWorld page. The text before the first "## " heading opens the page. Each
    "## Eyebrow · Heading" section becomes a row of cards when its list items start with a bold title
    ("- **Help at home.** ..." gets an icon, "- **Essence:** ..." doesn't), or otherwise a photo-and-text panel,
    using the first image in the section. A closing paragraph in italics becomes the small print."""
    body = (body or "").replace("\r\n", "\n")
    note = ""
    if m := _SMALL_PRINT.search(body):
        note, body = render_markdown(m.group(1)), body[:m.start()]
    intro, *chunks = re.split(r"^## +", body, flags=re.M)
    sections = []
    for chunk in chunks:
        heading_line, _, text = chunk.partition("\n")
        eyebrow, _, heading = heading_line.strip().rpartition(" · ")
        cards, rest = [], []
        for line in text.split("\n"):
            if m := _CARD_ITEM.match(line.strip()):
                title, mark, words = m.groups()
                words = words[:1].upper() + words[1:]  # "**Essence:** wellbeing resources" reads as a sentence on its own card
                cards.append({"title": title.strip(), "html": render_markdown(words), "icon": card_icon(title) if mark == "." else None})
            else:
                rest.append(line)
        rest = "\n".join(rest)
        photo = _PHOTO.search(rest)
        sections.append({"eyebrow": eyebrow, "heading": heading, "cards": cards, "photo": photo.group(1) if photo else "",
                         "html": render_markdown(_PHOTO.sub("", rest).strip())})
    return {"intro": render_markdown(intro.strip()), "sections": sections, "note": note}


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


# Who LAVE Experiences are for: the tabs on the Experiences page, in order. An event can be for several.
AUDIENCES = {"households": "Households", "individuals": "Individuals", "corporates": "Corporates"}
# The groups used before 13 November 2026, and where they belong now (old events, saved wording and links).
OLD_AUDIENCES = {"families": "households", "children": "households", "founders": "individuals",
                 "professionals": "individuals", "businesses": "corporates"}


def audiences(values) -> list[str]:
    """Known groups in tab order, old names mapped to the new ones: from a list, or "a, b" text."""
    if isinstance(values, str):
        values = values.split(",")
    found = {OLD_AUDIENCES.get(v.strip().lower(), v.strip().lower()) for v in values or [] if str(v).strip()}
    return [a for a in AUDIENCES if a in found]


def update_event_audiences(db: Session) -> int:
    """Move events saved with the old groups to the new ones (run on deploy). Returns how many changed."""
    changed = 0
    for p in db.scalars(select(Post).where(Post.kind == "event")):
        new = audiences(p.event_audiences or [])
        if new != (p.event_audiences or []):
            p.event_audiences = new
            changed += 1
    if changed:
        db.commit()
    return changed


def upcoming_events(db: Session, audience: str | None = None) -> list[Post]:
    """Published events still to come, or still running (a run of days that has started); for one group if given."""
    now = local_now()
    q = select(Post).where(Post.kind == "event", Post.status == PostStatus.published,
                           or_(Post.event_starts_at >= now, Post.event_ends_at >= now))
    events = list(db.scalars(q.order_by(Post.event_starts_at)))
    return [p for p in events if audience in audiences(p.event_audiences)] if audience else events


def event_when(starts: datetime, ends: datetime | None = None) -> str:
    """"Thursday 19 – Saturday 21 November 2026", or "Thursday 26 November 2026, 5.30pm to 6.30pm"."""
    def day(d):
        return f"{d:%A} {d.day} {d:%B %Y}"

    def clock(d):
        hour = d.strftime("%I").lstrip("0")
        return f"{hour}{'.' + d.strftime('%M') if d.minute else ''}{d.strftime('%p').lower()}"
    if ends and ends.date() != starts.date():
        first = f"{starts:%A} {starts.day}"
        if (starts.year, starts.month) != (ends.year, ends.month):
            first += f" {starts:%B}" + (f" {starts.year}" if starts.year != ends.year else "")
        return f"{first} – {day(ends)}"
    text = day(starts)
    if starts.hour or starts.minute:
        text += f", {clock(starts)}" + (f" to {clock(ends)}" if ends and ends > starts else "")
    return text


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
    # Member experiences renamed (1 November 2026): Run Club is LAVE Strides, yoga is LAVEYoga.
    ("LAVE Run Club: monthly group runs", "LAVE Strides: monthly group runs"),
    ("LAVE Run Club and LAVE Living", "LAVE Strides and LAVE Living"),
    ("Monthly yoga sessions", "Monthly LAVEYoga sessions"),
    ("Family yoga sessions", "Family LAVEYoga sessions"),
    ('"label": "Run Club"', '"label": "LAVE Strides"'),
    ('"label": "Yoga"', '"label": "LAVEYoga"'),
    ('"label": "LAVE Run Club"', '"label": "LAVE Strides"'),
    ('"label": "Family yoga"', '"label": "Family LAVEYoga"'),
    ('"label": "LAVE Living by Hope App"', '"label": "LAVE Living"'),
    # No LAVE Living provider is named until an agreement is signed; it shows as coming soon (1 November 2026).
    ('{"text": "LAVE Living, delivered by Hope App: wellbeing resources", "soon": false}',
     '{"text": "LAVE Living: wellbeing resources", "soon": true}'),
    ('{"text": "Full LAVE Living support, delivered by Hope App", "soon": false}', '{"text": "Full LAVE Living support", "soon": true}'),
    ('{"text": "LAVE Living for the whole household, delivered by Hope App", "soon": false}',
     '{"text": "LAVE Living for the whole household", "soon": true}'),
    ('"label": "LAVE Living (Hope App)"', '"label": "LAVE Living (coming soon)"'),
    ('{"label": "LAVE Living", "href": "/memberships/#compare"}', '{"label": "LAVE Living", "href": "/memberships/living/"}'),
    # LAVEnclave joins Wellbeing, after LAVE Living (only while LAVE Living is still last, so it's added once).
    ('{"label": "LAVE Living", "href": "/memberships/living/"}]',
     '{"label": "LAVE Living", "href": "/memberships/living/"}, {"label": "LAVEnclave", "href": "/memberships/#compare"}]'),
    ("Run Club, yoga, Founders Lab and LAVE Family visits", "LAVE Strides, LAVEYoga, Founders Lab and LAVE Family visits"),
    ("Run Club, yoga and gym members", "LAVE Strides, LAVEYoga and gym members"),
    ('{"label": "Lifestyle", "href": ""}, {"label": "Sport", "href": ""}, {"label": "Upcoming events", "href": ""}',
     '{"label": "All experiences", "href": "/memberships/access/upcoming-events/"}, {"label": "Households", "href": ""}, '
     '{"label": "Individuals", "href": ""}, {"label": "Corporates", "href": ""}'),
    ('{"label": "Families", "href": ""}, {"label": "Founders", "href": ""}, {"label": "Professionals", "href": ""}, '
     '{"label": "Children", "href": ""}, {"label": "Businesses", "href": ""}',
     '{"label": "Households", "href": ""}, {"label": "Individuals", "href": ""}, {"label": "Corporates", "href": ""}'),
    # The LAVE Living page laid out like LAVEWorld: an eyebrow over each heading, and a photo beside "Private, always".
    ("## What's on offer", "## Support · What's on offer"),
    ("## With your membership", "## Membership · With your membership"),
    ("## Private, always", "## Privacy · Private, always\n\n![](" + WP + "2024/07/LAVE_Fabricare_Service_Bedroom.webp)"),
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
    for pack in db.scalars(select(Pack)):
        if swap(pack.note or "") != (pack.note or ""):
            pack.note = swap(pack.note)
            changed += 1
    if changed:
        db.commit()
        from app.site import store
        store._cache["stamp"] = None
    return changed


# Legal pages, from app/site/data/policies/*.md. Added once; after that they're edited in /admin → Website → Pages.
POLICIES_DIR = Path(__file__).resolve().parent.parent / "site" / "data" / "policies"
POLICIES_UPDATED = "27 October 2026"
POLICY_DATES = {"terms": "28 October 2026", "privacy": "1 November 2026"}  # pages changed since they first went live
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


# Pages that ship with the code: (path, file in app/site/data/pages, title, intro, photo). Added once on deploy; after
# that they're edited in /admin → Website → Pages.
PAGES_DIR = Path(__file__).resolve().parent.parent / "site" / "data" / "pages"
SHIPPED_PAGES = [
    ("/memberships/living/", "lave-living", "LAVE Living",
     "Care, beyond the wardrobe. We look after the textiles you love. LAVE Living looks after you.",
     WP + "2025/05/LAVE_WELLNESS_Fabric_Care.avif"),
]


def load_pages(db: Session) -> int:
    """Add any SHIPPED_PAGES page the site doesn't have yet. Returns how many were added. Caller commits."""
    added = 0
    for path, name, title, intro, image in SHIPPED_PAGES:
        if not db.scalar(select(PageContent).where(PageContent.path == path)):
            db.add(PageContent(path=path, title=title, intro=intro, body=(PAGES_DIR / f"{name}.md").read_text(),
                               image=image, published=True))
            added += 1
    return added


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
    ("/policies/privacy/",
     "LAVE Living is provided by Hope App. We don't share your details with Hope App: if you'd like to use LAVE Living, you sign up with them directly, and their own privacy policy applies.",
     "LAVE Living, our members' wellbeing service, is coming soon. Before it opens, we'll update this policy to say who provides it and how your information is handled.",
     "1 November 2026"),
    # The newsletter box: Klaviyo sends the emails, and the browser remembers when the box was closed or answered.
    ("/policies/privacy/",
     'your name, email and postcode if you join our area or Apothecary waitlist.',
     'your name, email and postcode if you join our area or Apothecary waitlist, and your email address if you sign up for our news.',
     "3 November 2026"),
    ("/policies/privacy/",
     '| Twilio | Sends our text messages |\n\nLAVE Living',
     '| Twilio | Sends our text messages |\n| Klaviyo | Sends our news emails to people who sign up |\n\nLAVE Living',
     "3 November 2026"),
    ("/policies/privacy/",
     'or you ask us to remove you.\n\n## 8.',
     'or you ask us to remove you.\n- News emails: your email address, until you unsubscribe.\n\n## 8.',
     "3 November 2026"),
    ("/policies/cookies/",
     "They're cleared when you close the tab.\n\n## Managing cookies",
     "They're cleared when you close the tab.\n- If you close or answer the box inviting you to join our list, your browser remembers it (lave_signup, in local storage) so the box doesn't keep appearing: for 30 days if you close it, a year if you join.\n\n## Managing cookies",
     "3 November 2026"),
    ("/policies/privacy/",
     "the pieces we care for (description, brand, colour, condition),",
     "the pieces we care for (description, brand, colour, condition, and photos of them when they arrive, which only you "
     "and our team can see),",
     "6 November 2026"),
    ("/policies/privacy/",
     "which only you and our team can see), your care preferences and notes,",
     "which only you and our team can see); the LAVE Experiences you reserve, and any note you add to a reservation "
     "(such as a dietary need); your care preferences and notes,",
     "12 November 2026"),
]


# Menu photos changed since launch: (column title, old photo, new photo). Applied on deploy to saved menus where the
# column still has the old photo; a photo chosen in the admin is left alone.
MENU_PHOTO_CHANGES = [
    ("Pass On", WP + "2024/07/LAVE-Atelier-Preserve-Renew.avif", "/media/rehome-pass-on-tote.webp"),
    # The first Pass On photo was a designer's own product shot; replaced by a free Pexels photo (José Martin Segura
    # Benites, pexels.com/photo/26736140), widened to the menu's 4:3 frame.
    ("Pass On", "/media/rehome-pass-on.webp", "/media/rehome-pass-on-tote.webp"),
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


def update_resell_photos(db: Session) -> int:
    """Give a saved Resell page the default category photos where none was chosen, and swap the old, low-resolution
    opening photo. Photos chosen in the admin are left alone. Returns how many changed."""
    from app.models import Media
    from app.site import defaults
    row = db.get(SiteContent, "page.resell")
    if not row or not row.value:
        return 0
    page, fresh, changed = json.loads(json.dumps(row.value)), defaults.resell(), 0
    old = WP + "2025/08/LAVE-Business-Dry-Cleaning-Fashion.avif"
    if page.get("banner", {}).get("image") in {old, *db.scalars(select(Media.url).where(Media.source_url == old))}:
        page["banner"]["image"], changed = fresh["banner"]["image"], changed + 1
    photos = {c["key"]: c["banner_image"] for c in fresh["categories"]}
    for c in page.get("categories", []):
        if not c.get("banner_image") and photos.get(c.get("key")):
            c["banner_image"], changed = photos[c["key"]], changed + 1
    if changed:
        row.value, row.updated_by = page, "Resell photos"
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
    load_pages(db)
    if not db.scalar(select(Post).limit(1)):
        db.add(Post(slug=slugify(STARTER_POST["title"]), kind="thread", status=PostStatus.draft, **STARTER_POST))
    db.commit()
