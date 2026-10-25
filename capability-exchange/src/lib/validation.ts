import { z } from "zod";
import { currencies } from "@/config/taxonomy";

/* Helpers: empty form fields become null, so "not provided" is stored as null, never as a guess. */
const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

export const optText = (max = 2000) =>
  z.preprocess(blankToNull, z.string().trim().max(max, `Keep this under ${max} characters.`).nullable().optional()).transform((v) => v ?? null);
export const reqText = (max = 200, label = "This field") =>
  z.string({ error: `${label} is required.` }).trim().min(1, `${label} is required.`).max(max, `Keep this under ${max} characters.`);
export const optInt = (min = 0, max = 1_000_000) =>
  z.preprocess(blankToNull, z.coerce.number({ error: "Enter a whole number." }).int("Enter a whole number.").min(min).max(max).nullable().optional()).transform((v) => v ?? null);
export const optMoney = () =>
  z
    .preprocess(
      (v) => (typeof v === "string" ? blankToNull(v.replace(/[,\s]/g, "")) : v),
      z.coerce.number({ error: "Enter an amount using digits only." }).nonnegative("Amounts cannot be negative.").max(1e13).nullable().optional(),
    )
    .transform((v) => (v == null ? null : String(v)));
export const optDate = () =>
  z.preprocess(blankToNull, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date picker or YYYY-MM-DD.").nullable().optional()).transform((v) => v ?? null);
export const optUrl = () =>
  z
    .preprocess(blankToNull, z.string().trim().max(500).url("Enter a full web address starting with https://").refine((u) => /^https?:\/\//i.test(u), "Only web links (https://) are accepted.").nullable().optional())
    .transform((v) => v ?? null);
export const optEnum = <const T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess(blankToNull, z.enum(values as unknown as [T[number], ...T[number][]]).nullable().optional()).transform((v) => (v ?? null) as T[number] | null);
export const bool = () => z.preprocess((v) => v === true || v === "on" || v === "true" || v === "1", z.boolean());
export const stringList = (max = 30, itemMax = 80) =>
  z
    .preprocess((v) => {
      const items = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
      return items.flatMap((i) => (typeof i === "string" ? i.split(",") : []));
    }, z.array(z.string()))
    .transform((arr) => Array.from(new Set(arr.map((s) => s.trim()).filter(Boolean))))
    .pipe(z.array(z.string().max(itemMax)).max(max));
export const currency = () => optEnum(currencies as unknown as [string, ...string[]]);

export const visibilityEnum = z.enum(["private", "approved_employers"]);

/* ------------------------------------------------------------------ */
/* Accounts                                                            */
/* ------------------------------------------------------------------ */

export const registerSchema = z.object({
  displayName: reqText(120, "Your name"),
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254),
  password: z.string().min(12, "Use at least 12 characters.").max(200),
  accountType: z.enum(["talent", "employer"], { error: "Choose how you will use the platform." }),
});

export const signInSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

/* ------------------------------------------------------------------ */
/* Core profile (saved section by section; drafts may be incomplete)   */
/* ------------------------------------------------------------------ */

export const profileSections = {
  basics: z.object({
    fullName: reqText(120, "Name"),
    preferredName: optText(60),
    headline: optText(140),
    roleFamily: optEnum(["business_development", "investment", "infrastructure", "operations", "technology", "risk_compliance", "other"]),
    yearsExperience: optInt(0, 70),
  }),
  location: z.object({
    locationCity: optText(80),
    locationCountry: optText(80),
    timeZone: optText(60),
    languages: stringList(12, 40),
  }),
  introduction: z.object({
    introduction: optText(2500),
    sectors: stringList(10, 80),
  }),
  preferences: z.object({
    opportunityTypes: z.array(z.enum(["permanent", "fixed_term", "project", "fractional", "advisory"])).default([]),
    workArrangements: z.array(z.enum(["remote", "hybrid", "on_site"])).default([]),
    relocation: optEnum(["no", "open", "travel_only"]),
    geographicPreferences: optText(300),
  }),
  availability: z.object({
    availabilityStatus: optEnum(["available_now", "available_from", "open_to_conversations", "not_available"]),
    availableFrom: optDate(),
    noticePeriodWeeks: optInt(0, 52),
    hoursPerWeek: optInt(1, 80),
  }),
  compensation: z
    .object({
      compensationCurrency: currency(),
      compensationMin: optMoney(),
      compensationMax: optMoney(),
      compensationPeriod: optEnum(["annual", "monthly", "daily", "hourly"]),
      compensationVisibility: visibilityEnum.default("private"),
    })
    .refine((v) => !v.compensationMin || !v.compensationMax || Number(v.compensationMin) <= Number(v.compensationMax), {
      path: ["compensationMax"],
      message: "The upper figure must be at least the lower figure.",
    })
    .refine((v) => (!v.compensationMin && !v.compensationMax) || (v.compensationCurrency && v.compensationPeriod), {
      path: ["compensationCurrency"],
      message: "Choose a currency and period for the figures you entered.",
    }),
  contact: z.object({
    contactEmail: z.preprocess(blankToNull, z.string().trim().email("Enter a valid email address.").max(254).nullable().optional()).transform((v) => v ?? null),
    contactPhone: optText(40),
    linkedinUrl: optUrl(),
    websiteUrl: optUrl(),
  }),
} as const;
export type ProfileSectionKey = keyof typeof profileSections;
export const profileSectionKeys = Object.keys(profileSections) as ProfileSectionKey[];

export const visibilitySettingsSchema = z.object({
  visibility: z.enum(["private", "approved_employers"]),
  contactVisibility: z.enum(["private", "on_introduction", "approved_employers"]),
  evidenceVisibility: visibilityEnum,
});

export const moduleAnswerSchema = z.object({
  moduleKey: z.string().max(40),
  questionKey: z.string().max(40),
  answer: z.string().max(6000, "Keep this answer under 6,000 characters."),
  visibility: visibilityEnum.default("approved_employers"),
});

/* ------------------------------------------------------------------ */
/* Capabilities                                                        */
/* ------------------------------------------------------------------ */

export const profileCapabilitySchema = z.object({
  name: reqText(80, "Capability"),
  category: z.enum(["domain", "functional", "technical", "leadership", "language"]).default("functional"),
  tier: z.enum(["core", "strong", "working"]),
  selfProficiency: z.enum(["aware", "practitioner", "advanced", "expert"], { error: "Choose a proficiency level." }),
  yearsExperience: optInt(0, 60),
  evidenceNote: optText(200),
  visibility: visibilityEnum.default("approved_employers"),
});

/* ------------------------------------------------------------------ */
/* Evidence Portfolio                                                  */
/* ------------------------------------------------------------------ */

export const engagementSchema = z
  .object({
    kind: z.enum(["role", "project", "venture", "advisory"]),
    title: reqText(160, "Name"),
    organisationName: optText(160),
    confidentiality: z.enum(["named", "anonymised"]).default("named"),
    anonymisedDescription: optText(200),
    roleTitle: optText(120),
    sector: optText(80),
    country: optText(80),
    startDate: optDate(),
    endDate: optDate(),
    isCurrent: bool(),
    status: z.enum(["ongoing", "completed", "paused", "discontinued"]).default("completed"),
    stageReached: optEnum(["introduction", "proposal", "contract_award", "execution", "completion"]),
    ventureStage: optEnum(["idea", "mvp", "revenue", "growth", "exit", "closed"]),
    context: optText(3000),
    responsibility: optText(2000),
    individualActions: optText(4000),
    teamContribution: optText(2000),
    outcomes: optText(3000),
    lessons: optText(2000),
    teamSize: optInt(0, 100000),
    valueCurrency: currency(),
    projectValue: optMoney(),
    revenueGenerated: optMoney(),
    budgetManaged: optMoney(),
    personallyAttributableValue: optMoney(),
    valueNotes: optText(1000),
    isSignature: bool(),
    visibility: visibilityEnum.default("approved_employers"),
    privateNotes: optText(2000),
    capabilityIds: z.array(z.string().uuid()).max(20).default([]),
  })
  .refine((v) => !v.startDate || !v.endDate || v.startDate <= v.endDate, { path: ["endDate"], message: "The end date must be after the start date." })
  .refine((v) => v.confidentiality === "named" || !!v.anonymisedDescription, {
    path: ["anonymisedDescription"],
    message: "Describe the organisation without naming it, for example 'a West African port operator'.",
  })
  .refine((v) => !(v.projectValue || v.revenueGenerated || v.budgetManaged || v.personallyAttributableValue) || !!v.valueCurrency, {
    path: ["valueCurrency"],
    message: "Choose the currency for the figures you entered.",
  });

export const claimSchema = z.object({
  engagementId: z.preprocess(blankToNull, z.string().uuid().nullable().optional()).transform((v) => v ?? null),
  claimType: z.enum(["outcome", "financial", "responsibility", "credential", "recognition", "other"]),
  text: reqText(600, "The claim"),
  achievedOn: optDate(),
  visibility: visibilityEnum.default("approved_employers"),
});

export const evidenceLinkSchema = z.object({
  title: reqText(160, "Title"),
  description: optText(600),
  url: optUrl().refine((v) => !!v, "Enter the link."),
  visibility: visibilityEnum.default("private"),
});

export const evidenceFileMetaSchema = z.object({
  title: reqText(160, "Title"),
  description: optText(600),
  isRedacted: bool(),
  redactionNote: optText(300),
  visibility: visibilityEnum.default("private"),
  claimId: z.preprocess(blankToNull, z.string().uuid().nullable().optional()).transform((v) => v ?? null),
});

export const learningRecordSchema = z.object({
  kind: z.enum(["course", "certification", "degree", "self_directed"]),
  title: reqText(160, "Title"),
  provider: optText(120),
  year: optInt(1950, 2100),
  takeaway: optText(1000),
  credentialUrl: optUrl(),
  visibility: visibilityEnum.default("approved_employers"),
});

export const publicWorkSchema = z.object({
  kind: z.enum(["writing", "talk", "podcast", "open_source", "community", "research", "other"]),
  title: reqText(200, "Title"),
  venue: optText(160),
  url: optUrl(),
  year: optInt(1950, 2100),
  description: optText(600),
  visibility: visibilityEnum.default("approved_employers"),
});

export const refereeSchema = z.object({
  name: reqText(120, "Name"),
  relationship: reqText(160, "Relationship"),
  organisation: optText(160),
  email: z.preprocess(blankToNull, z.string().trim().email("Enter a valid email address.").max(254).nullable().optional()).transform((v) => v ?? null),
  phone: optText(40),
  speaksTo: optText(400),
  consentToContact: bool(),
  visibility: visibilityEnum.default("private"),
});

/* ------------------------------------------------------------------ */
/* Sharing                                                             */
/* ------------------------------------------------------------------ */

export const shareLinkSchema = z.object({
  label: reqText(80, "Label"),
  expiresInDays: z.coerce.number().int().min(1).max(90),
  includeContact: bool(),
  includeEvidence: bool(),
});

/* ------------------------------------------------------------------ */
/* Employers                                                           */
/* ------------------------------------------------------------------ */

export const organisationSchema = z.object({
  name: reqText(160, "Organisation name"),
  website: optUrl(),
  country: optText(80),
  sector: optText(80),
  sizeBand: optEnum(["1-10", "11-50", "51-250", "251-1000", "1000+"]),
  description: optText(1500),
  registrationNote: optText(1000),
});

export const opportunitySchema = z
  .object({
    title: reqText(160, "Title"),
    engagementType: z.enum(["permanent", "fixed_term", "project", "fractional", "advisory"]),
    problemStatement: optText(3000),
    expectedOutcomes: optText(3000),
    responsibilities: optText(4000),
    experienceRequirements: optText(2000),
    requiredEvidence: optText(1500),
    locationText: optText(160),
    country: optText(80),
    workArrangement: optEnum(["remote", "hybrid", "on_site"]),
    timeZoneRequirements: optText(160),
    startDate: optDate(),
    durationText: optText(120),
    hoursPerWeek: optInt(1, 80),
    compensationCurrency: currency(),
    compensationMin: optMoney(),
    compensationMax: optMoney(),
    compensationPeriod: optEnum(["annual", "monthly", "daily", "hourly"]),
    selectionStages: stringList(10, 80),
    sectors: stringList(6, 80),
  })
  .refine((v) => !v.compensationMin || !v.compensationMax || Number(v.compensationMin) <= Number(v.compensationMax), {
    path: ["compensationMax"],
    message: "The upper figure must be at least the lower figure.",
  })
  .refine((v) => (!v.compensationMin && !v.compensationMax) || (v.compensationCurrency && v.compensationPeriod), {
    path: ["compensationCurrency"],
    message: "Choose a currency and period for the figures you entered.",
  });

export const requirementSchema = z.object({
  kind: z.enum(["capability", "evidence", "experience", "language", "other"]),
  label: reqText(160, "Requirement"),
  importance: z.enum(["essential", "desirable"]),
  minProficiency: optEnum(["aware", "practitioner", "advanced", "expert"]),
  notes: optText(400),
});

export const applicationSchema = z.object({
  opportunityId: z.string().uuid(),
  expressionOfInterest: reqText(2000, "Your expression of interest").refine((v) => v.length >= 40, "Write at least a couple of sentences (40 characters)."),
  includeContact: bool(),
  includeEvidence: bool(),
  confirm: bool().refine((v) => v, "Confirm that you have reviewed what will be shared."),
});

export const shortlistSchema = z.object({
  name: reqText(120, "Shortlist name"),
  description: optText(500),
  opportunityId: z.preprocess(blankToNull, z.string().uuid().nullable().optional()).transform((v) => v ?? null),
});

export const introductionSchema = z.object({
  profileId: z.string().uuid(),
  opportunityId: z.preprocess(blankToNull, z.string().uuid().nullable().optional()).transform((v) => v ?? null),
  applicationId: z.preprocess(blankToNull, z.string().uuid().nullable().optional()).transform((v) => v ?? null),
  message: reqText(1500, "Your message").refine((v) => v.length >= 30, "Explain briefly why you would like an introduction (30+ characters)."),
});

/* ------------------------------------------------------------------ */
/* Administration                                                      */
/* ------------------------------------------------------------------ */

export const reasonSchema = reqText(1000, "A reason").refine((v) => v.length >= 10, "Give a reason of at least 10 characters. It is kept in the audit record.");

export const verificationReviewSchema = z.object({
  claimId: z.string().uuid(),
  decision: z.enum(["independently_verified", "clarification_requested", "not_verified"]),
  method: z.enum(["document_review", "reference_check", "public_record", "issuer_confirmation", "other"]),
  scope: reqText(1000, "What was checked").refine((v) => v.length >= 20, "Describe what was checked and how (20+ characters)."),
  evidenceIdsReviewed: z.array(z.string().uuid()).default([]),
  noteToCandidate: optText(1000),
  reason: reasonSchema,
});

export const reportSchema = z.object({
  targetType: z.enum(["profile", "opportunity", "organisation"]),
  targetId: z.string().uuid(),
  category: z.enum(["inaccurate", "inappropriate", "impersonation", "discriminatory", "spam", "other"]),
  details: optText(1500),
});

/* ------------------------------------------------------------------ */
/* FormData helpers                                                    */
/* ------------------------------------------------------------------ */

/** Converts FormData to a plain object. Keys listed in `arrays` are read with getAll. */
export function formToObject(form: FormData, arrays: string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of new Set(form.keys())) {
    if (key.startsWith("$ACTION")) continue;
    out[key] = arrays.includes(key) ? form.getAll(key).map(String) : form.get(key);
  }
  for (const key of arrays) if (!(key in out)) out[key] = [];
  return out;
}

export function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    if (!errors[key]) errors[key] = issue.message;
  }
  return errors;
}
