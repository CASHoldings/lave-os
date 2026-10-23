from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="LAVE_", extra="ignore")

    # "production" unless set: development-only shortcuts (test sign-in, fake payments) must be switched on deliberately.
    env: str = "production"
    database_url: str = "sqlite:///./lave.db"
    # Where uploaded and imported images are kept when there's no bucket (this machine). On Render this was the
    # persistent disk; photos are copied from it into the bucket the first time the bucket is set up.
    media_dir: str = ""
    # Photo storage: a Cloudflare R2 bucket (any S3-compatible bucket works). Blank: the folder above.
    storage_bucket: str = ""
    storage_endpoint: str = ""  # https://<account id>.r2.cloudflarestorage.com
    storage_key_id: str = ""
    storage_secret: str = ""
    # First admin, created by `python -m app.release` when the database has no staff yet.
    first_admin_email: str = ""
    first_admin_password: str = ""

    # Signs staff and client session tokens issued by this API.
    secret_key: str = "change-me-in-production"
    # Shared with the WordPress connector plugin; signs the short-lived SSO tokens it hands to the embeds.
    wp_sso_secret: str = "change-me-shared-with-wordpress"
    wp_login_url: str = "https://lavelondon.com/my-account/"

    # Origins allowed to call the API from the browser (the WordPress site).
    cors_origins: list[str] = ["https://lavelondon.com", "http://localhost:8000"]

    client_session_hours: int = 336  # two weeks
    staff_session_hours: int = 12

    stripe_secret_key: str = ""
    stripe_publishable_key: str = ""
    stripe_webhook_secret: str = ""
    # Stripe Price IDs for membership plans, keyed by plan code.
    stripe_price_essence: str = ""
    stripe_price_elevate: str = ""
    stripe_price_eclat: str = ""
    # Annual prices (two months free).
    stripe_price_essence_annual: str = ""
    stripe_price_elevate_annual: str = ""
    stripe_price_eclat_annual: str = ""

    # Public address of the website, used in emailed links.
    site_url: str = "http://localhost:8000"
    # Outgoing email over SMTP (Resend: smtp.resend.com, user `resend`, an API key as password). Without a host, emails are logged instead of sent.
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    # Emails come from this address, and contact-form messages are delivered to it.
    mail_from: str = "LAVE <hello@lavelondon.com>"

    # Apothecary delivery (UK only): flat rate, free above a basket value, always free for members.
    shop_shipping_pence: int = 495
    shop_free_shipping_over_pence: int = 5000

    timezone: str = "Europe/London"
    # How many days ahead clients may book.
    booking_horizon_days: int = 21
    # Minimum notice before a slot starts, in minutes.
    booking_min_notice_minutes: int = 120
    # Earliest a return delivery can be after the collection window ends.
    turnaround_hours: int = 24
    # Clients can cancel a booking up to this long before it starts.
    cancel_cutoff_minutes: int = 120

    def check_production_safety(self) -> None:
        if self.env != "production":
            return
        problems = []
        if self.secret_key.startswith("change-me") or len(self.secret_key) < 32:
            problems.append("LAVE_SECRET_KEY must be a long random value")
        if self.wp_sso_secret.startswith("change-me") or len(self.wp_sso_secret) < 32:
            problems.append("LAVE_WP_SSO_SECRET must be a long random value")
        if not self.site_url.startswith("https://"):
            problems.append("LAVE_SITE_URL must start with https://")
        # Without these, the site would quietly run on an empty database, or keep photos where a deploy wipes them.
        if self.database_url.startswith("sqlite"):
            problems.append("LAVE_DATABASE_URL must point at the live database (lave-db)")
        if not all((self.storage_bucket, self.storage_endpoint, self.storage_key_id, self.storage_secret)):
            problems.append("LAVE_STORAGE_BUCKET, _ENDPOINT, _KEY_ID and _SECRET must all be set (Cloudflare R2)")
        if problems:
            raise RuntimeError("LAVE OS won't start in production: " + "; ".join(problems))

    @field_validator("database_url")
    @classmethod
    def _psycopg(cls, v: str) -> str:
        # Hosts hand out postgres:// or postgresql:// addresses; SQLAlchemy needs to be told to use psycopg 3.
        for prefix in ("postgres://", "postgresql://"):
            if v.startswith(prefix):
                return "postgresql+psycopg://" + v[len(prefix):]
        return v

    @property
    def contact_address(self) -> str:
        from email.utils import parseaddr
        return parseaddr(self.mail_from)[1] or "hello@lavelondon.com"

    @property
    def media_path(self) -> Path:
        return Path(self.media_dir) if self.media_dir else PROJECT / "media"

    @property
    def is_dev(self) -> bool:
        return self.env == "development"

    @property
    def stripe_enabled(self) -> bool:
        return bool(self.stripe_secret_key)

    def stripe_price_for(self, plan: str, interval: str = "month") -> str:
        return getattr(self, f"stripe_price_{plan}" + ("_annual" if interval == "year" else ""), "")


@lru_cache
def get_settings() -> Settings:
    return Settings()
