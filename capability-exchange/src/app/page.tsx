import { brand } from "@/config/brand";
import { ButtonLink, Card, VerificationBadge } from "@/components/ui";

export default function HomePage() {
  return (
    <div className="space-y-20">
      <section className="grid items-center gap-10 pt-4 lg:grid-cols-[1.2fr_1fr]">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-accent-strong">{brand.name}</p>
          <h1 className="mt-3 text-4xl leading-tight sm:text-5xl">{brand.tagline}</h1>
          <p className="mt-5 max-w-xl text-lg text-ink-muted">
            A structured, evidence-backed record of what experienced professionals can do, what they have delivered and the work they want next.
            {" "}{brand.positioning}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/sign-up">Start your {brand.modules.profile.name}</ButtonLink>
            <ButtonLink href="/sign-up?as=employer" variant="secondary">
              Hire or staff a project
            </ButtonLink>
          </div>
          <p className="mt-4 text-sm text-ink-muted">Profiles are private until their owner chooses to share them.</p>
        </div>
        <Card className="space-y-4" aria-label="Example of how claims are labelled">
          <p className="text-sm font-semibold text-ink-muted">How claims are labelled</p>
          {[
            ["Led the lender process to financial close for a terminal expansion.", "independently_verified"],
            ["Raised fleet availability from 71% to 86% in 18 months.", "evidence_supplied"],
            ["Designed tariff benchmarking for a 50 MW solar tender.", "self_reported"],
          ].map(([text, status]) => (
            <div key={text} className="rounded-lg border border-line p-3">
              <p className="text-sm">{text}</p>
              <div className="mt-2">
                <VerificationBadge status={status as "self_reported"} />
              </div>
            </div>
          ))}
          <p className="text-xs text-ink-soft">Illustrative, fictional examples.</p>
        </Card>
      </section>

      <section aria-labelledby="modules" className="grid gap-6 md:grid-cols-3">
        <h2 id="modules" className="sr-only">
          What the platform offers
        </h2>
        {Object.values(brand.modules).map((m) => (
          <Card key={m.name}>
            <h3 className="text-xl">{m.name}</h3>
            <p className="mt-2 text-ink-muted">{m.description}</p>
          </Card>
        ))}
      </section>

      <section className="grid gap-10 md:grid-cols-2">
        <div>
          <h2 className="text-2xl">For professionals</h2>
          <ul className="mt-4 space-y-3 text-ink-muted">
            <li>Start with a short core profile and add depth when it is useful. Missing answers simply read as “not provided”.</li>
            <li>Separate what you did from what your team did, and the value of a project from the value you personally drove.</li>
            <li>Attach evidence privately, share redacted versions, and decide who sees what.</li>
            <li>Share time-limited links you can revoke, and approve every change an assistant suggests.</li>
          </ul>
        </div>
        <div>
          <h2 className="text-2xl">For employers and project owners</h2>
          <ul className="mt-4 space-y-3 text-ink-muted">
            <li>Publish permanent, fixed-term, project, fractional and advisory opportunities.</li>
            <li>Search by capability, sector, availability, engagement type and evidence status.</li>
            <li>See which requirements are supported by evidence, which are stated, and which simply are not addressed yet.</li>
            <li>No single talent score. Every decision stays with a person.</li>
          </ul>
        </div>
      </section>

      <section className="rounded-[var(--radius-card)] bg-ink px-6 py-10 text-white sm:px-10">
        <h2 className="text-2xl text-white">Built on clear rules</h2>
        <div className="mt-6 grid gap-6 text-sm text-white/85 md:grid-cols-3">
          <p>Uploading a document never verifies a claim. Verification records what was checked, how and by whom.</p>
          <p>Personality, protected characteristics and “culture fit” are never inferred, and values never affect search results.</p>
          <p>AI suggestions are drafts linked to your own words. Nothing is saved until you approve it.</p>
        </div>
      </section>
    </div>
  );
}
