"""Every page (except home) has a breadcrumb trail; every step is a link and the last one is the page itself."""
import re

CRUMBS = re.compile(r'<nav class="crumbs" aria-label="Breadcrumb">\s*<ol>(.*?)</ol>', re.S)
STEP = re.compile(r'<li><a href="([^"]+)"( aria-current="page")?>([^<]+)</a></li>')


def trail(html: str) -> list[tuple[str, bool, str]]:
    m = CRUMBS.search(html)
    assert m, "no breadcrumb"
    steps = STEP.findall(m.group(1))
    assert len(steps) == m.group(1).count("<li>"), "a step without a link"
    return [(href, bool(cur), label) for href, cur, label in steps]


def check(api, path: str) -> list[tuple[str, bool, str]]:
    r = api.get(path)
    steps = trail(r.text)
    assert steps[0][:1] == ("/",) and steps[0][2] == "Home", path
    assert steps[-1][0] == path.split("?")[0] and steps[-1][1], f"{path}: the last step should be this page"
    assert not any(cur for _, cur, _ in steps[:-1]), path
    assert '"@type": "BreadcrumbList"' in r.text, path
    return steps


def test_every_public_page(api):
    sm = api.get("/sitemap.xml").text
    paths = [p.replace("&amp;", "&") for p in re.findall(r"<loc>http://localhost:8000([^<]+)</loc>", sm)]
    assert len(paths) > 30
    for path in paths:
        if path == "/":
            assert '<nav class="crumbs"' not in api.get("/").text  # home: none
            continue
        r = api.get(path, follow_redirects=False)
        if r.status_code != 200:
            continue  # /book/ sends guests to sign in
        check(api, path)


def test_trails_read_naturally(api):
    labels = lambda path: [label for _, _, label in check(api, path)]  # noqa: E731
    assert labels("/atelier/prices/") == ["Home", "Atelier", "Clean", "Prices"]
    assert labels("/atelier/clean/") == ["Home", "Atelier", "Clean"]
    assert labels("/atelier/") == ["Home", "Atelier"]
    assert labels("/contact/") == ["Home", "Contact"]
    assert labels("/search/?q=silk") == ["Home", "Search"]
    assert labels("/basket/") == ["Home", "Apothecary", "Basket"]
    assert labels("/account/login/") == ["Home", "Account", "Sign in"]
    assert labels("/account/register/") == ["Home", "Account", "Create an account"]
    r = api.get("/no-such-page/")
    assert r.status_code == 404 and [s[2] for s in trail(r.text)] == ["Home", "Page not found"]


def test_signed_in_pages(api, client_headers):
    from app.auth import CLIENT_COOKIE
    token = client_headers["Authorization"].split(" ", 1)[1]
    api.cookies.set(CLIENT_COOKIE, token)
    assert [s[2] for s in check(api, "/account/")] == ["Home", "Account"]
    assert [s[2] for s in check(api, "/account/bookings/")] == ["Home", "Account", "Bookings"]
    assert [s[2] for s in check(api, "/book/")] == ["Home", "Atelier", "Book a collection"]
