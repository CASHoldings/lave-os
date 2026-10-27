"""Weekly photo backups, error alerts and visitor analytics."""
from datetime import datetime

import pytest

from app.config import get_settings
from app.services import alerts, backups, clock, mailer


class FakeR2:
    """Two buckets, and the five calls the backup makes."""

    def __init__(self):
        self.buckets = {"lave-media": {f"p{i}.webp": b"x" * (i + 1) for i in range(5)}, "lave-media-backup": {}}

    def list_objects_v2(self, Bucket, ContinuationToken=None):
        keys = sorted(self.buckets[Bucket])
        start = int(ContinuationToken or 0)
        page, more = keys[start:start + 2], start + 2 < len(keys)
        return {"Contents": [{"Key": k, "Size": len(self.buckets[Bucket][k])} for k in page], "IsTruncated": more,
                **({"NextContinuationToken": str(start + 2)} if more else {})}

    def copy_object(self, Bucket, Key, CopySource):
        self.buckets[Bucket][Key] = self.buckets[CopySource["Bucket"]][CopySource["Key"]]

    def delete_object(self, Bucket, Key):
        del self.buckets[Bucket][Key]


@pytest.fixture
def backup_on(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "storage_bucket", "lave-media")
    monkeypatch.setattr(s, "storage_backup_bucket", "lave-media-backup")
    monkeypatch.setattr(s, "storage_backup_keep", 2)
    yield
    clock.freeze(None)


def test_weekly_dated_copies_keep_the_newest(db_session, backup_on):
    r2 = FakeR2()
    with db_session() as db:
        for day in (1, 8, 15):
            clock.freeze(datetime(2026, 11, day, 3))
            result = backups.run(db, client=r2)
            assert result["photos"] == 5 and not result["error"]
            assert backups.run(db, client=r2) is None  # once a week
        folders = {k.split("/")[0] for k in r2.buckets["lave-media-backup"]}
        assert folders == {"2026-11-08", "2026-11-15"}  # keeps 2
        assert r2.buckets["lave-media-backup"]["2026-11-15/p3.webp"] == b"xxxx"
        st = backups.status(db)
        assert st["folder"] == "2026-11-15" and st["removed_folders"] == ["2026-11-01"] and not st["running"]
        clock.freeze(datetime(2026, 11, 16, 3))
        assert backups.run(db, client=r2, force=True)["folder"] == "2026-11-16"  # "Back up now"


def test_a_failed_backup_is_reported(db_session, backup_on, monkeypatch):
    monkeypatch.setattr(get_settings(), "alert_email", "founder@example.com")
    monkeypatch.setattr(mailer, "send", lambda *a, **kw: mailer.OUTBOX.appendleft({"to": a[0], "subject": a[1]}) or True)
    alerts.reset()

    class Broken(FakeR2):
        def copy_object(self, **kw):
            raise RuntimeError("Access Denied")
    with db_session() as db:
        clock.freeze(datetime(2026, 11, 1, 3))
        assert "Access Denied" in backups.run(db, client=Broken())["error"]
    assert any(m["subject"] == "LAVE OS alert: Photo backup failed" for m in mailer.OUTBOX)


def test_errors_are_emailed_once_per_half_hour(monkeypatch):
    monkeypatch.setattr(get_settings(), "alert_email", "founder@example.com")
    alerts.reset()
    mailer.OUTBOX.clear()
    monkeypatch.setattr(mailer, "send", lambda *a, **kw: mailer.OUTBOX.appendleft({"to": a[0], "subject": a[1]}) or True)
    assert alerts.report("Website error", "GET /boom") is True
    assert alerts.report("Website error", "GET /boom again") is False
    assert alerts.report("Photo backup failed", "denied") is True
    assert len(alerts.RECENT) == 3 and len(mailer.OUTBOX) == 2


def test_a_server_error_sends_an_alert(api, monkeypatch):
    from app.routers import public
    monkeypatch.setattr(get_settings(), "alert_email", "founder@example.com")
    alerts.reset()

    def boom(*a, **kw):
        raise RuntimeError("database fell over")
    monkeypatch.setattr(public, "available_slots", boom)
    from fastapi.testclient import TestClient
    from app.main import app
    with TestClient(app, raise_server_exceptions=False) as c:
        assert c.get("/api/slots?start=2026-10-06&days=1").status_code == 500
    assert any("database fell over" in a["detail"] for a in alerts.RECENT)


def test_system_tab_and_analytics(api, staff_headers, monkeypatch):
    r = api.get("/api/staff/system", headers=staff_headers).json()
    assert r["analytics"] is False and r["backup"]["configured"] is False and r["health_url"].endswith("/healthz")
    assert "cloudflareinsights" not in api.get("/").text
    monkeypatch.setattr(get_settings(), "cf_analytics_token", "abc123")
    page = api.get("/").text
    assert 'static.cloudflareinsights.com/beacon.min.js' in page and '"token": "abc123"' in page
    assert api.post("/api/staff/system/backup", headers=staff_headers).status_code == 409
