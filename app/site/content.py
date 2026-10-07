"""Site structure: the four sections, their sub-menus and the mega-menu columns under each.

Images point at the media already on lavelondon.com until they're uploaded to LAVE OS (phase 6 moves all of
this into the /admin editor). Columns marked draft=True are proposals the founder hasn't confirmed yet: the live
WordPress menus for those items show another section's content.
"""
import re
import unicodedata
from dataclasses import dataclass, field

WP = "https://lavelondon.com/wp-content/uploads/"


def slugify(text: str) -> str:
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", ascii_text.lower().replace("&", "and")).strip("-")


@dataclass
class Column:
    title: str
    image: str
    # Each link is either a label (its page is derived from the menu, e.g. /atelier/clean/women/)
    # or a (label, address) pair that points somewhere specific.
    links: list
    draft: bool = False

    @property
    def slug(self) -> str:
        return slugify(self.title)

    def items(self, section_path: str, sub_slug: str) -> list[tuple[str, str]]:
        return [link if isinstance(link, tuple) else (link, f"{section_path}{sub_slug}/{slugify(link)}/") for link in self.links]

    @property
    def labels(self) -> list[str]:
        return [link[0] if isinstance(link, tuple) else link for link in self.links]


@dataclass
class SubNav:
    title: str
    columns: list[Column] = field(default_factory=list)

    @property
    def slug(self) -> str:
        return slugify(self.title)


@dataclass
class Section:
    key: str
    title: str
    path: str
    subnav: list[SubNav]
    hero: str = ""
    hero_video: str = ""


SECTIONS: list[Section] = [
    Section("atelier", "Atelier", "/atelier/", hero=WP + "2025/11/LAVE-Fabric-Care-Atelier-scaled.webp", subnav=[
        SubNav("Clean", [
            Column("Personals", WP + "2024/07/LAVE-CLEAN.webp", ["Women", "Men", "Children", "Pets"]),
            Column("Homes", WP + "2024/07/LAVE_Fabricare_Service_Bedroom.webp", ["Bedding", "Drapery", "Tableware", "Furnishings"]),
            Column("Business", WP + "2024/07/LAVE-Atelier-Clean-Businesses.avif", ["Hospitality", "Wellness", "Corporates", "Healthcare"]),
            Column("Specialties", WP + "2024/07/LAVE-Atelier-Clean-Specialties.avif", ["Delicates", "Leather", "Bridal", "Heritage"]),
        ]),
        SubNav("Preserve", [
            Column("Fix & Restore", WP + "2024/07/LAVE-Atelier-Preserve-Repair.avif", ["Textiles", "Upholstery", "Leather"]),
            Column("Fit & Change", WP + "2024/07/LAVE-Atelier-Preserve-Alterations.avif", ["Adjustments", "Conversions", "Styling"]),
            Column("Protect", WP + "2024/07/Lave_Atelier_Protect.avif", ["Anti-Moth", "Repellents", "Specialist Care"]),
            Column("Re-imagine", WP + "2024/07/LAVE-Atelier-Preserve-Renew.avif", ["Upcycle", "Recycle", "Donate"]),
        ]),
        SubNav("Vault", [
            Column("Couture & Occasion", WP + "2024/07/LAVE-Atelier-Store-Couture.avif", ["Fashion", "Bridal", "Designer"]),
            Column("Art & Heirlooms", WP + "2025/11/LAVE-Atelier-Store-Textile.webp", ["Textiles", "Vintage linens", "Tapestries"]),
            Column("Decor & Drapery", WP + "2024/07/LAVE-Atelier-Store-Furnishings.avif", ["Rugs", "Upholstery", "Curtains"]),
            Column("Seasonal", WP + "2025/12/LAVE_Atelier_Store-1.webp", ["Plumes", "Everydays", "Delicates"]),
        ]),
        SubNav("Rehome", [
            Column("Move Refresh", WP + "2025/05/LAVE_HOME_Fabric_Care.avif", ["Bedding", "Curtains", "Upholstery"], draft=True),
            Column("Pass On", WP + "2024/07/LAVE-Atelier-Preserve-Renew.avif", ["Resell", "Gift", "Donate"], draft=True),
            Column("Uniform Refresh", WP + "2025/05/LAVE_GIRL_Fabric_Care.avif", ["Schools", "Families", "Campaign"], draft=True),
        ]),
    ]),
    Section("apothecary", "Apothecary", "/apothecary/", hero=WP + "2025/08/LAVE_London_Fabricare_Detergents.avif", subnav=[
        SubNav("Wash", [
            Column("Laundry", WP + "2024/03/Lave_Detergents-1.webp", ["Detergents", "Conditioners", "Soaps"]),
            Column("Collections", WP + "2024/03/LAVE_DARKS.webp", ["Bundles", "Kits", "Essentials"]),
            Column("Scents", WP + "2024/03/LAVE_MIST.webp", ["Artemis", "Serene", "Respire"]),
            Column("Washkits", WP + "2024/03/Lave_Dryer-Balls-1.webp", ["Brush", "Bag & Ball", "Refills"]),
        ]),
        SubNav("Treat", [
            Column("Stain", WP + "2024/07/Lave_Apothecary_Treatments_Stain.webp", ["Spot & Brighten"]),
            Column("Refresh", WP + "2024/07/Lave_Apothecary_Treatments_Refresh.webp", ["Odor & Refresh"]),
            Column("Protect", WP + "2024/07/Lave_Apothecary_Treatments_PROTECT.webp", ["Fabric Protection"]),
        ]),
        SubNav("Edit", [
            Column("Garment Care", WP + "2024/07/LAVE_Apothecary_Accessories_GarmentCare.webp", ["Maintain & Care"]),
            Column("Storage & Vessels", WP + "2024/07/LAVE_Apothecary_Accessories_Storage.webp", ["Organise & Refills"]),
            Column("Mending", WP + "2024/07/LAVE_Apothecary_Accessories_Mending.webp", ["Fabric Repair"]),
        ]),
        SubNav("Equip", [
            Column("Laundry Room", WP + "2025/12/LAVE_Atelier_Beddings.avif", ["Baskets", "Drying", "Hangers"], draft=True),
            Column("Pressing", WP + "2025/12/LAVE_Atelier_Refresh_Ironing.avif", ["Steamers", "Irons", "Boards"], draft=True),
            Column("Travel", WP + "2024/07/LAVE_Apothecary_Accessories_Storage.webp", ["Garment Bags", "Wash Kits"], draft=True),
        ]),
    ]),
    Section("membership", "Membership", "/memberships/", hero=WP + "2025/12/LAVE-Membership.webp", subnav=[
        SubNav("Discover", [
            Column("How it works", WP + "2025/12/LAVEAFRI-AtelierBannerr-2-scaled.webp", [
                ("Your collection day", "/memberships/#plans-overview"), ("Your laundry bags", "/memberships/#compare"),
                ("Care records", "/memberships/#compare")], draft=True),
            Column("Compare tiers", WP + "2026/01/LAVE_Atelier_Towel_Refresh.webp", [
                ("At a glance", "/memberships/#compare"), ("Annual: two months free", "/memberships/#plans-overview")], draft=True),
            Column("Questions", WP + "2025/12/LAVE_Atelier_Refresh_Ironing.avif", [
                ("Contact us", "/contact/"), ("LAVE Privé enquiries", "/contact/?topic=prive")], draft=True),
        ]),
        SubNav("Plans", [
            Column("Essence", WP + "2025/04/Laundry-For-Your-Family_ESSENCE_Tier.webp", ["£29 a month", "£290 a year"]),
            Column("Elevate", WP + "2025/04/Laundry-For-Your-Family_ELEVATE_Tier-1.webp", ["£59 a month", "£590 a year"]),
            Column("Éclat", WP + "2025/04/LAVE_Monthly-Linen-Refresh_ECLAT.webp", ["£129 a month", "£1,290 a year"]),
        ]),
        SubNav("Benefits", [
            Column("Care", WP + "2024/07/LAVE-Atelier-Preserve-Alterations.avif", [
                ("Fixed collection day", "/memberships/#compare"), ("Repairs and alterations", "/memberships/#compare"),
                ("Seasonal storage", "/memberships/#compare"), ("Wardrobe visits", "/memberships/#compare")]),
            Column("Wellbeing", WP + "2025/05/LAVE_WELLNESS_Fabric_Care.avif", [
                ("LAVE Run Club", "/memberships/#compare"), ("Yoga", "/memberships/#compare"),
                ("LAVE Living by Hope App", "/memberships/#compare")]),
            Column("Community", WP + "2025/08/LAVE-Business-Dry-Cleaning-Office-Workers.avif", [
                ("Founders Lab", "/memberships/#compare"), ("LAVE Family", "/memberships/#eclat"),
                ("Coffee Lounge (coming soon)", "/memberships/#compare")]),
        ]),
        SubNav("Access", [
            Column("LAVE Privé", WP + "2025/06/LAVE_Monthly-Linen-Refresh_MAISON-PRIVE.webp", [
                ("Large houses and mansions", "/contact/?topic=prive"), ("Enquire", "/contact/?topic=prive")]),
            Column("LAVE Experiences", WP + "2025/12/LAVE-Membership.webp", ["Lifestyle", "Sport", "Upcoming events"]),
            Column("LAVE Family", WP + "2025/05/LAVE_GIRL_Fabric_Care.avif", [
                ("City visits for children", "/memberships/#eclat"), ("Family yoga", "/memberships/#eclat")]),
        ]),
    ]),
    Section("laveworld", "LAVEWorld", "/laveworld/", hero=WP + "2025/11/LAVE-Fabric-Care-Sustainability.webp", subnav=[
        SubNav("Story", [
            Column("Creation", WP + "2025/12/LAVE-Origin.webp", [("How LAVE began", "/laveworld/story/creation/")]),
            Column("Heritage", WP + "2025/11/LAVE-Atelier-Store-Textile.webp", [("The craft of care", "/laveworld/story/heritage/")]),
            Column("Purpose", WP + "2025/11/LAVE-Fabric-Care-Atelier-scaled.webp", [("Why LAVE exists", "/laveworld/story/purpose/")]),
        ]),
        SubNav("Knowledge", [
            Column("THREAD by LAVE", WP + "2024/04/Lave-Content-1.webp", [("Latest stories", "/laveworld/knowledge/thread-by-lave/")]),
            Column("Events", WP + "2024/07/LAVE-Atelier-Store-Couture.avif", [("Upcoming events", "/laveworld/knowledge/events/")]),
            Column("Press", WP + "2025/08/LAVE-Business-Dry-Cleaning-Fashion.avif", [("In the press", "/laveworld/knowledge/press/")]),
        ]),
        SubNav("Connect", [
            Column("Community", WP + "2025/05/LAVE_WELLNESS_Fabric_Care.avif", [
                ("LAVE Run Club", "/memberships/#compare"), ("Founders Lab", "/memberships/#compare")], draft=True),
            Column("Events", WP + "2025/12/LAVE-Membership.webp", [
                ("Upcoming events", "/laveworld/knowledge/events/"), ("Member experiences", "/memberships/access/upcoming-events/")], draft=True),
            Column("Contact", WP + "2025/05/LAVE_Hotels_Fabric_Care.avif", [
                ("Contact us", "/contact/"), ("LAVE Privé", "/contact/?topic=prive")], draft=True),
        ]),
        SubNav("Impact", [
            Column("People", WP + "2025/12/LAVEAFRI-AtelierBannerr-2-scaled.webp", [("Our people", "/laveworld/impact/people/")]),
            Column("Planet", WP + "2024/04/LAVE-CIRCULAR-VALUES.webp", [("Our planet", "/laveworld/impact/planet/")]),
            Column("Principles", WP + "2024/07/LAVE-Atelier-Preserve-Renew.avif", [("Our principles", "/laveworld/impact/principles/")]),
        ]),
    ]),
]

BY_KEY = {s.key: s for s in SECTIONS}
BY_PATH = {s.path.strip("/"): s for s in SECTIONS}

FOOTER = {
    "anagram": WP + "2024/03/LAVE_2026_Anagram_V2-300x300.webp",
    "links": [("LAVEWorld", "/laveworld/"), ("Services", "/atelier/"), ("Membership", "/memberships/"), ("Connect", "/laveworld/connect/"), ("Support", "/contact/")],
    # (name, url, SVG path). Icons are drawn white inside a navy circle.
    "social": [
        ("Facebook", "https://www.facebook.com/lavelondon",
         '<path d="M13.5 21v-7.5h2.5l.4-3h-2.9V8.6c0-.9.3-1.5 1.5-1.5h1.5V4.4c-.3 0-1.2-.1-2.2-.1-2.2 0-3.7 1.3-3.7 3.8v2.3H8v3h2.6V21z"/>'),
        ("Instagram", "https://www.instagram.com/lavelondon/",
         '<path d="M12 7.3A4.7 4.7 0 1 0 12 16.7 4.7 4.7 0 0 0 12 7.3zm0 7.7a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm4.9-8.9a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2zM20.9 8c-.1-1.5-.4-2.8-1.5-3.9S17 2.7 15.5 2.6C14 2.5 10 2.5 8.5 2.6 7 2.7 5.7 3 4.6 4.1S3.1 6.5 3.1 8c-.1 1.5-.1 5.5 0 7 .1 1.5.4 2.8 1.5 3.9s2.4 1.4 3.9 1.5c1.5.1 5.5.1 7 0 1.5-.1 2.8-.4 3.9-1.5s1.4-2.4 1.5-3.9c.1-1.5.1-5.5 0-7zm-2 8.8c-.3.8-1 1.5-1.8 1.8-1.3.5-4.3.4-5.6.4s-4.4.1-5.6-.4c-.8-.3-1.5-1-1.8-1.8-.5-1.3-.4-4.3-.4-5.6s-.1-4.4.4-5.6c.3-.8 1-1.5 1.8-1.8 1.3-.5 4.3-.4 5.6-.4s4.4-.1 5.6.4c.8.3 1.5 1 1.8 1.8.5 1.3.4 4.3.4 5.6s.1 4.4-.4 5.6z"/>'),
        ("YouTube", "https://www.youtube.com/@lavelondon",
         '<path d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8c1.6.4 7.8.4 7.8.4s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8zM10 15V9l5.2 3z"/>'),
        ("X", "https://x.com/lavelondon",
         '<path d="M17.8 3h3.1l-6.8 7.7L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.2-8.3L1.8 3h6.4l4.4 5.8zm-1.1 16.2h1.7L7.4 4.7H5.6z"/>'),
        ("Threads", "https://www.threads.com/@lavelondon",
         '<path d="M16.6 11.2l-.3-.1c-.2-3.1-1.9-4.9-4.8-4.9-1.7 0-3.2.7-4.1 2.1l1.6 1.1c.7-1 1.7-1.2 2.5-1.2 1 0 1.7.3 2.2.8.3.4.5.9.6 1.5-.8-.1-1.7-.2-2.6-.1-2.6.2-4.3 1.7-4.2 3.8.1 1.1.6 2 1.5 2.6.8.5 1.8.8 2.8.7 1.4-.1 2.4-.6 3.2-1.5.6-.7.9-1.6 1-2.8.7.4 1.2.9 1.4 1.6.5 1.1.5 2.9-1 4.4-1.3 1.3-2.8 1.8-5.2 1.9-2.6 0-4.6-.9-5.9-2.5-1.2-1.5-1.8-3.7-1.8-6.4s.6-4.9 1.8-6.4c1.3-1.6 3.3-2.5 5.9-2.5 2.7 0 4.7.9 6 2.5.7.8 1.1 1.8 1.4 3l1.9-.5c-.4-1.4-1-2.7-1.8-3.7C17.8 3 15.3 1.9 12 1.9h-.1c-3.3 0-5.8 1.1-7.4 3.1C3 6.9 2.2 9.4 2.2 12.5s.8 5.6 2.3 7.5c1.6 2 4.1 3.1 7.4 3.1h.1c2.9 0 5-.8 6.7-2.5 2.3-2.3 2.2-5.2 1.5-6.9-.5-1.2-1.5-2.2-2.8-2.8zm-4.7 4.6c-1.1.1-2.3-.4-2.3-1.5 0-.8.6-1.7 2.4-1.8h.6c.6 0 1.2.1 1.8.2-.2 2.4-1.4 3-2.5 3.1z"/>'),
    ],
}

LOGO_NAVY = WP + "2024/07/LAVE-logo-4000w-scaled.webp"
LOGO_WHITE = WP + "2024/05/LAVE-logo-white-4000w-scaled.webp"
FAVICON = WP + "2026/06/cropped-LAVE_2026_Anagram-32x32.webp"
# Brand images used on every page. "Copy images now" in /admin copies these too, and the site then uses the copies.
BRAND = {"logo_navy": LOGO_NAVY, "logo_white": LOGO_WHITE, "anagram": FOOTER["anagram"], "favicon": FAVICON}
