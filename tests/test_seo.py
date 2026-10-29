"""What search engines and link previews see."""
import json
import re


def _head(api, path):
    return api.get(path).text.split("</head>")[0]


def _jsonld(api, path):
    return [json.loads(b) for b in re.findall(r'<script type="application/ld\+json">(.*?)</script>', api.get(path).text, re.S)]


def test_every_page_has_a_canonical_address_and_a_link_preview(api):
    head = _head(api, "/atelier/prices/?utm_source=x")
    canonical = re.search(r'rel="canonical" href="([^"]+)"', head).group(1)
    assert canonical.endswith("/atelier/prices/") and "?" not in canonical
    for tag in ("og:title", "og:description", "og:image", "og:url", 'name="twitter:card"'):
        assert tag in head
    assert "/static/site/og-lave.jpg" in head  # the share image when a page has no photo of its own
    assert api.get("/static/site/og-lave.jpg").headers["content-type"] == "image/jpeg"


def test_pages_still_being_written_stay_out_of_search(api):
    for path in ("/atelier/clean/bridal/", "/atelier/vault/rugs/", "/laveworld/knowledge/press/"):
        assert 'content="noindex, follow"' in _head(api, path), path
    assert "<title>Bridal | Clean | LAVE</title>" in _head(api, "/atelier/clean/bridal/")
    for path in ("/", "/atelier/prices/", "/memberships/", "/policies/privacy/"):
        assert 'name="robots"' not in _head(api, path), path


def test_sitemap_lists_only_pages_worth_finding(api):
    sitemap = api.get("/sitemap.xml").text
    assert "/book/" not in sitemap and "/policies/terms/" in sitemap
    assert "/laveworld/knowledge/</loc>" not in sitemap  # no stories yet
    assert "/atelier/clean/bridal/" not in sitemap


def test_descriptions_are_specific(api):
    default = "Care Better. Preserve what you treasure. LAVE, London"
    for path in ("/contact/", "/atelier/clean/", "/apothecary/wash/", "/policies/cancellation/", "/laveworld/story/"):
        head = _head(api, path)
        assert default not in head, path
    assert "Contact LAVE | Textile Care Atelier, London" in _head(api, "/contact/")


def test_structured_data_for_the_business_products_and_membership(api):
    business = _jsonld(api, "/")[0]
    assert business["@type"] == "DryCleaningOrLaundry" and business["legalName"] == "LAVE LTD"
    assert {"Battersea, London", "Nine Elms, London", "SW11, London"} <= {a["name"] for a in business["areaServed"]}
    assert business["openingHoursSpecification"][0]["opens"] == "06:00" and "address" not in business
    membership = next(d for d in _jsonld(api, "/memberships/") if d["@type"] == "Service")
    assert [o["price"] for o in membership["hasOfferCatalog"]["itemListElement"]] == ["29.00", "59.00", "129.00"]
    sitemap = api.get("/sitemap.xml").text
    product_path = re.search(r"http://[^<]+(/apothecary/products/[^<]+/)</loc>", sitemap).group(1)
    product = next(d for d in _jsonld(api, product_path) if d["@type"] == "Product")
    assert product["offers"]["priceCurrency"] == "GBP" and product["brand"]["name"] == "LAVE"
    assert product["offers"]["availability"].endswith(("PreOrder", "InStock", "OutOfStock"))


def test_home_page_description(api):
    head = _head(api, "/")
    text = ("Premium dry cleaning and laundry collection in South London. LAVE is an eco-conscious textile care atelier "
            "extending the life of your wardrobe and home fabrics.")
    assert f'<meta name="description" content="{text}">' in head
    assert f'<meta property="og:description" content="{text}">' in head


def test_resell_has_its_own_introduction(api):
    page = api.get("/atelier/rehome/resell/").text
    assert "We curate and rehome luxury and rare pieces, new or nearly new" in page
    assert "This page is being written" not in page
    assert '<p class="lead">' not in page.split("<h1>Resell</h1>")[1].split("</section>")[0]  # not bold
