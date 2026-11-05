"""Pages check for wording edits at most every few seconds, so a burst of visitors doesn't use up the database
connections (5 November 2026), while an edit saved in the admin shows at once."""
from sqlalchemy import event

from app.db import get_db
from app.site import store


def test_pages_spare_the_database_but_edits_show_at_once(api, staff_headers, monkeypatch):
    monkeypatch.setattr(store, "RECHECK_SECONDS", 15)
    store._cache.update(stamp=None, site=None, checked=0.0)
    session = api.app.dependency_overrides[get_db]
    queries = []
    engine = next(session()).get_bind()
    listen = lambda *a, **k: queries.append(a[2])  # noqa: E731
    event.listen(engine, "before_cursor_execute", listen)
    try:
        assert api.get("/atelier/").status_code == 200
        first = len(queries)
        assert api.get("/atelier/").status_code == 200
        assert not [q for q in queries[first:] if "FROM site_content" in q]  # no second check within 15 seconds

        doc = api.get("/api/staff/content/signup", headers=staff_headers).json()
        api.put("/api/staff/content/signup", json={"value": dict(doc["value"], heading="Something new is coming.")},
                headers=staff_headers)
        assert "Something new is coming." in api.get("/atelier/").text
    finally:
        event.remove(engine, "before_cursor_execute", listen)
        store._cache.update(stamp=None, site=None, checked=0.0)
