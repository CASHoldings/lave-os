/**
 * Fictional demonstration data. Every person, organisation, project and figure here is
 * invented for demonstration. Nothing is taken from real candidate records.
 * Demo accounts have no passwords: they can only be entered through demo sign-in,
 * which exists only in local demo mode.
 */
import { count, eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { capabilities, claims, organisationMemberships, organisations, users, talentProfiles, opportunities } from "@/server/db/schema";
import { loadActor, type Actor } from "@/server/policy/actor";
import { saveModuleAnswer, saveOwnedRecord, saveProfileSection, upsertProfileCapability, updateVisibilitySettings, slugify } from "@/server/services/profile";
import { saveClaim, saveEngagement, uploadEvidenceFile, addEvidenceLink, requestVerification } from "@/server/services/portfolio";
import { addRequirement, saveOpportunity, setOpportunityStatus } from "@/server/services/employer";
import { addApplicationNote, addToShortlist, applyToOpportunity, createShortlist, requestIntroduction, setApplicationStatus } from "@/server/services/applications";
import { recordVerificationReview, createReport } from "@/server/services/admin";
import { createShareLink } from "@/server/services/sharing";

export const DEMO_EMAIL_DOMAIN = "demo.invalid";

export async function isDatabaseEmpty() {
  const [{ n }] = await getDb().select({ n: count() }).from(users);
  return n === 0;
}

const curatedCapabilities: [string, (typeof capabilities.$inferInsert)["category"]][] = [
  ["Project finance", "domain"],
  ["Infrastructure PPPs", "domain"],
  ["Financial modelling", "functional"],
  ["Due diligence", "functional"],
  ["Investment analysis", "functional"],
  ["Portfolio management", "functional"],
  ["Fundraising", "functional"],
  ["Impact measurement", "functional"],
  ["Environmental and social governance (ESG)", "domain"],
  ["Business development", "functional"],
  ["Partnership development", "functional"],
  ["Stakeholder engagement", "functional"],
  ["Government relations", "functional"],
  ["Contract negotiation", "functional"],
  ["Procurement", "functional"],
  ["Supply chain management", "functional"],
  ["Logistics", "functional"],
  ["Fleet management", "functional"],
  ["Port operations", "domain"],
  ["Mining operations", "domain"],
  ["Health and safety management", "functional"],
  ["Operations management", "functional"],
  ["Programme management", "functional"],
  ["Change management", "leadership"],
  ["Team leadership", "leadership"],
  ["Anti-money laundering (AML)", "domain"],
  ["Sanctions compliance", "domain"],
  ["Customer due diligence (KYC)", "functional"],
  ["Regulatory compliance", "domain"],
  ["Enterprise risk management", "domain"],
  ["Credit risk", "domain"],
  ["Internal audit", "functional"],
  ["Digital payments", "domain"],
  ["Renewable energy development", "domain"],
  ["Power purchase agreements", "domain"],
  ["Water and sanitation", "domain"],
  ["Agricultural value chains", "domain"],
  ["Public policy", "domain"],
  ["Market research", "functional"],
  ["Data engineering", "technical"],
  ["Machine learning", "technical"],
  ["Cloud architecture", "technical"],
  ["Data governance", "technical"],
  ["Product management", "functional"],
  ["Software engineering", "technical"],
  ["Python", "technical"],
  ["SQL", "technical"],
  ["English", "language"],
  ["French", "language"],
  ["Portuguese", "language"],
  ["Arabic", "language"],
  ["Kiswahili", "language"],
  ["Amharic", "language"],
  ["isiZulu", "language"],
  ["Wolof", "language"],
];

/** Builds a small, valid one-page PDF so demo downloads open normally. */
export function demoPdf(lines: string[]): Uint8Array {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const text = lines.map((l, i) => `BT /F1 ${i === 0 ? 16 : 11} Tf 60 ${760 - i * 22} Td (${esc(l)}) Tj ET`).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

const demoFile = (title: string, lines: string[]) => ({
  name: `${slugify(title)}.pdf`,
  type: "application/pdf",
  bytes: demoPdf(["FICTIONAL DEMONSTRATION DOCUMENT", title, ...lines, "", "This file was generated for the demo. It is not a real record."]),
});

async function demoUser(displayName: string, local: string, accountType: "talent" | "employer", admin = false): Promise<Actor> {
  const db = getDb();
  const [user] = await db
    .insert(users)
    .values({
      email: `${local}@${DEMO_EMAIL_DOMAIN}`,
      displayName,
      accountType,
      authProvider: "demo",
      passwordHash: null,
      isDemo: true,
      platformRole: admin ? "admin" : "member",
    })
    .returning({ id: users.id });
  if (accountType === "talent") await db.insert(talentProfiles).values({ userId: user.id, fullName: displayName, isDemo: true });
  return (await loadActor(user.id))!;
}

async function demoOrg(name: string, status: "approved" | "pending", fields: Partial<typeof organisations.$inferInsert>, owner: Actor, members: Actor[] = []) {
  const db = getDb();
  const [org] = await db
    .insert(organisations)
    .values({ name, status, isDemo: true, createdBy: owner.userId, reviewedAt: status === "approved" ? new Date() : null, reviewReason: status === "approved" ? "Demonstration organisation." : null, ...fields })
    .returning({ id: organisations.id });
  await db.insert(organisationMemberships).values({ organisationId: org.id, userId: owner.userId, role: "owner" });
  for (const m of members) await db.insert(organisationMemberships).values({ organisationId: org.id, userId: m.userId, role: "member" });
  return org.id;
}

const reload = async (a: Actor) => (await loadActor(a.userId))!;

export async function seedDemoData() {
  const db = getDb();
  for (const [name, category] of curatedCapabilities) {
    await db.insert(capabilities).values({ name, slug: slugify(name), category, curated: true }).onConflictDoNothing();
  }

  /* ----------------------------- Admin ------------------------------ */
  const admin = await demoUser("Platform Reviewer (demo)", "reviewer", "employer", true);

  /* --------------------------- Talent 1 ----------------------------- */
  // Efua: infrastructure finance, complete profile, discoverable, one verified claim.
  let efua = await demoUser("Efua Mensah-Bonsu", "efua", "talent");
  await saveProfileSection(efua, "basics", { fullName: "Efua Mensah-Bonsu", preferredName: "Efua", headline: "Infrastructure finance lead: ports, power and PPP structuring", roleFamily: "investment", yearsExperience: "14" });
  await saveProfileSection(efua, "location", { locationCity: "Accra", locationCountry: "Ghana", timeZone: "GMT (UTC+0)", languages: ["English", "French", "Twi"] });
  await saveProfileSection(efua, "introduction", {
    introduction:
      "I structure and close long-term financing for infrastructure assets, mainly ports and power, from feasibility through financial close. My work sits between sponsors, development finance institutions and governments: I build the financial case, negotiate the risk allocation and keep complex lender groups moving to signature.",
    sectors: ["Logistics, ports and maritime", "Energy and renewables", "Development and public sector"],
  });
  await saveProfileSection(efua, "preferences", { opportunityTypes: ["permanent", "advisory", "project"], workArrangements: ["hybrid", "remote"], relocation: "travel_only", geographicPreferences: "West Africa based; regular travel across the continent is fine." });
  await saveProfileSection(efua, "availability", { availabilityStatus: "available_from", availableFrom: "2027-01-15", noticePeriodWeeks: "8" });
  await saveProfileSection(efua, "compensation", { compensationCurrency: "USD", compensationMin: "140000", compensationMax: "175000", compensationPeriod: "annual", compensationVisibility: "approved_employers" });
  await saveProfileSection(efua, "contact", { contactEmail: "efua.contact@demo.invalid", contactPhone: "+000 000 0001", linkedinUrl: "https://www.example.org/efua-demo" });
  for (const [name, tier, level, years] of [
    ["Project finance", "core", "expert", "12"],
    ["Infrastructure PPPs", "core", "advanced", "9"],
    ["Financial modelling", "core", "expert", "14"],
    ["Contract negotiation", "strong", "advanced", "10"],
    ["Stakeholder engagement", "strong", "advanced", "10"],
    ["Environmental and social governance (ESG)", "working", "practitioner", "4"],
  ] as const) {
    await upsertProfileCapability(efua, { name, category: "functional", tier, selfProficiency: level, yearsExperience: years });
  }
  efua = await reload(efua);
  const capId = async (name: string) => (await db.select({ id: capabilities.id }).from(capabilities).where(eq(capabilities.slug, slugify(name))))[0].id;

  const portEng = await saveEngagement(efua, {
    kind: "project",
    title: "Container terminal expansion financing",
    confidentiality: "anonymised",
    organisationName: "Fictional terminal concessionaire",
    anonymisedDescription: "a West African container terminal concessionaire",
    roleTitle: "Lead financial adviser (sponsor side)",
    sector: "Logistics, ports and maritime",
    country: "Ghana",
    startDate: "2021-03-01",
    endDate: "2023-06-30",
    status: "completed",
    stageReached: "completion",
    context: "The concessionaire needed to fund a second berth and new cranes while traffic forecasts were being revised after the pandemic.",
    responsibility: "Accountable for the financing plan, lender process and the financial model used by all parties.",
    individualActions: "Built and maintained the project finance model; ran the lender competition; negotiated the debt service reserve and traffic-risk sharing terms; prepared the credit papers for two development lenders.",
    teamContribution: "Legal, technical and insurance advisers covered their workstreams; the sponsor's treasury team owned hedging.",
    outcomes: "Financial close reached in June 2023 with three lenders. The traffic-risk mechanism I proposed was adopted in the final term sheet.",
    lessons: "I started lender engagement before the traffic study was final; it cost us two months of re-runs. I now sequence the market study first.",
    teamSize: "6",
    valueCurrency: "USD",
    projectValue: "310000000",
    budgetManaged: "2400000",
    valueNotes: "Project value is the total capital cost. The budget figure is the advisory budget I managed. No revenue figure applies.",
    isSignature: true,
    capabilityIds: [await capId("Project finance"), await capId("Financial modelling"), await capId("Contract negotiation")],
  });
  const portClaim = await saveClaim(efua, { engagementId: portEng, claimType: "outcome", text: "Led the lender process to financial close for a USD 310m terminal expansion with three lenders.", achievedOn: "2023-06-30" });
  const closingCert = await uploadEvidenceFile(efua, { title: "Redacted financial close notice", description: "Lender agent notice confirming conditions precedent satisfied. Lender names and amounts per lender redacted.", isRedacted: true, redactionNote: "Lender names and individual commitments removed.", visibility: "approved_employers", claimId: portClaim }, demoFile("Redacted financial close notice", ["Financial close notice (redacted)", "Project: container terminal expansion (fictional)", "Date: 30 June 2023"]));
  await saveClaim(efua, { engagementId: portEng, claimType: "responsibility", text: "Personally built and owned the project finance model relied on by sponsor and lenders." });
  await addEvidenceLink(efua, { title: "Conference talk: allocating traffic risk in port PPPs", url: "https://www.example.org/demo-talk-port-risk", visibility: "approved_employers" });

  const solarEng = await saveEngagement(efua, {
    kind: "project",
    title: "Utility-scale solar tender support",
    confidentiality: "anonymised",
    anonymisedDescription: "a national energy ministry in West Africa",
    roleTitle: "Financial workstream lead",
    sector: "Energy and renewables",
    startDate: "2019-01-01",
    endDate: "2020-08-31",
    status: "discontinued",
    stageReached: "proposal",
    context: "A competitive tender for 50 MW of solar capacity, run by the ministry with donor funding.",
    individualActions: "Designed the bid evaluation model and the tariff benchmarking; drafted the financial sections of the request for proposals.",
    outcomes: "The tender reached the proposal stage; the programme was paused after a change of government, before contract award.",
    lessons: "Political sponsorship matters more than the quality of the documents. I now map decision-makers before the technical work starts.",
    valueCurrency: "USD",
    projectValue: "55000000",
    capabilityIds: [await capId("Infrastructure PPPs"), await capId("Financial modelling")],
  });
  await saveClaim(efua, { engagementId: solarEng, claimType: "responsibility", text: "Designed the tariff benchmarking used to evaluate bids for a 50 MW solar tender." });
  await saveModuleAnswer(efua, { moduleKey: "narrative", questionKey: "core", answer: "I make infrastructure projects bankable. The core of my expertise is translating an asset's risks into a financing structure that lenders, sponsors and governments can all sign." });
  await saveModuleAnswer(efua, { moduleKey: "ai_fluency", questionKey: "quality_control", answer: "I use AI to draft first versions of credit memo sections and to check model logic descriptions. I never let it produce numbers that go into a model; every figure is traced to a source cell." });
  await saveModuleAnswer(efua, { moduleKey: "values", questionKey: "values", answer: "Candour with lenders: I disclosed a traffic forecast downgrade early in 2022, which delayed close but kept the lender group's trust.", visibility: "approved_employers" });
  await saveOwnedRecord(efua, "learning", { kind: "certification", title: "Infrastructure finance certificate (fictional programme)", provider: "Demonstration Institute", year: "2022", takeaway: "Sharpened my approach to construction risk allocation." });
  await saveOwnedRecord(efua, "referee", { name: "Kwesi Appiah (fictional)", relationship: "Former managing director, advisory firm", organisation: "Fictional advisory firm", email: "kwesi.reference@demo.invalid", speaksTo: "My lender negotiations on the terminal financing.", consentToContact: true, visibility: "approved_employers" });
  await updateVisibilitySettings(efua, { visibility: "approved_employers", contactVisibility: "on_introduction", evidenceVisibility: "approved_employers" });
  await requestVerification(efua, portClaim);
  await recordVerificationReview(admin, {
    claimId: portClaim,
    decision: "independently_verified",
    method: "document_review",
    scope: "Checked the redacted financial close notice: project description, close date and the candidate's firm named as financial adviser. Did not check individual lender amounts.",
    evidenceIdsReviewed: [closingCert],
    noteToCandidate: "Verified against the close notice. Lender amounts were redacted and are outside the scope of this check.",
    reason: "Notice matches the claim's project, date and role.",
  });

  /* --------------------------- Talent 2 ----------------------------- */
  let tendai = await demoUser("Tendai Moyo", "tendai", "talent");
  await saveProfileSection(tendai, "basics", { fullName: "Tendai Moyo", headline: "Mining operations and supply chain manager; fractional COO for mid-tier mines", roleFamily: "operations", yearsExperience: "16" });
  await saveProfileSection(tendai, "location", { locationCity: "Johannesburg", locationCountry: "South Africa", timeZone: "SAST (UTC+2)", languages: ["English", "Shona", "isiZulu"] });
  await saveProfileSection(tendai, "introduction", { introduction: "I run mine-site operations and the supply chains behind them. I have improved fleet availability, cut inbound logistics costs and led safety turnarounds at open-pit operations in Zimbabwe and South Africa.", sectors: ["Mining and natural resources", "Logistics, ports and maritime"] });
  await saveProfileSection(tendai, "preferences", { opportunityTypes: ["fractional", "project", "advisory"], workArrangements: ["hybrid", "on_site"], relocation: "travel_only" });
  await saveProfileSection(tendai, "availability", { availabilityStatus: "available_now", hoursPerWeek: "20" });
  await saveProfileSection(tendai, "compensation", { compensationCurrency: "ZAR", compensationMin: "9000", compensationMax: "12000", compensationPeriod: "daily", compensationVisibility: "approved_employers" });
  for (const [name, tier, level] of [
    ["Mining operations", "core", "expert"],
    ["Supply chain management", "core", "advanced"],
    ["Fleet management", "core", "expert"],
    ["Health and safety management", "strong", "advanced"],
    ["Procurement", "strong", "advanced"],
    ["Team leadership", "strong", "advanced"],
  ] as const) await upsertProfileCapability(tendai, { name, category: "functional", tier, selfProficiency: level });
  tendai = await reload(tendai);
  const fleetEng = await saveEngagement(tendai, {
    kind: "role",
    title: "Operations manager, open-pit platinum operation",
    confidentiality: "anonymised",
    anonymisedDescription: "a mid-tier platinum producer in South Africa",
    roleTitle: "Operations manager",
    sector: "Mining and natural resources",
    startDate: "2018-02-01",
    endDate: "2024-03-31",
    status: "completed",
    individualActions: "Introduced a daily fleet availability review; renegotiated the tyre and parts supply contract; led the safety stand-down after two serious incidents.",
    teamContribution: "Maintenance and safety teams carried out the changes; I set targets and ran the reviews.",
    outcomes: "Haul fleet availability rose from 71% to 86% over 18 months; lost-time injuries fell by half over two years.",
    teamSize: "240",
    valueCurrency: "ZAR",
    budgetManaged: "380000000",
    isSignature: true,
    capabilityIds: [await capId("Fleet management"), await capId("Mining operations"), await capId("Health and safety management")],
  });
  const tendaiClaim = await saveClaim(tendai, { engagementId: fleetEng, claimType: "outcome", text: "Raised haul fleet availability from 71% to 86% within 18 months." });
  await uploadEvidenceFile(tendai, { title: "Monthly operations report extract", description: "Fleet availability chart, site name removed.", isRedacted: true, visibility: "private", claimId: tendaiClaim }, demoFile("Monthly operations report extract", ["Fleet availability by month (fictional)", "Site name redacted"]));
  await updateVisibilitySettings(tendai, { visibility: "approved_employers", contactVisibility: "on_introduction", evidenceVisibility: "private" });

  /* --------------------------- Talent 3 ----------------------------- */
  let wanjiru = await demoUser("Wanjiru Kariuki", "wanjiru", "talent");
  await saveProfileSection(wanjiru, "basics", { fullName: "Wanjiru Kariuki", headline: "Financial crime compliance lead for digital banks and payments", roleFamily: "risk_compliance", yearsExperience: "10" });
  await saveProfileSection(wanjiru, "location", { locationCity: "Nairobi", locationCountry: "Kenya", timeZone: "EAT (UTC+3)", languages: ["English", "Kiswahili"] });
  await saveProfileSection(wanjiru, "introduction", { introduction: "I build anti-money-laundering and sanctions programmes for fast-growing payment and banking businesses, balancing regulator expectations with customer onboarding that still works on a mobile phone.", sectors: ["Banking and financial services", "Technology and telecoms"] });
  await saveProfileSection(wanjiru, "preferences", { opportunityTypes: ["permanent", "fixed_term"], workArrangements: ["hybrid", "remote"], relocation: "open" });
  await saveProfileSection(wanjiru, "availability", { availabilityStatus: "available_from", availableFrom: "2026-12-01", noticePeriodWeeks: "4" });
  for (const [name, tier, level] of [
    ["Anti-money laundering (AML)", "core", "expert"],
    ["Sanctions compliance", "core", "advanced"],
    ["Customer due diligence (KYC)", "core", "expert"],
    ["Regulatory compliance", "strong", "advanced"],
    ["Digital payments", "strong", "advanced"],
    ["SQL", "working", "practitioner"],
  ] as const) await upsertProfileCapability(wanjiru, { name, category: "functional", tier, selfProficiency: level });
  wanjiru = await reload(wanjiru);
  const amlEng = await saveEngagement(wanjiru, {
    kind: "role",
    title: "Head of AML, mobile payments provider",
    confidentiality: "anonymised",
    anonymisedDescription: "an East African mobile payments provider",
    roleTitle: "Head of AML",
    sector: "Banking and financial services",
    startDate: "2020-05-01",
    isCurrent: true,
    status: "ongoing",
    individualActions: "Rebuilt the transaction monitoring rules; introduced risk-based onboarding tiers; prepared the business for its first central bank AML inspection.",
    outcomes: "False-positive alerts fell by about 40% after the rules rebuild; the inspection closed with no major findings.",
    teamSize: "14",
    isSignature: true,
    capabilityIds: [await capId("Anti-money laundering (AML)"), await capId("Customer due diligence (KYC)")],
  });
  await saveClaim(wanjiru, { engagementId: amlEng, claimType: "outcome", text: "Reduced false-positive transaction monitoring alerts by about 40% after rebuilding the rules." });
  await updateVisibilitySettings(wanjiru, { visibility: "approved_employers", contactVisibility: "approved_employers", evidenceVisibility: "private" });
  await saveProfileSection(wanjiru, "contact", { contactEmail: "wanjiru.contact@demo.invalid" });

  /* --------------------------- Talent 4 ----------------------------- */
  let karim = await demoUser("Karim Benali", "karim", "talent");
  await saveProfileSection(karim, "basics", { fullName: "Karim Benali", headline: "Renewable energy business developer: wind and solar origination in North and West Africa", roleFamily: "business_development", yearsExperience: "11" });
  await saveProfileSection(karim, "location", { locationCity: "Casablanca", locationCountry: "Morocco", timeZone: "WET (UTC+1)", languages: ["Arabic", "French", "English"] });
  await saveProfileSection(karim, "introduction", { introduction: "I originate and develop renewable energy projects, from land and grid access to signed power purchase agreements, working with developers, utilities and industrial buyers.", sectors: ["Energy and renewables"] });
  await saveProfileSection(karim, "preferences", { opportunityTypes: ["advisory", "project", "permanent"], workArrangements: ["remote", "hybrid"], relocation: "open" });
  await saveProfileSection(karim, "availability", { availabilityStatus: "open_to_conversations" });
  for (const [name, tier, level] of [
    ["Renewable energy development", "core", "expert"],
    ["Power purchase agreements", "core", "advanced"],
    ["Business development", "core", "expert"],
    ["Government relations", "strong", "advanced"],
    ["French", "strong", "expert"],
  ] as const) await upsertProfileCapability(karim, { name, category: "functional", tier, selfProficiency: level });
  karim = await reload(karim);
  const ppaEng = await saveEngagement(karim, {
    kind: "project",
    title: "Corporate PPA for a cement plant",
    confidentiality: "anonymised",
    anonymisedDescription: "an industrial cement producer",
    roleTitle: "Origination lead",
    sector: "Energy and renewables",
    startDate: "2022-01-01",
    endDate: "2023-09-30",
    status: "completed",
    stageReached: "contract_award",
    individualActions: "Identified the buyer, structured the tariff indexation and led commercial negotiations through to signature.",
    teamContribution: "The developer's engineering team designed the plant; legal counsel drafted the agreement.",
    outcomes: "A 15-year agreement for 40 MW was signed. Construction had not started when I left the developer, so I cannot speak to delivery.",
    valueCurrency: "EUR",
    projectValue: "38000000",
    capabilityIds: [await capId("Power purchase agreements"), await capId("Business development")],
  });
  await saveClaim(karim, { engagementId: ppaEng, claimType: "outcome", text: "Led negotiations to signature of a 15-year, 40 MW corporate power purchase agreement." });
  await updateVisibilitySettings(karim, { visibility: "approved_employers", contactVisibility: "on_introduction", evidenceVisibility: "private" });

  /* --------------------------- Talent 5 ----------------------------- */
  let ife = await demoUser("Ifeoluwa Adebayo-Clarke", "ifeoluwa", "talent");
  await saveProfileSection(ife, "basics", { fullName: "Ifeoluwa Adebayo-Clarke", preferredName: "Ife", headline: "Data platform engineer and fractional data lead for African fintechs", roleFamily: "technology", yearsExperience: "9" });
  await saveProfileSection(ife, "location", { locationCity: "London", locationCountry: "United Kingdom", timeZone: "GMT/BST", languages: ["English", "Yoruba"] });
  await saveProfileSection(ife, "introduction", { introduction: "I design data platforms that small teams can run: ingestion, modelling and governance for lending and payments businesses. Based in London and working mostly with teams in Lagos, Nairobi and Accra.", sectors: ["Technology and telecoms", "Banking and financial services"] });
  await saveProfileSection(ife, "preferences", { opportunityTypes: ["fractional", "fixed_term", "advisory"], workArrangements: ["remote"], relocation: "no" });
  await saveProfileSection(ife, "availability", { availabilityStatus: "available_now", hoursPerWeek: "16" });
  for (const [name, tier, level] of [
    ["Data engineering", "core", "expert"],
    ["Cloud architecture", "core", "advanced"],
    ["Data governance", "strong", "advanced"],
    ["Python", "strong", "expert"],
    ["SQL", "strong", "expert"],
    ["Machine learning", "working", "practitioner"],
  ] as const) await upsertProfileCapability(ife, { name, category: "technical", tier, selfProficiency: level });
  ife = await reload(ife);
  const dataEng = await saveEngagement(ife, {
    kind: "advisory",
    title: "Fractional data lead, consumer lender",
    confidentiality: "anonymised",
    anonymisedDescription: "a Nigerian consumer lending start-up",
    roleTitle: "Fractional head of data",
    sector: "Banking and financial services",
    startDate: "2024-01-01",
    isCurrent: true,
    status: "ongoing",
    individualActions: "Designed the warehouse model; set up data quality checks on loan book reporting; mentored two analysts.",
    outcomes: "Monthly investor reporting now runs from tested models instead of spreadsheets.",
    capabilityIds: [await capId("Data engineering"), await capId("Data governance")],
  });
  await saveClaim(ife, { engagementId: dataEng, claimType: "responsibility", text: "Designed the lender's warehouse model and data quality checks used for investor reporting." });
  await addEvidenceLink(ife, { title: "Open-source data quality checks (example repository)", url: "https://www.example.org/demo-repo", visibility: "approved_employers" });
  await saveOwnedRecord(ife, "publicWork", { kind: "writing", title: "Running a data platform with a team of three", venue: "Demo engineering blog", url: "https://www.example.org/demo-article", year: "2025" });
  await updateVisibilitySettings(ife, { visibility: "approved_employers", contactVisibility: "on_introduction", evidenceVisibility: "approved_employers" });

  /* --------------------------- Talent 6 ----------------------------- */
  let aminata = await demoUser("Aminata Sow", "aminata", "talent");
  await saveProfileSection(aminata, "basics", { fullName: "Aminata Sow", headline: "Impact investment associate: agriculture and SME finance", roleFamily: "investment", yearsExperience: "5" });
  await saveProfileSection(aminata, "location", { locationCity: "Dakar", locationCountry: "Senegal", timeZone: "GMT (UTC+0)", languages: ["French", "Wolof", "English"] });
  await saveProfileSection(aminata, "introduction", { introduction: "I screen and diligence early-stage investments in agricultural businesses across francophone West Africa, and I build the impact measurement frameworks our investees report against.", sectors: ["Agriculture and food", "Private equity and venture capital"] });
  await saveProfileSection(aminata, "preferences", { opportunityTypes: ["permanent", "fixed_term"], workArrangements: ["hybrid", "on_site"], relocation: "open" });
  await saveProfileSection(aminata, "availability", { availabilityStatus: "available_from", availableFrom: "2027-02-01", noticePeriodWeeks: "12" });
  for (const [name, tier, level] of [
    ["Due diligence", "core", "advanced"],
    ["Impact measurement", "core", "advanced"],
    ["Agricultural value chains", "strong", "practitioner"],
    ["Financial modelling", "strong", "practitioner"],
  ] as const) await upsertProfileCapability(aminata, { name, category: "functional", tier, selfProficiency: level });
  aminata = await reload(aminata);
  const agriEng = await saveEngagement(aminata, {
    kind: "role",
    title: "Investment associate, agri-SME fund",
    confidentiality: "anonymised",
    anonymisedDescription: "a regional impact fund",
    roleTitle: "Investment associate",
    sector: "Agriculture and food",
    startDate: "2022-09-01",
    isCurrent: true,
    status: "ongoing",
    individualActions: "Led due diligence on four investments; designed the fund's impact indicators for smallholder income.",
    outcomes: "Three of the four investments I diligenced were approved by the investment committee.",
    capabilityIds: [await capId("Due diligence"), await capId("Impact measurement")],
  });
  const aminataClaim = await saveClaim(aminata, { engagementId: agriEng, claimType: "outcome", text: "Led due diligence on four agri-SME investments, three approved by the investment committee." });
  await uploadEvidenceFile(aminata, { title: "Reference letter from fund partner (redacted)", isRedacted: true, visibility: "private", claimId: aminataClaim }, demoFile("Reference letter (redacted)", ["Letter confirming role and diligence work (fictional)"]));
  await requestVerification(aminata, aminataClaim);
  await updateVisibilitySettings(aminata, { visibility: "approved_employers", contactVisibility: "on_introduction", evidenceVisibility: "private" });

  /* --------------------------- Talent 7 ----------------------------- */
  // Samuel: complete but private. Demonstrates that private profiles never appear in search.
  let samuel = await demoUser("Samuel Tesfaye", "samuel", "talent");
  await saveProfileSection(samuel, "basics", { fullName: "Samuel Tesfaye", headline: "Logistics operations manager moving into product management", roleFamily: "operations", yearsExperience: "8" });
  await saveProfileSection(samuel, "location", { locationCity: "Addis Ababa", locationCountry: "Ethiopia", timeZone: "EAT (UTC+3)", languages: ["Amharic", "English"] });
  await saveProfileSection(samuel, "introduction", { introduction: "I have run warehouse and last-mile operations for eight years and am now moving into product management for logistics software, starting with the operational tools I used to wish existed." });
  await saveProfileSection(samuel, "preferences", { opportunityTypes: ["permanent"], workArrangements: ["hybrid"] });
  await saveProfileSection(samuel, "availability", { availabilityStatus: "open_to_conversations" });
  await upsertProfileCapability(samuel, { name: "Logistics", category: "functional", tier: "core", selfProficiency: "advanced" });
  await upsertProfileCapability(samuel, { name: "Product management", category: "functional", tier: "working", selfProficiency: "aware" });
  samuel = await reload(samuel);
  await saveEngagement(samuel, { kind: "role", title: "Last-mile operations lead", confidentiality: "anonymised", anonymisedDescription: "a parcel delivery company", status: "completed", outcomes: "Cut failed deliveries by redesigning route planning." });
  await saveModuleAnswer(samuel, { moduleKey: "career_direction", questionKey: "unconventional", answer: "I am changing careers from operations to product. I see that as an advantage: I know the users." });

  /* --------------------------- Talent 8 ----------------------------- */
  // Lindiwe: a new draft profile, used to demonstrate onboarding.
  await demoUser("Lindiwe Dlamini", "lindiwe", "talent");

  /* --------------------------- Employers ---------------------------- */
  const kofi = await demoUser("Kofi Asante", "kofi", "employer");
  const grace = await demoUser("Grace Achieng", "grace", "employer");
  const nomvula = await demoUser("Nomvula Khumalo", "nomvula", "employer");
  const moussa = await demoUser("Moussa Traoré", "moussa", "employer");

  await demoOrg("Savanna Infrastructure Partners (fictional)", "approved", { country: "Ghana", sector: "Construction and engineering", sizeBand: "51-250", website: "https://www.example.org/savanna", description: "A fictional infrastructure developer and investor used for demonstration." }, kofi, [grace]);
  await demoOrg("Kasi Digital Bank (fictional)", "approved", { country: "South Africa", sector: "Banking and financial services", sizeBand: "251-1000", description: "A fictional digital bank used for demonstration." }, nomvula);
  await demoOrg("Sahel Agritech Ventures (fictional)", "pending", { country: "Mali", sector: "Agriculture and food", sizeBand: "11-50", registrationNote: "We invest in agricultural technology across the Sahel and want to hire two portfolio advisers." }, moussa);

  const k = await reload(kofi);
  const n = await reload(nomvula);

  const pfOpp = await saveOpportunity(k, {
    title: "Director, Project Finance (Ports)",
    engagementType: "permanent",
    problemStatement: "We are developing two port concessions and need someone to own the financing workstream from term sheet to financial close.",
    expectedOutcomes: "Financial close on our first concession within 18 months, and a lender group we can return to for the second.",
    responsibilities: "Own the financing plan and model; run lender processes; negotiate risk allocation with the government counterparties; lead a team of three analysts.",
    experienceRequirements: "At least one infrastructure financing taken to financial close in a lead role.",
    requiredEvidence: "Evidence of at least one financial close (redacted documents are fine).",
    locationText: "Accra, with regional travel",
    country: "Ghana",
    workArrangement: "hybrid",
    startDate: "2027-03-01",
    compensationCurrency: "USD",
    compensationMin: "130000",
    compensationMax: "170000",
    compensationPeriod: "annual",
    selectionStages: ["Profile review", "Conversation with the CEO", "Case discussion", "References (with consent)"],
    sectors: ["Logistics, ports and maritime"],
  });
  await addRequirement(k, pfOpp, { kind: "capability", label: "Project finance", importance: "essential", minProficiency: "advanced" });
  await addRequirement(k, pfOpp, { kind: "capability", label: "Financial modelling", importance: "essential", minProficiency: "advanced" });
  await addRequirement(k, pfOpp, { kind: "capability", label: "Contract negotiation", importance: "desirable" });
  await addRequirement(k, pfOpp, { kind: "language", label: "Portuguese", importance: "desirable" });
  await setOpportunityStatus(k, pfOpp, "published");

  const procOpp = await saveOpportunity(k, {
    title: "Fractional Head of Procurement",
    engagementType: "fractional",
    problemStatement: "Our construction procurement is run project by project. We need a framework that works across sites.",
    expectedOutcomes: "A procurement policy, approved supplier panels and a monthly reporting routine within six months.",
    responsibilities: "Design the framework; set up supplier panels; train site teams.",
    locationText: "Remote, with quarterly site visits",
    workArrangement: "remote",
    hoursPerWeek: "16",
    durationText: "6 months, possibly extended",
    compensationCurrency: "USD",
    compensationMin: "600",
    compensationMax: "800",
    compensationPeriod: "daily",
    selectionStages: ["Profile review", "Two conversations"],
  });
  await addRequirement(k, procOpp, { kind: "capability", label: "Procurement", importance: "essential", minProficiency: "advanced" });
  await addRequirement(k, procOpp, { kind: "capability", label: "Supply chain management", importance: "desirable" });
  await addRequirement(k, procOpp, { kind: "experience", label: "Construction or mining site procurement", importance: "essential" });
  await setOpportunityStatus(k, procOpp, "published");

  const waterOpp = await saveOpportunity(k, {
    title: "Advisory board member: water infrastructure",
    engagementType: "advisory",
    problemStatement: "We are considering a water utility PPP programme and want independent advice on regulatory risk.",
    expectedOutcomes: "Quarterly advice to the board on the programme.",
  });
  await addRequirement(k, waterOpp, { kind: "capability", label: "Water and sanitation", importance: "essential" });

  const amlOpp = await saveOpportunity(n, {
    title: "Head of Financial Crime Compliance",
    engagementType: "permanent",
    problemStatement: "We are entering two new markets and our financial crime controls need to scale without slowing onboarding.",
    expectedOutcomes: "A regulator-ready AML and sanctions programme in both markets within 12 months.",
    responsibilities: "Own AML, sanctions and fraud policy; lead a team of eight; act as the money laundering reporting officer.",
    locationText: "Johannesburg or Nairobi",
    workArrangement: "hybrid",
    startDate: "2027-01-15",
    compensationCurrency: "USD",
    compensationMin: "95000",
    compensationMax: "125000",
    compensationPeriod: "annual",
    selectionStages: ["Profile review", "Panel interview", "Case study"],
    sectors: ["Banking and financial services"],
  });
  await addRequirement(n, amlOpp, { kind: "capability", label: "Anti-money laundering (AML)", importance: "essential", minProficiency: "expert" });
  await addRequirement(n, amlOpp, { kind: "capability", label: "Sanctions compliance", importance: "essential", minProficiency: "advanced" });
  await addRequirement(n, amlOpp, { kind: "capability", label: "Team leadership", importance: "desirable" });
  await setOpportunityStatus(n, amlOpp, "published");

  const dataOpp = await saveOpportunity(n, {
    title: "Data Platform Lead (12-month contract)",
    engagementType: "fixed_term",
    problemStatement: "Our reporting relies on manual extracts. We need a reliable data platform for regulatory and management reporting.",
    expectedOutcomes: "A tested warehouse covering regulatory returns within nine months.",
    workArrangement: "remote",
    durationText: "12 months",
    selectionStages: ["Profile review", "Technical conversation"],
  });
  await addRequirement(n, dataOpp, { kind: "capability", label: "Data engineering", importance: "essential", minProficiency: "advanced" });
  await addRequirement(n, dataOpp, { kind: "capability", label: "Data governance", importance: "desirable" });
  await setOpportunityStatus(n, dataOpp, "published");

  /* ------------------------ Applications etc. ----------------------- */
  const efuaApp = await applyToOpportunity(await reload(efua), {
    opportunityId: pfOpp,
    expressionOfInterest: "I have taken a port financing to close as lead adviser and would like to do the same from the sponsor side. Happy to discuss how I would sequence the first concession.",
    includeContact: false,
    includeEvidence: true,
    confirm: true,
  });
  await setApplicationStatus(k, efuaApp, "shortlisted", "Strong evidence of a completed financial close.");
  await addApplicationNote(k, efuaApp, "Verified close notice on file. Ask about lender appetite for a second concession.");

  const wanjiruApp = await applyToOpportunity(await reload(wanjiru), {
    opportunityId: amlOpp,
    expressionOfInterest: "I have prepared a payments business for its first AML inspection and rebuilt monitoring rules at scale. I would like to help Kasi enter new markets safely.",
    includeContact: true,
    includeEvidence: false,
    confirm: true,
  });
  await setApplicationStatus(n, wanjiruApp, "in_review");

  const list = await createShortlist(k, { name: "Ports finance bench", description: "People to approach for the second concession.", opportunityId: pfOpp });
  await addToShortlist(k, list, efua.profileId!, "Applied; verified close.");
  await addToShortlist(k, list, tendai.profileId!, "Operations depth; possible fit for port operations later.");

  await requestIntroduction(n, { profileId: ife.profileId!, opportunityId: dataOpp, message: "We are building a regulatory data platform and your fractional work with lenders looks highly relevant. Would you be open to a conversation?" });

  await createShareLink(await reload(efua), { label: "For a recruiter I met at a conference", expiresInDays: "14", includeContact: false, includeEvidence: true });

  await createReport(k, { targetType: "opportunity", targetId: dataOpp, category: "inaccurate", details: "Demonstration report: the listing has no compensation information, which candidates may find unclear." });

  // Opportunities and organisations created here are demo records.
  await db.update(opportunities).set({ isDemo: true });
  const [{ verified }] = await db.select({ verified: count() }).from(claims).where(eq(claims.verificationStatus, "independently_verified"));
  return { verifiedClaims: verified };
}
