"""Receipts and invoices as PDFs, in LAVE's voice and look.

A receipt is for a settled order and can be downloaded at any time (client account, admin). An invoice is issued
from the admin, usually for a business client: it keeps a fixed copy of the lines and totals, has its own number
(INV-0001…), a due date from the payment terms, and can be emailed with the PDF attached. Invoices are never deleted;
a wrong one is voided and a new one issued.
"""
from datetime import timedelta

from fpdf import FPDF
from fpdf.enums import XPos, YPos
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Invoice, Order, PaymentStatus
from app.services import letters
from app.services.clock import local_now
from app.site.content import COMPANY, SLOGAN, TAGLINE

INK, SOFT, LINE = (25, 32, 51), (91, 96, 112), (230, 230, 230)
TERMS = {0: "Due on receipt", 7: "7 days", 14: "14 days", 30: "30 days"}


class DocumentError(Exception):
    pass


def money(pence: int) -> str:
    return ("-" if pence < 0 else "") + f"£{abs(pence) / 100:,.2f}"


def _day(d) -> str:
    return f"{d.day} {d:%B %Y}"


# What the order comes to

def order_lines(order: Order) -> tuple[list[dict], int, bool]:
    """The lines, the total, and whether it's an estimate (the atelier hasn't counted the items yet)."""
    from app.services import delivery
    lines = []
    estimate = not order.items
    if order.items:
        for g in order.items:
            lines.append({"what": " ".join(x for x in (g.colour, g.brand, g.description) if x) or "Item",
                          "detail": " · ".join(x for x in (g.tag_code, g.service.name if g.service else "") if x),
                          "amount_pence": g.price_pence})
        if order.minimum_top_up_pence:
            lines.append({"what": f"Minimum order {money(order.minimum_pence)}", "detail": "Your items came to less",
                          "amount_pence": order.minimum_top_up_pence})
    else:
        for item in order.requested_items or []:
            quote = bool(item.get("priced_later"))
            lines.append({"what": f"{item.get('qty', 1)} × {item.get('name', 'Item')}",
                          "detail": "Priced after inspection" if quote else "As booked",
                          "amount_pence": 0 if quote else item["unit_pence"] * item.get("qty", 1), "quote": quote})
    if order.missed_visits_pence:
        lines.append({"what": "Missed visit", "detail": "See our terms, section 10", "amount_pence": order.missed_visits_pence})
    lines.append({"what": "Collection and delivery", "detail": "" if order.fees_pence else delivery.charge_text(order),
                  "amount_pence": order.fees_pence})
    if order.discount_pence:
        lines.append({"what": "Discount", "detail": "", "amount_pence": -order.discount_pence})
    total = order.total_pence if order.items else order.expected_total_pence
    return lines, total, estimate


def settlement(order: Order) -> tuple[list[tuple[str, int]], int]:
    """What has been paid or credited against the order, and what's still due. An order marked paid in person has
    no card payments on record, so the rest counts as paid in person."""
    paid = [("Paid at booking", sum(p.amount_pence for p in order.payments if p.kind == "booking" and p.status == "succeeded")),
            ("Paid after review", sum(p.amount_pence for p in order.payments if p.kind == "adjustment" and p.status == "succeeded")),
            ("LAVE account credit used", order.credit_used_pence),
            ("Credited to your LAVE account", -order.credited_pence)]
    rows = [(k, v) for k, v in paid if v]
    due = max(0, order.balance_pence)
    if order.payment_status == PaymentStatus.paid and due:
        rows.append(("Paid in person", due))
        due = 0
    return rows, due


def receipt_available(order: Order) -> bool:
    return order.payment_status == PaymentStatus.paid


# The page

def _text(s) -> str:
    """The PDF's built-in Helvetica covers Latin-1 (£, é); swap the few other characters we use."""
    s = str(s or "")
    for a, b in (("−", "-"), ("–", "-"), ("—", "-"), ("’", "'"), ("‘", "'"), ("“", '"'), ("”", '"'), ("…", "...")):
        s = s.replace(a, b)
    return s.encode("latin-1", "replace").decode("latin-1")


class _Page(FPDF):
    def footer(self):
        self.set_y(-18)
        self.set_draw_color(*LINE)
        self.line(18, self.get_y(), 192, self.get_y())
        self.ln(3)
        self.set_font("Helvetica", "", 7.5)
        self.set_text_color(*SOFT)
        for part in COMPANY.split(" Registered office"):  # name and number, then the registered office
            self.cell(0, 3.8, _text(part if part.startswith("LAVE") else "Registered office" + part), align="C",
                      new_x=XPos.LMARGIN, new_y=YPos.NEXT)


def _start(title: str) -> _Page:
    pdf = _Page(format="A4")
    pdf.set_margins(18, 18, 18)
    pdf.set_auto_page_break(True, margin=26)
    pdf.set_title(_text(title))
    pdf.set_author("LAVE LTD")
    pdf.set_creator("LAVE OS")
    pdf.add_page()
    pdf.set_text_color(*INK)
    pdf.set_font("Helvetica", "B", 22)
    pdf.set_char_spacing(6)
    pdf.cell(80, 10, "LAVE", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_char_spacing(0)
    pdf.set_font("Helvetica", "", 8.5)
    pdf.set_text_color(*SOFT)
    pdf.cell(80, 5, _text(f"{SLOGAN}. {TAGLINE}."), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    return pdf


def _heading(pdf: _Page, title: str, facts: list[tuple[str, str]]) -> None:
    """The document's name and its key facts, top right."""
    pdf.set_xy(110, 18)
    pdf.set_font("Helvetica", "B", 15)
    pdf.set_text_color(*INK)
    pdf.set_char_spacing(2)
    pdf.cell(82, 9, _text(title.upper()), align="R", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_char_spacing(0)
    for k, v in facts:
        pdf.set_x(110)
        pdf.set_font("Helvetica", "", 8.5)
        pdf.set_text_color(*SOFT)
        pdf.cell(38, 5, _text(k), align="R")
        pdf.set_font("Helvetica", "B", 8.5)
        pdf.set_text_color(*INK)
        pdf.cell(44, 5, _text(v), align="R", new_x=XPos.LMARGIN, new_y=YPos.NEXT)


def _parties(pdf: _Page, to_label: str, to_lines: list[str]) -> None:
    s = get_settings()
    site = s.site_url.replace("https://", "").replace("http://", "")
    ours = ["LAVE LTD", "438 Streatham High Road", "London SW16 3PX", s.contact_address, letters.PHONE, site]
    top = max(pdf.get_y(), 52) + 6
    for x, label, rows in ((18, "From", ours), (110, to_label, [r for r in to_lines if r])):
        pdf.set_xy(x, top)
        pdf.set_font("Helvetica", "B", 7.5)
        pdf.set_text_color(*SOFT)
        pdf.set_char_spacing(1.5)
        pdf.cell(80, 5, _text(label.upper()), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.set_char_spacing(0)
        for i, row in enumerate(rows):
            pdf.set_x(x)
            pdf.set_font("Helvetica", "B" if i == 0 else "", 9.5)
            pdf.set_text_color(*INK)
            pdf.multi_cell(82, 4.8, _text(row), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        if x == 18:
            left_end = pdf.get_y()
    pdf.set_y(max(left_end, pdf.get_y()) + 8)


def _table(pdf: _Page, lines: list[dict]) -> None:
    pdf.set_font("Helvetica", "B", 7.5)
    pdf.set_text_color(*SOFT)
    pdf.set_char_spacing(1.5)
    pdf.cell(124, 7, "ITEM")
    pdf.cell(50, 7, "AMOUNT", align="R", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_char_spacing(0)
    pdf.set_draw_color(*INK)
    pdf.line(18, pdf.get_y(), 192, pdf.get_y())
    for line in lines:
        y = pdf.get_y() + 2.5
        pdf.set_xy(18, y)
        pdf.set_font("Helvetica", "", 9.5)
        pdf.set_text_color(*INK)
        pdf.multi_cell(124, 5, _text(line["what"]), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        if line.get("detail"):
            pdf.set_font("Helvetica", "", 8)
            pdf.set_text_color(*SOFT)
            pdf.multi_cell(124, 4.2, _text(line["detail"]), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        end = pdf.get_y()
        pdf.set_xy(142, y)
        pdf.set_font("Helvetica", "", 9.5)
        pdf.set_text_color(*INK)
        pdf.cell(50, 5, _text("To be priced" if line.get("quote") else money(line["amount_pence"])), align="R")
        pdf.set_y(end + 2.5)
        pdf.set_draw_color(*LINE)
        pdf.line(18, pdf.get_y(), 192, pdf.get_y())


def _sums(pdf: _Page, rows: list[tuple[str, str, bool]]) -> None:
    """Right-aligned totals: (label, amount, bold)."""
    pdf.ln(3)
    for label, amount, bold in rows:
        pdf.set_x(96)
        pdf.set_font("Helvetica", "B" if bold else "", 10 if bold else 9.5)
        pdf.set_text_color(*INK if bold else SOFT)
        pdf.cell(60, 6.5, _text(label), align="R")
        pdf.set_text_color(*INK)
        pdf.cell(36, 6.5, _text(amount), align="R", new_x=XPos.LMARGIN, new_y=YPos.NEXT)


def _paragraphs(pdf: _Page, paras: list[str]) -> None:
    pdf.ln(6)
    for p in paras:
        if not p:
            continue
        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(*SOFT)
        pdf.multi_cell(0, 4.8, _text(p), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.ln(2.5)


NO_VAT = "LAVE LTD isn't VAT-registered, so no VAT is charged."


def receipt_pdf(order: Order) -> bytes:
    if not receipt_available(order):
        raise DocumentError("A receipt is available once the order is paid.")
    lines, total, _ = order_lines(order)
    paid_rows, due = settlement(order)
    paid_on = order.paid_at or local_now()
    pdf = _start(f"LAVE receipt, order {order.ref}")
    _heading(pdf, "Receipt", [("Order", order.ref), ("Paid on", _day(paid_on)), ("Order date", _day(order.created_at))])
    c = order.client
    _parties(pdf, "Received from", [c.full_name if c else "", c.email if c else ""])
    _table(pdf, lines)
    _sums(pdf, [("Total", money(total), True)] + [(k, money(v), False) for k, v in paid_rows]
          + [("Still to pay", money(due), True)])
    _paragraphs(pdf, ["Thank you for trusting LAVE with your pieces.", NO_VAT,
                      f"Questions about this receipt: {get_settings().contact_address}"])
    return bytes(pdf.output())


# Invoices

def invoice_settings(db: Session) -> dict:
    """The founder's wording and default terms (Website → Pages & menus → Invoices)."""
    from app.site import store
    doc = store.load(db).docs.get("invoices") or {}
    try:
        terms = int(str(doc.get("terms_days", "14")).strip())
    except ValueError:
        terms = 14
    return {"terms_days": terms if terms in TERMS else 14, "how_to_pay": doc.get("how_to_pay", ""),
            "thanks": doc.get("thanks", "")}


def bill_to_suggestion(db: Session, order: Order) -> dict:
    """Prefill the invoice form: the client's last invoice details, else their name, email and default address."""
    last = db.scalar(select(Invoice).where(Invoice.client_id == order.client_id).order_by(Invoice.id.desc()))
    if last:
        return {"company": last.company, "contact_name": last.contact_name, "address": last.address, "email": last.email}
    c = order.client
    addr = next((a for a in c.addresses if a.is_default and not a.archived), None) or next(
        (a for a in c.addresses if not a.archived), None)
    return {"company": "", "contact_name": c.full_name, "address": addr.one_line().replace(", ", "\n") if addr else "",
            "email": c.email}


def _next_number(db: Session) -> str:
    n = db.scalar(select(func.count()).select_from(Invoice)) or 0
    while True:
        n += 1
        number = f"INV-{n:04d}"
        if not db.scalar(select(Invoice.id).where(Invoice.number == number)):
            return number


def issue_invoice(db: Session, order: Order, *, company: str, contact_name: str = "", address: str = "", email: str = "",
                  po_ref: str = "", terms_days: int | None = None, note: str = "", by: str = "") -> Invoice:
    """A fixed copy of the order as it stands now. Caller commits."""
    from app.models import OrderStatus
    if order.status == OrderStatus.cancelled:
        raise DocumentError("This order is cancelled.")
    if not company.strip():
        raise DocumentError("Enter the company (or person) the invoice is for.")
    settings = invoice_settings(db)
    terms = settings["terms_days"] if terms_days is None else terms_days
    if terms not in TERMS:
        raise DocumentError("Choose payment terms: due on receipt, 7, 14 or 30 days.")
    lines, total, estimate = order_lines(order)
    paid_rows, due = settlement(order)
    today = local_now().date()
    inv = Invoice(number=_next_number(db), order_id=order.id, client_id=order.client_id, order_ref=order.ref,
                  company=company.strip()[:160], contact_name=contact_name.strip()[:160], address=address.strip(),
                  email=(email or order.client.email).strip().lower()[:255], po_ref=po_ref.strip()[:80],
                  issued_on=today, due_on=today + timedelta(days=terms), terms_days=terms,
                  lines=lines + [{"paid": k, "amount_pence": v} for k, v in paid_rows],
                  total_pence=total, paid_pence=total - due if due <= total else 0, due_pence=due, estimate=estimate,
                  note=note.strip(), created_by=by)
    db.add(inv)
    db.flush()
    return inv


def invoice_pdf(db: Session, inv: Invoice) -> bytes:
    settings = invoice_settings(db)
    items = [line for line in inv.lines if "paid" not in line]
    paid_rows = [(line["paid"], line["amount_pence"]) for line in inv.lines if "paid" in line]
    pdf = _start(f"LAVE invoice {inv.number}")
    facts = [("Invoice number", inv.number), ("Date", _day(inv.issued_on)),
             ("Payment terms", TERMS.get(inv.terms_days, f"{inv.terms_days} days")), ("Due", _day(inv.due_on)),
             ("Order", inv.order_ref)]
    if inv.po_ref:
        facts.append(("Your reference", inv.po_ref))
    _heading(pdf, "Void invoice" if inv.voided_at else "Invoice", facts)
    _parties(pdf, "Bill to", [inv.company, inv.contact_name, *inv.address.splitlines(), inv.email])
    _table(pdf, items)
    _sums(pdf, [("Total", money(inv.total_pence), True)] + [(k, money(v), False) for k, v in paid_rows]
          + [("Amount due", money(inv.due_pence), True)])
    _paragraphs(pdf, [
        f"This invoice was voided on {_day(inv.voided_at)}: {inv.void_reason}" if inv.voided_at else "",
        "This invoice is based on the items booked. If the atelier's count differs, we'll send an updated invoice."
        if inv.estimate else "",
        inv.note,
        f"Please pay {money(inv.due_pence)} by {_day(inv.due_on)}, quoting {inv.number}." if inv.due_pence and not inv.voided_at else "",
        settings["how_to_pay"] if inv.due_pence and not inv.voided_at else "",
        NO_VAT,
        settings["thanks"],
    ])
    return bytes(pdf.output())


def send_invoice(db: Session, inv: Invoice) -> bool:
    """Email the invoice with its PDF attached. Returns True if the mail server accepted it."""
    if inv.voided_at:
        raise DocumentError("This invoice is void.")
    if not inv.email:
        raise DocumentError("Add an email address to send the invoice to.")
    settings = invoice_settings(db)
    first = inv.contact_name.split(" ")[0] if inv.contact_name else ""
    due = (f"The amount due is {money(inv.due_pence)}, by {_day(inv.due_on)}." if inv.due_pence
           else "It has already been paid in full, so there's nothing more to pay.")
    sent = letters.send(inv.email, f"Invoice {inv.number} from LAVE", first, [
        f"Please find attached invoice {inv.number} for order {inv.order_ref}. {due}",
        *([settings["how_to_pay"]] if inv.due_pence and settings["how_to_pay"] else []),
        "If anything doesn't look right, simply reply to this email.",
    ], letters.SOON, attachments=[(f"LAVE-{inv.number}.pdf", invoice_pdf(db, inv), "application/pdf")])
    if sent:
        inv.sent_at = local_now()
    return sent


def invoice_row(inv: Invoice) -> dict:
    return {"id": inv.id, "number": inv.number, "order_ref": inv.order_ref, "company": inv.company,
            "issued_on": inv.issued_on.isoformat(), "due_on": inv.due_on.isoformat(), "terms": TERMS.get(inv.terms_days, ""),
            "total_pence": inv.total_pence, "due_pence": inv.due_pence, "estimate": inv.estimate, "email": inv.email,
            "sent_at": inv.sent_at.isoformat() if inv.sent_at else None,
            "voided_at": inv.voided_at.isoformat() if inv.voided_at else None, "void_reason": inv.void_reason}
