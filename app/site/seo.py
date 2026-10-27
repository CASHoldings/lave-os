"""What search engines and link previews read: page descriptions, and structured data (schema.org JSON-LD) that tells
Google LAVE is a local laundry and dry cleaner, what it charges and where it works."""
import json

from markupsafe import Markup

from app.site.content import SERVICE_MESSAGE, SLOGAN, TAGLINE

OG_IMAGE = "/static/site/og-lave.jpg"  # 1200 × 630, used when a page has no photo of its own
AREAS = ["Battersea", "Nine Elms", "Battersea Power Station", "SW11"]

# Pages without a description of their own (most set theirs in their template).
DESCRIPTIONS = {
    "/": "Premium dry cleaning and laundry collection in South London. LAVE is an eco-conscious textile care atelier "
         "extending the life of your wardrobe and home fabrics.",
    "/contact/": "Contact LAVE, London's Textile Care Atelier, about bookings, membership, LAVE Privé, business care or press. "
                 "Call +44 7763 566 145.",
    "/laveworld/knowledge/": "THREAD by LAVE: guides to caring for clothes and home textiles, with LAVE news, events and press.",
    "/atelier/clean/": "Dry cleaning, laundry and wash & fold for wardrobes and home textiles in Battersea, Nine Elms and SW11, "
                       "collected and returned from 48 hours.",
    "/atelier/preserve/": "Repairs, alterations, restoration and specialist care that extend the life of the clothes and "
                          "textiles you love. LAVE Atelier, London.",
    "/atelier/vault/": "The LAVE Vault: clean, protected storage for couture, bridal, seasonal wardrobes, heirlooms and home "
                       "textiles, returned when you need them.",
    "/atelier/rehome/": "Moving, passing on or refreshing: LAVE prepares bedding, curtains and wardrobes to rehome, resell, "
                        "gift or donate.",
    "/apothecary/wash/": "Detergents, conditioners, soaps and wash kits from the LAVE Apothecary, made for caring for fabrics at home.",
    "/apothecary/treat/": "Stain, odour and fabric protection treatments from the LAVE Apothecary, for clothes and home textiles.",
    "/apothecary/edit/": "Curated fabric care edits from the LAVE Apothecary: repair, maintenance, organising and refills.",
    "/apothecary/equip/": "Hangers, garment bags, steamers, irons, boards and brushes from the LAVE Apothecary, to look after "
                          "what you own.",
    "/memberships/discover/": "Discover LAVE membership: scheduled collections, care included every month and member "
                              "experiences, from £29 a month in Battersea and SW11.",
    "/memberships/plans/": "Compare LAVE's Essence, Elevate and Éclat memberships: collections, laundry bags, repairs and "
                           "storage included, from £29 a month.",
    "/memberships/benefits/": "What LAVE members receive: complimentary Saver collection and return, laundry bags, repairs, "
                              "storage boxes and wardrobe visits.",
    "/memberships/access/": "Member access at LAVE: Run Club, yoga, Founders Lab, LAVE Living and member events in London.",
    "/laveworld/story/": "The story of LAVE, London's Textile Care Atelier: our purpose, how we began and the craft behind our care.",
    "/laveworld/connect/": "Connect with LAVE: events, partnerships, press and the people behind London's Textile Care Atelier.",
    "/laveworld/impact/": "LAVE's impact: intentional care for people, the planet and the textiles you love, by extending the "
                          "life of what you own.",
}


def jsonld(data: dict) -> Markup:
    # "</" can't appear inside a script element, so it's escaped.
    return Markup('<script type="application/ld+json">' + json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
                  + "</script>")


def absolute(site_url: str, url: str) -> str:
    return url if not url or url.startswith("http") else site_url + url


def business(site_url: str, social: list[dict]) -> dict:
    """LAVE as a local business that comes to its customers (no shopfront address shown)."""
    return {
        "@context": "https://schema.org",
        "@type": "DryCleaningOrLaundry",
        "@id": f"{site_url}/#business",
        "name": "LAVE",
        "legalName": "LAVE LTD",
        "description": f"{SLOGAN}. {TAGLINE}. London's Textile Care Atelier: {SERVICE_MESSAGE.lower()}. Dry cleaning, "
                       "laundry, repairs, alterations and storage, collected from your door.",
        "slogan": f"{SLOGAN}. {TAGLINE}.",
        "url": f"{site_url}/",
        "image": f"{site_url}{OG_IMAGE}",
        "logo": f"{site_url}{OG_IMAGE}",
        "telephone": "+447763566145",
        "email": "hello@lavelondon.com",
        "priceRange": "££",
        "currenciesAccepted": "GBP",
        "paymentAccepted": "Credit card, Debit card",
        "areaServed": [{"@type": "Place", "name": f"{a}, London"} for a in AREAS],
        "openingHoursSpecification": [{
            "@type": "OpeningHoursSpecification",
            "dayOfWeek": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
            "opens": "06:00", "closes": "22:00"}],
        "potentialAction": {"@type": "ReserveAction", "name": "Book a collection",
                            "target": {"@type": "EntryPoint", "urlTemplate": f"{site_url}/book/"}},
        "sameAs": [s["url"] for s in social if s.get("url")],
    }


def product(site_url: str, p, image_url: str, selling: bool) -> dict:
    prices = [v.price_pence for v in p.variants if v.active] or [0]
    in_stock = selling and any(v.active and v.stock > 0 for v in p.variants)
    data = {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": p.name,
        "description": p.summary,
        "brand": {"@type": "Brand", "name": "LAVE"},
        "url": f"{site_url}/apothecary/products/{p.slug}/",
        "offers": {
            "@type": "AggregateOffer" if len(set(prices)) > 1 else "Offer",
            "priceCurrency": "GBP",
            **({"lowPrice": f"{min(prices) / 100:.2f}", "highPrice": f"{max(prices) / 100:.2f}"}
               if len(set(prices)) > 1 else {"price": f"{prices[0] / 100:.2f}"}),
            "availability": "https://schema.org/InStock" if in_stock else
                            ("https://schema.org/OutOfStock" if selling else "https://schema.org/PreOrder"),
            "seller": {"@id": f"{site_url}/#business"},
        },
    }
    if image_url:
        data["image"] = absolute(site_url, image_url)
    return data


def memberships(site_url: str, plans: list[dict]) -> dict:
    return {
        "@context": "https://schema.org",
        "@type": "Service",
        "name": "LAVE Membership",
        "serviceType": "Laundry and dry cleaning membership",
        "provider": {"@id": f"{site_url}/#business"},
        "areaServed": [{"@type": "Place", "name": f"{a}, London"} for a in AREAS],
        "url": f"{site_url}/memberships/",
        "hasOfferCatalog": {
            "@type": "OfferCatalog",
            "name": "Membership plans",
            "itemListElement": [{
                "@type": "Offer",
                "name": f"{p['name']} membership",
                "description": p.get("tagline", ""),
                "price": f"{p['price_pence'] / 100:.2f}",
                "priceCurrency": "GBP",
                "priceSpecification": {"@type": "UnitPriceSpecification", "price": f"{p['price_pence'] / 100:.2f}",
                                       "priceCurrency": "GBP", "unitText": "month"},
                "url": f"{site_url}/memberships/#{p['code']}",
            } for p in plans],
        },
    }
