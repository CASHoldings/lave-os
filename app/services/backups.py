"""A dated weekly copy of every photo, in a second R2 bucket (LAVE_STORAGE_BACKUP_BUCKET), so a photo deleted or
overwritten by mistake can be recovered. Each copy is a folder named by its date (2026-10-27/…); the newest
LAVE_STORAGE_BACKUP_KEEP copies are kept and older ones removed.

R2 copies inside Cloudflare (nothing passes through the website), so it's quick and free of transfer costs. The API
token needs access to both buckets.
"""
import json
import logging
import re
from datetime import datetime, timedelta

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import SiteSetting
from app.services.clock import local_now

log = logging.getLogger("lave.backups")
KEY = "backup.photos"
EVERY = timedelta(days=7)
DATED = re.compile(r"^(\d{4}-\d{2}-\d{2})/")


def configured() -> bool:
    s = get_settings()
    return bool(s.storage_bucket and s.storage_backup_bucket)


def status(db: Session) -> dict:
    row = db.get(SiteSetting, KEY)
    return {"configured": configured(), "bucket": get_settings().storage_backup_bucket,
            "keep": get_settings().storage_backup_keep, **(json.loads(row.value) if row and row.value else {})}


def _save(db: Session, data: dict) -> None:
    row = db.get(SiteSetting, KEY) or SiteSetting(key=KEY)
    row.value = json.dumps(data)
    db.add(row)
    db.commit()


def _claim(db: Session, force: bool) -> bool:
    """Only one copy of the website runs the backup, and only once a week (unless asked to now)."""
    row = db.get(SiteSetting, KEY)
    before = row.value if row else None
    last = json.loads(before).get("started_at") if before else None
    if not force and last and local_now() - datetime.fromisoformat(last) < EVERY:
        return False
    data = {**(json.loads(before) if before else {}), "started_at": local_now().isoformat(timespec="seconds"), "running": True}
    if row is None:
        _save(db, data)
        return True
    claimed = db.execute(update(SiteSetting).where(SiteSetting.key == KEY, SiteSetting.value == before)
                         .values(value=json.dumps(data))).rowcount
    db.commit()
    return claimed == 1


def run(db: Session, client=None, force: bool = False) -> dict | None:
    """Copy every photo into today's folder in the backup bucket, then drop the oldest copies. None if not due."""
    if not configured() or not _claim(db, force):
        return None
    s = get_settings()
    if client is None:
        from app.services import storage
        client = storage.current().client
    folder = local_now().date().isoformat()
    copied = size = 0
    try:
        token = None
        while True:
            page = client.list_objects_v2(Bucket=s.storage_bucket, **({"ContinuationToken": token} if token else {}))
            for o in page.get("Contents", []):
                client.copy_object(Bucket=s.storage_backup_bucket, Key=f"{folder}/{o['Key']}",
                                   CopySource={"Bucket": s.storage_bucket, "Key": o["Key"]})
                copied, size = copied + 1, size + o["Size"]
            if not page.get("IsTruncated"):
                break
            token = page["NextContinuationToken"]
        removed = _prune(client, s.storage_backup_bucket, s.storage_backup_keep)
        result = {"finished_at": local_now().isoformat(timespec="seconds"), "folder": folder, "photos": copied,
                  "bytes": size, "removed_folders": removed, "error": ""}
        log.info("Photo backup %s: %d photos", folder, copied)
    except Exception as exc:  # noqa: BLE001  (reported in the admin and by email, then tried again next week)
        log.exception("Photo backup failed")
        result = {"finished_at": local_now().isoformat(timespec="seconds"), "folder": folder, "photos": copied,
                  "bytes": size, "error": str(exc)[:300]}
        from app.services import alerts
        alerts.report("Photo backup failed", str(exc))
    _save(db, {**status(db), **result, "running": False})
    return result


def _prune(client, bucket: str, keep: int) -> list[str]:
    keys, token = [], None
    while True:
        page = client.list_objects_v2(Bucket=bucket, **({"ContinuationToken": token} if token else {}))
        keys += [o["Key"] for o in page.get("Contents", [])]
        if not page.get("IsTruncated"):
            break
        token = page["NextContinuationToken"]
    folders = sorted({m.group(1) for k in keys if (m := DATED.match(k))}, reverse=True)
    old = folders[keep:]
    for k in keys:
        if (m := DATED.match(k)) and m.group(1) in old:
            client.delete_object(Bucket=bucket, Key=k)
    return old
