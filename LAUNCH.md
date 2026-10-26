# Launching LAVE OS on lavelondon.com

Work through these in order. Steps 1–5 happen while WordPress is still live, so nothing changes for visitors
until step 6. Allow about an hour, plus waiting time for DNS.

## 1. Put the code on GitHub

1. Create a free account at github.com (if you don't have one).
2. Click **New repository**. Name: `lave-os`. Choose **Private**. Don't tick any of the "add a README / .gitignore / licence" boxes.
3. Send Claude the repository address (it looks like `https://github.com/your-name/lave-os`). Claude connects the project to it,
   and you approve the upload. GitHub will ask you to sign in the first time; that's you, not Claude.

## 2. Create the server on Render

1. Sign up at render.com with **Sign in with GitHub**, and allow Render to see the `lave-os` repository.
2. Click **New → Blueprint**, choose `lave-os`, and click **Apply**. Render reads `render.yaml` and creates:
   the website (`lave-os`), the database (`lave-db`), and a 5 GB disk for images. All in Frankfurt.
3. Render asks for a few values. Fill in only these two for now:
   - `LAVE_FIRST_ADMIN_EMAIL`: the email you'll sign in to /admin with.
   - `LAVE_FIRST_ADMIN_PASSWORD`: a new password, 12+ characters. Type it yourself; don't share it with anyone, including Claude.
   Leave the email (SMTP) and Stripe values blank. They're later steps.
4. Wait for the first deploy to finish (a few minutes). The log ends with "Your service is live".

## 3. Sign in to the live admin

1. Open `https://lave-os.onrender.com/admin` (Render shows the exact address at the top of the `lave-os` page).
2. Sign in with the email and password from step 2.
3. In Render, open `lave-os` → **Environment**, delete `LAVE_FIRST_ADMIN_PASSWORD`, and save. Your account stays; this just removes the password from the server settings.

## 4. Copy the images off WordPress — required before step 6

In the live admin: **Website → Images → Copy images now**. Wait until it says every image is in the library.
If a few fail, press it again; if some still fail, send Claude the list.

This must happen while lavelondon.com is still WordPress: after the switch, the old image addresses point at the new site.

## 5. Check the site on its temporary address

Click through `https://lave-os.onrender.com`: home, the four sections, a service page, the membership page, sign up as a test client, and book a collection.
Make any content edits you want in /admin now; they carry straight over to lavelondon.com.

## 6. Point lavelondon.com at Render

1. In Render, open `lave-os` → **Settings → Custom Domains**. `lavelondon.com` and `www.lavelondon.com` are already listed.
   Render shows the DNS records each one needs. Use the values Render shows; at the time of writing they are:
   - `lavelondon.com`: an **A** record pointing to `216.24.57.1`
   - `www.lavelondon.com`: a **CNAME** pointing to `lave-os.onrender.com`
2. In Hostinger: **Domains → lavelondon.com → DNS / Nameservers → DNS records**.
   - Edit the **A** record for `@` to Render's address. Delete any other **A** or **AAAA** records for `@`.
   - Edit (or add) the **CNAME** for `www` to Render's address.
   - **Don't touch** MX, TXT, SPF, DKIM, DMARC, `autodiscover` or `mail` records. They run your email.
3. Back in Render, click **Verify** next to each domain. It can take from a few minutes up to a few hours. Render then issues the HTTPS certificates itself.
4. Visit `https://lavelondon.com`. Then send an email to yourself at your @lavelondon.com address to confirm email still works.

### lavelondon.co.uk

The app sends `lavelondon.co.uk` and `www.lavelondon.co.uk` on to `lavelondon.com`; Render gives them HTTPS.

1. In Render, `lave-os` → **Settings → Custom Domains** lists both (from `render.yaml`). If they're missing, run
   **Blueprints → lave-os → Manual sync**, or add them there with **+ Add Custom Domain**.
2. In Hostinger: **Domains → lavelondon.co.uk → DNS / Nameservers → DNS records**. Remove any redirect set on the
   domain in Hostinger first, then:
   - Edit the **A** record for `@` to `216.24.57.1`. Delete any other **A** or **AAAA** records for `@`.
   - Edit (or add) the **CNAME** for `www` to `lave-os.onrender.com`.
   - Leave any MX or TXT records alone.
3. In Render, click **Verify** next to both. Then `https://lavelondon.co.uk` should land on `https://lavelondon.com`.

### Photo storage (Cloudflare R2)

Photos live in a Cloudflare R2 bucket rather than on a Render disk, so Render can switch to a new version without taking
the site offline. Their addresses (`/media/...`) don't change.

1. Sign in at dash.cloudflare.com (a free account is fine) → **R2 Object Storage**. Cloudflare may ask for a card to
   switch R2 on; LAVE's photos are far inside the free allowance (10 GB, no download charges).
2. **Create bucket**: name `lave-media`, location **Automatic** (or Western Europe), storage class **Standard**. Leave
   public access off: the website fetches the photos itself.
3. On the R2 overview page, copy the **S3 API** address under Account details. It looks like
   `https://<account id>.r2.cloudflarestorage.com`. Leave off anything after `.com`.
4. **Manage API tokens → Create API token**: permission **Object Read & Write**, applied to the `lave-media` bucket
   only, no expiry. Copy the **Access Key ID** and **Secret Access Key**. The secret is shown once.
5. In Render, `lave-os` → **Environment**, add (paste the keys here only, never in chat or email):
   - `LAVE_STORAGE_BUCKET` = `lave-media`
   - `LAVE_STORAGE_ENDPOINT` = the S3 API address from step 3
   - `LAVE_STORAGE_KEY_ID` and `LAVE_STORAGE_SECRET` = the two keys from step 4
   Then **Save, rebuild and deploy**.
6. When the site starts, it copies every photo from the old disk into the bucket. In `lave-os` → **Logs**, look for
   `Photo storage: ... All photos are in the bucket.`
7. Only then remove the disk: Claude takes it out of `render.yaml`; after that deploy, delete it under `lave-os` →
   **Settings → Disk** if Render still lists it.

## 7. Tell Google

In Google Search Console (search.google.com/search-console), add `lavelondon.com` if it isn't there, and submit
`https://lavelondon.com/sitemap.xml`. Old WordPress addresses already forward to the new pages.

## After launch: still to switch on

- **Email sending** (sign-in links, password resets, receipts): until it's set up, LAVE OS can't send email. Claude will set up a sending service with you next.
- **Stripe** (card payments and memberships): until the keys are added, bookings work without a card and the membership page says payments aren't switched on yet.
- **WordPress**: keep the backup. Once you're happy, you can cancel the WordPress part of the Hostinger plan, but **keep the domain and email**.

## Collection, delivery and turnaround (rules v1.4)

The rules from "LAVE_Collection_Delivery_Spec" are built in; everything below is in /admin → **Settings**:

- **Collection & delivery**: the charges (£45 free Saver threshold, £4.95, £6.95, Essence £4.95 one-hour), the 48-hour
  turnaround, the categories confirmed per order, and whether members can drop off. Bank holidays come from gov.uk.
- **Service area**: the 1,743 launch-zone postcodes (SW11 and the Wandsworth side of SW8). Add postcodes or whole
  sectors (`SW4 9`) for phase 2; see the waitlist and demand by district.
- **Ateliers**: add each drop-off location with its opening hours, closures and daily capacity. The drop-off option
  only appears for members once at least one atelier is active. Retire (don't delete) a location that has bookings.
- **Today**: scan or type bag codes (`LV-7K2M9P-1`) to check drop-offs in; log bags left without a booking.

### Bot sign-ups

The sign-up and sign-in-link forms quietly stop bots (a hidden field, a time check, random-letter names): they see
the normal "check your email" page, but nothing is created or sent. For the strongest protection, add Cloudflare
Turnstile (free, usually invisible): dash.cloudflare.com → **Turnstile → Add widget**, hostname `lavelondon.com`,
mode **Managed**. Then in Render → `lave-os` → Environment add `LAVE_TURNSTILE_SITE_KEY` and `LAVE_TURNSTILE_SECRET`.
/admin → Clients hides sign-ups that never confirmed their email, and can remove those older than two days.

### "Your driver is on the way" (text or email)

When a collection or delivery is marked **En route** on Today, the client is told their driver is on the way: by text
when they have a UK mobile number and texts are set up, otherwise (or if the text fails) by email. Once per visit.

To send texts, open a Twilio account (twilio.com), buy a UK number or register the sender name "LAVE", then add in
Render → `lave-os` → Environment (paste the token there only): `LAVE_TWILIO_ACCOUNT_SID`, `LAVE_TWILIO_AUTH_TOKEN`
and `LAVE_TWILIO_FROM` (the number, `LAVE`, or a Messaging Service SID starting MG). /admin → Settings →
Collection & delivery shows whether texts are on.

## Day to day

- **Editing**: everything in /admin goes live as soon as you save. No deploy needed.
- **Code changes from Claude**: once they're pushed to GitHub, Render deploys them automatically, updates the database, and keeps the site up if anything fails.
- **Backups**: Render backs up the database daily (restore from `lave-db` → **Recovery**). Photos are kept in the
  Cloudflare R2 bucket `lave-media`.
