"""Request bodies. Responses are plain dicts built in app/serializers.py."""
from datetime import date

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.models import (
    BookingStatus,
    MembershipPlan,
    OrderStatus,
    PaymentStatus,
    ServiceCategory,
    StaffRole,
    WindowType,
    BookingMode,
)


class WpExchange(BaseModel):
    token: str


class ProfileUpdate(BaseModel):
    first_name: str | None = Field(None, max_length=120)
    last_name: str | None = Field(None, max_length=120)
    phone: str | None = Field(None, max_length=40)
    preferences: dict[str, str] | None = None


class AddressIn(BaseModel):
    label: str = Field("Home", max_length=60)
    line1: str = Field(min_length=1, max_length=200)
    line2: str = Field("", max_length=200)
    city: str = Field("London", max_length=100)
    postcode: str = Field(min_length=2, max_length=12)
    instructions: str = Field("", max_length=1000)
    is_default: bool = False

    @field_validator("postcode")
    @classmethod
    def norm_postcode(cls, v: str) -> str:
        return " ".join(v.upper().split())


class AddressPatch(BaseModel):
    label: str | None = None
    line1: str | None = None
    line2: str | None = None
    city: str | None = None
    postcode: str | None = None
    instructions: str | None = None
    is_default: bool | None = None


class SlotChoice(BaseModel):
    template_id: int
    day: date


class BookingRequest(BaseModel):
    collection: SlotChoice
    delivery: SlotChoice | None = None
    address_id: int | None = None
    requested_services: list[str] = []
    wardrobe_item_ids: list[int] = []
    notes: str = Field("", max_length=2000)


class VaultRetrieval(BaseModel):
    item_ids: list[int] = Field(min_length=1)
    slot: SlotChoice
    address_id: int | None = None


class WardrobePatch(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=200)
    hidden: bool | None = None


class MembershipCheckout(BaseModel):
    plan: MembershipPlan
    interval: str = Field("month", pattern="^(month|year)$")
    return_url: str


class ReturnUrl(BaseModel):
    return_url: str


class CardSaved(BaseModel):
    setup_intent_id: str


# Staff

class StaffLogin(BaseModel):
    email: EmailStr
    password: str


class StaffCreate(BaseModel):
    email: EmailStr
    name: str
    password: str = Field(min_length=10)
    role: StaffRole = StaffRole.operator


class StaffPatch(BaseModel):
    name: str | None = None
    role: StaffRole | None = None
    active: bool | None = None
    password: str | None = Field(None, min_length=10)


class BookingPatch(BaseModel):
    status: BookingStatus | None = None
    driver_id: int | None = None
    notes: str | None = None


class OrderStatusChange(BaseModel):
    status: OrderStatus
    note: str = ""


class OrderPatch(BaseModel):
    staff_notes: str | None = None
    fees_pence: int | None = Field(None, ge=0)
    discount_pence: int | None = Field(None, ge=0)


class ManualPayment(BaseModel):
    status: PaymentStatus
    note: str = ""


class WalkInOrder(BaseModel):
    client_id: int
    client_notes: str = ""


class GarmentIn(BaseModel):
    description: str = Field(min_length=1, max_length=200)
    service_id: int | None = None
    brand: str = ""
    colour: str = ""
    fibre: str = ""
    condition_notes: str = ""
    price_pence: int | None = Field(None, ge=0)
    send_to_vault: bool = False
    # Repeat of a piece already in the client's Wardrobe.
    wardrobe_item_id: int | None = None


class GarmentPatch(BaseModel):
    description: str | None = None
    service_id: int | None = None
    brand: str | None = None
    colour: str | None = None
    fibre: str | None = None
    condition_notes: str | None = None
    price_pence: int | None = Field(None, ge=0)
    send_to_vault: bool | None = None


class ClientPatch(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    phone: str | None = None
    staff_notes: str | None = None
    preferences: dict[str, str] | None = None


class ClientCreate(BaseModel):
    email: EmailStr
    first_name: str = ""
    last_name: str = ""
    phone: str = ""


class VaultPatch(BaseModel):
    location: str | None = None
    season: str | None = None
    description: str | None = None


class SlotTemplateIn(BaseModel):
    weekday: int = Field(ge=0, le=6)
    start: str  # "HH:MM"
    end: str
    window_type: WindowType
    mode: BookingMode = BookingMode.lave_collects
    capacity: int = Field(ge=0)
    fee_pence: int = Field(0, ge=0)
    active: bool = True


class SlotTemplatePatch(BaseModel):
    capacity: int | None = Field(None, ge=0)
    fee_pence: int | None = Field(None, ge=0)
    active: bool | None = None


class BlackoutIn(BaseModel):
    day: date
    reason: str = ""


class ServiceIn(BaseModel):
    code: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=200)
    category: ServiceCategory
    unit: str = "item"
    price_pence: int = Field(ge=0)
    active: bool = True
    show_online: bool = False
    image: str = Field("", max_length=400)
    summary: str = Field("", max_length=2000)
    collections: list[str] = []


class ServicePatch(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=200)
    category: ServiceCategory | None = None
    unit: str | None = None
    price_pence: int | None = Field(None, ge=0)
    active: bool | None = None
    show_online: bool | None = None
    image: str | None = Field(None, max_length=400)
    summary: str | None = Field(None, max_length=2000)
    collections: list[str] | None = None
    review_note: str | None = None


class ContentSave(BaseModel):
    value: dict


class MediaPatch(BaseModel):
    alt: str = Field("", max_length=300)


class ProductIn(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    summary: str = Field("", max_length=2000)
    image: str = Field("", max_length=400)
    menu_sub: str = Field(min_length=1, max_length=60)
    menu_item: str = Field("", max_length=60)
    active: bool = True


class ProductPatch(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=160)
    summary: str | None = Field(None, max_length=2000)
    image: str | None = Field(None, max_length=400)
    menu_sub: str | None = Field(None, min_length=1, max_length=60)
    menu_item: str | None = Field(None, max_length=60)
    active: bool | None = None
    sort: int | None = None


class VariantIn(BaseModel):
    size: str = Field(min_length=1, max_length=60)
    scent: str = Field("", max_length=60)
    price_pence: int = Field(ge=0)
    stock: int = Field(0, ge=0)


class SellingSwitch(BaseModel):
    on: bool


class VariantPatch(BaseModel):
    price_pence: int | None = Field(None, ge=0)
    stock: int | None = Field(None, ge=0)
    active: bool | None = None


class ShopOrderUpdate(BaseModel):
    status: str
    tracking: str = ""


class PostIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    kind: str = Field("thread", pattern="^(thread|event|press)$")
    excerpt: str = Field("", max_length=600)
    body: str = Field("", max_length=100_000)
    cover_image: str = Field("", max_length=400)
    author: str = Field("LAVE", max_length=120)
    slug: str | None = Field(None, max_length=160)
    event_starts_at: str | None = None  # "YYYY-MM-DDTHH:MM"
    event_location: str = ""
    event_theme: str = ""
    members_only: bool = False
    outlet: str = ""
    external_url: str = ""


class PublishChange(BaseModel):
    publish: bool
    published_at: str | None = None  # schedule for later, "YYYY-MM-DDTHH:MM"


class PageIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    intro: str = Field("", max_length=1000)
    body: str = Field("", max_length=100_000)
    image: str = Field("", max_length=400)
    published: bool = False


class MarkdownIn(BaseModel):
    text: str = Field("", max_length=100_000)
