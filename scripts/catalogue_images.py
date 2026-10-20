"""Turn the founder's photo folder into web images for the price list, packs and category banners.

    python3 scripts/catalogue_images.py ~/Downloads/Lave

Writes WebP copies to app/site/data/images/ plus manifest.json, which says which photo goes on which item, pack
and category. On deploy, `app.release` adds them to the image library and assigns them (only where nothing has
been chosen yet, so photos picked in /admin are never replaced). Needs Pillow (`pip install pillow`).
"""
import json
import re
import sys
from pathlib import Path

from PIL import Image

OUT = Path(__file__).resolve().parent.parent / "app" / "site" / "data" / "images"

# Studio shots (garment on the grey backdrop) → price-list item.
ITEMS = {
    "MEN,  SHIRT, COTTON": "Shirt, non-member hung",
    "MEN, SHIRT, COTTON": "Shirt, non-member folded",
    "MEN, SHIRT, LINEN": "Shirt, linen/dark hung",
    "MEN, COLLAR SHIRT, LINEN": "Shirt, linen/dark folded",
    "WOMEN, SHIRT, COTTON": "Shirt, lady washable",
    "WOMEN, T-SHIRT, COTTON": "T-shirt, washable",
    "MEN, POLO SHIRT, COTTON": "T-shirt/polo, washable",
    "WOMEN, LAYERED TOP, JERSEY AND COTTON-POPLIN": "Top, long sleeve (wash & press)",
    "WOMEN, BLOUSE, COTTON-TWILL": "Blouse (wash & press)",
    "MEN, ZIP-UP HOODIE, COTTON-JERSEY": "Sweatshirt / hoodie",
    "MEN, TANK, COTTON": "Vest top",
    "MEN, SHIRT, COTTON AND LINEN BLEND": "Shirt, silk (men's)",
    "WOMEN, BLOUSE, STRETCH-JERSEY": "Top/blouse, plain",
    "WOMEN, BLOUSE, SILK": "Top/blouse, silk",
    "WOMEN, METALLIC TWEED, SEQUIN-EMBELISHED": "Top, beaded",
    "WOMEN, T-SHIRT, STRETCH-JERSEY": "T-shirt",
    "MEN, SHIRT, COTTON BLEND": "Shirt, dry clean",
    "WOMEN, CHEMISE, COTTON-JERSEY": "Bolero / shrug",
    "MEN, TIE, SILK": "Tie",
    "MEN, SUIT (2 PIECES)": "Suit (2pc)",
    "MEN, 3 PIECE SUIT": "Suit, 3-piece",
    "MEN,  2 SUITS (4 PIECES)": "Dinner suit",
    "WOMEN, SUIT COMBO - 2 PIECE SUIT (2 PIECES IN TOTAL)": "Suit, skirt+jacket",
    "WOMEN, SUIT DRESS, WOOL": "Suit, dress+jacket",
    "WOMEN, JUMPSUIT (2)": "Jumpsuit, short",
    "WOMEN, JUMPSUIT": "Jumpsuit, long",
    "WOMEN, VEST, CASHMERE": "Waistcoat",
    "WOMEN, SUIT COMBO - 2 PIECE SUITS ( 2 PIECES IN TOTAL)": "Suit (2 pcs) combo",
    "MEN, BLAZER, LINEN": "Suit, linen 2-piece",
    "MEN, 3 PIECE SUIT (2)": "Morning suit, 3-piece",
    "MEN, BLAZER, WOOL": "Dinner jacket",
    "MEN, SUIT TROUSERS WOOL": "Dinner trousers",
    "MEN, BOW-TIE, VELVET": "Bow tie",
    "WOMEN, MID-THIGH BODYSUIT": "Playsuit",
    "WOMEN, JACKET, WOOL-TWILL": "Jacket, standard",
    "WOMEN, BLAZER, CREPE": "Jacket, tailored",
    "WOMEN, DOWN-JACKET, WOOL- BLEND, QUILTED": "Jacket, quilted",
    "MEN, SKI, JACKET, QUILTED AND  PADED": "Jacket, puffa",
    "MEN, JACKET, BOMBER, SATIN": "Jacket, zipped",
    "MEN, BOMBER JACKET, SHEARLING-TRIMMED FELT": "Jacket, leather trim",
    "MEN, JACKET, LINEN": "Jacket, linen",
    "MEN, GILET, QUILTED SHELL DOWN": "Gilet / body warmer (puffa)",
    "WOMEN, DOUBLE BREASTED BLAZER, WOOL GRAIN DE POUDRE, SATIN-TRIMMED": "Jacket, designer",
    "MEN,  TROUSERS, WOOL": "Trousers, standard",
    "MEN, TROUSERS, JEANS, DENIM": "Jeans",
    "MEN, SHORTS, LINEN": "Shorts",
    "MEN, TROUSERS, PONTE": "Trousers, wash & press",
    "WOMEN, SUIT TROUSERS, CREPE": "Trousers, silk / delicate",
    "MEN, TROUSERS, LINEN": "Trousers, linen",
    "MEN, SWEATPANTS, COTTON-BLEND": "Tracksuit bottoms / joggers",
    "WOMEN, TROUSERS, WOOL-TWILL": "Trousers, culottes",
    "WOMEN, MINI SKIRT, STRETCH WOOL": "Skirt, plain short",
    "WOMEN, MIDI SKIRT, WOOL": "Skirt, plain long",
    "WOMEN, SKIRT, DRAPED, WOOL-CREPE": "Skirt, part pleated",
    "MAXI SKIRT, TWILL": "Skirt, full pleat",
    "WOMEN, MIDI SKIRT, SATIN": "Skirt, silk / delicate",
    "WOMEN, MIDI SKIRT, COTTON": "Skirt, wash & press",
    "WOMEN, MINI DRESS, WOVEN": "Dress, plain short",
    "WOMEN, MINI-DRESS, SATIN": "Dress, short silk",
    "WOMEN, MAXI- DRESS, COTTON": "Dress, plain long",
    "WOMEN, MIDI-DRESS, SATIN": "Dress, long silk",
    "LAVE118": "Dress, evening",
    "WOMEN, MAXI- DRESS, ORGANZA": "Dress, evening silk",
    "WOMEN, MAXI- DRESS, ORGANZA (2)": "Dress, evening long",
    "LAVE140": "Dress, beaded delicate",
    "WOMEN, MIDI-DRESS, STRETCH LACE": "Dress, delicate",
    "WOMEN, MIDI-DRESS, COTTON-POPLIN": "Dress, wash & press",
    "WOMEN, NIGHTDRESS, SILK-SATIN": "Nightdress",
    "21 copy": "Wedding dress (clean, hung)",
    "433": "Wedding dress (clean + boxed)",
    "LAVE126": "Prom dress",
    "WOMEN, COAT, WOOL-TWEED": "Coat, 3/4",
    "MEN, COAT, WOOL AND CASHMERE-BLEND": "Coat, long",
    "LAVE124": "Coat, puffa",
    "WOMEN, COAT, CASHMERE": "Coat, cashmere",
    "WOMEN, COAT, TRENCH": "Coat, trench",
    "WOMEN, COAT, TEDDY BEAR, WOOL": "Coat, imitation fur",
    "WOMEN, SHELL COAT,": "Coat / jacket, Moncler / Canada Goose",
    "WOMEN, COAT, CAMEL HAIR": "Coat, designer (Burberry / Max Mara)",
    "MEN, COAT, HOODED,  COTTON-BLEND": "Coat, wash & press",
    "MEN, SWEATER, COTTON": "Knitwear, light",
    "WOMEN, SWEATER, CABLE-KNIT, MERINO WOOL": "Knitwear, heavy",
    "MEN, ACCESSORIES, SNOOD": "Scarf, small",
    "MEN, ACCESSORIES, SCARF, WOOL": "Scarf, large",
    "MEN, SKI, BEANIE, MERINO WOOL": "Cap/hat",
    "MEN, ACCESSORIES, SCARF, WOOL AND SILK": "Pashmina/shawl",
    "WOMEN, ROBE, COTTON -JERSEY": "Dressing gown",
    "WOMEN, CARDIGAN, WOOL": "Cardigan",
    "WOMEN, CARDIGAN, HOODED, LONG": "Cardigan, long",
    "MEN, SWEATER, CASHMERE": "Jumper, cashmere",
    "MEN, ACCESSORIES, SCARF, SILK": "Scarf, silk",
    "MEN, ACCESSORIES, POCKET SQUARE, LINEN": "Handkerchief",
    "MEN, ACCESSORIES, POCKET SQUARE, SILK": "Handkerchief, silk",
    "MEN, ACCESSORIES, GLOVES,CASHMERE": "Gloves, fabric",
    "WOMEN, CAMISOLE": "Petticoat / slip",
    "NGSFI2026134": "Child's item, age 0-3",
    "GIRL, TOP COTTON": "Child's item, age 3-6",
    "GIRL, DRESS, SATIN": "Child's dress (dry clean)",
    "BOY, WATERPROOF COAT, COTTON": "Child's coat (dry clean)",
    "BOY, CORDUROY, COTTON": "Child's suit (dry clean)",
    "BOY, SWEATER, WOOL": "Child's knitwear",
    "GIRL, TROUSERS, JEANS": "Child's trousers",
    "MEN, SWEATPANTS, CASHMERE-BLEND": "Tracksuit (top + bottoms)",
    "27 copy": "Lab coat",
    "MEN, JACKET, LEATHER": "Leather jacket",
    "WOMEN, MIDI SKIRT, LEATHER": "Leather skirt",
    "WOMEN, TRENCH COAT, LEATHER, DOUBLE-BREASTED": "Leather coat, 3/4",
    "MEN, JACKET, LEATHER (2)": "Leather coat, long",
    "MEN, JACKET, BOMBER, SUEDE": "Suede jacket",
    "WOMEN, MINI SKIRT, SUEDE": "Suede skirt",
    "WOMEN, COAT, SUEDE": "Suede coat, long",
    "WOMEN, COAT, SHEARLING COAT": "Sheepskin / shearling coat",
    "MEN, ACCESSORIES, GLOVES, LEATHER, SUEDE, SHEARLING": "Gloves, leather (pair)",
    "MEN, BOMBER JACKET, LEATHER, SHEARLING-TRIMMED,": "Item with leather / fur / suede trim",
    "WOMEN, BLAZER, LEATHER": "Leather waistcoat",
    "13 copy 2": "Shoe shine",
    "96": "Handbag, leather",
    "MEN, SKI, GLOVES, LEATHER": "Gloves",
    "MEN, SKI, JACKET": "Ski jacket",
    "WOMEN, SKI-SUIT,": "Ski suit",
    "MEN, SKI, TROUSERS, PADDED": "Ski trousers",
    "WOMEN, PYJAMAS, SILK-SATIN": "Pyjama, pair",
    "WOMEN, BRA AND BRIEF SET": "Bra",
    "MEN, UNDERWEAR, BOXER SHORTS, COTTON": "Underwear",
    "LAVE62": "Bath robe",
    "NGSFI2026137": "Bath towel",
    "NGSFI2026138": "Bath sheet",
    "LAVE54": "Hand towel",
    "LAVE48": "Bath mat",
    "LAVE164": "Pillowcase",
    "4 copy": "Blanket, double",
    "LAVE143": "Throw",
    "LAVE156": "Blanket, small",
    "LAVE161": "Cushion cover, medium",
    "LAVE163": "Pillow, non-feather",
    "NGSFI2026139": "Pillow, feather",
    "LAVE47": "Duvet, non-feather double",
    "NGSFI2026143": "Duvet, feather double",
    "3 copy": "Mattress protector, king",
    "9 copy 2": "Mattress topper, fibre",
    "LAVE159": "Chair cover, single",
    "15 copy 2": "Sofa cover, 3-settee",
    "8 copy 2": "Dog cushion/bed",
    "NGSFI2026133": "Duvet cover, double",
    "LAVE158": "Curtains, lined (per m²)",
    "LAVE52": "Curtains, unlined (per m²)",
    "LAVE157": "Curtains, heavy (per m²)",
    "81 2": "Rug, medium (1.5 x 2 m)",
    "36": "Medium bag (up to 6 kg)",
    "LAVE94": "Ironing (per kg, on hangers)",
}

# Lifestyle shots → category banner.
CATEGORIES = {
    "Shirts & tops (wash & press)": "LAVE166",
    "Tops & shirts (dry clean)": "LAVE178",
    "Suits & formal": "MEN, 3 PIECE SUIT",
    "Jackets": "WOMEN, DOUBLE BREASTED BLAZER, WOOL",
    "Trousers": "LAVE173",
    "Skirts": "WOMEN, MIDI WRAP SKIRT, SATIN",
    "Dresses": "WOMEN, MIDI-DRESS, STRETCH WOOL",
    "Bridal & occasion": "1 copy",
    "Coats": "WOMEN, TRENCH COAT, WOOL, DOUBLE BREASTED",
    "Knitwear & accessories": "LAVE58",
    "Traditional & cultural wear": "144 2",
    "Children's": "BOY, CARDIGAN, COTTON",
    "Sportswear, workwear & uniforms": "31 copy 2",
    "Leather, suede, wax & fur": "MEN, JACKET, BIKER",
    "Shoes, trainers & bags": "111",
    "Bed linen": "15 copy",
    "Duvets, pillows & home": "NGSFI2026144",
    "Table & kitchen linen": "4 copy 2",
    "Curtains & blinds": "LAVE50",
    "Rugs": "80 2",
    "Laundry items": "LAVE61",
    "Wash & fold bags": "16",
    "Pressing only": "6 copy 2",
    "Ski wear": "WOMEN, QUILTED SKI-JACKET",
    "Alterations": "LAVE170",
    "Repairs": "LAVE153",
}

# Pack photos.
PACKS = {
    "The Work Week": "LAVE184", "The Full Week": "MEN,  5 SHIRTS, COTTON", "The Fortnight": "LAVE180",
    "Her Week": "WOMEN, 3 SHIRTS, COTTON", "Smart Casual": "LAVE181", "The Weekend": "LAVE177",
    "Gym & Lounge": "MEN, SWEATPANTS, CASHMERE", "Essentials": "MEN, UNDERWEAR, 5 BOXER SHORTS, COTTON",
    "Suit + 5 Shirts": "MEN,  2 SUITS (4 PIECES) (3)", "Bathroom Set": "LAVE172",
    "Black Tie": "MEN, 3 BOW-TIE, VELVET", "Kids' Pack": "BOY, T-SHIRT, COTTON (2)",
    "Handkerchief 5": "MEN, 3 TIE COMBO, SILK", "New Year Bedroom Reset": "LAVE168",
    "Winter Put-Away": "LAVE57", "Summer Linen": "MEN, OVERSHIRT, LINEN", "Back to School": "BOY, SHIRT, COTTON",
    "Autumn Bring-Out": "WOMEN, COAT, WOOL-CREPE, DOUBLE-BREASTED,", "Ski Pack": "MEN, SKI, SALOPETTES",
    "Living Room Refresh": "LAVE160", "Linen & Dark Shirts": "LAVE171", "Her Everyday Layers": "WOMEN, 3 SLEEVELESS BLOUSES",
    "Silk Care": "WOMEN, 3 SHIRT, SILK", "Dry-Clean Tops": "WOMEN, TOP, SATIN",
    "Two Suits + Ties": "MEN,  2 SUITS (4 PIECES) (4)", "Her Suit Week": "WOMEN, SUIT COMBO - 2 PIECE SUITS X2  (4 PIECES IN TOTAL)",
    "Wedding Guest": "WOMEN, 3 PIECE SUIT AND SHIRT", "Dinner Jacket Set": "MEN,  BLAZER PONTE",
    "Jumpsuits & Playsuits": "WOMEN, TANK AND PANTS, COTTON-JERSEY", "Jacket Rotation": "WOMEN, SUIT BLAZER, WOOL",
    "Outerwear Autumn": "WOMEN, GILET, SHELL DOWN", "Trouser Mix": "WOMEN, SUIT TROUSERS, WOOL",
    "Delicate Bottoms": "WOMEN, MIDI SKIRT, LACE", "Skirt Week": "WOMEN, MIDI SKIRT, COTTON-VOILE",
    "Pleats & Kilt": "GIRL, SKIRT, COTTON", "Dress Week": "WOMEN, MIDI-DRESS, STRETCH JERSEY",
    "Silk Dresses": "WOMEN, MIDI-DRESS, STRETCH LACE (2)", "Nightwear": "WOMEN, ROBE, SILK-SATIN",
    "Coat Season": "WOMEN, COAT, TRENCH, SATIN", "Winter Warmers": "MEN, COAT, VIRGIN WOOL",
    "Knitwear Drawer": "LAVE60", "Cashmere Care": "WOMEN, TWINSET CARDIGAN & VEST, CASHMERE",
    "Wraps & Gloves": "MEN, ACCESSORIES, SCARF, CASHMERE", "Accessories Pack": "MEN, 5 TIE COMBO, SILK",
    "Little Ones": "NGSFI2026135", "Kids' Occasion": "GIRL, DRESS, COTTON", "Sports & Swim": "MEN, 3 TANKS, COTTON",
    "Workwear": "26 copy", "Single Bed Change": "LAVE55", "Double Bed Change": "16 copy",
    "King Bed Change": "6 copy", "Super King Luxe": "4 copy", "Guest Room Ready": "17 copy 2",
    "Winter Duvets": "29 copy 2", "King Duvet Reset": "30 copy 2", "Super King Reset": "7 copy",
    "Kids' Rooms Reset": "37", "Blankets & Throws": "LAVE59", "Bed Spreads": "LAVE56",
    "Mattress Care": "NGSFI2026142", "Sofa Refresh": "40", "Armchair Refresh": "112",
    "Cushion Swap": "LAVE162", "Outdoor & Wellness": "28 copy", "Pet Pack": "76 2",
    "Spa Towels": "LAVE64", "Lingerie & Lounge": "WOMEN, BRA AND BRIEF SET, STRETCH JERSEY",
    "Family Ski": "WOMEN, SKI-JACKET",
}

PEOPLE = {"WOMEN": "Women's", "MEN": "Men's", "BOY": "Boy's", "GIRL": "Girl's"}


def stem(path: Path) -> str:
    return path.stem[4:] if path.stem.startswith("LAVE") else path.stem


def alt_text(s: str, fallback: str) -> str:
    if not re.match(r"^(WOMEN|MEN|BOY|GIRL|MAXI)", s):
        return fallback
    s = re.sub(r"\s*\(\d+\)$", "", s).replace("_", " ")
    parts = [p.strip() for p in s.split(",") if p.strip()]
    who = PEOPLE.get(parts[0])
    words = ", ".join(parts[1:] if who else parts).lower()
    words = re.sub(r"\s+", " ", words).replace(" - ", " – ")
    return f"{who} {words}" if who else words[0].upper() + words[1:]


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:70]


def main(src: Path) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    files = {stem(p): p for p in sorted(src.glob("*.png"))}
    for name, target in [*((k, k) for k in ITEMS), *((v, v) for v in CATEGORIES.values()), *((v, v) for v in PACKS.values())]:
        if target not in files:
            sys.exit(f"Missing photo: {target}")
    uses = {}
    for s, item in ITEMS.items():
        uses.setdefault(s, {"items": [], "packs": [], "categories": []})["items"].append(item)
    for cat, s in CATEGORIES.items():
        uses.setdefault(s, {"items": [], "packs": [], "categories": []})["categories"].append(cat)
    for pack, s in PACKS.items():
        uses.setdefault(s, {"items": [], "packs": [], "categories": []})["packs"].append(pack)
    manifest, seen = [], set()
    for s, path in files.items():
        name = slug(s if re.match(r"^(WOMEN|MEN|BOY|GIRL|MAXI)", s) else "lave-" + s) or "lave"
        while name in seen:
            name += "-2"
        seen.add(name)
        u = uses.get(s, {"items": [], "packs": [], "categories": []})
        fallback = (u["categories"] or u["packs"] or u["items"] or [""])[0]
        img = Image.open(path)
        img = img.convert("RGBA" if img.mode in ("RGBA", "LA", "P") else "RGB")
        if img.mode == "RGBA":  # flatten transparency onto the studio backdrop
            bg = Image.new("RGB", img.size, (247, 247, 247))
            bg.paste(img, mask=img.split()[3])
            img = bg
        img.thumbnail((1400, 1400))
        img.save(OUT / f"{name}.webp", "WEBP", quality=80, method=6)
        manifest.append({"file": f"{name}.webp", "source": path.name, "alt": alt_text(s, fallback), **u})
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False))
    total = sum((OUT / m["file"]).stat().st_size for m in manifest)
    print(f"{len(manifest)} images, {total / 1e6:.1f} MB; {len(ITEMS)} items, {len(PACKS)} packs, {len(CATEGORIES)} categories assigned")


if __name__ == "__main__":
    main(Path(sys.argv[1]).expanduser())
