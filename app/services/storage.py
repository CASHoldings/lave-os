"""Where library photos are kept: a Cloudflare R2 bucket on the live site, a folder on this machine otherwise.

Photos keep their /media/<name> addresses either way. With a bucket, each photo is fetched once and kept in a working
copy on the server, so pages load as quickly as from a disk, and the website no longer needs one: Render can then
switch to a new version without taking the site offline.
"""
import mimetypes
import re
import secrets
import shutil
import tempfile
import threading
from pathlib import Path

from app.config import get_settings

# A photo's name inside the library: 202610-1a2b3c4d5e6f7a8b.webp, or thumbs/ followed by one.
NAME = re.compile(r"(thumbs/)?[A-Za-z0-9][A-Za-z0-9._-]*$")


def valid(name: str) -> bool:
    return bool(NAME.match(name)) and ".." not in name


class Folder:
    """Photos in a folder (this machine, the tests, and the live site until the bucket is set up)."""

    def __init__(self, root: Path):
        self.root = root

    def has(self, name: str) -> bool:
        return valid(name) and (self.root / name).is_file()

    def path(self, name: str) -> Path | None:
        return self.root / name if self.has(name) else None

    def write(self, name: str, data: bytes) -> None:
        target = self.root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        temp = target.with_name(f"{target.name}.{secrets.token_hex(4)}.tmp")
        temp.write_bytes(data)
        temp.replace(target)  # in one step, so a visitor never gets half a file

    def names(self) -> dict[str, int]:
        if not self.root.exists():
            return {}
        return {str(p.relative_to(self.root)): p.stat().st_size for p in self.root.rglob("*")
                if p.is_file() and valid(str(p.relative_to(self.root))) and not p.name.endswith(".tmp")}


class Bucket:
    """Photos in an S3-compatible bucket (Cloudflare R2), with a working copy of each kept on the server."""

    def __init__(self, bucket: str, endpoint: str, key_id: str, secret: str, cache: Path, client=None):
        self.bucket, self.cache = bucket, cache
        self._client = client
        self._settings = (endpoint, key_id, secret)
        self._names: dict[str, int] | None = None
        self._lock = threading.Lock()

    @property
    def client(self):
        if self._client is None:
            import boto3
            from botocore.config import Config
            endpoint, key_id, secret = self._settings
            self._client = boto3.client("s3", endpoint_url=endpoint, aws_access_key_id=key_id,
                                        aws_secret_access_key=secret, region_name="auto",
                                        config=Config(retries={"max_attempts": 4, "mode": "standard"},
                                                      max_pool_connections=32))
        return self._client

    def names(self) -> dict[str, int]:
        """Every photo in the bucket with its size. Read from the bucket once, then kept up to date here."""
        with self._lock:
            if self._names is None:
                found, token = {}, None
                while True:
                    page = self.client.list_objects_v2(Bucket=self.bucket, **({"ContinuationToken": token} if token else {}))
                    found.update({o["Key"]: o["Size"] for o in page.get("Contents", [])})
                    if not page.get("IsTruncated"):
                        break
                    token = page["NextContinuationToken"]
                self._names = found
            return self._names

    def has(self, name: str) -> bool:
        return valid(name) and name in self.names()

    def path(self, name: str) -> Path | None:
        if not self.has(name):
            return None
        local = self.cache / name
        if not local.is_file():
            data = self.client.get_object(Bucket=self.bucket, Key=name)["Body"].read()
            Folder(self.cache).write(name, data)
        return local

    def write(self, name: str, data: bytes) -> None:
        kind = mimetypes.guess_type(name)[0] or "application/octet-stream"
        self.client.put_object(Bucket=self.bucket, Key=name, Body=data, ContentType=kind)
        Folder(self.cache).write(name, data)
        names = self.names()
        with self._lock:
            names[name] = len(data)


_store: Folder | Bucket | None = None


def current() -> Folder | Bucket:
    global _store
    if _store is None:
        s = get_settings()
        if s.storage_bucket:
            _store = Bucket(s.storage_bucket, s.storage_endpoint, s.storage_key_id, s.storage_secret,
                            Path(tempfile.gettempdir()) / "lave-media")
        else:
            _store = Folder(s.media_path)
    return _store


def find(name: str) -> Path | None:
    """The file to send for /media/<name>: from storage, then the old image disk while photos are being moved off it,
    then the price-list photos that ship with the code."""
    if not valid(name):
        return None
    from app.services.repository import IMAGES_DIR
    store = current()
    try:
        if path := store.path(name):
            return path
    except Exception as exc:  # storage unreachable: fall back to what's on this server
        print(f"Photo storage: couldn't fetch {name} ({exc})", flush=True)
    legacy = get_settings().media_path
    if isinstance(store, Bucket) and (legacy / name).is_file():
        return legacy / name
    bundled = IMAGES_DIR / name
    return bundled if "/" not in name and bundled.is_file() else None


def move_from_disk(source: Path, store: Bucket | None = None) -> dict:
    """Copy every library photo from the old image disk into the bucket (photos already there are skipped), and say
    what happened in the logs. Runs in the background when the website starts with a bucket set up."""
    from app.services.repository import IMAGES_DIR
    store = store or current()
    result = {"copied": 0, "already": 0, "failed": [], "on_disk": 0}
    if not isinstance(store, Bucket) or not source.exists():
        return result
    bundled = {p.name for p in IMAGES_DIR.glob("*")}
    have = store.names()
    for name, size in sorted(Folder(source).names().items()):
        if name in bundled:
            continue  # ships with the code
        result["on_disk"] += 1
        if have.get(name) == size:
            result["already"] += 1
            continue
        try:
            store.write(name, (source / name).read_bytes())
            result["copied"] += 1
        except Exception as exc:  # one bad file must not stop the rest
            result["failed"].append(f"{name} ({exc})")
    missing = [n for n, size in Folder(source).names().items() if n not in bundled and store.names().get(n) != size]
    print(f"Photo storage: {result['on_disk']} photos on the old disk; {result['copied']} copied to the bucket now, "
          f"{result['already']} already there. " + ("All photos are in the bucket." if not missing else
          f"{len(missing)} not yet in the bucket: {', '.join(missing[:10])}"), flush=True)
    for line in result["failed"][:20]:
        print(f"Photo storage: couldn't copy {line}", flush=True)
    return result


def clear_cache() -> None:
    """For tests."""
    global _store
    if isinstance(_store, Bucket):
        shutil.rmtree(_store.cache, ignore_errors=True)
    _store = None
