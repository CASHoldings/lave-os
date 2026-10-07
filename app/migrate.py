"""Pre-launch schema top-up: create new tables and add new nullable columns to existing ones.

Run with `python -m app.migrate`. Before launch, replace this with Alembic migrations (already installed).
"""
from sqlalchemy import inspect, text

from app.db import Base, engine
import app.models  # noqa: F401  (registers the models)


def upgrade() -> list[str]:
    Base.metadata.create_all(engine)
    added = []
    insp = inspect(engine)
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            existing = {c["name"] for c in insp.get_columns(table.name)}
            for col in table.columns:
                if col.name in existing:
                    continue
                ddl_type = col.type.compile(dialect=engine.dialect)
                default = ""
                if col.default is not None and getattr(col.default, "is_scalar", False):
                    v = col.default.arg
                    default = f" DEFAULT {int(v) if isinstance(v, bool) else repr(v)}"
                elif isinstance(col.type.python_type, type) and col.type.python_type in (list, dict):
                    default = " DEFAULT '[]'" if col.type.python_type is list else " DEFAULT '{}'"
                conn.execute(text(f'ALTER TABLE {table.name} ADD COLUMN {col.name} {ddl_type}{default}'))
                added.append(f"{table.name}.{col.name}")
    return added


if __name__ == "__main__":
    print("Added:", upgrade() or "nothing")
    from app.db import SessionLocal
    from app.services.wardrobe import backfill
    with SessionLocal() as db:
        print("Wardrobe pieces created for existing garments:", backfill(db))
