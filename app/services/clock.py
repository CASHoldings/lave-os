from datetime import datetime
from zoneinfo import ZoneInfo

from app.config import get_settings

_frozen: datetime | None = None


def local_now() -> datetime:
    """Current atelier-local time as a naive datetime. Tests can freeze it."""
    if _frozen is not None:
        return _frozen
    return datetime.now(ZoneInfo(get_settings().timezone)).replace(tzinfo=None, microsecond=0)


def freeze(at: datetime | None) -> None:
    global _frozen
    _frozen = at
