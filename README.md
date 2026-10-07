# LAVE OS

The whole of lavelondon.com in one system: the public website, client accounts, bookings, garment tracking, the Vault, the Wardrobe, the Apothecary shop, the THREAD by LAVE journal, and the staff dashboard. It replaces the WordPress site; the WordPress connector plugin in `wordpress/` is kept only as a fallback.

```
Visitors ──▶ lavelondon.com (this app, server-rendered pages)
             ├─ /atelier/  /apothecary/  /memberships/  /laveworld/   website
             ├─ /account/  /book/  /basket/  /checkout/                clients (signed-in cookie)
             ├─ /admin                                                 staff dashboard
             └─ /api/…                                                 JSON for the dashboard and account screens
             Postgres · Stripe (cards, memberships, shop) · SMTP email (sign-in links, receipts)
```

- **Clients** create an account with email and password, confirmed by an emailed link, or sign in with a one-time emailed link.
- **Staff** sign in at `/admin`. Roles: admin, operator, driver.
- **Payments**: card saved at booking, charged after garments are itemised; memberships are Stripe subscriptions; the Apothecary uses Stripe Checkout.

## What it does

| Area | Clients (on the website) | Staff (`/admin`) |
|---|---|---|
| Booking | LAVE collects or drop off · 1-hour (£4) or Saver windows · week grid · return slot at least 24h later, or arrange later · notes and what's in the bag | Day board of collections and deliveries · assign drivers · en route / done / missed · capacity and fees per window · closed days |
| Clients | Profile, mobile, care preferences (shirts, starch, fragrance, detergent), addresses, card on file | Search, create walk-in clients, staff notes, order and Vault history |
| Orders | Live tracker (Booked → Collected → Inspected → In care → Quality check → Ready → Delivered), itemised list with tags and prices, history | Pipeline counts · itemise garments with tag codes, service and price · move through stages · print tags · scan or type a tag to find it |
| Vault | See stored pieces, select some, book a return | Inventory with rack locations and season · return requests · mark returned |
| Payments | Save card (Stripe Elements), start or manage a membership | Charge card on file · record in-person payment or waive (admin) · nothing leaves the atelier unpaid |
| Wardrobe | Every piece LAVE has cleaned, with times cared for · tick pieces and "Book these again" | Link a garment to the same piece at intake · see which pieces the client is sending |
| Apothecary | Products with size and scent · basket · delivery or collection · Stripe Checkout | Orders to pack, dispatch with tracking · price and stock per option · selling on/off (emails the waitlist) |
| Journal | THREAD by LAVE, events (LAVE Experiences), press · LAVEWorld pages · contact form | Write, preview, schedule and publish posts · edit LAVEWorld pages · upload images · read contact messages |
| Website | Every page's text and photos, menus, membership plans and prices, footer | Edit and save live (admins), reset to original · image library with alt text · copy images off lavelondon.com · Atelier services and Apothecary products |

Rules the system enforces:
- slot capacity
- 2 hours' notice
- a 21-day booking horizon
- no bookings on closed days
- returns at least 24 hours after collection
- client cancellation up to 2 hours before
- order stages only move forward in order
- prices are locked once an order is paid
- garments marked for the Vault move there automatically when the order is ready

## Run it locally

Needs Python 3.11+.

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env        # then set LAVE_ENV=development and LAVE_DATABASE_URL=sqlite:///./lave.db
.venv/bin/python -m app.seed --admin you@lavelondon.com
.venv/bin/uvicorn app.main:app --reload --port 8000
```

- Website: http://localhost:8000/
- Staff dashboard: http://localhost:8000/admin
- API docs: http://localhost:8000/api/docs

`LAVE_ENV` defaults to `production`. Set `LAVE_ENV=development` locally to get emails shown on screen, the test-payment button and the API docs. In production the app refuses to start without long random `LAVE_SECRET_KEY` / `LAVE_WP_SSO_SECRET` values and an `https://` `LAVE_SITE_URL`.

After pulling new code, run `.venv/bin/python -m app.migrate` to add new tables and columns.

For realistic sample clients, orders and Vault items, add `LAVE_DEV_ADMIN_EMAIL` and `LAVE_DEV_ADMIN_PASSWORD` to `.env` and run `.venv/bin/python -m scripts.demo_data` (development only).

Tests: `.venv/bin/python -m pytest -q`

## Deploy

LAVE OS runs on Render (`render.yaml`): one web service, a Postgres database and a disk for images, all in Frankfurt.
Step-by-step launch instructions for lavelondon.com are in [LAUNCH.md](LAUNCH.md).

- **Each deploy** runs `python -m app.release` first: it brings the database up to date and, on a brand-new database only,
  loads the starting content and creates the first admin from `LAVE_FIRST_ADMIN_EMAIL` / `LAVE_FIRST_ADMIN_PASSWORD`.
- **Pushing to `main`** on GitHub deploys automatically. If the new version fails its health check (`/healthz`), Render keeps the old one running.
- **Settings** are environment variables with the `LAVE_` prefix (see `.env.example`). Render generates the two secret keys.
- **One process only**: sign-in rate limits and the image-copy progress live in memory.
- **Old WordPress addresses** forward to their new pages (`app/site/redirects.py`). Unknown addresses show the LAVE "not found" page.
- **The WordPress connector** in `wordpress/` is no longer needed now the whole site runs on LAVE OS. It's kept for reference.

## Before going live

- **Prices**: the starting price list in `app/seed.py` is placeholder. Replace it with LAVE's real prices under Settings → Price list.
- **Slot pattern**: the defaults are Monday–Saturday, 1-hour windows from 6am to 10pm (4 bookings each, £4), 3-hour Saver windows (8 each, free), and atelier counter hours from 8am to 8pm. Adjust them under Settings → Slots.
- **Database migrations**: `app.release` adds new tables and columns automatically. Renaming or removing a column needs a proper migration (Alembic is installed).
- **Notifications**: email works over SMTP (sign-in links, receipts, dispatch). Text messages ("we'll text you when the driver is close") aren't built yet.
- **Rate limits** on sign-in and forms are kept in memory, so they reset on restart and aren't shared between servers. Move them to Redis or the database if you run more than one server.
- **Stock** isn't held while a client is on the Stripe payment page. If two people buy the last item at once, the second order is flagged "Oversold" in Shop → To pack.
- **Images** still load from lavelondon.com/wp-content until you press "Copy images now" in Website → Images. Do it before switching the domain, and check the list of any that failed.
- **Member detergent refills**: not built; the subscription model is under financial review.

## Layout

```
app/
  main.py            app factory, CORS, static mounts
  config.py          settings (LAVE_* env vars)
  models.py          data model
  auth.py            WordPress SSO, client and staff sessions, roles
  routers/           public.py, client.py (/api/me), staff.py (/api/staff)
  services/          slots.py, orders.py (stage rules), payments.py (Stripe)
  seed.py            tables, slot pattern, price list, first admin
static/
  embed/lave.js      <lave-booking> and <lave-account> web components
  admin/             staff dashboard
  dev/               local preview of the WordPress pages
wordpress/lave-os-connector/   WordPress plugin
scripts/demo_data.py           sample data for local development
tests/                         end-to-end API tests
```
