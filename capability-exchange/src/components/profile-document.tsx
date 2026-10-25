import type { ProfileView, ViewClaim, ViewEvidence } from "@/server/services/profile-view";
import {
  availabilityStatuses,
  capabilityTiers,
  compensationPeriods,
  engagementKinds,
  engagementStages,
  labelOf,
  learningKinds,
  opportunityTypes,
  proficiencyLevels,
  profileModules,
  publicWorkKinds,
  relocationOptions,
  roleFamilies,
  ventureStages,
  verificationMethods,
  workArrangements,
} from "@/config/taxonomy";
import { Badge, Card, DefinitionRow, NotProvided, VerificationBadge, VisibilityBadge, formatDate, formatMoney, formatMonth } from "./ui";

export type DownloadContext = { kind: "live" } | { kind: "share"; token: string } | { kind: "application"; applicationId: string } | { kind: "none" };

function downloadHref(ctx: DownloadContext, id: string) {
  switch (ctx.kind) {
    case "live":
      return `/api/evidence/${id}/download`;
    case "share":
      return `/api/share/${ctx.token}/evidence/${id}`;
    case "application":
      return `/api/evidence/${id}/download?application=${ctx.applicationId}`;
    default:
      return null;
  }
}

function EvidenceLine({ e, ctx }: { e: ViewEvidence; ctx: DownloadContext }) {
  const href = e.kind === "file" ? downloadHref(ctx, e.id) : e.url;
  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <span aria-hidden="true">{e.kind === "file" ? "📄" : "🔗"}</span>
      {href ? (
        <a href={href} target={e.kind === "link" ? "_blank" : undefined} rel={e.kind === "link" ? "noopener noreferrer nofollow" : undefined}>
          {e.title}
          {e.kind === "file" && <span className="sr-only"> (download, link valid for one minute)</span>}
        </a>
      ) : (
        <span>{e.title}</span>
      )}
      {e.isRedacted && <Badge tone="neutral">Redacted</Badge>}
      {e.description && <span className="basis-full text-ink-muted">{e.description}</span>}
    </li>
  );
}

function ClaimItem({ claim, evidence, ctx, showVisibility }: { claim: ViewClaim; evidence: ViewEvidence[]; ctx: DownloadContext; showVisibility: boolean }) {
  const linked = evidence.filter((e) => claim.evidenceIds.includes(e.id));
  return (
    <li className="rounded-lg border border-line p-3">
      <p>{claim.text}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <VerificationBadge status={claim.verificationStatus} />
        {showVisibility && <VisibilityBadge visibility={claim.visibility} />}
        <span className="text-xs text-ink-soft">
          {claim.achievedOn ? `Achieved ${formatDate(claim.achievedOn)} · ` : ""}Last confirmed {formatDate(claim.lastConfirmedAt)}
        </span>
      </div>
      {claim.latestReview && claim.latestReview.decision === "independently_verified" && claim.verificationStatus === "independently_verified" && (
        <p className="mt-2 text-sm text-ink-muted">
          <strong>Verification:</strong> {labelOf(verificationMethods, claim.latestReview.method)} on {formatDate(claim.latestReview.reviewedAt)}. What was checked: {claim.latestReview.scope}
        </p>
      )}
      {claim.latestReview?.noteToCandidate && (
        <p className="mt-2 text-sm text-ink-muted">
          <strong>Reviewer&apos;s note to you:</strong> {claim.latestReview.noteToCandidate}
        </p>
      )}
      {linked.length > 0 && (
        <ul className="mt-2 space-y-1" aria-label="Supporting evidence">
          {linked.map((e) => (
            <EvidenceLine key={e.id} e={e} ctx={ctx} />
          ))}
        </ul>
      )}
      {claim.verificationStatus === "evidence_supplied" && linked.length === 0 && <p className="mt-2 text-xs text-ink-soft">Evidence has been supplied but is not shared in this view.</p>}
    </li>
  );
}

const Text = ({ value }: { value: string | null | undefined }) => (value ? <span className="whitespace-pre-line">{value}</span> : <NotProvided />);

export function ProfileDocument({ view, ctx = { kind: "none" } }: { view: ProfileView; ctx?: DownloadContext }) {
  const isOwner = view.audience === "owner";
  const evidence = view.evidence;
  const name = view.preferredName && view.preferredName !== view.fullName ? `${view.fullName} (${view.preferredName})` : view.fullName;
  const location = [view.locationCity, view.locationCountry].filter(Boolean).join(", ");
  const a = view.availability;
  const tiers = capabilityTiers.map((t) => ({ ...t, items: view.capabilities.filter((c) => c.tier === t.value) }));

  return (
    <article className="space-y-6" aria-label={`Profile of ${view.fullName}`}>
      <Card>
        <h2 className="text-3xl">{name || <NotProvided>Name not provided</NotProvided>}</h2>
        <p className="mt-1 text-lg text-ink-muted">{view.headline || <NotProvided>Headline not provided</NotProvided>}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {view.roleFamily && <Badge tone="accent">{labelOf(roleFamilies, view.roleFamily)}</Badge>}
          {location && <Badge>📍 {location}</Badge>}
          {view.timeZone && <Badge>🕒 {view.timeZone}</Badge>}
          {view.yearsExperience != null && <Badge>{view.yearsExperience} years&apos; experience</Badge>}
        </div>
        <dl className="mt-6">
          <DefinitionRow term="Availability">
            {a.status ? (
              <>
                {labelOf(availabilityStatuses, a.status)}
                {a.status === "available_from" && a.availableFrom && ` (${formatDate(a.availableFrom)})`}
                {a.noticePeriodWeeks != null && ` · ${a.noticePeriodWeeks} weeks' notice`}
                {a.hoursPerWeek != null && ` · up to ${a.hoursPerWeek} hours a week`}
              </>
            ) : (
              <NotProvided />
            )}
          </DefinitionRow>
          <DefinitionRow term="Looking for">{view.opportunityTypes.length ? view.opportunityTypes.map((t) => labelOf(opportunityTypes, t)).join(", ") : <NotProvided />}</DefinitionRow>
          <DefinitionRow term="Working arrangements">
            {view.workArrangements.length ? view.workArrangements.map((w) => labelOf(workArrangements, w)).join(", ") : <NotProvided />}
            {view.relocation && ` · ${labelOf(relocationOptions, view.relocation)}`}
            {view.geographicPreferences && <span className="block text-sm text-ink-muted">{view.geographicPreferences}</span>}
          </DefinitionRow>
          <DefinitionRow term="Languages">{view.languages.length ? view.languages.join(", ") : <NotProvided />}</DefinitionRow>
          <DefinitionRow term="Sectors">{view.sectors.length ? view.sectors.join(", ") : <NotProvided />}</DefinitionRow>
          {view.compensation ? (
            <DefinitionRow term="Compensation expectations">
              {view.compensation.min || view.compensation.max ? (
                <>
                  {[formatMoney(view.compensation.min, view.compensation.currency), formatMoney(view.compensation.max, view.compensation.currency)].filter(Boolean).join(" to ")}{" "}
                  {labelOf(compensationPeriods, view.compensation.period)}
                </>
              ) : (
                <NotProvided />
              )}
              {isOwner && (
                <span className="ml-2">
                  <VisibilityBadge visibility={view.compensation.visibility} />
                </span>
              )}
            </DefinitionRow>
          ) : (
            <DefinitionRow term="Compensation expectations">
              <NotProvided>Not shared</NotProvided>
            </DefinitionRow>
          )}
          <DefinitionRow term="Contact">
            {view.contact ? (
              <>
                {view.contact.email ? <a href={`mailto:${view.contact.email}`}>{view.contact.email}</a> : <NotProvided />}
                {view.contact.phone && <span className="block">{view.contact.phone}</span>}
              </>
            ) : (
              <NotProvided>Shared only with the candidate&apos;s approval</NotProvided>
            )}
          </DefinitionRow>
          {(view.links.linkedinUrl || view.links.websiteUrl) && (
            <DefinitionRow term="Links">
              {[view.links.linkedinUrl, view.links.websiteUrl].filter(Boolean).map((u) => (
                <a key={u} href={u!} target="_blank" rel="noopener noreferrer nofollow" className="mr-4 break-all">
                  {u}
                </a>
              ))}
            </DefinitionRow>
          )}
        </dl>
      </Card>

      <Card>
        <h3 className="text-xl">Introduction</h3>
        <p className="mt-2">
          <Text value={view.introduction} />
        </p>
      </Card>

      <Card>
        <h3 className="text-xl">Capabilities</h3>
        <p className="mt-1 text-sm text-ink-muted">Proficiency is self-rated unless marked as assessed.</p>
        {view.capabilities.length === 0 ? (
          <p className="mt-3">
            <NotProvided />
          </p>
        ) : (
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {tiers.map((t) => (
              <div key={t.value}>
                <h4 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">{t.label}</h4>
                {t.items.length === 0 ? (
                  <p className="mt-2 text-sm">
                    <NotProvided />
                  </p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {t.items.map((c) => (
                      <li key={c.id} className="text-sm">
                        <span className="font-semibold">{c.name}</span>
                        <span className="block text-ink-muted">
                          {labelOf(proficiencyLevels, c.selfProficiency)} (self-rated)
                          {c.assessedProficiency && ` · ${labelOf(proficiencyLevels, c.assessedProficiency)} (assessed)`}
                          {c.yearsExperience != null && ` · ${c.yearsExperience} yrs`}
                        </span>
                        {c.evidenceNote && <span className="block text-ink-soft">{c.evidenceNote}</span>}
                        {isOwner && c.visibility === "private" && <VisibilityBadge visibility="private" />}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <section aria-labelledby="contrib" className="space-y-4">
        <h3 id="contrib" className="text-2xl">
          Contributions and projects
        </h3>
        {view.engagements.length === 0 && (
          <Card>
            <NotProvided />
          </Card>
        )}
        {view.engagements.map((e) => {
          const dates = [formatMonth(e.startDate), e.isCurrent ? "present" : formatMonth(e.endDate)].filter(Boolean).join(" to ");
          const figures = [
            ["Overall project value", e.projectValue],
            ["Revenue generated", e.revenueGenerated],
            ["Budget managed", e.budgetManaged],
            ["Value personally attributable", e.personallyAttributableValue],
          ].filter(([, v]) => v);
          return (
            <Card key={e.id} as="article">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h4 className="font-serif text-xl">{e.title}</h4>
                  <p className="text-ink-muted">
                    {[e.roleTitle, e.organisationLabel].filter(Boolean).join(" · ")}
                    {e.confidentiality === "anonymised" && <span className="sr-only"> (organisation anonymised)</span>}
                  </p>
                  <p className="text-sm text-ink-soft">{[labelOf(engagementKinds, e.kind), dates, e.sector, e.country].filter(Boolean).join(" · ")}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {e.isSignature && <Badge tone="accent">Signature project</Badge>}
                  {e.confidentiality === "anonymised" && <Badge>Client anonymised</Badge>}
                  {isOwner && <VisibilityBadge visibility={e.visibility} />}
                </div>
              </div>
              {(e.stageReached || e.ventureStage) && (
                <p className="mt-3 text-sm">
                  <strong>Stage reached:</strong>{" "}
                  {e.stageReached ? (
                    <span>
                      {engagementStages.map((s, i) => {
                        const reachedIdx = engagementStages.findIndex((x) => x.value === e.stageReached);
                        return (
                          <span key={s.value} className={i <= reachedIdx ? "font-semibold text-ink" : "text-ink-soft"}>
                            {s.label}
                            {i < engagementStages.length - 1 ? " → " : ""}
                          </span>
                        );
                      })}
                      <span className="sr-only">. Furthest stage: {labelOf(engagementStages, e.stageReached)}.</span>
                    </span>
                  ) : (
                    labelOf(ventureStages, e.ventureStage)
                  )}
                </p>
              )}
              <dl className="mt-3">
                {e.context && <DefinitionRow term="Context"><Text value={e.context} /></DefinitionRow>}
                {e.responsibility && <DefinitionRow term="Responsibility"><Text value={e.responsibility} /></DefinitionRow>}
                <DefinitionRow term="What they did personally"><Text value={e.individualActions} /></DefinitionRow>
                {e.teamContribution && <DefinitionRow term="What the team did"><Text value={e.teamContribution} /></DefinitionRow>}
                <DefinitionRow term="Outcomes"><Text value={e.outcomes} /></DefinitionRow>
                {e.lessons && <DefinitionRow term="Lessons learned"><Text value={e.lessons} /></DefinitionRow>}
                {e.teamSize != null && <DefinitionRow term="Team size">{e.teamSize}</DefinitionRow>}
                {figures.length > 0 && (
                  <DefinitionRow term="Figures">
                    <ul className="space-y-1">
                      {figures.map(([label, v]) => (
                        <li key={label}>
                          {label}: <strong>{formatMoney(v, e.valueCurrency)}</strong>
                        </li>
                      ))}
                    </ul>
                    {e.valueNotes && <span className="mt-1 block text-sm text-ink-muted">{e.valueNotes}</span>}
                  </DefinitionRow>
                )}
                {isOwner && e.privateNotes && (
                  <DefinitionRow term="Private notes (only you)">
                    <Text value={e.privateNotes} />
                  </DefinitionRow>
                )}
              </dl>
              {e.capabilities.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {e.capabilities.map((c) => (
                    <Badge key={c.id}>{c.name}</Badge>
                  ))}
                </div>
              )}
              {e.claims.length > 0 && (
                <>
                  <h5 className="mt-4 text-sm font-semibold uppercase tracking-wide text-ink-muted">Claims</h5>
                  <ul className="mt-2 space-y-2">
                    {e.claims.map((c) => (
                      <ClaimItem key={c.id} claim={c} evidence={evidence} ctx={ctx} showVisibility={isOwner} />
                    ))}
                  </ul>
                </>
              )}
            </Card>
          );
        })}
        {view.standaloneClaims.length > 0 && (
          <Card>
            <h4 className="text-lg">Other claims</h4>
            <ul className="mt-2 space-y-2">
              {view.standaloneClaims.map((c) => (
                <ClaimItem key={c.id} claim={c} evidence={evidence} ctx={ctx} showVisibility={isOwner} />
              ))}
            </ul>
          </Card>
        )}
      </section>

      {view.modules.length > 0 && (
        <section aria-labelledby="modules-h" className="space-y-4">
          <h3 id="modules-h" className="text-2xl">
            In their own words
          </h3>
          {profileModules
            .filter((m) => view.modules.some((r) => r.moduleKey === m.key))
            .map((m) => (
              <Card key={m.key}>
                <h4 className="text-lg">{m.title}</h4>
                {m.excludedFromMatching && <p className="text-xs text-ink-soft">Shown for context only. Never used for search or matching.</p>}
                <dl className="mt-2">
                  {m.questions.map((q) => {
                    const r = view.modules.find((x) => x.moduleKey === m.key && x.questionKey === q.key);
                    if (!r) return null;
                    return (
                      <DefinitionRow key={q.key} term={q.label}>
                        <Text value={q.type === "scale" ? `${r.answer} out of 5 (self-assessed)` : r.answer} />
                        {isOwner && r.visibility === "private" && (
                          <span className="ml-2">
                            <VisibilityBadge visibility="private" />
                          </span>
                        )}
                      </DefinitionRow>
                    );
                  })}
                </dl>
              </Card>
            ))}
        </section>
      )}

      {(view.learning.length > 0 || view.publicWork.length > 0) && (
        <div className="grid gap-6 md:grid-cols-2">
          {view.learning.length > 0 && (
            <Card>
              <h3 className="text-xl">Learning and development</h3>
              <ul className="mt-3 space-y-3">
                {view.learning.map((l) => (
                  <li key={l.id} className="text-sm">
                    <span className="font-semibold">{l.title}</span>
                    <span className="block text-ink-muted">{[labelOf(learningKinds, l.kind), l.provider, l.year].filter(Boolean).join(" · ")}</span>
                    {l.takeaway && <span className="block">{l.takeaway}</span>}
                    {l.credentialUrl && (
                      <a href={l.credentialUrl} target="_blank" rel="noopener noreferrer nofollow">
                        Credential link
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {view.publicWork.length > 0 && (
            <Card>
              <h3 className="text-xl">Public work</h3>
              <ul className="mt-3 space-y-3">
                {view.publicWork.map((p) => (
                  <li key={p.id} className="text-sm">
                    {p.url ? (
                      <a href={p.url} target="_blank" rel="noopener noreferrer nofollow" className="font-semibold">
                        {p.title}
                      </a>
                    ) : (
                      <span className="font-semibold">{p.title}</span>
                    )}
                    <span className="block text-ink-muted">{[labelOf(publicWorkKinds, p.kind), p.venue, p.year].filter(Boolean).join(" · ")}</span>
                    {p.description && <span className="block">{p.description}</span>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      {view.referees.length > 0 && (
        <Card>
          <h3 className="text-xl">References</h3>
          <p className="mt-1 text-sm text-ink-muted">References are never contacted without the candidate&apos;s consent.</p>
          <ul className="mt-3 space-y-3">
            {view.referees.map((r) => (
              <li key={r.id} className="text-sm">
                <span className="font-semibold">{r.name}</span> · {r.relationship}
                {r.organisation && `, ${r.organisation}`}
                {r.speaksTo && <span className="block text-ink-muted">Can speak to: {r.speaksTo}</span>}
                {r.contact ? (
                  <span className="block">
                    {r.contact.email} {r.contact.phone}
                  </span>
                ) : (
                  <span className="block text-ink-soft">Contact details are private.</span>
                )}
                {isOwner && (
                  <span className="mt-1 flex gap-2">
                    <VisibilityBadge visibility={r.visibility} />
                    <Badge tone={r.consentToContact ? "success" : "neutral"}>{r.consentToContact ? "You consent to contact" : "No consent to contact"}</Badge>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {isOwner && evidence.length > 0 && (
        <Card>
          <h3 className="text-xl">Evidence library</h3>
          <ul className="mt-3 space-y-2">
            {evidence.map((e) => (
              <EvidenceLine key={e.id} e={e} ctx={ctx} />
            ))}
          </ul>
        </Card>
      )}
      <p className="text-sm text-ink-soft">Profile last updated {formatDate(view.updatedAt)}{view.lastConfirmedAt ? `; confirmed current ${formatDate(view.lastConfirmedAt)}` : ""}.</p>
    </article>
  );
}
