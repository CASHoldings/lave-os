"""Membership plans: the single source for names, prices and benefits shown anywhere on the site.

Stripe holds the billing truth (LAVE_STRIPE_PRICE_<CODE> and LAVE_STRIPE_PRICE_<CODE>_ANNUAL);
keep its prices in step with these. Items marked soon=True show a "Coming soon" label.
"""


def _items(*rows):
    return [{"text": r, "soon": False} if isinstance(r, str) else {"text": r[0], "soon": True} for r in rows]


PLANS = [
    {
        "code": "essence", "name": "Essence", "tier": 1, "price_pence": 2900, "annual_pence": 29000,
        "tagline": "Care, on a schedule you can count on.",
        "builds_on": None,
        "sections": [
            ("Collection", _items(
                "A fixed fortnightly collection day for your neighbourhood (two collections a month)",
                "A 2-hour collection and return window",
                "Standard return")),
            ("Care included", _items(
                "1 LAVE laundry bag a month: 6 kg, washed, dried and folded",
                "A care record for every garment we handle",
                "A founding welcome kit")),
            ("Member experience", _items(
                "LAVE Run Club: monthly group runs",
                "LAVE Living, delivered by Hope App: wellbeing resources",
                "Member prices on extras: £16 per additional bag, £15 a month per storage box",
                ("LAVE Coffee Lounge access",))),
        ],
        "headline": ["Fortnightly collection, 2-hour window", "1 laundry bag a month (6 kg)", "LAVE Run Club and LAVE Living"],
    },
    {
        "code": "elevate", "name": "Elevate", "tier": 2, "price_pence": 5900, "annual_pence": 59000,
        "tagline": "For people who invest in their wardrobe.",
        "builds_on": "Essence",
        "sections": [
            ("Collection", _items(
                "A fixed weekly collection day",
                "A 1-hour collection and return window",
                "Priority return",
                "1 extra collection a month, on request")),
            ("Care included", _items(
                "2 LAVE laundry bags a month",
                "1 repair or alteration a month",
                "1 seasonal storage box",
                "2 wardrobe visits a year with your Fabric Care Concierge",
                "Specialist items (leather, bridal, couture) assessed first and booked with priority")),
            ("Member experience", _items(
                "Monthly yoga sessions",
                "LAVE Founders Lab: quarterly evenings for founders and professionals",
                "Partner gym access and perks",
                "Full LAVE Living support, delivered by Hope App",
                "Priority booking for all member events")),
        ],
        "headline": ["Weekly collection, 1-hour window", "2 bags, 1 repair and 1 storage box a month", "Wardrobe visits with your Fabric Care Concierge"],
    },
    {
        "code": "eclat", "name": "Éclat", "tier": 3, "price_pence": 12900, "annual_pence": 129000,
        "tagline": "Care for the whole household.",
        "builds_on": "Elevate",
        "sections": [
            ("Collection", _items(
                "A weekly collection day, plus 1 extra collection a month",
                "Handover in your home or at your concierge desk",
                "Priority return")),
            ("Care included", _items(
                "4 LAVE laundry bags a month (one a week)",
                "2 repairs or alterations a month",
                "2 seasonal storage boxes",
                "1 bedding set cleaned each month",
                "2 wardrobe visits a year, covering the whole household")),
            ("Member experience", _items(
                "LAVE Family: city visits for children, such as a tour of Parliament, museums and behind-the-scenes visits to London landmarks",
                "Family yoga sessions",
                "LAVE Living for the whole household, delivered by Hope App",
                "A guest place at member events",
                ("Priority seating at the LAVE Coffee Lounge",))),
        ],
        "headline": ["Weekly collection with in-home handover", "4 bags, 2 repairs and a bedding set a month", "LAVE Family visits for the whole household"],
    },
]

# "At a glance" comparison. "yes" shows a tick, "no" a dash; anything else is shown as written.
COMPARE = [
    ("Collection and return", [
        ("Price a month / a year", ["£29 / £290", "£59 / £590", "£129 / £1,290"]),
        ("Collection", ["Fortnightly, 2-hour window", "Weekly, 1-hour window, +1 extra a month",
                        "Weekly, +1 extra a month, in-home or concierge handover"]),
        ("Return", ["Standard", "Priority", "Priority"]),
    ]),
    ("Care", [
        ("Laundry bags (6 kg)", ["1", "2", "4"]),
        ("Repairs and alterations", ["Member price", "1 a month", "2 a month"]),
        ("Storage boxes", ["Member price", "1", "2"]),
        ("Bedding set", ["no", "no", "1 a month"]),
        ("Wardrobe visits", ["no", "2 a year", "2 a year, whole household"]),
    ]),
    ("Member experience", [
        ("Run Club", ["yes", "yes", "yes"]),
        ("LAVE Living (Hope App)", ["Wellbeing resources", "Full support", "Whole household"]),
        ("Yoga", ["no", "Monthly", "Monthly, plus family sessions"]),
        ("Founders Lab", ["no", "Quarterly", "Quarterly"]),
        ("Gym partner perks", ["no", "yes", "yes"]),
        ("LAVE Family city visits", ["no", "no", "yes"]),
        ("Coffee Lounge (coming soon)", ["Access", "Access", "Priority seating"]),
    ]),
]

EXTRAS = "Member prices on extras: £16 per additional bag, £15 a month per storage box."

BY_CODE = {p["code"]: p for p in PLANS}
NAMES = {p["code"]: p["name"] for p in PLANS}
PRICES = {p["code"]: p["price_pence"] for p in PLANS}


def gbp(pence: int) -> str:
    """£29, £4.95, £1,290."""
    return f"£{pence / 100:,.0f}" if pence % 100 == 0 else f"£{pence / 100:,.2f}"
