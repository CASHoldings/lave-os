"""LAVE's emails to clients: one voice and one look. Each goes out as plain text with a designed version alongside,
so it reads well in every mail app.

A letter is a greeting, a list of blocks (paragraphs, a button, a small table) and a closing line, signed by LAVE.
"""
from dataclasses import dataclass
from html import escape
from urllib.parse import urlparse

from app.config import get_settings
from app.services import mailer
from app.site.content import SERVICE_MESSAGE, SLOGAN, TAGLINE

PHONE = "+44 7763 566 145"
# The brand line every letter closes on, followed by a sentence that fits the occasion.
CARE = f"At LAVE, we offer {SERVICE_MESSAGE[0].lower()}{SERVICE_MESSAGE[1:]}."
AGAIN = f"{CARE} We look forward to caring for yours again."
SOON = f"{CARE} We look forward to caring for yours."

INK, SOFT, LINE, PAPER = "#192033", "#5b6070", "#e6e6e6", "#f3f3f3"
FONT = "'Century Gothic', CenturyGothic, AppleGothic, 'Avenir Next', Avenir, Helvetica, Arial, sans-serif"


@dataclass
class Button:
    label: str
    url: str


@dataclass
class Table:
    rows: list[tuple[str, str]]  # (what, amount); the last row is shown as the total


Block = str | Button | Table


def hello(first_name: str | None) -> str:
    name = (first_name or "").strip()
    return f"Hello {name}," if name else "Hello,"


def send(to: str, subject: str, first_name: str | None, blocks: list[Block], closing: str = AGAIN) -> bool:
    text, html = compose(subject, hello(first_name), blocks, closing)
    return mailer.send(to, subject, text, html=html)


def compose(subject: str, greeting: str, blocks: list[Block], closing: str) -> tuple[str, str]:
    settings = get_settings()
    email = settings.contact_address
    site = urlparse(settings.site_url).netloc or "lavelondon.com"
    contact = [("M", PHONE, f"tel:{PHONE.replace(' ', '')}"), ("E", email, f"mailto:{email}"),
               ("W", site, settings.site_url)]

    # Plain text.
    parts = [greeting]
    for b in blocks:
        if isinstance(b, Button):
            parts.append(f"{b.label}:\n{b.url}")
        elif isinstance(b, Table):
            width = max(len(w) for w, _ in b.rows)
            parts.append("\n".join(f"  {w.ljust(width)}  {a}" for w, a in b.rows))
        else:
            parts.append(b)
    parts += [closing, f"With care,\nLAVE\n{SLOGAN}. {TAGLINE}.", "\n".join(f"{k} {v}" for k, v, _ in contact)]
    text = "\n\n".join(parts)

    # Designed version: tables and inline styles, which every mail app understands.
    p = f"margin:0 0 18px;font-family:{FONT};font-size:15px;line-height:1.65;color:{INK};"
    body = [f'<p style="{p}">{escape(greeting)}</p>']
    for b in blocks:
        if isinstance(b, Button):
            url = escape(b.url)
            body.append(
                f'<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;"><tr>'
                f'<td style="background:{INK};"><a href="{url}" style="display:inline-block;padding:15px 30px;'
                f'font-family:{FONT};font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;'
                f'color:#ffffff;text-decoration:none;">{escape(b.label)}</a></td></tr></table>'
                f'<p style="{p}font-size:13px;color:{SOFT};">Or copy this link into your browser:<br>'
                f'<a href="{url}" style="color:{INK};word-break:break-all;">{url}</a></p>')
        elif isinstance(b, Table):
            rows = []
            for i, (what, amount) in enumerate(b.rows):
                last = i == len(b.rows) - 1
                cell = (f"padding:9px 0;font-family:{FONT};font-size:14px;color:{INK};border-top:1px solid {LINE};"
                        + ("font-weight:700;" if last else ""))
                rows.append(f'<tr><td style="{cell}">{escape(what)}</td>'
                            f'<td align="right" style="{cell}white-space:nowrap;">{escape(amount)}</td></tr>')
            body.append('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
                        f'style="margin:0 0 18px;border-bottom:1px solid {LINE};">{"".join(rows)}</table>')
        else:
            body.append(f'<p style="{p}">{escape(b)}</p>')
    body.append(f'<p style="{p}">{escape(closing)}</p>')
    body.append(f'<p style="{p}margin-bottom:0;">With care,<br>LAVE<br>'
                f'<span style="color:{SOFT};">{escape(SLOGAN)}. {escape(TAGLINE)}.</span></p>')
    links = "<br>".join(f'{k}&nbsp;&nbsp;<a href="{escape(href)}" style="color:{SOFT};text-decoration:none;">{escape(v)}</a>'
                        for k, v, href in contact)
    preview = next((b for b in blocks if isinstance(b, str)), "")
    html = (
        f'<!doctype html><html lang="en"><head><meta charset="utf-8">'
        f'<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light">'
        f'<title>{escape(subject)}</title></head>'
        f'<body style="margin:0;padding:0;background:{PAPER};">'
        f'<div style="display:none;max-height:0;overflow:hidden;opacity:0;">{escape(preview)}</div>'
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{PAPER};"><tr>'
        f'<td align="center" style="padding:32px 12px;">'
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;">'
        f'<tr><td align="center" style="padding:44px 36px 6px;font-family:{FONT};font-size:26px;letter-spacing:12px;'
        f'color:{INK};">LAVE</td></tr>'
        f'<tr><td style="padding:28px 36px 30px;">{"".join(body)}</td></tr>'
        f'<tr><td style="padding:22px 36px 36px;border-top:1px solid {LINE};font-family:{FONT};font-size:12px;'
        f'line-height:1.9;color:{SOFT};">{links}</td></tr>'
        f'</table></td></tr></table></body></html>')
    return text, html
