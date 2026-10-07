"""Outgoing email. Uses SMTP when LAVE_SMTP_HOST is set; otherwise logs the message (and keeps it for the dev preview)."""
import logging
import smtplib
from collections import deque
from email.message import EmailMessage

from app.config import get_settings

log = logging.getLogger("lave.mail")
# Recent messages, shown on the sign-in pages in development so links can be clicked without an inbox.
OUTBOX: deque[dict] = deque(maxlen=20)


class MailError(Exception):
    pass


def send(to: str, subject: str, text: str, reply_to: str | None = None, raise_errors: bool = False) -> bool:
    """Send a plain-text email. Returns True if the mail server accepted it.

    Normally never raises, so a client's request doesn't fail because email is down; `raise_errors=True`
    (the admin's test button) raises MailError with the reason instead.
    """
    settings = get_settings()
    OUTBOX.appendleft({"to": to, "subject": subject, "text": text})
    if not settings.smtp_host:
        # Emails can hold sign-in links, so only print the body on a developer's machine.
        if settings.is_dev:
            log.warning("Email not sent (no SMTP configured) to=%s subject=%s\n%s", to, subject, text)
        else:
            log.warning("Email not sent (no SMTP configured) to=%s subject=%s", to, subject)
        if raise_errors:
            raise MailError("Email sending isn't set up yet: LAVE_SMTP_HOST is empty.")
        return False
    msg = EmailMessage()
    msg["From"] = settings.mail_from
    msg["To"] = to
    msg["Subject"] = subject
    if reply_to:
        msg["Reply-To"] = reply_to
    msg.set_content(text)
    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
            smtp.starttls()
            if settings.smtp_user:
                smtp.login(settings.smtp_user, settings.smtp_password)
            smtp.send_message(msg)
    except (OSError, smtplib.SMTPException) as exc:
        # Never fail the client's request because the mail server is down; the log shows what didn't go.
        log.exception("Email failed to=%s subject=%s", to, subject)
        if raise_errors:
            raise MailError(_explain(exc)) from exc
        return False
    return True


def _explain(exc: Exception) -> str:
    if isinstance(exc, smtplib.SMTPAuthenticationError):
        return "The mail server rejected the username or password (for SendGrid: user apikey, password = the API key)."
    if isinstance(exc, smtplib.SMTPSenderRefused):
        return f"The mail server won't send from {get_settings().mail_from}. Check the sender is verified in SendGrid."
    if isinstance(exc, smtplib.SMTPResponseException):
        return f"The mail server said: {exc.smtp_code} {exc.smtp_error.decode(errors='replace')[:200]}"
    return f"Couldn't reach the mail server: {exc}"


def last_to(email: str) -> dict | None:
    return next((m for m in OUTBOX if m["to"] == email), None)
