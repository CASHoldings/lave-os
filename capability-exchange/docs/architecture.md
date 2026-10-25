# Architecture

One Next.js 16 application (App Router, TypeScript) with a server-side service layer over PostgreSQL. No microservices.

```
Browser ──▶ Next.js pages (server components) ──▶ services ──▶ policy ──▶ PostgreSQL
        └─▶ server actions / API routes ───────┘        │
                                                         ├─▶ private storage (local disk | Supabase Storage)
                                                         └─▶ AI provider (Anthropic | demo | off)
```

- **Pages** are server components. They call services directly; nothing is pre-rendered with user data.
- **Mutations** are server actions (`src/app/**/actions.ts`). Each one authenticates, then calls a service that authorises and validates with Zod. Server actions are treated as public endpoints: the UI is never the security boundary.
- **API routes** cover what forms cannot: multipart upload, authorised downloads (redirects to one-minute signed links), signed local file serving and data export.
- **Services** (`src/server/services`) hold all business rules. They take an `Actor` (who is asking) and are tested directly with Vitest against an in-memory PostgreSQL (PGlite).
- **Policy** (`src/server/policy`) is the only place visibility is decided.

## Authentication and roles

- Sessions are random 32-byte tokens in an HTTP-only, `SameSite=Lax` cookie (`Secure` in production). Only a SHA-256 hash is stored. They last 14 days and are deleted on sign-out or account deletion.
- Passwords: built-in scrypt hashing (`AUTH_PROVIDER=password`), or Supabase Auth (`AUTH_PROVIDER=supabase`), which checks the password while this app keeps its own session and roles. Sign-in failures are rate-limited per hashed email (8 per 15 minutes).
- Roles: every user is a *talent* or *employer* account. Employers belong to organisations (owner, admin or member). `platform_role = admin` marks administrators.
- **Demo sign-in** (one click, fictional accounts with no password) exists only when `APP_MODE=demo` and `NODE_ENV` is not `production`. The check is made on each request. `src/instrumentation.ts` validates configuration at server start, so `APP_MODE=demo` in production stops the server.

## Visibility and permissions

`resolveAudience(actor, profile)` returns one of:

| Audience | When | Sees |
|---|---|---|
| owner | the profile's own user | everything, including private items and notes |
| admin | platform administrator | everything except private notes and reference contact details; every view and file download is audited |
| employer | a member of an **approved** organisation, *and* the profile is visible to approved employers | items marked shareable; contact details only if the candidate chose "all approved employers" or accepted that organisation's introduction; evidence files only if the evidence setting and the item allow it; compensation only if shared; never reference contact details unless granted and consented |
| share | holder of an active, unexpired share link | the shareable view, plus contact details and evidence if the link includes them |
| snapshot | an application's frozen copy | the shareable view at the moment of applying, plus the options the candidate ticked |
| *(none)* | anyone else, including pending organisations | nothing: services respond "not found", so ids cannot be probed |

`buildProfileView(profile, audience)` is the only function that turns database rows into what a viewer sees. The same view feeds pages, share links, snapshots, export and AI context. Search builds its index (`talent_profiles.search_text`) from employer-visible content only, and leaves it empty while a profile is private, so private text can never be matched or inferred.

Evidence downloads go through `authoriseEvidenceDownload`. It checks the context (live view, share link or application snapshot), then issues a link that expires in 60 seconds: a Supabase signed URL, or an HMAC-signed local token served with `Content-Disposition: attachment`, `nosniff` and a sandboxing CSP.

### Database-level enforcement

Migration `drizzle/0001_row_level_security.sql`:

- enables row-level security on **every** table. The application connects as the table owner, which bypasses RLS; any other role (for example Supabase's `anon` and `authenticated` Data API roles) sees nothing. Default privileges for those roles are revoked if they exist.
- creates a restricted role `ace_app_user` with policies on the organisation-private tables (`shortlists`, `shortlist_entries`, `application_notes`). Services touch those tables only inside `withOrgRls(userId, …)`, which runs `SET LOCAL ROLE ace_app_user` with the user's id in `ace.user_id`. A missing `WHERE` clause still cannot return another organisation's rows, and the role cannot read any other table.

Verified on PGlite (tests) and on PostgreSQL 16 with a non-superuser owner role.

## Data model

Defined in [`src/server/db/schema.ts`](../src/server/db/schema.ts); migrations live in `drizzle/`. Provenance, verification and visibility are explicit columns and enums, never free text.

| Area | Tables |
|---|---|
| Identity | `users`, `sessions`, `auth_attempts` |
| Organisations | `organisations` (status: pending, approved, rejected or suspended, plus reviewer and reason), `organisation_memberships` |
| Profiles | `talent_profiles` (core fields and visibility settings), `module_responses` (one row per answered question, each with its own visibility) |
| Capabilities | `capabilities` (taxonomy with *category*), `profile_capabilities` (*tier*, *self-rated* and separately *assessed* proficiency) |
| Evidence Portfolio | `engagements` (projects, roles, ventures and advisory work; stage reached; overall value, revenue, budget and personally attributable value kept apart; confidentiality), `engagement_capabilities`, `claims` (type, source, author, achieved date, last confirmed, verification status), `evidence_items` (file, link or reference; redaction; visibility), `claim_evidence`, `verification_reviews` (decision, method, scope, evidence reviewed, reviewer, reason, the claim text at review) |
| Other records | `learning_records`, `public_work_items`, `referees` (consent to contact) |
| Sharing | `share_links` (hashed token, expiry, revocation, flags), `access_grants` (per-organisation contact, evidence or references access) |
| Opportunities | `opportunities`, `opportunity_requirements` (essential or desirable, minimum proficiency) |
| Applications | `profile_snapshots` (frozen JSON), `applications`, `application_events` (status history with actor), `application_notes` (row-level security), `introduction_requests` |
| Shortlists | `shortlists`, `shortlist_entries` (row-level security) |
| AI | `ai_suggestions` (validated output, sources, provider, demonstration flag, approval status), `ai_requests` (metadata only, for rate limits) |
| Trust and safety | `content_reports`, `audit_events` (identifiers and reasons only), `deletion_receipts` |

### Verification rules

- New claims are *self-reported*. Attaching evidence moves a claim to *evidence supplied*. Uploading never verifies.
- Only `recordVerificationReview` (administrators) sets *independently verified* or *clarification requested*. It requires a method, a written scope of what was checked, and a reason. Unless the method is a reference check or public record, it also requires the specific evidence reviewed.
- Administrators cannot change claim text. If the candidate changes a reviewed claim's wording, the review no longer applies and the label reverts.

### Applications and snapshots

Applying stores a JSON snapshot of the shareable view, with optional contact details and evidence. Later profile edits never change it. When a candidate withdraws, employers keep the application record, status history and their own notes, but lose the snapshot and its files. Deleting an account anonymises the application (`"Deleted account"`, snapshot removed).

## Matching (no single score)

`compareProfileToOpportunity` is deterministic and runs on the viewer's permitted view:

| Outcome | Rule |
|---|---|
| Supported by evidence | Matching capability at or above the required level, with a linked example whose claim has evidence or verification, or an assessed proficiency |
| Stated | Matching capability listed (self-rated), no evidenced example |
| Potential gap | Matching capability self-rated **below** the required level |
| Needs reading | No structured match, but related wording appears in examples |
| Not provided | Nothing in the visible profile addresses it. Shown as missing information, never as a gap |

Availability checks compare engagement type, working arrangement, start date (availability date and notice period), weekly hours, and compensation. Compensation is compared only when the candidate shared it, and only in the same currency and period, with no conversion.

Search ordering: keyword relevance (`ts_rank`) when keywords are given, otherwise most recently updated. Values, motivations, names, photographs and writing style are never inputs to search, filters or ordering. Employer decisions (status changes) are always explicit human actions, recorded with the actor in `application_events`.

## AI assistance

`src/server/ai/provider.ts` defines `AiProvider.generate(request)`. Each task supplies fixed instructions, minimised data, a Zod schema and a deterministic `demo()` function.

| Task | Who | Output and safeguards |
|---|---|---|
| Summarise profile | talent | Sentences citing fact ids from the shareable view. Uncited or judgemental sentences are removed and listed. Informational only. |
| Clearer wording | talent | A rewrite with a list of changes. `introducedFacts()` blocks approval if new figures, currencies, names, superlatives or verification words appear. Stale originals are refused. |
| Draft records from text | talent | Roles, capabilities and claims, each with a quote that must appear in the pasted text. Approved items become private, self-reported drafts. Capabilities need the person's own proficiency rating. The pasted text is not stored. |
| Follow-up questions | talent | Questions about a project, citing its facts. |
| Explain comparison | employer | A plain-language reading of the deterministic comparison, from the permitted view only. No score or verdict; judgement language is filtered. |
| Opportunity clarity | employer | Rule-based checks (missing fields, exclusionary wording such as age, "native speaker", gendered terms, "culture fit") plus model suggestions. Never edits the opportunity. |

The rule-based **profile checks** (`profile-checks.ts`) are not AI. They ask focused questions such as *"You mentioned facilitating … Did it reach introduction, proposal, contract award, execution or completion? What was your individual contribution?"* and always run.

## Logging and privacy

`src/server/log.ts` logs event names, identifiers and error classes only. Driver error messages are not logged because they can echo values. Audit metadata keys are allowlisted in `services/audit.ts`.

## Design system

Tokens live in `src/app/globals.css` (Tailwind CSS v4 `@theme`): warm neutral backgrounds, deep navy text, restrained teal accents, serif headings, visible focus outlines, underlined links, reduced-motion support. Components in `src/components/ui.tsx` and `forms.tsx` provide labelled fields with linked hints and errors, accessible radio and checkbox groups, alerts with live regions, and evidence and visibility badges that carry meaning through text and icon as well as colour.
