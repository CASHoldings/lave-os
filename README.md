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

1. **Server.** Any host that runs a Python web app and Postgres works, for example Render, Railway, Fly.io, or a small VPS. Run:
   `uvicorn app.main:app --host 0.0.0.0 --port $PORT --proxy-headers`
   Serve it over HTTPS at a subdomain such as `os.lavelondon.com`.
2. **Database.** Set `LAVE_DATABASE_URL` to Postgres, then run `python -m app.seed --admin you@lavelondon.com` once. This creates the tables, the default slot pattern and the starting price list.
3. **Secrets.** Set `LAVE_SECRET_KEY` and `LAVE_WP_SSO_SECRET` to long random values. See `.env.example`.
4. **Stripe.**
   - Add your keys.
   - Create three monthly Prices for the memberships (Essence, Elevate, Éclat) and put their IDs in `LAVE_STRIPE_PRICE_*`.
   - Add a webhook endpoint `https://os.lavelondon.com/api/stripe/webhook` for these events:
     - `setup_intent.succeeded`
     - `payment_intent.succeeded`
     - `payment_intent.payment_failed`
     - `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`
   - Put the signing secret in `LAVE_STRIPE_WEBHOOK_SECRET`.
   - Turn on the Customer Portal so members can manage their plan.
5. **WordPress.**
   - Zip `wordpress/lave-os-connector/` and upload it under Plugins → Add New → Upload, then activate it.
   - In `wp-config.php` add `define('LAVE_OS_SSO_SECRET', '<same value as LAVE_WP_SSO_SECRET>');`
   - Under Settings → LAVE OS, set the LAVE OS address.
   - Put `[lave_booking]` on the "Book a collection" page and `[lave_account]` on a client account page. In Elementor, use the Shortcode widget.
   - Once you're happy, deactivate the old `laundry-booking-system` plugin.

## Before going live

- **Prices**: the starting price list in `app/seed.py` is placeholder. Replace it with LAVE's real prices under Settings → Price list.
- **Slot pattern**: the defaults are Monday–Saturday, 1-hour windows from 6am to 10pm (4 bookings each, £4), 3-hour Saver windows (8 each, free), and atelier counter hours from 8am to 8pm. Adjust them under Settings → Slots.
- **Database migrations**: tables are created by `app.seed`. Alembic is installed; set up migrations before the first schema change after launch.
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
