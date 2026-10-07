from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.routers import client, public, staff
from app.site import account_routes as site_accounts
from app.site import routes as site
from app.site import journal_routes as site_journal
from app.site import shop_routes as site_shop

STATIC = Path(__file__).resolve().parent.parent / "static"
MEDIA = Path(__file__).resolve().parent.parent / "media"


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

    app.include_router(public.router)
    app.include_router(client.router)
    app.include_router(staff.router)

    @app.get("/healthz", include_in_schema=False)
    def health():
        return {"ok": True}

    # Embeds loaded by WordPress, and the staff dashboard.
    app.mount("/embed", StaticFiles(directory=STATIC / "embed"), name="embed")
    app.mount("/admin/assets", StaticFiles(directory=STATIC / "admin"), name="admin-assets")

    @app.get("/admin", include_in_schema=False)
    def admin_index():
        return FileResponse(STATIC / "admin" / "index.html")

    app.mount("/static/site", StaticFiles(directory=STATIC / "site"), name="site-assets")
    # Images uploaded from /admin (journal covers, page images).
    MEDIA.mkdir(exist_ok=True)
    app.mount("/media", StaticFiles(directory=MEDIA), name="media")

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

    # Last: the website's /{section}/ routes would otherwise shadow the paths above.
    app.include_router(site_accounts.router)
    app.include_router(site_shop.router)
    app.include_router(site_journal.router)
    app.include_router(site.router)
    return app


app = create_app()
