# African Capability Exchange

*Connecting African expertise with opportunity.*

A talent platform built around a **Living Profile**: a structured, evidence-backed record of what a professional can do, what they have delivered, how they work and learn, what they want next and when they are available. Employers and project owners use these profiles to find people for permanent roles, fixed-term roles, project assignments, fractional engagements and advisory work.

"African" is used inclusively: professionals across Africa and its diaspora, connected to opportunities within Africa and globally.

| Module | What it is |
|---|---|
| **Living Profile** | Each professional's evolving record: a short core profile plus 15 optional deeper modules. |
| **Evidence Portfolio** | Projects, roles, claims and evidence, each claim labelled *Self-reported*, *Evidence supplied*, *Independently verified* or *Clarification requested*. |
| **Opportunities** | Employment, projects, fractional roles and advisory engagements, with structured requirements. |

> **Working names.** "African Capability Exchange" and the module names are working names; availability and trademark checks are outstanding. All naming lives in [`src/config/brand.ts`](src/config/brand.ts), so a rename is a one-file change.

> **Status: a working MVP, not production-ready.** It builds, its tests pass, and the core workflows run against PostgreSQL. Before real use it needs the items in [docs/production-readiness.md](docs/production-readiness.md), notably email delivery, a security review and a legal/privacy review.

This directory is self-contained and separate from the LAVE OS application at the repository root. It should eventually move to its own repository.

---

## Quick start (local demo, no external services)

Needs **Node.js 20.9 or later** (developed on Node 22).

```bash
cd capability-exchange
npm ci
cp .env.example .env.local     # APP_MODE=demo by default
npm run demo                    # sets up the embedded database with fictional data, then starts the app
```

Open http://localhost:3000 and use **Demo sign-in** on the sign-in page. All people, organisations and records are fictional.

| Persona | Shows |
|---|---|
| Efua Mensah-Bonsu | Complete, discoverable profile with an independently verified claim and an application |
| Lindiwe Dlamini | A brand-new draft profile, for trying onboarding |
| Samuel Tesfaye | A complete but **private** profile (never appears in search) |
| Kofi Asante | Approved employer with opportunities, applications and a shortlist |
| Nomvula Khumalo | Approved employer reviewing an application; a different organisation from Kofi |
| Moussa Traoré | Employer whose organisation is **awaiting approval** |
| Platform Reviewer | Administrator: approvals, verification, reports, audit |

`npm run demo:reset` deletes the embedded demo database and uploads (under `.data/` only) and rebuilds them.

Demo mode uses an embedded PostgreSQL (PGlite) on disk, local private file storage, and **labelled demonstration responses** instead of live AI. Demo sign-in is refused whenever `NODE_ENV=production`: a production server with `APP_MODE=demo` will not start.

---

## Running against PostgreSQL / Supabase

1. Create a PostgreSQL database (Supabase: *Project Settings → Database* gives the connection string). The connecting role must own the tables and be able to create one role (`ace_app_user`) during migration. Supabase's default `postgres` role should have these privileges; this has not been verified against a live Supabase project.
2. Set in `.env.local` (or your host's environment):
   ```
   APP_MODE=standard
   DATABASE_URL=postgres://...
   SESSION_SECRET=<48+ random characters, e.g. `openssl rand -base64 48`>
   APP_URL=https://your-domain
   ```
3. `npm run db:migrate`
4. Optionally load the fictional data into an **empty, non-production** database: `npm run db:seed`.
5. `npm run build && npm start`

### Optional external services

| Feature | Without credentials | With credentials |
|---|---|---|
| Database | Embedded PGlite (demo/development only) | `DATABASE_URL` (PostgreSQL 15+; verified on 16) |
| Sign-in | Built-in email + password (scrypt) | `AUTH_PROVIDER=supabase` + `SUPABASE_URL`, `SUPABASE_ANON_KEY` |
| Evidence storage | Private local disk + signed one-minute links | `STORAGE_PROVIDER=supabase` + `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, a **private** bucket (default name `evidence`) |
| AI assistance | Off, or labelled demonstration responses in demo mode | `ANTHROPIC_API_KEY` (optionally `AI_PROVIDER=anthropic`, `ANTHROPIC_MODEL`) |
| Email (password reset, invitations, notifications) | **Not implemented**: no email is ever sent | Not yet available |

The Supabase Auth and Supabase Storage adapters follow the documented `supabase-js` API but **have not been run against a live Supabase project** in this repository. Test them in a staging project before relying on them.

All variables are documented in [`.env.example`](.env.example).

---

## AI provider configuration

AI runs on the server only, behind an interface in [`src/server/ai/`](src/server/ai). Selection:

| `AI_PROVIDER` | Behaviour |
|---|---|
| unset | `anthropic` if `ANTHROPIC_API_KEY` is set; `demo` in demo mode; otherwise off |
| `anthropic` | Live drafts from Claude (default model `claude-opus-5-5`, override with `ANTHROPIC_MODEL`). Falls back to off if no key is set. |
| `demo` | Rule-based output, always labelled *"Demonstration response: rules, not AI"*. Ignored in production. |
| `none` | Assistant switched off; every other feature works, including rule-based profile checks |

Anthropic requests use structured JSON output validated against a Zod schema, a timeout (`AI_TIMEOUT_MS`, default 30 s), one retry, a per-person hourly limit (`AI_HOURLY_LIMIT`, default 30), and the server-side refusal fallback (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`), so a policy refusal is retried on a suitable model within the same call. Remove those two parameters in [`src/server/ai/anthropic.ts`](src/server/ai/anthropic.ts) if you do not want that behaviour.

Safeguards (details in [docs/architecture.md](docs/architecture.md#ai-assistance)):
- Context is built from the **permission-filtered** profile view, minus names, contact details, references, compensation, private notes and values answers.
- Every factual sentence must cite a fact id from that context; uncited sentences and judgement language ("reject", "culture fit"…) are removed and shown as such.
- Rewrites that add figures, currencies, names or verification words cannot be approved. Extracted items must quote the person's text, and become **private, self-reported drafts** only after the person approves them.
- The model gets no tools. It cannot verify credentials, contact references or reject applicants. User-supplied text is wrapped and marked as untrusted data.
- Only metadata (task, provider, success, latency) is logged, never prompts or outputs.

---

## Tests

```bash
npm run lint
npm run typecheck          # next typegen + tsc
npm test                   # Vitest: services, permissions, AI guards (in-memory PGlite)
npm run test:e2e           # Playwright: starts its own isolated demo server on port 3200
npm run build
```

For Playwright, either run `npx playwright install chromium` once, or point at an existing Chromium with `PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome`.

Latest results (see [docs/production-readiness.md](docs/production-readiness.md#verification-performed) for what each covers):

| Check | Result |
|---|---|
| ESLint | clean |
| TypeScript | clean |
| Vitest | 57 tests, 4 files, all passing |
| Playwright | 15 tests (13 desktop, 2 mobile), all passing, including axe accessibility checks |
| `next build` | succeeds |
| PostgreSQL 16 | migrations, seed, row-level security and a register → autosave → upload → download flow verified with a non-superuser role |

How the acceptance checks map to tests:

| # | Acceptance check | Where |
|---|---|---|
| 1 | Register, save, return later | `tests/e2e/talent.spec.ts` test 1; `tests/unit/foundation.test.ts` |
| 2 | Project, claim and private evidence | `talent.spec.ts` test 2; `permissions.test.ts` "projects, claims and private evidence" |
| 3 | No access to private profiles/files by URL or API | `talent.spec.ts` tests 2–3; `permissions.test.ts` "private profiles and files…" |
| 4 | Enable and revoke sharing | `talent.spec.ts` test 4; `permissions.test.ts` "share links…" |
| 5 | Approved employer publishes | `employer.spec.ts` test 5; `permissions.test.ts` |
| 6 | Search respects visibility | `employer.spec.ts` test 6; `permissions.test.ts` "search respects visibility" |
| 7 | Shortlists and applications persist | `employer.spec.ts` test 7; `permissions.test.ts` |
| 8 | Organisation isolation | `employer.spec.ts` test 8; `foundation.test.ts` (row-level security); `permissions.test.ts` |
| 9 | Approve or reject AI changes | `talent.spec.ts` test 9; `assistant.test.ts` |
| 10 | AI does not invent achievements or verification | `assistant.test.ts` "AI outputs do not invent…" |
| 11 | Usable when AI is unavailable | `assistant.test.ts` "AI unavailable" |
| 12 | Mobile and keyboard | `mobile.spec.ts`; `accessibility.spec.ts` |
| 13 | Production cannot enable demo sign-in | `foundation.test.ts` "configuration"; manual check that `next start` refuses `APP_MODE=demo` |

---

## Deployment

Any Node.js host that runs `next start` works (one instance or several behind a load balancer). Outline:

1. Provision PostgreSQL (e.g. Supabase) and, if using it, a **private** Supabase Storage bucket.
2. Set `NODE_ENV=production`, `APP_MODE=standard`, `DATABASE_URL`, `SESSION_SECRET`, `APP_URL=https://…`, and the storage, auth and AI variables you use. With several instances, also set `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` to a shared value.
3. Run `npm ci && npm run build`, then `npm run db:migrate` as a release step, then `npm start`.
4. **Use Supabase Storage (or another shared private store) when running more than one instance.** Local disk storage only works on a single instance with a persistent volume.
5. Put the app behind HTTPS. The app sets secure, HTTP-only, same-site cookies in production.

The server refuses to start in production without `DATABASE_URL`, a 32+ character `SESSION_SECRET` and an `https://` `APP_URL`, and refuses `APP_MODE=demo` outright.

Nothing has been deployed publicly.

---

## Project layout

```
src/
  config/            brand.ts (all naming), env.ts (validated settings), taxonomy.ts (vocabularies, profile modules)
  server/
    db/              schema.ts (Drizzle), client.ts (PostgreSQL or PGlite, row-level security helper)
    policy/          actor.ts (who is asking), profile-access.ts (all visibility rules)
    services/        profile, portfolio, sharing, employer, applications, search, matching, admin,
                     account-data (export/deletion), assistant (AI tasks), profile-checks (rule-based)
    ai/              provider interface, Anthropic and demo providers, grounding checks
    auth/            identity providers, sessions, request helpers
    storage/         private storage (local disk, Supabase), upload checks
    seed/demo.ts     fictional demonstration data
  app/               routes (App Router), server actions per area, API routes for files and export
  components/        design system and shared views (profile document, comparison view)
drizzle/             SQL migrations (0001 adds row-level security)
tests/unit           Vitest
tests/e2e            Playwright
docs/                architecture, decisions and assumptions, production readiness
```

## Further reading

- [docs/architecture.md](docs/architecture.md): structure, data model, permissions, matching and AI.
- [docs/decisions-and-assumptions.md](docs/decisions-and-assumptions.md): choices made and why.
- [docs/production-readiness.md](docs/production-readiness.md): completed features, limitations and what is needed before launch.
