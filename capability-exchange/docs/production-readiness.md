# Production readiness

**This is a working MVP, not a production-ready service.** The core workflows are implemented and tested, but launching with real candidates needs the work listed under *Required before launch*.

## Completed

**Foundation**
- PostgreSQL schema with migrations, foreign keys, indexes and explicit provenance, verification and visibility fields
- Row-level security on every table, with database-enforced organisation isolation for shortlists and employer notes
- Password sign-in (scrypt) with rate limiting, hashed session tokens, secure cookies, and an optional Supabase Auth adapter
- Configuration validated at startup; demo mode refused in production
- Design system: tokens, accessible form components, evidence and visibility badges
- Fictional demo data across eight professionals, three organisations, opportunities, applications, a shortlist, a verified claim, a pending verification request and a report

**Talent**
- Progressive core profile with autosave, save-and-resume ("continue where you left off") and drafts
- 15 optional modules with role-relevant prompts and per-answer visibility
- Capabilities in three tiers, kept separate from proficiency; self-rated and assessed proficiency stored separately
- Projects and roles with stage reached, separate figures for value, revenue, budget and personal attribution, confidentiality and anonymisation, plus private notes
- Claims with evidence status, last-confirmed dates and verification requests
- Private evidence upload (type and content checks, 10 MB), links, redaction flags, short-lived download links
- Learning records, public work, references with consent
- Profile preview as owner, approved employer or share link
- Sharing settings for profile, contact details, evidence and compensation; revocable, expiring share links; per-organisation permissions; introduction requests
- Opportunity discovery with a personal comparison; applications with a confirmed snapshot; tracker; withdrawal
- JSON export; immediate account deletion covering files, derived text, search text and snapshots
- Rule-based profile checks (follow-up questions) that work without AI

**Employers**
- Organisation registration, with publishing and discovery held back until an administrator approves
- Team members and roles
- Opportunity editor with problem, outcomes, responsibilities, requirements (essential or desirable, minimum level), evidence wanted, location, arrangement, dates, budget and selection stages; draft, published and closed states
- Talent search: keywords, capabilities, sector, country, arrangement, engagement type, availability, available-by date, evidence status, budget compatibility, comparison against an opportunity
- Requirement-by-requirement comparison with no score, separating missing information from gaps
- Shortlists with private notes; application review with snapshot, comparison, recorded status changes, private notes and introduction requests

**Administrators**
- Organisation approval, rejection and suspension with reasons
- Verification queue and reviews (method, scope, evidence reviewed, note to candidate, reason) that cannot alter claim text
- Reports with access-restricting actions
- Operational overview and an audit record viewer
- Audited administrator profile views and file downloads

**AI**
- Provider interface; Anthropic implementation with structured output, timeout, retry, refusal fallback and rate limit; labelled demonstration provider; off mode
- Summaries, clearer wording, draft extraction, follow-up questions, comparison explanations, opportunity clarity checks
- Citation validation, invented-fact detection, judgement filtering, permission-filtered and minimised context, approval before any change

## Verification performed

| Check | Result |
|---|---|
| ESLint (Next.js core-web-vitals + TypeScript rules) | clean |
| TypeScript (`next typegen && tsc --noEmit`) | clean |
| Vitest (57 tests): configuration safety, accounts, sessions, row-level security, private evidence, direct-access refusals, share links (revoke, expiry, ownership), search visibility, publishing rules, snapshots, organisation isolation, withdrawal, verification rules, export and deletion, AI guards, demo seed | all passing |
| Playwright (15 tests, Chromium, desktop and Pixel 7 viewport): the acceptance checks in the README, axe-core WCAG 2.1 A/AA scans of public and signed-in pages (no serious or critical issues), keyboard-only sign-in and editing, no horizontal scrolling on mobile | all passing |
| `next build` | succeeds |
| PostgreSQL 16, non-superuser owner role | migrations, seed, RLS isolation, restricted-role denial; production server refuses `APP_MODE=demo`; register → autosave → upload → owner download (302 to a one-minute link) → anonymous download 404; session cookie `HttpOnly; Secure; SameSite=Lax`; no emails or profile text in server logs |

### Not verified

- **Live Anthropic API.** No API key was available. The Anthropic provider type-checks against `@anthropic-ai/sdk` 1.1.0, but every AI test used a fake or demo provider. Check output quality, latency and refusal behaviour with a real key before relying on it.
- **Supabase Auth and Supabase Storage adapters.** Written to the documented API but never run against a live project.
- Real screen readers (only automated axe checks and keyboard tests ran), browsers other than Chromium, and real phones.
- Performance under load. Search runs one profile-view build per result (max 50), which is fine for a pilot but should be measured.
- `npm audit` reports advisories in development dependencies; these have not been triaged.

## Known limitations

- No email: no verification of email addresses, no password reset, no notifications or invitations.
- No PDF text extraction; "Draft records from text" works on pasted text only.
- Assessed proficiency has no workflow; administrators cannot record it in the UI yet.
- Account deletion is immediate, with no cooling-off or recovery period.
- One account type per user; one organisation per employer user in the UI.
- Search is PostgreSQL full-text (English stemming). There is no fuzzy matching across languages, and keyword search covers the narrative module but not the other modules.
- Rate limits for sign-in and AI are stored in the database per hashed email or user, with no IP-based throttling.
- Local file storage is suitable for a single server only.
- No Content Security Policy beyond the file-download responses. Basic security headers (`nosniff`, `DENY` framing, referrer policy) are set.
- The administrator role is assigned in the database; there is no UI to grant it.

## Required before launch

1. **Security review and penetration test**, including server actions, file handling and row-level security on the production database role.
2. **Legal and privacy review**: privacy notice, lawful basis, consent wording for references and evidence, data processing agreements (hosting, Supabase, Anthropic), cross-border transfer assessment (for example NDPA, Kenya DPA, POPIA, GDPR), retention schedule and backup policy, terms of use for employers.
3. **Email provider** for email verification, password reset, introduction notifications and organisation-approval notices.
4. **Authentication hardening**: email verification, optional multi-factor authentication (especially for administrators and employers), session listing and revocation.
5. **Shared private storage** (Supabase Storage or equivalent) tested end to end, with malware scanning of uploads.
6. **Live AI evaluation**: evaluate the Anthropic provider on real but consented samples for grounding, refusals, tone and latency; agree retention settings with the provider; decide on cost limits.
7. **Operations**: managed PostgreSQL with backups and point-in-time recovery, migration release step, error monitoring, uptime checks, log retention, and an audit-log retention policy.
8. **Content Security Policy** with nonces, and a dependency-update policy.
9. **Moderation playbook** for reports and verification, including who may be an administrator and how decisions are reviewed.
10. **Name and trademark clearance** for the working brand, and real support contact details in `src/config/brand.ts`.
11. **User research** with candidates and employers in the initial sectors, before importing any real records. No real candidate records have been imported.
