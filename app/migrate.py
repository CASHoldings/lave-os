"""Pre-launch schema top-up: create new tables and add new nullable columns to existing ones.

Run with `python -m app.migrate`. Before launch, replace this with Alembic migrations (already installed).
"""
from sqlalchemy import inspect, text

from app.db import Base, engine
import app.models  # noqa: F401  (registers the models)


def _enum_values() -> list[str]:
    """Postgres keeps an enum's values in the database: add any new ones (e.g. a new order status)."""
    if engine.dialect.name != "postgresql":
        return []
    added = []
    with engine.connect() as conn:
        conn = conn.execution_options(isolation_level="AUTOCOMMIT")  # ALTER TYPE … ADD VALUE can't run in a transaction
        seen = set()
        for table in Base.metadata.sorted_tables:
            for col in table.columns:
                name, values = getattr(col.type, "name", None), getattr(col.type, "enums", None)
                if not name or not values or name in seen:
                    continue
                seen.add(name)
                have = set(conn.execute(text("SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid "
                                             "WHERE t.typname = :n"), {"n": name}).scalars())
                for v in values:
                    if have and v not in have:
                        conn.execute(text(f"ALTER TYPE {name} ADD VALUE IF NOT EXISTS '{v}'"))
                        added.append(f"{name}.{v}")
    return added


def upgrade() -> list[str]:
    Base.metadata.create_all(engine)
    added = _enum_values()
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
                    if isinstance(v, bool):  # Postgres wants TRUE/FALSE; SQLite accepts both
                        default = f" DEFAULT {'TRUE' if v else 'FALSE'}"
                    else:
                        default = f" DEFAULT {repr(v)}"
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
