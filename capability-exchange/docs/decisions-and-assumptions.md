# Decisions and assumptions

Choices made without waiting for confirmation, recorded so they can be revisited.

## Repository and stack

- **Separate application in `capability-exchange/`.** The repository holds LAVE OS, an unrelated Python/FastAPI product. The talent platform is a different product with its own requested stack, so it lives in a self-contained directory and leaves LAVE OS untouched. It should move to its own repository.
- **Stack as requested:** Next.js 16 (App Router), TypeScript, Tailwind CSS 4, PostgreSQL via Drizzle ORM, Zod, Vitest and Playwright, with an optional Anthropic provider. Versions were current stable releases at build time; the lockfile is committed.
- **Drizzle ORM with SQL migrations** rather than Supabase-generated types, so the app runs on any PostgreSQL, including Supabase.
- **Embedded PGlite for demo mode and unit tests**, so the demo and test suite need no database server. Production refuses to start without `DATABASE_URL`.

## Authentication

- **Sessions and authorisation stay in this app, whichever provider checks passwords.** The built-in scrypt provider is the default because it works offline and is fully tested. The Supabase Auth adapter is thin (sign-up and sign-in only) and **not tested against a live project**.
- **No email.** Nothing in the build sends email (you asked for no real emails), so there is no email verification, password reset or invitation email. The sign-in page says so. Colleagues join an organisation by an owner adding an existing employer account.
- Every account is either *talent* or *employer*; a person wanting both would need two accounts. The data model allows one user to have both a profile and memberships, but the UI does not offer it yet.

## Product rules

- **Private by default.** New profiles are private, contact details are shown only after an accepted introduction, evidence files are private, compensation is private, and references are private.
- **Core profile completion** needs: name and headline, location, time zone and languages, an introduction of at least 80 characters, opportunity types and arrangements, availability, at least one capability and at least one project. Compensation and contact details are optional. Applying requires a complete core profile; drafts can exist without one.
- **Deeper modules** follow the structure of the reference talent profile (narrative, value creation, signature projects, capability stack, AI fluency, learning, problem solving, leadership, collaboration, adaptability, entrepreneurship, public work, values and motivations, career direction, references). Questions were rewritten in the product's own words; no candidate content from the reference PDF is used anywhere. Records-based modules (projects, capabilities, learning, public work, references) link to structured editors.
- **Role-relevant prompts** come from a "main professional area" choice that only changes hints. It never affects visibility or matching.
- **Values and motivations** can be shared but are excluded from search, filters, matching and AI context.
- **One application per opportunity.** Withdrawal ends the employer's access to the snapshot; re-applying is not supported.
- **Introductions** release contact details to one organisation when the candidate accepts. The candidate can withdraw that access later.
- **Administrator actions** restrict access (approve or suspend organisations, close opportunities, hide a profile from discovery, suspend an account) and always need a reason. Administrators cannot edit anyone's content.
- **Assessed proficiency** is modelled but has no assessment workflow yet.
- **Currencies:** amounts are stored as entered with their currency and never converted, so a budget in USD per year is only compared with expectations in USD per year.
- **Demo data** is fictional: invented names, organisations and figures, with emails on the reserved `.invalid` domain.

## Deletion and retention

- Deletion is immediate after typing DELETE (no cooling-off period). Stored files are removed first; if storage cannot confirm removal, nothing is deleted and the person is asked to retry.
- Kept after deletion: audit events (event type, time and internal identifiers, no names, emails or content), anonymised application rows and the employer's own notes and status history, and a deletion receipt holding only a hash of the user id and counts. Operator backups are outside the application's control.

## AI

- Default model `claude-opus-5-5`, effort `medium`, with server-side refusal fallback enabled. Configurable via `ANTHROPIC_MODEL`.
- Demonstration responses are **rule-based** and always labelled as such; they are never presented as AI analysis. Production never uses them.
- PDF text extraction is **not implemented**. The `derived_text` column exists for it, and deletion already clears it.

## Branding

- "African Capability Exchange" with the tagline "Connecting African expertise with opportunity." and the module names Living Profile, Evidence Portfolio and Opportunities are working names, with inclusive positioning (Africa and the diaspora). All strings are in `src/config/brand.ts`. The short name "ACE" is used only for the logo initial and internal identifiers (cookie name, database role and setting names); renaming those is optional.
