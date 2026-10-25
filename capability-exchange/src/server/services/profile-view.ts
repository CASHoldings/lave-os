import { asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import {
  capabilities,
  claimEvidence,
  claims,
  engagementCapabilities,
  engagements,
  evidenceItems,
  learningRecords,
  moduleResponses,
  profileCapabilities,
  publicWorkItems,
  referees,
  talentProfiles,
  verificationReviews,
} from "@/server/db/schema";
import {
  compensationVisibleTo,
  contactVisibleTo,
  evidenceVisibleTo,
  itemVisibleTo,
  refereeContactVisibleTo,
  type Audience,
  type TalentProfileRow,
} from "@/server/policy/profile-access";

/* The shape every screen, export, snapshot and AI context is built from. */

export interface ViewEvidence {
  id: string;
  kind: "file" | "link" | "reference";
  title: string;
  description: string | null;
  url: string | null;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  isRedacted: boolean;
  redactionNote: string | null;
  visibility: "private" | "approved_employers";
  createdAt: string;
}

export interface ViewReview {
  decision: "independently_verified" | "clarification_requested" | "not_verified";
  method: string;
  scope: string;
  reviewedAt: string;
  noteToCandidate: string | null;
}

export interface ViewClaim {
  id: string;
  engagementId: string | null;
  claimType: string;
  text: string;
  source: string;
  achievedOn: string | null;
  lastConfirmedAt: string;
  verificationStatus: "self_reported" | "evidence_supplied" | "independently_verified" | "clarification_requested";
  verificationRequested: boolean;
  latestReview: ViewReview | null;
  evidenceIds: string[];
  visibility: "private" | "approved_employers";
}

export interface ViewEngagement {
  id: string;
  kind: string;
  title: string;
  organisationLabel: string | null;
  organisationName: string | null;
  confidentiality: "named" | "anonymised";
  roleTitle: string | null;
  sector: string | null;
  country: string | null;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
  status: string;
  stageReached: string | null;
  ventureStage: string | null;
  context: string | null;
  responsibility: string | null;
  individualActions: string | null;
  teamContribution: string | null;
  outcomes: string | null;
  lessons: string | null;
  teamSize: number | null;
  valueCurrency: string | null;
  projectValue: string | null;
  revenueGenerated: string | null;
  budgetManaged: string | null;
  personallyAttributableValue: string | null;
  valueNotes: string | null;
  isSignature: boolean;
  visibility: "private" | "approved_employers";
  privateNotes?: string | null;
  capabilities: { id: string; name: string }[];
  claims: ViewClaim[];
}

export interface ProfileView {
  id: string;
  userId: string;
  audience: Audience["kind"];
  fullName: string;
  preferredName: string | null;
  headline: string | null;
  roleFamily: string | null;
  locationCity: string | null;
  locationCountry: string | null;
  timeZone: string | null;
  languages: string[];
  introduction: string | null;
  sectors: string[];
  yearsExperience: number | null;
  opportunityTypes: string[];
  workArrangements: string[];
  relocation: string | null;
  geographicPreferences: string | null;
  availability: { status: string | null; availableFrom: string | null; noticePeriodWeeks: number | null; hoursPerWeek: number | null };
  compensation: { currency: string | null; min: string | null; max: string | null; period: string | null; visibility: "private" | "approved_employers" } | null;
  contact: { email: string | null; phone: string | null } | null;
  links: { linkedinUrl: string | null; websiteUrl: string | null };
  settings?: { visibility: string; contactVisibility: string; evidenceVisibility: string; compensationVisibility: string };
  capabilities: {
    id: string;
    capabilityId: string;
    name: string;
    category: string;
    tier: string;
    selfProficiency: string;
    assessedProficiency: string | null;
    assessmentMethod: string | null;
    yearsExperience: number | null;
    evidenceNote: string | null;
    visibility: "private" | "approved_employers";
  }[];
  engagements: ViewEngagement[];
  standaloneClaims: ViewClaim[];
  evidence: ViewEvidence[];
  modules: { moduleKey: string; questionKey: string; answer: string; visibility: "private" | "approved_employers" }[];
  learning: { id: string; kind: string; title: string; provider: string | null; year: number | null; takeaway: string | null; credentialUrl: string | null; verificationStatus: string; visibility: "private" | "approved_employers" }[];
  publicWork: { id: string; kind: string; title: string; venue: string | null; url: string | null; year: number | null; description: string | null; visibility: "private" | "approved_employers" }[];
  referees: {
    id: string;
    name: string;
    relationship: string;
    organisation: string | null;
    speaksTo: string | null;
    consentToContact: boolean;
    visibility: "private" | "approved_employers";
    contact: { email: string | null; phone: string | null } | null;
  }[];
  updatedAt: string;
  lastConfirmedAt: string | null;
  coreCompletedAt: string | null;
}

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

export async function loadProfileRow(profileId: string): Promise<TalentProfileRow | null> {
  const [row] = await getDb().select().from(talentProfiles).where(eq(talentProfiles.id, profileId)).limit(1);
  return row ?? null;
}

/**
 * Builds the profile as seen by `audience`. Callers must have obtained the audience from
 * `resolveAudience` (or from a validated share link or snapshot). Nothing outside this
 * function decides what a viewer can see.
 */
export async function buildProfileView(profile: TalentProfileRow, audience: Audience): Promise<ProfileView> {
  const db = getDb();
  const pid = profile.id;
  const isOwner = audience.kind === "owner";

  const [caps, engs, clms, evid, mods, learn, pubs, refs] = await Promise.all([
    db
      .select({ pc: profileCapabilities, name: capabilities.name, category: capabilities.category })
      .from(profileCapabilities)
      .innerJoin(capabilities, eq(capabilities.id, profileCapabilities.capabilityId))
      .where(eq(profileCapabilities.profileId, pid))
      .orderBy(asc(profileCapabilities.tier), asc(capabilities.name)),
    db.select().from(engagements).where(eq(engagements.profileId, pid)).orderBy(desc(engagements.isSignature), asc(engagements.sortOrder), desc(engagements.startDate)),
    db.select().from(claims).where(eq(claims.profileId, pid)).orderBy(asc(claims.createdAt)),
    db.select().from(evidenceItems).where(eq(evidenceItems.profileId, pid)).orderBy(desc(evidenceItems.createdAt)),
    db.select().from(moduleResponses).where(eq(moduleResponses.profileId, pid)),
    db.select().from(learningRecords).where(eq(learningRecords.profileId, pid)).orderBy(desc(learningRecords.year)),
    db.select().from(publicWorkItems).where(eq(publicWorkItems.profileId, pid)).orderBy(desc(publicWorkItems.year)),
    db.select().from(referees).where(eq(referees.profileId, pid)).orderBy(asc(referees.createdAt)),
  ]);

  const engIds = engs.map((e) => e.id);
  const claimIds = clms.map((c) => c.id);
  const [engCaps, links, reviews] = await Promise.all([
    engIds.length
      ? db
          .select({ engagementId: engagementCapabilities.engagementId, id: capabilities.id, name: capabilities.name })
          .from(engagementCapabilities)
          .innerJoin(capabilities, eq(capabilities.id, engagementCapabilities.capabilityId))
          .where(inArray(engagementCapabilities.engagementId, engIds))
      : Promise.resolve([]),
    claimIds.length ? db.select().from(claimEvidence).where(inArray(claimEvidence.claimId, claimIds)) : Promise.resolve([]),
    claimIds.length ? db.select().from(verificationReviews).where(inArray(verificationReviews.claimId, claimIds)).orderBy(desc(verificationReviews.reviewedAt)) : Promise.resolve([]),
  ]);

  // Evidence first: claims may only reference evidence the audience can see.
  const visibleEvidence = evid.filter((e) => evidenceVisibleTo(audience, profile, e.visibility));
  const visibleEvidenceIds = new Set(visibleEvidence.map((e) => e.id));

  const visibleEngagements = engs.filter((e) => itemVisibleTo(audience, e.visibility));
  const visibleEngagementIds = new Set(visibleEngagements.map((e) => e.id));

  const toClaim = (c: (typeof clms)[number]): ViewClaim => {
    const review = reviews.find((r) => r.claimId === c.id);
    return {
      id: c.id,
      engagementId: c.engagementId,
      claimType: c.claimType,
      text: c.text,
      source: c.source,
      achievedOn: c.achievedOn,
      lastConfirmedAt: iso(c.lastConfirmedAt)!,
      verificationStatus: c.verificationStatus,
      verificationRequested: !!c.verificationRequestedAt,
      latestReview: review
        ? {
            decision: review.decision,
            method: review.method,
            scope: review.scope,
            reviewedAt: iso(review.reviewedAt)!,
            noteToCandidate: isOwner || audience.kind === "admin" ? review.noteToCandidate : null,
          }
        : null,
      evidenceIds: links.filter((l) => l.claimId === c.id && visibleEvidenceIds.has(l.evidenceId)).map((l) => l.evidenceId),
      visibility: c.visibility,
    };
  };

  const visibleClaims = clms.filter((c) => itemVisibleTo(audience, c.visibility) && (!c.engagementId || visibleEngagementIds.has(c.engagementId)));

  return {
    id: profile.id,
    userId: profile.userId,
    audience: audience.kind,
    fullName: profile.fullName,
    preferredName: profile.preferredName,
    headline: profile.headline,
    roleFamily: profile.roleFamily,
    locationCity: profile.locationCity,
    locationCountry: profile.locationCountry,
    timeZone: profile.timeZone,
    languages: profile.languages,
    introduction: profile.introduction,
    sectors: profile.sectors,
    yearsExperience: profile.yearsExperience,
    opportunityTypes: profile.opportunityTypes,
    workArrangements: profile.workArrangements,
    relocation: profile.relocation,
    geographicPreferences: profile.geographicPreferences,
    availability: {
      status: profile.availabilityStatus,
      availableFrom: profile.availableFrom,
      noticePeriodWeeks: profile.noticePeriodWeeks,
      hoursPerWeek: profile.hoursPerWeek,
    },
    compensation: compensationVisibleTo(audience, profile)
      ? {
          currency: profile.compensationCurrency,
          min: profile.compensationMin,
          max: profile.compensationMax,
          period: profile.compensationPeriod,
          visibility: profile.compensationVisibility,
        }
      : null,
    contact: contactVisibleTo(audience, profile) ? { email: profile.contactEmail, phone: profile.contactPhone } : null,
    links: { linkedinUrl: profile.linkedinUrl, websiteUrl: profile.websiteUrl },
    settings: isOwner
      ? {
          visibility: profile.visibility,
          contactVisibility: profile.contactVisibility,
          evidenceVisibility: profile.evidenceVisibility,
          compensationVisibility: profile.compensationVisibility,
        }
      : undefined,
    capabilities: caps
      .filter((c) => itemVisibleTo(audience, c.pc.visibility))
      .map((c) => ({
        id: c.pc.id,
        capabilityId: c.pc.capabilityId,
        name: c.name,
        category: c.category,
        tier: c.pc.tier,
        selfProficiency: c.pc.selfProficiency,
        assessedProficiency: c.pc.assessedProficiency,
        assessmentMethod: c.pc.assessmentMethod,
        yearsExperience: c.pc.yearsExperience,
        evidenceNote: c.pc.evidenceNote,
        visibility: c.pc.visibility,
      })),
    engagements: visibleEngagements.map((e) => ({
      id: e.id,
      kind: e.kind,
      title: e.title,
      organisationLabel: e.confidentiality === "anonymised" ? e.anonymisedDescription : e.organisationName,
      // A confidential client name is only ever shown to the candidate.
      organisationName: isOwner || e.confidentiality === "named" ? e.organisationName : null,
      confidentiality: e.confidentiality,
      roleTitle: e.roleTitle,
      sector: e.sector,
      country: e.country,
      startDate: e.startDate,
      endDate: e.endDate,
      isCurrent: e.isCurrent,
      status: e.status,
      stageReached: e.stageReached,
      ventureStage: e.ventureStage,
      context: e.context,
      responsibility: e.responsibility,
      individualActions: e.individualActions,
      teamContribution: e.teamContribution,
      outcomes: e.outcomes,
      lessons: e.lessons,
      teamSize: e.teamSize,
      valueCurrency: e.valueCurrency,
      projectValue: e.projectValue,
      revenueGenerated: e.revenueGenerated,
      budgetManaged: e.budgetManaged,
      personallyAttributableValue: e.personallyAttributableValue,
      valueNotes: e.valueNotes,
      isSignature: e.isSignature,
      visibility: e.visibility,
      ...(isOwner ? { privateNotes: e.privateNotes } : {}),
      capabilities: engCaps.filter((c) => c.engagementId === e.id).map((c) => ({ id: c.id, name: c.name })),
      claims: visibleClaims.filter((c) => c.engagementId === e.id).map(toClaim),
    })),
    standaloneClaims: visibleClaims.filter((c) => !c.engagementId).map(toClaim),
    evidence: visibleEvidence.map((e) => ({
      id: e.id,
      kind: e.kind,
      title: e.title,
      description: e.description,
      url: e.kind === "link" ? e.url : null,
      fileName: e.fileName,
      mimeType: e.mimeType,
      sizeBytes: e.sizeBytes,
      isRedacted: e.isRedacted,
      redactionNote: e.redactionNote,
      visibility: e.visibility,
      createdAt: iso(e.createdAt)!,
    })),
    modules: mods
      .filter((m) => itemVisibleTo(audience, m.visibility) && m.answer.trim())
      .map((m) => ({ moduleKey: m.moduleKey, questionKey: m.questionKey, answer: m.answer, visibility: m.visibility })),
    learning: learn
      .filter((l) => itemVisibleTo(audience, l.visibility))
      .map((l) => ({
        id: l.id,
        kind: l.kind,
        title: l.title,
        provider: l.provider,
        year: l.year,
        takeaway: l.takeaway,
        credentialUrl: l.credentialUrl,
        verificationStatus: l.verificationStatus,
        visibility: l.visibility,
      })),
    publicWork: pubs
      .filter((p) => itemVisibleTo(audience, p.visibility))
      .map((p) => ({ id: p.id, kind: p.kind, title: p.title, venue: p.venue, url: p.url, year: p.year, description: p.description, visibility: p.visibility })),
    referees: refs
      .filter((r) => itemVisibleTo(audience, r.visibility))
      .map((r) => ({
        id: r.id,
        name: r.name,
        relationship: r.relationship,
        organisation: r.organisation,
        speaksTo: r.speaksTo,
        consentToContact: r.consentToContact,
        visibility: r.visibility,
        contact: refereeContactVisibleTo(audience, r.consentToContact) ? { email: r.email, phone: r.phone } : null,
      })),
    updatedAt: iso(profile.updatedAt)!,
    lastConfirmedAt: iso(profile.lastConfirmedAt),
    coreCompletedAt: iso(profile.coreCompletedAt),
  };
}

/** All evidence ids a given audience may download for this profile. */
export async function visibleEvidenceIdsFor(profile: TalentProfileRow, audience: Audience): Promise<Set<string>> {
  const rows = await getDb().select({ id: evidenceItems.id, visibility: evidenceItems.visibility }).from(evidenceItems).where(eq(evidenceItems.profileId, profile.id));
  return new Set(rows.filter((r) => evidenceVisibleTo(audience, profile, r.visibility)).map((r) => r.id));
}
