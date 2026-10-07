"""Outgoing email. Uses SMTP when LAVE_SMTP_HOST is set; otherwise logs the message (and keeps it for the dev preview)."""
import logging
import smtplib
from collections import deque
from email.message import EmailMessage

from app.config import get_settings

log = logging.getLogger("lave.mail")
# Recent messages, shown on the sign-in pages in development so links can be clicked without an inbox.
OUTBOX: deque[dict] = deque(maxlen=20)


def send(to: str, subject: str, text: str) -> None:
    settings = get_settings()
    OUTBOX.appendleft({"to": to, "subject": subject, "text": text})
    if not settings.smtp_host:
        # Emails can hold sign-in links, so only print the body on a developer's machine.
        if settings.is_dev:
            log.warning("Email not sent (no SMTP configured) to=%s subject=%s\n%s", to, subject, text)
        else:
            log.warning("Email not sent (no SMTP configured) to=%s subject=%s", to, subject)
        return
    msg = EmailMessage()
    msg["From"] = settings.mail_from
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(text)
    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
            smtp.starttls()
            if settings.smtp_user:
                smtp.login(settings.smtp_user, settings.smtp_password)
            smtp.send_message(msg)
    except (OSError, smtplib.SMTPException):
        # Never fail the client's request because the mail server is down; the log shows what didn't go.
        log.exception("Email failed to=%s subject=%s", to, subject)


def last_to(email: str) -> dict | None:
    return next((m for m in OUTBOX if m["to"] == email), None)
