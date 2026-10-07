"""Starting content for everything editable in /admin → Website.

Each document is plain JSON. The site uses the saved version from the database when there is one, and these
defaults otherwise ("Reset to original" in /admin goes back to these).
"""
from app import plans as plan_defaults
from app.site import content
from app.site.content import WP


_PLAN_IMAGES = {
    "essence": WP + "2025/04/Laundry-For-Your-Family_ESSENCE_Tier.webp",
    "elevate": WP + "2025/04/Laundry-For-Your-Family_ELEVATE_Tier-1.webp",
    "eclat": WP + "2025/04/LAVE_Monthly-Linen-Refresh_ECLAT.webp",
}


def _link(link) -> dict:
    return {"label": link[0], "href": link[1]} if isinstance(link, tuple) else {"label": link, "href": ""}


def menus() -> dict:
    return {"sections": [
        {"key": s.key, "title": s.title, "path": s.path, "hero": s.hero,
         "subnav": [{"title": n.title, "columns": [
             {"title": c.title, "image": c.image, "links": [_link(l) for l in c.links]} for c in n.columns]}
             for n in s.subnav]}
        for s in content.SECTIONS]}


def plans() -> dict:
    return {
        "plans": [{
            "code": p["code"], "name": p["name"], "tier": p["tier"], "price_pence": p["price_pence"],
            "annual_pence": p["annual_pence"], "tagline": p["tagline"], "builds_on": p["builds_on"] or "",
            "sections": [{"title": t, "items": items} for t, items in p["sections"]],
            "headline": list(p["headline"]),
            "image": _PLAN_IMAGES[p["code"]],
        } for p in plan_defaults.PLANS],
        "compare": [{"group": g, "rows": [{"label": label, "values": list(values)} for label, values in rows]}
                    for g, rows in plan_defaults.COMPARE],
        "extras": plan_defaults.EXTRAS,
    }


def home() -> dict:
    return {
        "apothecary": {"title": "The Apothecary", "link_text": "Discover", "href": "/apothecary/",
                       "image": WP + "2025/08/LAVE_London_Fabricare_Detergents.avif"},
        "atelier": {"title": "The Atelier", "link_text": "Discover", "href": "/atelier/",
                    "image": WP + "2025/12/LAVEAFRI-AtelierBannerr-2-scaled.webp"},
    }


def footer() -> dict:
    return {
        "welcome_heading": "Welcome to LAVE, your Textile Care Atelier",
        "welcome_text": "LAVE is a technology-enabled **Textile Care Atelier** that cares for, manages and extends the life "
                        "of wardrobes, home and business textiles.",
        "values_heading": "Care better.  Preserve what you treasure.",
        "values_text": "Our values guide every choice: intentional care for **people**, **planet**, and the **textiles** you treasure.",
        "links": [{"label": label, "href": href} for label, href in content.FOOTER["links"]],
        "social": [{"name": name, "url": url} for name, url, _icon in content.FOOTER["social"]],
    }


def _card(label, href, image):
    return {"label": label, "href": href, "image": image}


def atelier() -> dict:
    return {
        "heading": "Welcome to LAVE Atelier",
        "lead": "Explore how LAVE cares for your wardrobe, home and business textiles.",
        "text": "You invest in quality. You choose garments with intention. Your textiles deserve care shaped by the same "
                "values. At LAVE, we extend the life of what you treasure, from heirloom silks to everyday essentials, with "
                "expert cleaning, bespoke formulations, restoration and climate-conscious storage.",
        "clean": {"eyebrow": "Clean", "heading": "Laundry for your wardrobe, home & business",
                  "text": "Your fabrics deserve more than ordinary cleaning. We care for personal clothing, home textiles and "
                          "business needs with expertise designed for London's climate, protecting quality, comfort and what you cherish.",
                  "cards": [
                      _card("Women", "/atelier/clean/women/", WP + "2025/08/LAVE_London_Fabricare_DryCleaning_Women.avif"),
                      _card("Men", "/atelier/clean/men/", WP + "2025/08/LAVE_Dry-Cleaning-For-Your-Family_MAN.webp"),
                      _card("Children", "/atelier/clean/children/", WP + "2025/05/LAVE_GIRL_Fabric_Care.avif"),
                      _card("Pets", "/atelier/clean/pets/", WP + "2025/05/LAVE_PETS_Fabric_Care.avif")]},
        "booking": {"eyebrow": "How to book with LAVE", "heading": "Your LAVE journey starts here",
                    "text": "Choose a one-hour or Saver collection window, or drop off at the atelier. We text you when the driver "
                            "is close, tag and itemise every piece, and show you the price before we charge.",
                    "button": "Book a collection", "image": WP + "2024/11/LAVE_Dashboard_her.webp"},
        "refresh": {"eyebrow": "LAVE Refresh", "heading": "Laundry service that fits your life",
                    "text": "Your busy life demands easy care. We refresh everything, from clothing and gym wear to bedding and "
                            "towels, on your schedule: one-off, weekly, monthly or custom.",
                    "cards": [
                        _card("Ironing", "/atelier/clean/#homes", WP + "2025/12/LAVE_Atelier_Refresh_Ironing.avif"),
                        _card("Towels", "/atelier/clean/bedding/", WP + "2026/01/LAVE_Atelier_Towel_Refresh.webp"),
                        _card("Bedding", "/atelier/clean/bedding/", WP + "2025/12/LAVE_Atelier_Beddings.avif"),
                        _card("Pillows", "/atelier/clean/bedding/", WP + "2025/12/LAVE_Atelier_Refresh_Pillows.avif"),
                        _card("Duvets", "/atelier/clean/bedding/", WP + "2025/12/LAVE_Atelier_Refresh_Duvet.avif")]},
        "press": {"eyebrow": "Press Refresh", "heading": "Premium pressing",
                  "text": "Press Refresh is our premium pressing service. It keeps your wardrobe presentation-ready, extends the "
                          "life of your favourite pieces and gives you back precious time.",
                  "button": "Book pressing", "image": WP + "2026/01/LAVE-Atelier-Ironing-Service-scaled.avif"},
        "monthly": {"eyebrow": "Monthly Refresh", "heading": "Laundry and dry cleaning for your family",
                    "text": "A monthly wash, dry and fold service that keeps garments and home textiles fresh, cared for and "
                            "ready for life's moments."},
        "move": {"eyebrow": "Move Refresh", "heading": "Complete textile care for home transitions",
                 "text": "Professional fabric care for home moves. We collect, deep clean and refresh all your household "
                         "textiles, from bedding and curtains to upholstery, and deliver them fresh to your new address.",
                 "button": "Learn more", "image": WP + "2024/07/LAVE_Fabricare_Service_Bedroom.webp"},
        "business": {"eyebrow": "For business", "heading": "Textile care for the places people gather",
                     "text": "Linen, uniforms and soft furnishings for wellness studios, offices, fashion houses, hotels, "
                             "restaurants and clinics, on a schedule that fits your operation.",
                     "cards": [
                         _card("Wellness", "/atelier/clean/wellness/", WP + "2025/05/LAVE_WELLNESS_Fabric_Care.avif"),
                         _card("Corporates", "/atelier/clean/corporates/", WP + "2025/08/LAVE-Business-Dry-Cleaning-Office-Workers.avif"),
                         _card("Fashion", "/atelier/vault/fashion/", WP + "2025/08/LAVE-Business-Dry-Cleaning-Fashion.avif"),
                         _card("Hotels", "/atelier/clean/hospitality/", WP + "2025/05/LAVE_Hotels_Fabric_Care.avif"),
                         _card("Eateries", "/atelier/clean/hospitality/", WP + "2025/05/LAVE_Resturants_Eateries_Fabric_Care.avif"),
                         _card("Healthcare", "/atelier/clean/healthcare/", WP + "2025/08/LAVE-Business-Dry-Cleaning-healthcare.avif")]},
        "collections": {
            "women": "Coats, blazers, dresses and shirts, cleaned and hand-finished with the care each fabric needs.",
            "men": "Tailoring, shirts and outerwear, cleaned and pressed to keep their shape.",
            "children": "Gentle care for babywear, school uniforms and occasion outfits.",
            "pets": "Coats, beds and blankets for the animals in your home.",
        },
    }


def apothecary() -> dict:
    return {
        "heading": "The LAVE Apothecary",
        "lead": "Bespoke formulations to care better for your wardrobe, home and business textiles at home.",
        "text": "Beautifully fragranced detergents, treatments and tools, formulated by the atelier for the care of fine fabrics.",
        "groups": {
            "wash": "Detergents, conditioners and soaps in LAVE's signature scents.",
            "treat": "Lift stains, refresh fabrics and protect them between washes.",
            "edit": "Tools to maintain, store and mend your textiles.",
            "equip": "Considered essentials for the laundry room.",
        },
        "waitlist_heading": "Join the waitlist",
        "waitlist_text": "Be the first to know when we launch our fabric care solutions: beautifully fragranced detergents for "
                         "your home laundry and a specialist dry cleaning service.",
    }


def membership() -> dict:
    return {
        "eyebrow": "LAVE Membership",
        "heading": "Care for your wardrobe, every month",
        "text": "Regular collection, laundry, repairs and storage, with experiences that go beyond the wardrobe. Choose "
                "monthly, or pay for a year and get two months free.",
        "prive_text": "An exclusive textile care service for large houses and mansions.",
        "experiences_text": "Run Club, yoga, Founders Lab and LAVE Family visits, with new experiences added through the year.",
    }


def laveworld() -> dict:
    return {
        "heading": "Welcome to LAVEWorld",
        "lead": "The story, knowledge and community behind LAVE.",
        "text": "Care better. Preserve what you treasure. Our values guide every choice: intentional care for people, planet "
                "and the textiles you treasure.",
        "journal_heading": "THREAD by LAVE",
        "journal_text": "Notes on caring for the textiles in your life.",
        "values_heading": "What guides us",
        "connect": {"eyebrow": "Connect", "heading": "Join LAVEWorld",
                    "text": "Members enjoy monthly care, repairs, storage and invitations to LAVE Experiences across lifestyle and sport.",
                    "button": "See membership", "image": WP + "2025/12/LAVE-Membership.webp"},
    }


# What /admin → Website lists, in order. "locked" lists can't have entries added or removed; "readonly" fields can't change.
DOCUMENTS = {
    "home": {"title": "Home page", "help": "The two halves of the home page.", "default": home},
    "page.atelier": {"title": "Atelier page", "help": "Every heading, paragraph, card and photo on the Atelier page.",
                     "default": atelier, "locked": ["collections"]},
    "page.apothecary": {"title": "Apothecary page", "help": "Introduction, section notes and the waitlist box.",
                        "default": apothecary, "locked": ["groups"]},
    "page.membership": {"title": "Membership page", "help": "Introduction and the LAVE Privé and Experiences boxes.",
                        "default": membership},
    "page.laveworld": {"title": "LAVEWorld page", "help": "Introduction and section headings.", "default": laveworld},
    "menus": {"title": "Menus", "help": "The photo columns and links in each dropdown. The four sections and their "
                                         "sub-menus are fixed, because pages and web addresses hang off their names.",
              "default": menus, "locked": ["sections", "subnav"], "readonly": ["key", "path", "sections.title", "subnav.title"]},
    "plans": {"title": "Membership plans", "help": "Tier names, prices and benefits. Keep Stripe's prices in step with these.",
              "default": plans, "locked": ["plans", "values"], "readonly": ["code", "tier"]},
    "footer": {"title": "Footer", "help": "Use **double asterisks** around words to make them bold.", "default": footer,
               "locked": ["social"], "readonly": ["name"]},
}
