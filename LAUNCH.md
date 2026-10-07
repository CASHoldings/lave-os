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

## 7. Tell Google

In Google Search Console (search.google.com/search-console), add `lavelondon.com` if it isn't there, and submit
`https://lavelondon.com/sitemap.xml`. Old WordPress addresses already forward to the new pages.

## After launch: still to switch on

- **Email sending** (sign-in links, password resets, receipts): until it's set up, LAVE OS can't send email. Claude will set up a sending service with you next.
- **Stripe** (card payments and memberships): until the keys are added, bookings work without a card and the membership page says payments aren't switched on yet.
- **WordPress**: keep the backup. Once you're happy, you can cancel the WordPress part of the Hostinger plan, but **keep the domain and email**.

## Day to day

- **Editing**: everything in /admin goes live as soon as you save. No deploy needed.
- **Code changes from Claude**: once they're pushed to GitHub, Render deploys them automatically, updates the database, and keeps the site up if anything fails.
- **Backups**: Render backs up the database daily (restore from `lave-db` → **Recovery**) and snapshots the image disk daily.
