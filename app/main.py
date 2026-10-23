from pathlib import Path
from urllib.parse import urlparse

from fastapi import FastAPI, Request
from fastapi.exception_handlers import http_exception_handler
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import get_settings
from app.routers import client, public, staff
from app.site import account_routes as site_accounts
from app.site import routes as site
from app.site import journal_routes as site_journal
from app.site import price_routes as site_prices
from app.site import shop_routes as site_shop
from app.services.media import UPLOAD_NAME

STATIC = Path(__file__).resolve().parent.parent / "static"
# Other addresses LAVE owns, sent on to the main one.
OTHER_DOMAINS = {"lavelondon.co.uk", "www.lavelondon.co.uk"}
YEAR, DAY = 365 * 86400, 86400


def cache_rule(path: str, versioned: bool) -> str | None:
    if path == "/admin":
        return "no-cache"  # always check for a newer dashboard, which points at the new ?v= files
    if path.startswith(("/static/", "/admin/assets/", "/embed/")):
        if versioned:
            return f"public, max-age={YEAR}, immutable"  # a change gets a new ?v= number
        if "/fonts/" in path:
            return f"public, max-age={30 * DAY}"
        return f"public, max-age={DAY}"
    if path.startswith("/media/"):
        # Uploaded photos (and their small copies) never change. The bundled price-list photos can, when a new set
        # ships, so they're kept a day.
        return f"public, max-age={30 * DAY if UPLOAD_NAME.match(path.rsplit('/', 1)[-1]) else DAY}"
    return None


def create_app() -> FastAPI:
    settings = get_settings()
    settings.check_production_safety()
    app = FastAPI(title="LAVE OS", version="0.1.0", docs_url="/api/docs" if settings.is_dev else None, redoc_url=None)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.middleware("http")
    async def cache_times(request: Request, call_next):
        # Tell browsers how long they can keep files without asking again.
        response = await call_next(request)
        if response.status_code in (200, 304) and "cache-control" not in response.headers:
            if rule := cache_rule(request.url.path, bool(request.query_params.get("v"))):
                response.headers["cache-control"] = rule
        return response

    @app.middleware("http")
    async def one_address(request: Request, call_next):
        # www.lavelondon.com and lavelondon.co.uk → lavelondon.com, so search engines see a single site.
        host = request.headers.get("host", "")
        if host.split(":")[0] in OTHER_DOMAINS:
            main = urlparse(settings.site_url)
            return RedirectResponse(str(request.url.replace(scheme=main.scheme, netloc=main.netloc)), status_code=301)
        if host.startswith("www."):
            return RedirectResponse(str(request.url.replace(netloc=host[4:])), status_code=301)
        return await call_next(request)

    app.include_router(public.router)
    app.include_router(client.router)
    app.include_router(staff.router)

    @app.get("/healthz", include_in_schema=False)
    def health():
        # Render restarts the app if this fails, so check the database too.
        from sqlalchemy import text
        from app.db import engine
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
        except Exception:
            return JSONResponse({"ok": False}, status_code=503)
        return {"ok": True}

    # Embeds loaded by WordPress, and the staff dashboard.
    app.mount("/embed", StaticFiles(directory=STATIC / "embed"), name="embed")
    app.mount("/admin/assets", StaticFiles(directory=STATIC / "admin"), name="admin-assets")

    @app.get("/admin", include_in_schema=False)
    def admin_index():
        return FileResponse(STATIC / "admin" / "index.html")

    app.mount("/static/site", StaticFiles(directory=STATIC / "site"), name="site-assets")
    # Images uploaded from /admin (journal covers, page images).
    settings.media_path.mkdir(parents=True, exist_ok=True)

    # The price-list photos ship with the code. Put them on the image disk here, as the website starts: on Render the
    # disk isn't attached during the pre-deploy step.
    if settings.env != "test":
        from app.services.repository import sync_bundle_files
        sync_bundle_files(settings.media_path)
        # Slim down oversized photos already in the library, in the background so the website starts at once.
        import threading
        from app.services.media import slim_library
        threading.Thread(target=slim_library, args=(settings.media_path,), daemon=True).start()
    app.mount("/media", StaticFiles(directory=settings.media_path), name="media")

    if settings.is_dev:
        # Local preview of the WordPress pages, with a stand-in for the connector plugin's SSO token.
        from datetime import datetime, timedelta, timezone

        import jwt

        @app.get("/api/dev/wp-token", include_in_schema=False)
        def dev_wp_token(email: str = "guest@lavelondon.com", wp_id: int = 1001, first_name: str = "Stanley"):
            now = datetime.now(timezone.utc)
            claims = {"iss": "lave-wp", "sub": str(wp_id), "email": email, "first_name": first_name,
                      "iat": now, "exp": now + timedelta(minutes=15)}
            return {"token": jwt.encode(claims, settings.wp_sso_secret, algorithm="HS256")}

        app.mount("/dev", StaticFiles(directory=STATIC / "dev", html=True), name="dev")

    @app.exception_handler(StarletteHTTPException)
    async def not_found(request: Request, exc: StarletteHTTPException):
        # Website addresses that don't exist: forward old WordPress links, otherwise show the LAVE "not found" page.
        path = request.url.path
        if exc.status_code != 404 or path.startswith(("/api/", "/admin", "/embed/", "/static/")):
            return await http_exception_handler(request, exc)
        from app.db import get_db
        from app.site import redirects, store
        from app.site.routes import render
        sessions = request.app.dependency_overrides.get(get_db, get_db)()
        db = next(sessions)
        try:
            target = redirects.resolve(path, db)
            if target:
                return RedirectResponse(target, status_code=301)
            request.state.site = store.load(db)
        finally:
            sessions.close()
        return render(request, "site/not_found.html", status_code=404)

    # Last: the website's /{section}/ routes would otherwise shadow the paths above.
    app.include_router(site_accounts.router)
    app.include_router(site_shop.router)
    app.include_router(site_prices.router)
    app.include_router(site_journal.router)
    app.include_router(site.router)
    return app


app = create_app()
