/**
 * Controlled vocabularies and the profile module definitions.
 * Labels are product language; values are stable identifiers stored in the database.
 */

export const opportunityTypes = [
  { value: "permanent", label: "Permanent employment" },
  { value: "fixed_term", label: "Fixed-term role" },
  { value: "project", label: "Project assignment" },
  { value: "fractional", label: "Fractional role" },
  { value: "advisory", label: "Advisory work" },
] as const;
export type OpportunityType = (typeof opportunityTypes)[number]["value"];

export const workArrangements = [
  { value: "remote", label: "Remote" },
  { value: "hybrid", label: "Hybrid" },
  { value: "on_site", label: "On site" },
] as const;
export type WorkArrangement = (typeof workArrangements)[number]["value"];

export const availabilityStatuses = [
  { value: "available_now", label: "Available now" },
  { value: "available_from", label: "Available from a date" },
  { value: "open_to_conversations", label: "Open to conversations" },
  { value: "not_available", label: "Not currently available" },
] as const;
export type AvailabilityStatus = (typeof availabilityStatuses)[number]["value"];

export const relocationOptions = [
  { value: "no", label: "Not open to relocation" },
  { value: "open", label: "Open to relocation" },
  { value: "travel_only", label: "Open to travel, not relocation" },
] as const;

export const compensationPeriods = [
  { value: "annual", label: "per year" },
  { value: "monthly", label: "per month" },
  { value: "daily", label: "per day" },
  { value: "hourly", label: "per hour" },
] as const;
export type CompensationPeriod = (typeof compensationPeriods)[number]["value"];

export const currencies = ["USD", "EUR", "GBP", "NGN", "GHS", "KES", "ZAR", "EGP", "MAD", "XOF", "XAF", "RWF", "ETB", "TZS", "UGX"] as const;

/** Primary professional area; used only to choose helpful prompts, never for ranking. */
export const roleFamilies = [
  { value: "business_development", label: "Business development and partnerships" },
  { value: "investment", label: "Investment and finance" },
  { value: "infrastructure", label: "Infrastructure and projects" },
  { value: "operations", label: "Operations and supply chain" },
  { value: "technology", label: "Technology and data" },
  { value: "risk_compliance", label: "Risk, compliance and governance" },
  { value: "other", label: "Another field" },
] as const;
export type RoleFamily = (typeof roleFamilies)[number]["value"];

export const sectors = [
  "Agriculture and food",
  "Banking and financial services",
  "Construction and engineering",
  "Development and public sector",
  "Education",
  "Energy and renewables",
  "Healthcare and life sciences",
  "Insurance",
  "Logistics, ports and maritime",
  "Manufacturing",
  "Media and creative",
  "Mining and natural resources",
  "Oil and gas",
  "Private equity and venture capital",
  "Professional services",
  "Real estate",
  "Technology and telecoms",
  "Transport",
  "Water and sanitation",
] as const;

export const capabilityCategories = [
  { value: "domain", label: "Domain expertise" },
  { value: "functional", label: "Functional skill" },
  { value: "technical", label: "Technical or tool skill" },
  { value: "leadership", label: "Leadership and people" },
  { value: "language", label: "Language" },
] as const;
export type CapabilityCategory = (typeof capabilityCategories)[number]["value"];

/** Proficiency is separate from category. Self-rated and assessed levels use the same scale but are stored separately. */
export const proficiencyLevels = [
  { value: "aware", label: "Aware", rank: 1, help: "Working familiarity; can collaborate with specialists." },
  { value: "practitioner", label: "Practitioner", rank: 2, help: "Does this regularly and independently." },
  { value: "advanced", label: "Advanced", rank: 3, help: "Handles complex cases; others seek your view." },
  { value: "expert", label: "Expert", rank: 4, help: "Among the strongest people in the room on this." },
] as const;
export type Proficiency = (typeof proficiencyLevels)[number]["value"];
export const proficiencyRank = (p: Proficiency | null | undefined) => proficiencyLevels.find((l) => l.value === p)?.rank ?? 0;

export const capabilityTiers = [
  { value: "core", label: "Core expertise", help: "Two to four areas you are known for." },
  { value: "strong", label: "Strong capability", help: "You perform at a high level but would defer to a deep specialist." },
  { value: "working", label: "Working knowledge", help: "Enough to collaborate effectively; not a claimed strength." },
] as const;
export type CapabilityTier = (typeof capabilityTiers)[number]["value"];

export const engagementKinds = [
  { value: "role", label: "Role" },
  { value: "project", label: "Project" },
  { value: "venture", label: "Venture" },
  { value: "advisory", label: "Advisory or board" },
] as const;

/** Deal or project stages are kept separate so "facilitated" is never read as "delivered". */
export const engagementStages = [
  { value: "introduction", label: "Introduction" },
  { value: "proposal", label: "Proposal" },
  { value: "contract_award", label: "Contract award" },
  { value: "execution", label: "Execution" },
  { value: "completion", label: "Completion" },
] as const;

export const ventureStages = [
  { value: "idea", label: "Idea" },
  { value: "mvp", label: "Early product" },
  { value: "revenue", label: "Revenue" },
  { value: "growth", label: "Growth" },
  { value: "exit", label: "Exit" },
  { value: "closed", label: "Closed" },
] as const;

export const claimTypes = [
  { value: "outcome", label: "Outcome or result" },
  { value: "financial", label: "Financial figure" },
  { value: "responsibility", label: "Responsibility or scope" },
  { value: "credential", label: "Credential or qualification" },
  { value: "recognition", label: "Award or recognition" },
  { value: "other", label: "Other" },
] as const;

export const verificationStatuses = [
  { value: "self_reported", label: "Self-reported", help: "Stated by the professional. No supporting evidence attached yet." },
  { value: "evidence_supplied", label: "Evidence supplied", help: "Supporting material attached by the professional. Not independently checked." },
  { value: "independently_verified", label: "Independently verified", help: "Checked by a platform reviewer. The review records what was checked and how." },
  { value: "clarification_requested", label: "Clarification requested", help: "A reviewer has asked for more detail before a decision." },
] as const;
export type VerificationStatus = (typeof verificationStatuses)[number]["value"];

export const verificationMethods = [
  { value: "document_review", label: "Document review" },
  { value: "reference_check", label: "Reference confirmation (with candidate consent)" },
  { value: "public_record", label: "Public record or publication" },
  { value: "issuer_confirmation", label: "Confirmation from issuing organisation" },
  { value: "other", label: "Other (described in scope)" },
] as const;

export const learningKinds = [
  { value: "course", label: "Course or programme" },
  { value: "certification", label: "Certification or credential" },
  { value: "degree", label: "Degree" },
  { value: "self_directed", label: "Self-directed study" },
] as const;

export const publicWorkKinds = [
  { value: "writing", label: "Published writing" },
  { value: "talk", label: "Presentation or talk" },
  { value: "podcast", label: "Podcast" },
  { value: "open_source", label: "Open-source or code" },
  { value: "community", label: "Community built or led" },
  { value: "research", label: "Research, data or tools" },
  { value: "other", label: "Other public work" },
] as const;

export const motivationOptions = ["Autonomy", "Impact", "Mastery", "Financial reward", "Mission", "Recognition", "Relationships", "Security"] as const;

export const applicationStatuses = [
  { value: "submitted", label: "Submitted" },
  { value: "in_review", label: "In review" },
  { value: "shortlisted", label: "Shortlisted" },
  { value: "introduction_requested", label: "Introduction requested" },
  { value: "interviewing", label: "In conversation" },
  { value: "offer", label: "Offer made" },
  { value: "not_progressing", label: "Not progressing" },
  { value: "withdrawn", label: "Withdrawn by candidate" },
] as const;
export type ApplicationStatus = (typeof applicationStatuses)[number]["value"];

export const reportCategories = [
  { value: "inaccurate", label: "Inaccurate or misleading" },
  { value: "inappropriate", label: "Inappropriate content" },
  { value: "impersonation", label: "Impersonation" },
  { value: "discriminatory", label: "Discriminatory requirement or language" },
  { value: "spam", label: "Spam or scam" },
  { value: "other", label: "Other" },
] as const;

export function labelOf<T extends readonly { value: string; label: string }[]>(list: T, value: string | null | undefined): string {
  if (!value) return "Not provided";
  return list.find((i) => i.value === value)?.label ?? value;
}

/* ------------------------------------------------------------------ */
/* Profile modules                                                     */
/* ------------------------------------------------------------------ */

export type QuestionType = "long_text" | "short_text" | "scale" | "ranking";

export interface ModuleQuestion {
  key: string;
  label: string;
  help?: string;
  type: QuestionType;
  /** Optional role-specific prompt shown alongside the general help text. */
  roleHints?: Partial<Record<RoleFamily, string>>;
  maxWords?: number;
}

export interface ProfileModule {
  key: string;
  number: number;
  title: string;
  intro: string;
  /** Structured records managed elsewhere (e.g. projects) that belong to this module. */
  linkedRecords?: { label: string; href: string }[];
  questions: ModuleQuestion[];
  /** Answers are shown to employers but never used for search filters or ordering. */
  excludedFromMatching?: boolean;
}

export const profileModules: ProfileModule[] = [
  {
    key: "narrative",
    number: 1,
    title: "Professional narrative",
    intro: "Your thesis statement in your own words. Be specific about what you do and for whom.",
    questions: [
      {
        key: "core",
        label: "Who are you professionally, and what sits at the core of your expertise?",
        type: "long_text",
        maxWords: 200,
        roleHints: {
          business_development: "Name the markets, client types and deal sizes you work with.",
          investment: "Name the asset classes, stages and ticket sizes you know best.",
          infrastructure: "Name the asset types and the project phases you are strongest in.",
          technology: "Name the systems, scale and kinds of users you have built for.",
          risk_compliance: "Name the regulatory regimes and risk types you handle.",
          operations: "Name the operations you have run and their scale.",
        },
      },
      { key: "problems", label: "What kinds of problems do you solve, and for whom?", type: "long_text", maxWords: 150 },
      { key: "direction", label: "What direction are you heading in, and why?", type: "long_text", maxWords: 120 },
    ],
  },
  {
    key: "value_creation",
    number: 2,
    title: "Value creation record",
    intro: "Your most significant roles and what measurably changed because of your contribution. Each role is a structured record in your Evidence Portfolio.",
    linkedRecords: [{ label: "Manage roles and engagements", href: "/talent/portfolio" }],
    questions: [
      {
        key: "pattern",
        label: "Across your roles, where has your personal contribution most clearly changed results?",
        help: "Separate what you did from what your team or organisation did.",
        type: "long_text",
        maxWords: 150,
      },
    ],
  },
  {
    key: "signature_projects",
    number: 3,
    title: "Signature projects",
    intro: "Three to five projects that show the range and depth of your work, including what you learned from things that did not go to plan. Mark projects as signature projects in your Evidence Portfolio.",
    linkedRecords: [{ label: "Manage projects", href: "/talent/portfolio" }],
    questions: [],
  },
  {
    key: "capability_stack",
    number: 4,
    title: "Capability stack",
    intro: "Your capabilities in three tiers, each with a self-rated proficiency. Assessed proficiency is recorded separately if a reviewer assesses it.",
    linkedRecords: [{ label: "Manage capabilities", href: "/talent/capabilities" }],
    questions: [],
  },
  {
    key: "ai_fluency",
    number: 5,
    title: "AI fluency",
    intro: "How AI has changed the quality, speed or scope of your work, and how you check its output. Specific examples are more useful than lists of tools.",
    questions: [
      { key: "tools", label: "Which AI tools do you use regularly, and for what specific purposes?", type: "long_text", maxWords: 150 },
      {
        key: "examples",
        label: "Give one or two examples where AI materially improved your work. What would the same task have looked like two years ago?",
        help: "Describe the task, what AI contributed, what you contributed and what the result was.",
        type: "long_text",
        maxWords: 200,
      },
      { key: "quality_control", label: "How do you check AI outputs? Where do you not trust AI, and why?", type: "long_text", maxWords: 150 },
      { key: "outlook", label: "How do you expect AI to reshape your field over the next three to five years?", type: "long_text", maxWords: 150 },
    ],
  },
  {
    key: "learning",
    number: 6,
    title: "Learning and development",
    intro: "Your relationship with learning, not a list of credentials. Courses and certifications are recorded as structured learning records.",
    linkedRecords: [{ label: "Manage learning records", href: "/talent/learning" }],
    questions: [
      {
        key: "self_taught",
        label: "What is the most significant skill or domain you have taught yourself in the past two years? How did you do it?",
        help: "Method, timeline, how you knew you had acquired it, and how you have applied it.",
        type: "long_text",
        maxWords: 200,
      },
      { key: "changed_mind", label: "What professional belief have you changed your mind about in the past year, and why?", type: "long_text", maxWords: 150 },
    ],
  },
  {
    key: "problem_solving",
    number: 7,
    title: "Problem-solving examples",
    intro: "How you reason through problems. The quality of the reasoning matters more than the scale of the problem.",
    questions: [
      { key: "novel", label: "Describe a problem with no obvious precedent. How did you develop your approach?", type: "long_text", maxWords: 200 },
      { key: "wrong_first", label: "Describe a time your initial approach was wrong. How did you realise, and what did you do?", type: "long_text", maxWords: 200 },
      { key: "complex_decision", label: "Describe a complex decision you made. What did you know, what were the trade-offs, and what would you do differently?", type: "long_text", maxWords: 200 },
    ],
  },
  {
    key: "leadership",
    number: 8,
    title: "Leadership and influence",
    intro: "Formal authority and informal influence. Examples of shaping a decision without positional power are often the most revealing.",
    questions: [
      { key: "formal", label: "What formal leadership have you held? Team size, scope, outcomes and what you built.", type: "long_text", maxWords: 150 },
      { key: "informal", label: "Describe a time you drove change or influenced an important decision without formal authority.", type: "long_text", maxWords: 200 },
      { key: "adversity", label: "Describe leading through adversity, uncertainty or failure. What did you learn about yourself?", type: "long_text", maxWords: 200 },
      { key: "philosophy", label: "Your leadership philosophy, in no more than 150 words.", type: "long_text", maxWords: 150 },
    ],
  },
  {
    key: "collaboration",
    number: 9,
    title: "Collaboration preferences",
    intro: "How you work with teams, stakeholders, clients and partners. Self-awareness is more useful than a perfect record.",
    questions: [
      { key: "described_as", label: "How would close collaborators describe your working style?", type: "long_text", maxWords: 120 },
      { key: "effective", label: "Describe an effective cross-functional collaboration. What made it work?", type: "long_text", maxWords: 150 },
      { key: "difficult", label: "Describe a difficult collaboration. What was your part in the difficulty, and what did you learn?", type: "long_text", maxWords: 150 },
      { key: "environments", label: "Which team environments bring out your best work, and which drain you?", type: "long_text", maxWords: 120 },
    ],
  },
  {
    key: "adaptability",
    number: 10,
    title: "Adaptability",
    intro: "Evidence of how you have responded to change: market shifts, reorganisations or personal pivots.",
    questions: [
      { key: "disruption", label: "What is the most significant professional disruption you have navigated? How did you respond?", type: "long_text", maxWords: 200 },
      { key: "new_domain", label: "Describe a time you became effective in an unfamiliar domain or context. How did you get up to speed?", type: "long_text", maxWords: 150 },
      { key: "obsolete", label: "Describe an approach or belief that external change made obsolete. How did you respond?", type: "long_text", maxWords: 150 },
      {
        key: "ambiguity_rating",
        label: "How comfortable are you operating where the path forward is unclear? (1 = very uncomfortable, 5 = energised by it)",
        help: "This is your own rating. It is shown with your example and never used to rank you.",
        type: "scale",
      },
      { key: "ambiguity_example", label: "One example that supports your rating.", type: "long_text", maxWords: 120 },
    ],
  },
  {
    key: "entrepreneurship",
    number: 11,
    title: "Entrepreneurial and intrapreneurial experience",
    intro: "Anything you started or built: a business, a community, a product or an internal initiative, including ones that did not succeed. Ventures are recorded in your Evidence Portfolio.",
    linkedRecords: [{ label: "Add a venture", href: "/talent/portfolio/new?kind=venture" }],
    questions: [
      { key: "intrapreneurial", label: "Have you driven a significant initiative inside an organisation without a formal mandate?", type: "long_text", maxWords: 150 },
      { key: "investing_advisory", label: "Have you made early-stage investments or taken advisory roles in growing businesses?", type: "long_text", maxWords: 120 },
    ],
  },
  {
    key: "public_work",
    number: 12,
    title: "Public work and portfolios",
    intro: "Public evidence of your knowledge or contribution: writing, talks, code, communities and research. Consistency and depth matter more than audience size.",
    linkedRecords: [{ label: "Manage public work", href: "/talent/public-work" }],
    questions: [],
  },
  {
    key: "values",
    number: 13,
    title: "Professional values and motivations",
    intro: "What drives your decisions. These answers can be shown to employers you approve, but they are never used to filter, rank or match you.",
    excludedFromMatching: true,
    questions: [
      { key: "values", label: "Your three to five core professional values. For each, a decision it influenced.", type: "long_text", maxWords: 250 },
      { key: "motivations", label: "Order what motivates you, most important first.", type: "ranking" },
      { key: "motivations_why", label: "Why do your top two motivations matter to you?", type: "long_text", maxWords: 120 },
      { key: "sustain", label: "What do you need from a role and organisation to sustain your best work over several years?", type: "long_text", maxWords: 150 },
    ],
  },
  {
    key: "career_direction",
    number: 14,
    title: "Career direction and development goals",
    intro: "A grounded view of where you are heading and the capabilities you are developing.",
    questions: [
      { key: "horizon", label: "Where are you heading over the next five to ten years, and why is that the right direction for you?", type: "long_text", maxWords: 200 },
      { key: "developing", label: "Which capabilities are you actively developing now, and what will they enable?", type: "long_text", maxWords: 150 },
      { key: "accelerate", label: "What kind of role, team or organisation would most accelerate your development?", type: "long_text", maxWords: 150 },
      { key: "unconventional", label: "Is anything about your path unconventional or worth explaining directly?", help: "Career changes, gaps or non-linear paths, in your own words.", type: "long_text", maxWords: 150 },
    ],
  },
  {
    key: "references",
    number: 15,
    title: "References",
    intro: "Two or three people who can speak to specific parts of your work. Reference contact details are private, and nobody contacts a reference without your consent.",
    linkedRecords: [{ label: "Manage references", href: "/talent/references" }],
    questions: [],
  },
];

export const moduleByKey = (key: string) => profileModules.find((m) => m.key === key);
