"""Set a new password for a staff account, from the server's command line (Render → lave-os → Shell):

    python -m app.reset_password hello@lavelondon.com

It asks for the new password twice without showing it, and never prints it.
"""
import getpass
import sys

from app.auth import find_staff_by_email, hash_password
from app.db import SessionLocal


def reset(email: str, password: str) -> str:
    with SessionLocal() as db:
        staff = find_staff_by_email(db, email)
        if not staff:
            raise SystemExit(f"No staff account for {email}.")
        staff.password_hash = hash_password(password)
        staff.active = True
        db.commit()
        return f"Password changed for {staff.email} ({staff.role.value}). Sign in at /admin."


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python -m app.reset_password you@lavelondon.com")
    first = getpass.getpass("New password (12+ characters): ")
    if len(first) < 12:
        raise SystemExit("Password must be at least 12 characters. Nothing changed.")
    if getpass.getpass("Type it again: ") != first:
        raise SystemExit("The two passwords didn't match. Nothing changed.")
    print(reset(sys.argv[1], first))


if __name__ == "__main__":
    main()
