"""Photo storage in an R2 bucket, with a stand-in for the bucket so nothing leaves this machine."""
import io

from app.services import storage


class FakeBucket:
    """Answers the four calls LAVE OS makes to an S3-compatible bucket."""

    def __init__(self):
        self.objects, self.gets = {}, 0

    def list_objects_v2(self, Bucket, ContinuationToken=None):
        keys = sorted(self.objects)
        start = int(ContinuationToken or 0)
        page = keys[start:start + 2]  # small pages, to exercise paging
        more = start + 2 < len(keys)
        return {"Contents": [{"Key": k, "Size": len(self.objects[k])} for k in page], "IsTruncated": more,
                **({"NextContinuationToken": str(start + 2)} if more else {})}

    def put_object(self, Bucket, Key, Body, ContentType):
        assert ContentType.startswith("image/")
        self.objects[Key] = Body

    def get_object(self, Bucket, Key):
        self.gets += 1
        return {"Body": io.BytesIO(self.objects[Key])}


def bucket(tmp_path, fake=None):
    return storage.Bucket("lave-media", "https://example.r2.cloudflarestorage.com", "id", "secret", tmp_path / "cache",
                          client=fake or FakeBucket())


def test_photos_are_read_once_then_kept_on_the_server(tmp_path):
    fake = FakeBucket()
    fake.objects = {f"202610-000000000000000{i}.webp": b"photo %d" % i for i in range(5)}
    store = bucket(tmp_path, fake)
    assert len(store.names()) == 5  # every page of the listing
    path = store.path("202610-0000000000000003.webp")
    assert path.read_bytes() == b"photo 3"
    store.path("202610-0000000000000003.webp")
    assert fake.gets == 1
    assert store.path("202610-ffffffffffffffff.webp") is None and fake.gets == 1  # unknown photos never reach R2
    assert store.path("../secrets.webp") is None


def test_uploads_go_to_the_bucket(api, staff_headers, tmp_path, monkeypatch):
    from tests.test_launch import _photo
    fake = FakeBucket()
    monkeypatch.setattr(storage, "_store", bucket(tmp_path, fake))
    r = api.post("/api/staff/uploads", headers=staff_headers, files={"file": ("big.webp", _photo(2400, 1200), "image/webp")})
    url = r.json()["url"]
    name = url.removeprefix("/media/")
    assert set(fake.objects) == {name, f"thumbs/{name}"}  # the slimmed photo and its small copy
    for f in (tmp_path / "cache").rglob("*"):
        if f.is_file():
            f.unlink()  # as after a new deploy: the server's working copies are gone
    got = api.get(url)
    assert got.status_code == 200 and got.content == fake.objects[name]
    assert got.headers["cache-control"] == "public, max-age=2592000"
    from app.services.media import small_url
    assert small_url(url) == f"/media/thumbs/{name}"


def test_photos_move_from_the_old_disk(tmp_path, monkeypatch):
    from app.config import get_settings
    from app.services.repository import IMAGES_DIR
    disk = tmp_path / "disk"
    (disk / "thumbs").mkdir(parents=True)
    (disk / "202610-aaaaaaaaaaaaaaaa.webp").write_bytes(b"one")
    (disk / "202610-bbbbbbbbbbbbbbbb.avif").write_bytes(b"two")
    (disk / "thumbs" / "202610-aaaaaaaaaaaaaaaa.webp").write_bytes(b"small one")
    (disk / ".slimmed.json").write_text("{}")
    bundled = sorted(IMAGES_DIR.glob("*.webp"))[0].name
    (disk / bundled).write_bytes(b"ships with the code")
    fake = FakeBucket()
    fake.objects["202610-bbbbbbbbbbbbbbbb.avif"] = b"two"
    store = bucket(tmp_path, fake)

    # While photos are moving, any not yet in the bucket are still sent from the disk.
    monkeypatch.setattr(storage, "_store", store)
    monkeypatch.setattr(get_settings(), "media_dir", str(disk))
    assert storage.find("202610-aaaaaaaaaaaaaaaa.webp") == disk / "202610-aaaaaaaaaaaaaaaa.webp"

    result = storage.move_from_disk(disk, store)
    assert (result["on_disk"], result["copied"], result["already"], result["failed"]) == (3, 2, 1, [])
    assert set(fake.objects) == {"202610-aaaaaaaaaaaaaaaa.webp", "202610-bbbbbbbbbbbbbbbb.avif",
                                 "thumbs/202610-aaaaaaaaaaaaaaaa.webp"}
    assert storage.move_from_disk(disk, store)["copied"] == 0  # safe to run on every start
    assert storage.find("202610-aaaaaaaaaaaaaaaa.webp") == tmp_path / "cache" / "202610-aaaaaaaaaaaaaaaa.webp"


def test_pages_still_load_if_the_bucket_is_unreachable(api, tmp_path, monkeypatch):
    class Down(FakeBucket):
        def list_objects_v2(self, **kwargs):
            raise ConnectionError("R2 unreachable")

    monkeypatch.setattr(storage, "_store", bucket(tmp_path, Down()))
    assert api.get("/atelier/").status_code == 200
    assert api.get("/media/202610-aaaaaaaaaaaaaaaa.webp").status_code == 404
