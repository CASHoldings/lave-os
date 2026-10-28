"""LAVE OS data model.

Money is stored as integer pence. Times are stored as naive datetimes in the
atelier's local time (Europe/London), because slots are a local-time concept.
"""
import enum
import secrets
from datetime import date, datetime, time

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    Time,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def new_ref(prefix: str) -> str:
    # Unambiguous characters only: these are read aloud on the phone and written on tags.
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return prefix + "-" + "".join(secrets.choice(alphabet) for _ in range(6))


class StaffRole(str, enum.Enum):
    admin = "admin"
    operator = "operator"
    driver = "driver"


class WindowType(str, enum.Enum):
    hour = "hour"    # 1-hour window, paid
    saver = "saver"  # wider window, cheaper


class BookingKind(str, enum.Enum):
    collection = "collection"
    delivery = "delivery"


class BookingMode(str, enum.Enum):
    lave_collects = "lave_collects"  # driver visits the client's address
    drop_off = "drop_off"            # client brings / collects at the atelier


class BookingStatus(str, enum.Enum):
    scheduled = "scheduled"
    en_route = "en_route"
    completed = "completed"
    missed = "missed"
    cancelled = "cancelled"


class OrderStatus(str, enum.Enum):
    awaiting_collection = "awaiting_collection"
    collected = "collected"
    # Something in the reviewed order differs from the booking: on hold until staff have called the client.
    awaiting_customer_call = "awaiting_customer_call"
    inspected = "inspected"
    in_care = "in_care"
    quality_check = "quality_check"
    ready = "ready"
    out_for_delivery = "out_for_delivery"
    delivered = "delivered"
    cancelled = "cancelled"


class ItemStatus(str, enum.Enum):
    received = "received"
    inspected = "inspected"
    in_care = "in_care"
    quality_check = "quality_check"
    ready = "ready"
    returned = "returned"
    in_vault = "in_vault"


class PaymentStatus(str, enum.Enum):
    unpaid = "unpaid"
    paid = "paid"
    failed = "failed"
    refunded = "refunded"
    waived = "waived"


class MembershipPlan(str, enum.Enum):
    essence = "essence"
    elevate = "elevate"
    eclat = "eclat"


class MembershipStatus(str, enum.Enum):
    pending = "pending"
    active = "active"
    past_due = "past_due"
    cancelled = "cancelled"


class VaultStatus(str, enum.Enum):
    stored = "stored"
    retrieval_requested = "retrieval_requested"
    retrieved = "retrieved"


class ServiceCategory(str, enum.Enum):
    clean = "clean"
    press = "press"
    refresh = "refresh"
    preserve = "preserve"
    vault = "vault"
    repair = "repair"


class Timestamped:
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class StaffUser(Timestamped, Base):
    __tablename__ = "staff_users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[StaffRole] = mapped_column(Enum(StaffRole), default=StaffRole.operator)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Two-step sign-in (services/two_step.py): the authenticator secret, when it was turned on, the last code step
    # used (so a code works once), and hashes of the unused recovery codes.
    totp_secret: Mapped[str | None] = mapped_column(String(64))
    totp_enabled_at: Mapped[datetime | None] = mapped_column(DateTime)
    totp_last_step: Mapped[int] = mapped_column(Integer, default=0)
    recovery_codes: Mapped[list] = mapped_column(JSON, default=list)


class Client(Timestamped, Base):
    __tablename__ = "clients"
    id: Mapped[int] = mapped_column(primary_key=True)
    wp_user_id: Mapped[int | None] = mapped_column(Integer, unique=True)
    email: Mapped[str] = mapped_column(String(255), unique=True)
    first_name: Mapped[str] = mapped_column(String(120), default="")
    last_name: Mapped[str] = mapped_column(String(120), default="")
    phone: Mapped[str] = mapped_column(String(40), default="")
    # Care preferences, e.g. {"shirts": "hung", "starch": "light", "fragrance": "unscented"}
    preferences: Mapped[dict] = mapped_column(JSON, default=dict)
    staff_notes: Mapped[str] = mapped_column(Text, default="")
    stripe_customer_id: Mapped[str | None] = mapped_column(String(64))
    has_card_on_file: Mapped[bool] = mapped_column(Boolean, default=False)
    # Website sign-in. Clients who arrive through WordPress or are created by staff have no password.
    password_hash: Mapped[str | None] = mapped_column(String(255))
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime)
    # "Tell us about you" (members, all optional; services/members.py). Birthday is day and month only, no year.
    birthday_day: Mapped[int | None] = mapped_column(Integer)
    birthday_month: Mapped[int | None] = mapped_column(Integer)
    about: Mapped[dict] = mapped_column(JSON, default=dict)
    about_completed_at: Mapped[datetime | None] = mapped_column(DateTime)
    # Data rights (services/privacy.py): when they asked us to delete their account, and when we did.
    deletion_requested_at: Mapped[datetime | None] = mapped_column(DateTime)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime)

    addresses: Mapped[list["Address"]] = relationship(back_populates="client", cascade="all, delete-orphan")
    membership: Mapped["Membership | None"] = relationship(back_populates="client", uselist=False)

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip() or self.email


class Address(Timestamped, Base):
    __tablename__ = "addresses"
    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"))
    label: Mapped[str] = mapped_column(String(60), default="Home")
    line1: Mapped[str] = mapped_column(String(200))
    line2: Mapped[str] = mapped_column(String(200), default="")
    city: Mapped[str] = mapped_column(String(100), default="London")
    postcode: Mapped[str] = mapped_column(String(12))
    instructions: Mapped[str] = mapped_column(Text, default="")
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)

    client: Mapped[Client] = relationship(back_populates="addresses")

    def one_line(self) -> str:
        parts = [self.line1, self.line2, self.city, self.postcode]
        return ", ".join(p for p in parts if p)


class Membership(Timestamped, Base):
    __tablename__ = "memberships"
    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), unique=True)
    plan: Mapped[MembershipPlan] = mapped_column(Enum(MembershipPlan))
    status: Mapped[MembershipStatus] = mapped_column(Enum(MembershipStatus), default=MembershipStatus.pending)
    stripe_subscription_id: Mapped[str | None] = mapped_column(String(64))
    current_period_end: Mapped[datetime | None] = mapped_column(DateTime)
    billing_interval: Mapped[str | None] = mapped_column(String(8))  # "month" or "year"
    # Paused: no charges and no member benefits until resumes_at (or until resumed by hand).
    paused: Mapped[bool] = mapped_column(Boolean, default=False)
    resumes_at: Mapped[datetime | None] = mapped_column(DateTime)

    client: Mapped[Client] = relationship(back_populates="membership")

    @property
    def is_active(self) -> bool:
        return self.status == MembershipStatus.active and not self.paused

    @property
    def effective_status(self) -> str:
        return "paused" if self.status == MembershipStatus.active and self.paused else self.status.value


class Service(Timestamped, Base):
    """The price list. Staff pick from it when itemising an order; services with show_online appear on the website."""
    __tablename__ = "services"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    category: Mapped[ServiceCategory] = mapped_column(Enum(ServiceCategory))
    unit: Mapped[str] = mapped_column(String(20), default="item")
    price_pence: Mapped[int] = mapped_column(Integer)
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    # Website catalogue
    show_online: Mapped[bool] = mapped_column(Boolean, default=False)
    slug: Mapped[str | None] = mapped_column(String(160), unique=True)
    image: Mapped[str] = mapped_column(String(400), default="")
    summary: Mapped[str] = mapped_column(Text, default="")
    # Menu items the service is listed under, e.g. ["women"] or ["children"].
    collections: Mapped[list] = mapped_column(JSON, default=list)
    tags: Mapped[list] = mapped_column(JSON, default=list)
    # Note for the founder about something to check on this listing.
    review_note: Mapped[str] = mapped_column(Text, default="")

    # Product repository (the full price list, edited in /admin → Products or imported from the pricing sheet).
    product_category: Mapped[str] = mapped_column(String(80), default="")  # e.g. "Coats"; blank for legacy services
    sale_mode: Mapped[str] = mapped_column(String(20), default="single")  # pack | single_or_pack | single | quote | per_m2 | per_kg
    service_type: Mapped[str] = mapped_column(String(40), default="")  # Dry clean, Wash & press, Alteration…
    cost_pence: Mapped[int | None] = mapped_column(Integer)  # what processing costs LAVE (SoFresh); blank until known
    price_basis: Mapped[str] = mapped_column(String(60), default="")
    internal_notes: Mapped[str] = mapped_column(Text, default="")
    sort: Mapped[int] = mapped_column(Integer, default=0)
    # A retired website listing points at the repository item that replaced it (for redirects).
    replaced_by_id: Mapped[int | None] = mapped_column(Integer)

    @property
    def title(self) -> str:
        """The name without the SEO tail after the dash."""
        return self.name.split(" – ")[0].strip()


class SlotTemplate(Base):
    """Recurring weekly capacity. weekday: 0 = Monday."""
    __tablename__ = "slot_templates"
    id: Mapped[int] = mapped_column(primary_key=True)
    weekday: Mapped[int] = mapped_column(Integer)
    start: Mapped[time] = mapped_column(Time)
    end: Mapped[time] = mapped_column(Time)
    window_type: Mapped[WindowType] = mapped_column(Enum(WindowType))
    mode: Mapped[BookingMode] = mapped_column(Enum(BookingMode), default=BookingMode.lave_collects)
    capacity: Mapped[int] = mapped_column(Integer, default=4)
    fee_pence: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class SlotBlackout(Base):
    __tablename__ = "slot_blackouts"
    id: Mapped[int] = mapped_column(primary_key=True)
    day: Mapped[date] = mapped_column(Date, unique=True)
    reason: Mapped[str] = mapped_column(String(200), default="")


class Order(Timestamped, Base):
    __tablename__ = "orders"
    id: Mapped[int] = mapped_column(primary_key=True)
    ref: Mapped[str] = mapped_column(String(12), unique=True, default=lambda: new_ref("LV"))
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id"))
    status: Mapped[OrderStatus] = mapped_column(Enum(OrderStatus), default=OrderStatus.awaiting_collection)
    # What the client told us is in the bag, e.g. ["clean", "press"] plus free text.
    requested_services: Mapped[list] = mapped_column(JSON, default=list)
    # Wardrobe pieces the client said they're sending (ids of WardrobeItem).
    requested_wardrobe: Mapped[list] = mapped_column(JSON, default=list)
    # What the client said they're sending, from their price-list estimate (a snapshot; staff confirm after inspection).
    requested_items: Mapped[list] = mapped_column(JSON, default=list)
    estimate_pence: Mapped[int | None] = mapped_column(Integer)
    client_notes: Mapped[str] = mapped_column(Text, default="")
    staff_notes: Mapped[str] = mapped_column(Text, default="")
    fees_pence: Mapped[int] = mapped_column(Integer, default=0)
    # How the collection & delivery charge was set at booking (membership level then, one-hour leg, estimate);
    # see services/delivery.py. "manual" once staff override the charge by hand.
    delivery_basis: Mapped[dict] = mapped_column(JSON, default=dict)
    # Paid at booking and after review (OrderPayment), account credit used at booking, and credit given back after
    # review (ClientCredit). balance_pence is what's still owed (negative: what we owe the client).
    credit_used_pence: Mapped[int] = mapped_column(Integer, default=0)
    credited_pence: Mapped[int] = mapped_column(Integer, default=0)
    call_notes: Mapped[str] = mapped_column(Text, default="")  # what was agreed with the client on the phone
    # Orders with pieces outside the 48-hour promise: "together" (one return when all is ready) or "split".
    return_preference: Mapped[str] = mapped_column(String(10), default="")
    discount_pence: Mapped[int] = mapped_column(Integer, default=0)
    # Minimum order (items) for this booking: home collection or drop-off, set at booking (0: none, e.g. curated packs
    # or set by staff). Once counted, items under it are topped up to it (minimum_top_up_pence).
    minimum_pence: Mapped[int] = mapped_column(Integer, default=0)
    payment_status: Mapped[PaymentStatus] = mapped_column(Enum(PaymentStatus), default=PaymentStatus.unpaid)
    stripe_payment_intent_id: Mapped[str | None] = mapped_column(String(64))
    paid_at: Mapped[datetime | None] = mapped_column(DateTime)

    client: Mapped[Client] = relationship()
    items: Mapped[list["Garment"]] = relationship(back_populates="order", cascade="all, delete-orphan", order_by="Garment.id")
    bookings: Mapped[list["Booking"]] = relationship(back_populates="order", order_by="Booking.starts_at")
    events: Mapped[list["OrderEvent"]] = relationship(back_populates="order", cascade="all, delete-orphan", order_by="OrderEvent.id")
    payments: Mapped[list["OrderPayment"]] = relationship(cascade="all, delete-orphan", order_by="OrderPayment.id")

    @property
    def items_total_pence(self) -> int:
        return sum(i.price_pence for i in self.items)

    @property
    def minimum_top_up_pence(self) -> int:
        """What's added to bring counted items up to the minimum order. Nothing until the items are counted."""
        return max(0, (self.minimum_pence or 0) - self.items_total_pence) if self.items else 0

    @property
    def missed_visits_pence(self) -> int:
        """Charges for missed visits on this order (bookings.record_missed)."""
        return sum(b.missed_fee_pence for b in self.bookings)

    @property
    def total_pence(self) -> int:
        return max(0, self.items_total_pence + self.minimum_top_up_pence + self.fees_pence + self.missed_visits_pence
                   - self.discount_pence)

    @property
    def paid_pence(self) -> int:
        # Refunds of account credit come out of the client's credit, not the order.
        return sum(p.amount_pence for p in self.payments if p.status == "succeeded" and p.kind != "refund")

    @property
    def expected_total_pence(self) -> int:
        """The counted total once the atelier has itemised the order; until then, what was booked."""
        items = self.items_total_pence if self.items else sum(
            line["unit_pence"] * line["qty"] for line in self.requested_items or [] if not line.get("priced_later"))
        return max(0, items + self.minimum_top_up_pence + self.fees_pence + self.missed_visits_pence - self.discount_pence)

    @property
    def balance_pence(self) -> int:
        return self.expected_total_pence - self.paid_pence - self.credit_used_pence + self.credited_pence


class Booking(Timestamped, Base):
    __tablename__ = "bookings"
    id: Mapped[int] = mapped_column(primary_key=True)
    ref: Mapped[str] = mapped_column(String(12), unique=True, default=lambda: new_ref("BK"))
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id"))
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id"))
    template_id: Mapped[int | None] = mapped_column(ForeignKey("slot_templates.id", ondelete="SET NULL"))
    kind: Mapped[BookingKind] = mapped_column(Enum(BookingKind))
    mode: Mapped[BookingMode] = mapped_column(Enum(BookingMode))
    window_type: Mapped[WindowType] = mapped_column(Enum(WindowType))
    address_id: Mapped[int | None] = mapped_column(ForeignKey("addresses.id"))
    starts_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    ends_at: Mapped[datetime] = mapped_column(DateTime)
    fee_pence: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[BookingStatus] = mapped_column(Enum(BookingStatus), default=BookingStatus.scheduled)
    driver_id: Mapped[int | None] = mapped_column(ForeignKey("staff_users.id"))
    notes: Mapped[str] = mapped_column(Text, default="")
    reminded_at: Mapped[datetime | None] = mapped_column(DateTime)  # the evening-before reminder (notices.py)
    on_the_way_sent_at: Mapped[datetime | None] = mapped_column(DateTime)  # "your driver is on the way" (notices.py)
    # Atelier drop-offs (members): where, how many bags (labelled <ref>-1, <ref>-2…), and which have been checked in.
    atelier_id: Mapped[int | None] = mapped_column(ForeignKey("atelier_locations.id"))
    bags: Mapped[int] = mapped_column(Integer, default=0)
    bags_checked: Mapped[list] = mapped_column(JSON, default=list)
    checked_in_at: Mapped[datetime | None] = mapped_column(DateTime)
    # Each time we couldn't complete this visit: [{"at": iso, "fee_pence": n}] (Terms, 10: a customer's first missed
    # visit in any 12 months is rebooked free; after that each one is charged). See bookings.record_missed.
    missed_log: Mapped[list] = mapped_column(JSON, default=list)

    client: Mapped[Client] = relationship()
    order: Mapped[Order | None] = relationship(back_populates="bookings")
    address: Mapped[Address | None] = relationship()
    driver: Mapped[StaffUser | None] = relationship()
    atelier: Mapped["AtelierLocation | None"] = relationship()

    @property
    def missed_fee_pence(self) -> int:
        return sum(m.get("fee_pence", 0) for m in self.missed_log or [])

    @property
    def bag_codes(self) -> list[str]:
        """LV-7K2M9P-1, LV-7K2M9P-2…: the order reference the member sees, plus the bag number."""
        ref = self.order.ref if self.order else self.ref
        return [f"{ref}-{n}" for n in range(1, (self.bags or 0) + 1)]


class Garment(Timestamped, Base):
    """One physical item, tagged at intake and tracked through the atelier."""
    __tablename__ = "garments"
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"))
    tag_code: Mapped[str] = mapped_column(String(20), unique=True)
    service_id: Mapped[int | None] = mapped_column(ForeignKey("services.id"))
    description: Mapped[str] = mapped_column(String(200))
    brand: Mapped[str] = mapped_column(String(80), default="")
    colour: Mapped[str] = mapped_column(String(60), default="")
    fibre: Mapped[str] = mapped_column(String(80), default="")
    condition_notes: Mapped[str] = mapped_column(Text, default="")
    price_pence: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[ItemStatus] = mapped_column(Enum(ItemStatus), default=ItemStatus.received)
    send_to_vault: Mapped[bool] = mapped_column(Boolean, default=False)
    # The piece in the client's Wardrobe this garment is; the same coat cleaned twice shares one Wardrobe item.
    wardrobe_item_id: Mapped[int | None] = mapped_column(ForeignKey("wardrobe_items.id", ondelete="SET NULL"), index=True)

    order: Mapped[Order] = relationship(back_populates="items")
    service: Mapped[Service | None] = relationship()


class OrderEvent(Base):
    """Audit trail and the timeline clients see."""
    __tablename__ = "order_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"))
    garment_id: Mapped[int | None] = mapped_column(ForeignKey("garments.id", ondelete="CASCADE"))
    status: Mapped[str] = mapped_column(String(40))
    note: Mapped[str] = mapped_column(Text, default="")
    visible_to_client: Mapped[bool] = mapped_column(Boolean, default=True)
    staff_id: Mapped[int | None] = mapped_column(ForeignKey("staff_users.id"))
    at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    order: Mapped[Order] = relationship(back_populates="events")


class VaultItem(Timestamped, Base):
    __tablename__ = "vault_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id"))
    garment_id: Mapped[int | None] = mapped_column(ForeignKey("garments.id", ondelete="SET NULL"), unique=True)
    tag_code: Mapped[str] = mapped_column(String(20), unique=True)
    description: Mapped[str] = mapped_column(String(200))
    location: Mapped[str] = mapped_column(String(60), default="")  # e.g. "R3-S2-B14"
    season: Mapped[str] = mapped_column(String(20), default="")
    status: Mapped[VaultStatus] = mapped_column(Enum(VaultStatus), default=VaultStatus.stored)
    stored_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    retrieval_booking_id: Mapped[int | None] = mapped_column(ForeignKey("bookings.id", ondelete="SET NULL"))
    retrieved_at: Mapped[datetime | None] = mapped_column(DateTime)

    client: Mapped[Client] = relationship()
    retrieval_booking: Mapped[Booking | None] = relationship()


class ProcessedWebhook(Base):
    __tablename__ = "processed_webhooks"
    __table_args__ = (UniqueConstraint("event_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[str] = mapped_column(String(80))
    at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class WaitlistEntry(Base):
    """Sign-ups from the Apothecary waitlist until products go on sale."""
    __tablename__ = "waitlist_entries"
    id: Mapped[int] = mapped_column(primary_key=True)
    first_name: Mapped[str] = mapped_column(String(120))
    surname: Mapped[str] = mapped_column(String(120), default="")
    email: Mapped[str] = mapped_column(String(255), unique=True)
    source: Mapped[str] = mapped_column(String(60), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    # Set when we emailed them that the Apothecary opened.
    notified_at: Mapped[datetime | None] = mapped_column(DateTime)


class LoginToken(Base):
    """Single-use emailed links: sign in, verify an email, or reset a password. Only the hash is stored."""
    __tablename__ = "login_tokens"
    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    purpose: Mapped[str] = mapped_column(String(20))  # "signin" | "verify" | "reset"
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    used_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class WardrobeItem(Timestamped, Base):
    """A piece the client has had cared for by LAVE: their virtual wardrobe, for booking the same care again."""
    __tablename__ = "wardrobe_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    colour: Mapped[str] = mapped_column(String(60), default="")
    brand: Mapped[str] = mapped_column(String(80), default="")
    fibre: Mapped[str] = mapped_column(String(80), default="")
    service_id: Mapped[int | None] = mapped_column(ForeignKey("services.id", ondelete="SET NULL"))
    # Clients can hide pieces they no longer own.
    hidden: Mapped[bool] = mapped_column(Boolean, default=False)

    service: Mapped[Service | None] = relationship()
    garments: Mapped[list[Garment]] = relationship(foreign_keys=[Garment.wardrobe_item_id], order_by=Garment.id)


class Pack(Timestamped, Base):
    """A mixed pack of repository items, priced as the sum of its items (no discounts)."""
    __tablename__ = "packs"
    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(120), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(20), default="themed")  # starter | themed
    note: Mapped[str] = mapped_column(Text, default="")  # who it's for / when it sells
    summary: Mapped[str] = mapped_column(Text, default="")  # client-facing description
    items: Mapped[list] = mapped_column(JSON, default=list)  # [{"service_id": 12, "qty": 3}]
    months: Mapped[list] = mapped_column(JSON, default=list)  # months it's in season (1-12); empty = all year
    image: Mapped[str] = mapped_column(String(400), default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    show_online: Mapped[bool] = mapped_column(Boolean, default=True)
    sort: Mapped[int] = mapped_column(Integer, default=0)


class SiteSetting(Base):
    """Small switches the founder controls from /admin, e.g. whether the Apothecary is selling."""
    __tablename__ = "site_settings"
    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")


class Product(Timestamped, Base):
    __tablename__ = "products"
    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(120), unique=True)
    name: Mapped[str] = mapped_column(String(160))
    summary: Mapped[str] = mapped_column(Text, default="")
    image: Mapped[str] = mapped_column(String(400), default="")
    # Where it appears in the Apothecary menu, e.g. ("wash", "detergents").
    menu_sub: Mapped[str] = mapped_column(String(60), default="")
    menu_item: Mapped[str] = mapped_column(String(60), default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort: Mapped[int] = mapped_column(Integer, default=0)

    variants: Mapped[list["ProductVariant"]] = relationship(back_populates="product", cascade="all, delete-orphan",
                                                             order_by="ProductVariant.price_pence")


class ProductVariant(Base):
    __tablename__ = "product_variants"
    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), index=True)
    sku: Mapped[str] = mapped_column(String(60), unique=True)
    size: Mapped[str] = mapped_column(String(60))
    scent: Mapped[str] = mapped_column(String(60), default="")
    price_pence: Mapped[int] = mapped_column(Integer)
    stock: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    product: Mapped[Product] = relationship(back_populates="variants")

    @property
    def label(self) -> str:
        return " · ".join(p for p in [self.size, self.scent] if p)


class ShopOrderStatus(str, enum.Enum):
    pending_payment = "pending_payment"
    paid = "paid"
    dispatched = "dispatched"
    collected = "collected"
    cancelled = "cancelled"


class ShopOrder(Timestamped, Base):
    __tablename__ = "shop_orders"
    id: Mapped[int] = mapped_column(primary_key=True)
    ref: Mapped[str] = mapped_column(String(12), unique=True, default=lambda: new_ref("AP"))
    client_id: Mapped[int | None] = mapped_column(ForeignKey("clients.id", ondelete="SET NULL"))
    email: Mapped[str] = mapped_column(String(255), default="")
    status: Mapped[ShopOrderStatus] = mapped_column(Enum(ShopOrderStatus), default=ShopOrderStatus.pending_payment)
    fulfilment: Mapped[str] = mapped_column(String(20), default="delivery")  # "delivery" | "collect"
    subtotal_pence: Mapped[int] = mapped_column(Integer, default=0)
    shipping_pence: Mapped[int] = mapped_column(Integer, default=0)
    total_pence: Mapped[int] = mapped_column(Integer, default=0)
    shipping_address: Mapped[dict] = mapped_column(JSON, default=dict)
    stripe_session_id: Mapped[str | None] = mapped_column(String(120))
    paid_at: Mapped[datetime | None] = mapped_column(DateTime)
    dispatched_at: Mapped[datetime | None] = mapped_column(DateTime)
    tracking: Mapped[str] = mapped_column(String(120), default="")
    # Secret in the confirmation link, so only the buyer can see their order page.
    view_key: Mapped[str] = mapped_column(String(32), default=lambda: secrets.token_urlsafe(16))
    # Set when payment arrived for more than was left in stock (two buyers of the last item at once).
    stock_issue: Mapped[str] = mapped_column(Text, default="")

    lines: Mapped[list["ShopOrderLine"]] = relationship(back_populates="order", cascade="all, delete-orphan")
    client: Mapped[Client | None] = relationship()


class ShopOrderLine(Base):
    __tablename__ = "shop_order_lines"
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("shop_orders.id", ondelete="CASCADE"), index=True)
    variant_id: Mapped[int | None] = mapped_column(ForeignKey("product_variants.id", ondelete="SET NULL"))
    name: Mapped[str] = mapped_column(String(160))
    variant_label: Mapped[str] = mapped_column(String(160), default="")
    unit_price_pence: Mapped[int] = mapped_column(Integer)
    quantity: Mapped[int] = mapped_column(Integer)

    order: Mapped[ShopOrder] = relationship(back_populates="lines")


class PostStatus(str, enum.Enum):
    draft = "draft"
    published = "published"


class Post(Timestamped, Base):
    """THREAD by LAVE journal posts, events and press, written in /admin."""
    __tablename__ = "posts"
    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(160), unique=True)
    kind: Mapped[str] = mapped_column(String(20), default="thread")  # "thread" | "event" | "press"
    title: Mapped[str] = mapped_column(String(200))
    excerpt: Mapped[str] = mapped_column(Text, default="")
    body: Mapped[str] = mapped_column(Text, default="")  # Markdown
    cover_image: Mapped[str] = mapped_column(String(400), default="")
    status: Mapped[PostStatus] = mapped_column(Enum(PostStatus), default=PostStatus.draft)
    published_at: Mapped[datetime | None] = mapped_column(DateTime)
    author: Mapped[str] = mapped_column(String(120), default="LAVE")
    # Events (LAVE Experiences)
    event_starts_at: Mapped[datetime | None] = mapped_column(DateTime)
    event_location: Mapped[str] = mapped_column(String(200), default="")
    event_theme: Mapped[str] = mapped_column(String(40), default="")  # "lifestyle" | "sport" | ...
    members_only: Mapped[bool] = mapped_column(Boolean, default=False)
    # Press
    outlet: Mapped[str] = mapped_column(String(120), default="")
    external_url: Mapped[str] = mapped_column(String(400), default="")


class PageContent(Timestamped, Base):
    """Editable text for LAVEWorld pages (Story, Impact, Connect), keyed by URL path."""
    __tablename__ = "page_contents"
    id: Mapped[int] = mapped_column(primary_key=True)
    path: Mapped[str] = mapped_column(String(200), unique=True)
    title: Mapped[str] = mapped_column(String(200))
    intro: Mapped[str] = mapped_column(Text, default="")
    body: Mapped[str] = mapped_column(Text, default="")  # Markdown
    image: Mapped[str] = mapped_column(String(400), default="")
    published: Mapped[bool] = mapped_column(Boolean, default=False)


class ContactMessage(Base):
    """Messages sent from the website contact form."""
    __tablename__ = "contact_messages"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(255))
    topic: Mapped[str] = mapped_column(String(60), default="")
    message: Mapped[str] = mapped_column(Text)
    handled: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class SiteContent(Base):
    """Editable website content (page wording, menus, plans, footer), one JSON document per key."""
    __tablename__ = "site_content"
    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
    updated_by: Mapped[str] = mapped_column(String(120), default="")


class Media(Base):
    """The image library: files uploaded in /admin or copied from the old WordPress site."""
    __tablename__ = "media"
    id: Mapped[int] = mapped_column(primary_key=True)
    url: Mapped[str] = mapped_column(String(400), unique=True)
    filename: Mapped[str] = mapped_column(String(200), default="")
    alt: Mapped[str] = mapped_column(String(300), default="")
    source_url: Mapped[str] = mapped_column(String(600), default="")
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class AtelierLocation(Timestamped, Base):
    """A LAVE atelier where members can drop items off (services/ateliers.py). Retired, never deleted, once used."""
    __tablename__ = "atelier_locations"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    address: Mapped[str] = mapped_column(String(300), default="")
    postcode: Mapped[str] = mapped_column(String(12), default="")
    map_link: Mapped[str] = mapped_column(String(500), default="")
    access_instructions: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(10), default="active")  # active | paused | retired
    available_from: Mapped[date | None] = mapped_column(Date)
    available_to: Mapped[date | None] = mapped_column(Date)
    # {"0": ["08:00", "20:00"], …}: opening hours by weekday (0 = Monday); any day may be set, Sunday included.
    weekly_hours: Mapped[dict] = mapped_column(JSON, default=dict)
    closure_dates: Mapped[list] = mapped_column(JSON, default=list)  # ["2026-12-25", …]
    daily_capacity: Mapped[int | None] = mapped_column(Integer)
    members_only: Mapped[bool] = mapped_column(Boolean, default=True)


class AtelierChange(Base):
    """Every change to an atelier location: who, when, what."""
    __tablename__ = "atelier_changes"
    id: Mapped[int] = mapped_column(primary_key=True)
    atelier_id: Mapped[int] = mapped_column(ForeignKey("atelier_locations.id", ondelete="CASCADE"), index=True)
    by: Mapped[str] = mapped_column(String(120), default="")
    what: Mapped[str] = mapped_column(Text, default="")
    at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class ServicePostcode(Base):
    """A postcode LAVE collects from and delivers to (services/area.py)."""
    __tablename__ = "service_postcodes"
    postcode: Mapped[str] = mapped_column(String(10), primary_key=True)  # normalised: "SW11 6AB"
    district: Mapped[str] = mapped_column(String(6), default="", index=True)
    sector: Mapped[str] = mapped_column(String(8), default="")
    source: Mapped[str] = mapped_column(String(30), default="launch")
    added_by: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class ServiceSector(Base):
    """A whole postcode sector added to the service area by admin, e.g. "SW4 9"."""
    __tablename__ = "service_sectors"
    sector: Mapped[str] = mapped_column(String(8), primary_key=True)
    added_by: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class AreaWaitlistEntry(Base):
    """People outside the service area who asked to hear when LAVE reaches them."""
    __tablename__ = "area_waitlist"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160), default="")
    email: Mapped[str] = mapped_column(String(255))
    phone: Mapped[str] = mapped_column(String(40), default="")
    postcode: Mapped[str] = mapped_column(String(10), default="")
    district: Mapped[str] = mapped_column(String(6), default="", index=True)
    services: Mapped[list] = mapped_column(JSON, default=list)
    client_id: Mapped[int | None] = mapped_column(ForeignKey("clients.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class OrderPayment(Base):
    """Money taken for an order (or refunded, as a negative amount): at booking, after review, refunds to card."""
    __tablename__ = "order_payments"
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(12))  # booking | adjustment | refund
    amount_pence: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(12), default="pending")  # pending | succeeded | failed
    stripe_id: Mapped[str] = mapped_column(String(80), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class ClientCredit(Base):
    """A client's LAVE account credit: + credit given (e.g. an order came to less), − credit used or refunded."""
    __tablename__ = "client_credits"
    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), index=True)
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id", ondelete="SET NULL"))
    amount_pence: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(300), default="")
    expires_at: Mapped[datetime | None] = mapped_column(DateTime)
    by: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class ClientOccasion(Base):
    """Something a member is preparing for (a wedding, a gala, a move), so LAVE can have their pieces ready."""
    __tablename__ = "client_occasions"
    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), index=True)
    day: Mapped[date] = mapped_column(Date, index=True)
    title: Mapped[str] = mapped_column(String(160))
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class ClientGesture(Base):
    """A birthday gesture for a member: suggested by LAVE OS, then approved, changed or skipped by the founder."""
    __tablename__ = "client_gestures"
    __table_args__ = (UniqueConstraint("client_id", "occasion", "year"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), index=True)
    occasion: Mapped[str] = mapped_column(String(20), default="birthday")
    year: Mapped[int] = mapped_column(Integer)
    on_day: Mapped[date] = mapped_column(Date)
    kind: Mapped[str] = mapped_column(String(12), default="credit")  # credit | gift | experience | note
    title: Mapped[str] = mapped_column(String(200), default="")
    detail: Mapped[str] = mapped_column(Text, default="")
    value_pence: Mapped[int] = mapped_column(Integer, default=0)
    reasons: Mapped[list] = mapped_column(JSON, default=list)
    alternatives: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(12), default="suggested")  # suggested | approved | skipped
    decided_by: Mapped[str] = mapped_column(String(120), default="")
    decided_at: Mapped[datetime | None] = mapped_column(DateTime)
    reminded_at: Mapped[datetime | None] = mapped_column(DateTime)  # founder told it's coming up
    sent_at: Mapped[datetime | None] = mapped_column(DateTime)  # member's birthday email
    client: Mapped[Client] = relationship()
