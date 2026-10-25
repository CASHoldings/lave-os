import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ */
/* Enumerations: provenance, verification and visibility are explicit */
/* ------------------------------------------------------------------ */

export const platformRole = pgEnum("platform_role", ["member", "admin"]);
export const accountType = pgEnum("account_type", ["talent", "employer"]);
export const userStatus = pgEnum("user_status", ["active", "suspended", "deleted"]);
export const authProvider = pgEnum("auth_provider", ["password", "supabase", "demo"]);

export const orgStatus = pgEnum("org_status", ["pending", "approved", "rejected", "suspended"]);
export const orgRole = pgEnum("org_role", ["owner", "admin", "member"]);

/** Whole-profile visibility. Private by default. */
export const profileVisibility = pgEnum("profile_visibility", ["private", "approved_employers"]);
/** Item-level visibility for records inside a profile. */
export const itemVisibility = pgEnum("item_visibility", ["private", "approved_employers"]);
/** Contact details: hidden, released per organisation (introductions), or visible to approved employers. */
export const contactVisibility = pgEnum("contact_visibility", ["private", "on_introduction", "approved_employers"]);

export const availabilityStatus = pgEnum("availability_status", ["available_now", "available_from", "open_to_conversations", "not_available"]);
export const compensationPeriod = pgEnum("compensation_period", ["annual", "monthly", "daily", "hourly"]);
export const relocation = pgEnum("relocation", ["no", "open", "travel_only"]);

export const capabilityCategory = pgEnum("capability_category", ["domain", "functional", "technical", "leadership", "language"]);
export const proficiency = pgEnum("proficiency", ["aware", "practitioner", "advanced", "expert"]);
export const capabilityTier = pgEnum("capability_tier", ["core", "strong", "working"]);

export const engagementKind = pgEnum("engagement_kind", ["role", "project", "venture", "advisory"]);
export const engagementStatus = pgEnum("engagement_status", ["ongoing", "completed", "paused", "discontinued"]);
export const engagementStage = pgEnum("engagement_stage", ["introduction", "proposal", "contract_award", "execution", "completion"]);
export const ventureStage = pgEnum("venture_stage", ["idea", "mvp", "revenue", "growth", "exit", "closed"]);
export const confidentiality = pgEnum("confidentiality", ["named", "anonymised"]);

export const claimType = pgEnum("claim_type", ["outcome", "financial", "responsibility", "credential", "recognition", "other"]);
export const claimSource = pgEnum("claim_source", ["candidate", "reference", "employer", "platform"]);
export const verificationStatus = pgEnum("verification_status", [
  "self_reported",
  "evidence_supplied",
  "independently_verified",
  "clarification_requested",
]);
export const verificationDecision = pgEnum("verification_decision", ["independently_verified", "clarification_requested", "not_verified"]);
export const verificationMethod = pgEnum("verification_method", ["document_review", "reference_check", "public_record", "issuer_confirmation", "other"]);

export const evidenceKind = pgEnum("evidence_kind", ["file", "link", "reference"]);
export const learningKind = pgEnum("learning_kind", ["course", "certification", "degree", "self_directed"]);
export const publicWorkKind = pgEnum("public_work_kind", ["writing", "talk", "podcast", "open_source", "community", "research", "other"]);

export const opportunityType = pgEnum("opportunity_type", ["permanent", "fixed_term", "project", "fractional", "advisory"]);
export const workArrangement = pgEnum("work_arrangement", ["remote", "hybrid", "on_site"]);
export const opportunityStatus = pgEnum("opportunity_status", ["draft", "published", "closed"]);
export const requirementImportance = pgEnum("requirement_importance", ["essential", "desirable"]);
export const requirementKind = pgEnum("requirement_kind", ["capability", "evidence", "experience", "language", "other"]);

export const applicationStatus = pgEnum("application_status", [
  "submitted",
  "in_review",
  "shortlisted",
  "introduction_requested",
  "interviewing",
  "offer",
  "not_progressing",
  "withdrawn",
]);
export const introductionStatus = pgEnum("introduction_status", ["pending", "accepted", "declined", "withdrawn"]);
export const grantScope = pgEnum("grant_scope", ["contact", "evidence", "references"]);
export const grantSource = pgEnum("grant_source", ["application", "introduction", "manual"]);

export const aiSuggestionKind = pgEnum("ai_suggestion_kind", ["rewrite", "extract", "follow_up", "summary", "comparison", "opportunity_clarify"]);
export const aiSuggestionStatus = pgEnum("ai_suggestion_status", ["pending", "approved", "rejected", "superseded"]);

export const reportStatus = pgEnum("report_status", ["open", "actioned", "dismissed"]);

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/* ------------------------------------------------------------------ */
/* Identity                                                            */
/* ------------------------------------------------------------------ */

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    passwordHash: text("password_hash"),
    authProvider: authProvider("auth_provider").notNull().default("password"),
    externalAuthId: text("external_auth_id"),
    accountType: accountType("account_type").notNull(),
    platformRole: platformRole("platform_role").notNull().default("member"),
    status: userStatus("status").notNull().default("active"),
    isDemo: boolean("is_demo").notNull().default(false),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_email_key").on(sql`lower(${t.email})`), uniqueIndex("users_external_auth_key").on(t.authProvider, t.externalAuthId)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    tokenHash: text("token_hash").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("sessions_token_key").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
);

/** Counts sign-in attempts per hashed email for rate limiting. No raw emails or IPs are stored. */
export const authAttempts = pgTable(
  "auth_attempts",
  {
    id: id(),
    keyHash: text("key_hash").notNull(),
    succeeded: boolean("succeeded").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("auth_attempts_key_idx").on(t.keyHash, t.createdAt)],
);

/* ------------------------------------------------------------------ */
/* Organisations                                                       */
/* ------------------------------------------------------------------ */

export const organisations = pgTable(
  "organisations",
  {
    id: id(),
    name: text("name").notNull(),
    website: text("website"),
    country: text("country"),
    sector: text("sector"),
    sizeBand: text("size_band"),
    description: text("description"),
    registrationNote: text("registration_note"),
    status: orgStatus("status").notNull().default("pending"),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewReason: text("review_reason"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("organisations_status_idx").on(t.status)],
);

export const organisationMemberships = pgTable(
  "organisation_memberships",
  {
    id: id(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: orgRole("role").notNull().default("member"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("org_membership_key").on(t.organisationId, t.userId), index("org_membership_user_idx").on(t.userId)],
);

/* ------------------------------------------------------------------ */
/* Talent profiles                                                     */
/* ------------------------------------------------------------------ */

export const talentProfiles = pgTable(
  "talent_profiles",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fullName: text("full_name").notNull().default(""),
    preferredName: text("preferred_name"),
    headline: text("headline"),
    roleFamily: text("role_family"),
    locationCity: text("location_city"),
    locationCountry: text("location_country"),
    timeZone: text("time_zone"),
    languages: text("languages").array().notNull().default(sql`'{}'::text[]`),
    introduction: text("introduction"),
    opportunityTypes: opportunityType("opportunity_types").array().notNull().default(sql`'{}'`),
    workArrangements: workArrangement("work_arrangements").array().notNull().default(sql`'{}'`),
    relocation: relocation("relocation"),
    geographicPreferences: text("geographic_preferences"),
    availabilityStatus: availabilityStatus("availability_status"),
    availableFrom: date("available_from"),
    noticePeriodWeeks: integer("notice_period_weeks"),
    hoursPerWeek: integer("hours_per_week"),
    compensationCurrency: text("compensation_currency"),
    compensationMin: numeric("compensation_min", { precision: 14, scale: 2 }),
    compensationMax: numeric("compensation_max", { precision: 14, scale: 2 }),
    compensationPeriod: compensationPeriod("compensation_period"),
    compensationVisibility: itemVisibility("compensation_visibility").notNull().default("private"),
    sectors: text("sectors").array().notNull().default(sql`'{}'::text[]`),
    yearsExperience: integer("years_experience"),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    linkedinUrl: text("linkedin_url"),
    websiteUrl: text("website_url"),
    visibility: profileVisibility("visibility").notNull().default("private"),
    contactVisibility: contactVisibility("contact_visibility").notNull().default("on_introduction"),
    /** Default visibility for evidence files; each item can still be private. */
    evidenceVisibility: itemVisibility("evidence_visibility").notNull().default("private"),
    lastEditedSection: text("last_edited_section"),
    coreCompletedAt: timestamp("core_completed_at", { withTimezone: true }),
    lastConfirmedAt: timestamp("last_confirmed_at", { withTimezone: true }),
    /** Text built only from fields visible to approved employers; private content never enters the index. */
    searchText: text("search_text").notNull().default(""),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("talent_profiles_user_key").on(t.userId),
    index("talent_profiles_visibility_idx").on(t.visibility),
    index("talent_profiles_search_idx").using("gin", sql`to_tsvector('english', ${t.searchText})`),
  ],
);

/** Free-text answers to the deeper profile modules; one row per question, each with its own visibility. */
export const moduleResponses = pgTable(
  "module_responses",
  {
    id: id(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => talentProfiles.id, { onDelete: "cascade" }),
    moduleKey: text("module_key").notNull(),
    questionKey: text("question_key").notNull(),
    answer: text("answer").notNull(),
    visibility: itemVisibility("visibility").notNull().default("approved_employers"),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("module_responses_key").on(t.profileId, t.moduleKey, t.questionKey)],
);

export const capabilities = pgTable(
  "capabilities",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    category: capabilityCategory("category").notNull(),
    /** Curated entries are part of the shared taxonomy; others were added by a user. */
    curated: boolean("curated").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("capabilities_slug_key").on(t.slug)],
);

export const profileCapabilities = pgTable(
  "profile_capabilities",
  {
    id: id(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => talentProfiles.id, { onDelete: "cascade" }),
    capabilityId: uuid("capability_id")
      .notNull()
      .references(() => capabilities.id, { onDelete: "restrict" }),
    tier: capabilityTier("tier").notNull().default("strong"),
    selfProficiency: proficiency("self_proficiency").notNull(),
    assessedProficiency: proficiency("assessed_proficiency"),
    assessedBy: uuid("assessed_by").references(() => users.id, { onDelete: "set null" }),
    assessedAt: timestamp("assessed_at", { withTimezone: true }),
    assessmentMethod: text("assessment_method"),
    yearsExperience: integer("years_experience"),
    evidenceNote: text("evidence_note"),
    visibility: itemVisibility("visibility").notNull().default("approved_employers"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("profile_capabilities_key").on(t.profileId, t.capabilityId), index("profile_capabilities_cap_idx").on(t.capabilityId)],
);

/* ------------------------------------------------------------------ */
/* Evidence Portfolio: engagements, claims, evidence, verification     */
/* ------------------------------------------------------------------ */

export const engagements = pgTable(
  "engagements",
  {
    id: id(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => talentProfiles.id, { onDelete: "cascade" }),
    kind: engagementKind("kind").notNull().default("project"),
    title: text("title").notNull(),
    organisationName: text("organisation_name"),
    confidentiality: confidentiality("confidentiality").notNull().default("named"),
    anonymisedDescription: text("anonymised_description"),
    roleTitle: text("role_title"),
    sector: text("sector"),
    country: text("country"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    isCurrent: boolean("is_current").notNull().default(false),
    status: engagementStatus("status").notNull().default("completed"),
    /** The furthest stage reached while the candidate was involved. */
    stageReached: engagementStage("stage_reached"),
    ventureStage: ventureStage("venture_stage"),
    context: text("context"),
    responsibility: text("responsibility"),
    individualActions: text("individual_actions"),
    teamContribution: text("team_contribution"),
    outcomes: text("outcomes"),
    lessons: text("lessons"),
    teamSize: integer("team_size"),
    /** Value figures are kept apart: overall project value is not revenue generated or personal attribution. */
    valueCurrency: text("value_currency"),
    projectValue: numeric("project_value", { precision: 16, scale: 2 }),
    revenueGenerated: numeric("revenue_generated", { precision: 16, scale: 2 }),
    budgetManaged: numeric("budget_managed", { precision: 16, scale: 2 }),
    personallyAttributableValue: numeric("personally_attributable_value", { precision: 16, scale: 2 }),
    valueNotes: text("value_notes"),
    isSignature: boolean("is_signature").notNull().default(false),
    visibility: itemVisibility("visibility").notNull().default("approved_employers"),
    privateNotes: text("private_notes"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("engagements_profile_idx").on(t.profileId)],
);

export const engagementCapabilities = pgTable(
  "engagement_capabilities",
  {
    engagementId: uuid("engagement_id")
      .notNull()
      .references(() => engagements.id, { onDelete: "cascade" }),
    capabilityId: uuid("capability_id")
      .notNull()
      .references(() => capabilities.id, { onDelete: "restrict" }),
  },
  (t) => [primaryKey({ columns: [t.engagementId, t.capabilityId] }), index("engagement_capabilities_cap_idx").on(t.capabilityId)],
);

export const claims = pgTable(
  "claims",
  {
    id: id(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => talentProfiles.id, { onDelete: "cascade" }),
    engagementId: uuid("engagement_id").references(() => engagements.id, { onDelete: "set null" }),
    claimType: claimType("claim_type").notNull().default("outcome"),
    text: text("text").notNull(),
    source: claimSource("source").notNull().default("candidate"),
    authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
    authorName: text("author_name"),
    achievedOn: date("achieved_on"),
    lastConfirmedAt: timestamp("last_confirmed_at", { withTimezone: true }).notNull().defaultNow(),
    verificationStatus: verificationStatus("verification_status").notNull().default("self_reported"),
    verificationRequestedAt: timestamp("verification_requested_at", { withTimezone: true }),
    visibility: itemVisibility("visibility").notNull().default("approved_employers"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("claims_profile_idx").on(t.profileId), index("claims_engagement_idx").on(t.engagementId), index("claims_verification_idx").on(t.verificationStatus)],
);

export const evidenceItems = pgTable(
  "evidence_items",
  {
    id: id(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => talentProfiles.id, { onDelete: "cascade" }),
    kind: evidenceKind("kind").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    url: text("url"),
    storageKey: text("storage_key"),
    fileName: text("file_name"),
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes"),
    sha256: text("sha256"),
    isRedacted: boolean("is_redacted").notNull().default(false),
    redactionNote: text("redaction_note"),
    referenceId: uuid("reference_id"),
    /** Reserved for automated text extraction (not implemented). Cleared on deletion with the file. */
    derivedText: text("derived_text"),
    visibility: itemVisibility("visibility").notNull().default("private"),
    createdAt: createdAt(),
  },
  (t) => [index("evidence_profile_idx").on(t.profileId)],
);

export const claimEvidence = pgTable(
  "claim_evidence",
  {
    claimId: uuid("claim_id")
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => evidenceItems.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.claimId, t.evidenceId] }), index("claim_evidence_evidence_idx").on(t.evidenceId)],
);

export const verificationReviews = pgTable(
  "verification_reviews",
  {
    id: id(),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    reviewerUserId: uuid("reviewer_user_id").references(() => users.id, { onDelete: "set null" }),
    decision: verificationDecision("decision").notNull(),
    method: verificationMethod("method").notNull(),
    /** What exactly was checked, in plain language. Required. */
    scope: text("scope").notNull(),
    evidenceIdsReviewed: uuid("evidence_ids_reviewed").array().notNull().default(sql`'{}'::uuid[]`),
    noteToCandidate: text("note_to_candidate"),
    reason: text("reason").notNull(),
    /** The claim text at the time of review, so later edits are visible. */
    claimTextAtReview: text("claim_text_at_review").notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("verification_reviews_claim_idx").on(t.claimId)],
);

export const learningRecords = pgTable(
  "learning_records",
  {
    id: id(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => talentProfiles.id, { onDelete: "cascade" }),
    kind: learningKind("kind").notNull(),
    title: text("title").notNull(),
    provider: text("provider"),
    year: integer("year"),
    takeaway: text("takeaway"),
    credentialUrl: text("credential_url"),
    verificationStatus: verificationStatus("verification_status").notNull().default("self_reported"),
    visibility: itemVisibility("visibility").notNull().default("approved_employers"),
    createdAt: createdAt(),
  },
  (t) => [index("learning_profile_idx").on(t.profileId)],
);

export const publicWorkItems = pgTable(
  "public_work_items",
  {
    id: id(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => talentProfiles.id, { onDelete: "cascade" }),
    kind: publicWorkKind("kind").notNull(),
    title: text("title").notNull(),
    venue: text("venue"),
    url: text("url"),
    year: integer("year"),
    description: text("description"),
    visibility: itemVisibility("visibility").notNull().default("approved_employers"),
    createdAt: createdAt(),
  },
  (t) => [index("public_work_profile_idx").on(t.profileId)],
);

export const referees = pgTable(
  "referees",
  {
    id: id(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => talentProfiles.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    relationship: text("relationship").notNull(),
    organisation: text("organisation"),
    email: text("email"),
    phone: text("phone"),
    speaksTo: text("speaks_to"),
    engagementId: uuid("engagement_id").references(() => engagements.id, { onDelete: "set null" }),
    /** The candidate must explicitly consent before anyone contacts this reference. */
    consentToContact: boolean("consent_to_contact").notNull().default(false),
    /** Whether the reference's name and relationship (never contact details) can be shown to approved employers. */
    visibility: itemVisibility("visibility").notNull().default("private"),
    createdAt: createdAt(),
  },
  (t) => [index("referees_profile_idx").on(t.profileId)],
);

/* ------------------------------------------------------------------ */
/* Sharing                                                             */
/* ------------------------------------------------------------------ */

export const shareLinks = pgTable(
  "share_links",
  {
    id: id(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => talentProfiles.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    label: text("label").notNull(),
    includeContact: boolean("include_contact").notNull().default(false),
    includeEvidence: boolean("include_evidence").notNull().default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
    accessCount: integer("access_count").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("share_links_token_key").on(t.tokenHash), index("share_links_profile_idx").on(t.profileId)],
);

/** Candidate-approved access for a specific organisation, beyond what approved employers see by default. */
export const accessGrants = pgTable(
  "access_grants",
  {
    id: id(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => talentProfiles.id, { onDelete: "cascade" }),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    scope: grantScope("scope").notNull(),
    source: grantSource("source").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("access_grants_lookup_idx").on(t.profileId, t.organisationId)],
);

/* ------------------------------------------------------------------ */
/* Opportunities and applications                                     */
/* ------------------------------------------------------------------ */

export const opportunities = pgTable(
  "opportunities",
  {
    id: id(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    engagementType: opportunityType("engagement_type").notNull(),
    problemStatement: text("problem_statement"),
    expectedOutcomes: text("expected_outcomes"),
    responsibilities: text("responsibilities"),
    experienceRequirements: text("experience_requirements"),
    requiredEvidence: text("required_evidence"),
    locationText: text("location_text"),
    country: text("country"),
    workArrangement: workArrangement("work_arrangement"),
    timeZoneRequirements: text("time_zone_requirements"),
    startDate: date("start_date"),
    durationText: text("duration_text"),
    hoursPerWeek: integer("hours_per_week"),
    compensationCurrency: text("compensation_currency"),
    compensationMin: numeric("compensation_min", { precision: 14, scale: 2 }),
    compensationMax: numeric("compensation_max", { precision: 14, scale: 2 }),
    compensationPeriod: compensationPeriod("compensation_period"),
    selectionStages: text("selection_stages").array().notNull().default(sql`'{}'::text[]`),
    sectors: text("sectors").array().notNull().default(sql`'{}'::text[]`),
    status: opportunityStatus("status").notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("opportunities_org_idx").on(t.organisationId), index("opportunities_status_idx").on(t.status)],
);

export const opportunityRequirements = pgTable(
  "opportunity_requirements",
  {
    id: id(),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    kind: requirementKind("kind").notNull().default("capability"),
    capabilityId: uuid("capability_id").references(() => capabilities.id, { onDelete: "set null" }),
    label: text("label").notNull(),
    importance: requirementImportance("importance").notNull().default("essential"),
    minProficiency: proficiency("min_proficiency"),
    notes: text("notes"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("opp_requirements_opp_idx").on(t.opportunityId)],
);

/** A frozen copy of what the candidate approved to share. Later profile edits never alter it. */
export const profileSnapshots = pgTable(
  "profile_snapshots",
  {
    id: id(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => talentProfiles.id, { onDelete: "cascade" }),
    data: jsonb("data").notNull(),
    includeContact: boolean("include_contact").notNull().default(false),
    includeEvidence: boolean("include_evidence").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("snapshots_profile_idx").on(t.profileId)],
);

export const applications = pgTable(
  "applications",
  {
    id: id(),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    /** Nulled when a candidate deletes their account; the employer keeps an anonymous record. */
    profileId: uuid("profile_id").references(() => talentProfiles.id, { onDelete: "set null" }),
    snapshotId: uuid("snapshot_id").references(() => profileSnapshots.id, { onDelete: "set null" }),
    candidateDisplayName: text("candidate_display_name").notNull(),
    expressionOfInterest: text("expression_of_interest").notNull(),
    status: applicationStatus("status").notNull().default("submitted"),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("applications_org_idx").on(t.organisationId),
    index("applications_opp_idx").on(t.opportunityId),
    index("applications_profile_idx").on(t.profileId),
    uniqueIndex("applications_unique_active").on(t.opportunityId, t.profileId),
  ],
);

export const applicationEvents = pgTable(
  "application_events",
  {
    id: id(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    fromStatus: applicationStatus("from_status"),
    toStatus: applicationStatus("to_status").notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("application_events_app_idx").on(t.applicationId)],
);

/** Organisation-private notes on an application. Protected by row-level security as well as application checks. */
export const applicationNotes = pgTable(
  "application_notes",
  {
    id: id(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("application_notes_app_idx").on(t.applicationId)],
);

export const shortlists = pgTable(
  "shortlists",
  {
    id: id(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    opportunityId: uuid("opportunity_id").references(() => opportunities.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    description: text("description"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("shortlists_org_idx").on(t.organisationId)],
);

export const shortlistEntries = pgTable(
  "shortlist_entries",
  {
    id: id(),
    shortlistId: uuid("shortlist_id")
      .notNull()
      .references(() => shortlists.id, { onDelete: "cascade" }),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => talentProfiles.id, { onDelete: "cascade" }),
    note: text("note"),
    addedBy: uuid("added_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("shortlist_entries_key").on(t.shortlistId, t.profileId), index("shortlist_entries_profile_idx").on(t.profileId)],
);

export const introductionRequests = pgTable(
  "introduction_requests",
  {
    id: id(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => talentProfiles.id, { onDelete: "cascade" }),
    opportunityId: uuid("opportunity_id").references(() => opportunities.id, { onDelete: "set null" }),
    applicationId: uuid("application_id").references(() => applications.id, { onDelete: "set null" }),
    requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
    message: text("message").notNull(),
    status: introductionStatus("status").notNull().default("pending"),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("intro_requests_profile_idx").on(t.profileId), index("intro_requests_org_idx").on(t.organisationId)],
);

/* ------------------------------------------------------------------ */
/* AI assistance                                                       */
/* ------------------------------------------------------------------ */

export const aiSuggestions = pgTable(
  "ai_suggestions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id").references(() => talentProfiles.id, { onDelete: "cascade" }),
    organisationId: uuid("organisation_id").references(() => organisations.id, { onDelete: "cascade" }),
    kind: aiSuggestionKind("kind").notNull(),
    targetType: text("target_type"),
    targetId: uuid("target_id"),
    targetField: text("target_field"),
    /** Validated structured output, including source references and flagged uncertainties. */
    output: jsonb("output").notNull(),
    provider: text("provider").notNull(),
    model: text("model"),
    isDemonstration: boolean("is_demonstration").notNull().default(false),
    status: aiSuggestionStatus("status").notNull().default("pending"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("ai_suggestions_user_idx").on(t.userId, t.status)],
);

/** Request metadata for rate limits and operations. Never stores prompts or outputs. */
export const aiRequests = pgTable(
  "ai_requests",
  {
    id: id(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    task: text("task").notNull(),
    provider: text("provider").notNull(),
    succeeded: boolean("succeeded").notNull(),
    errorCode: text("error_code"),
    latencyMs: integer("latency_ms"),
    createdAt: createdAt(),
  },
  (t) => [index("ai_requests_user_idx").on(t.userId, t.createdAt)],
);

/* ------------------------------------------------------------------ */
/* Trust, safety and audit                                            */
/* ------------------------------------------------------------------ */

export const contentReports = pgTable(
  "content_reports",
  {
    id: id(),
    reporterUserId: uuid("reporter_user_id").references(() => users.id, { onDelete: "set null" }),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    category: text("category").notNull(),
    details: text("details"),
    status: reportStatus("status").notNull().default("open"),
    resolutionNote: text("resolution_note"),
    resolvedBy: uuid("resolved_by").references(() => users.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("content_reports_status_idx").on(t.status)],
);

/** Append-only record of significant actions. Metadata holds identifiers and reasons, never profile content. */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    actorUserId: uuid("actor_user_id"),
    actorRole: text("actor_role"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: uuid("target_id"),
    organisationId: uuid("organisation_id"),
    reason: text("reason"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [index("audit_events_created_idx").on(t.createdAt), index("audit_events_target_idx").on(t.targetType, t.targetId)],
);

/** Proof that a deletion ran, without retaining personal data. */
export const deletionReceipts = pgTable("deletion_receipts", {
  id: id(),
  userIdHash: text("user_id_hash").notNull(),
  summary: jsonb("summary").notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
});
