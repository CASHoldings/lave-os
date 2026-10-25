import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb } from "../helpers/db";
import { makeAdmin, makeCompleteTalent, makeEmployer, makeTalent, reload } from "../helpers/factories";
import { saveClaim, saveEngagement, uploadEvidenceFile, addEvidenceLink, authoriseEvidenceDownload, requestVerification, deleteEvidence } from "@/server/services/portfolio";
import { buildProfileView, loadProfileRow } from "@/server/services/profile-view";
import { resolveAudience } from "@/server/policy/profile-access";
import { saveOwnedRecord, saveProfileSection, updateVisibilitySettings, saveModuleAnswer } from "@/server/services/profile";
import { createShareLink, revokeShareLink, viewSharedProfile, respondToIntroduction, listIntroductionRequests } from "@/server/services/sharing";
import { searchTalent } from "@/server/services/search";
import { saveOpportunity, addRequirement, setOpportunityStatus, listPublishedOpportunities, getOwnOpportunity } from "@/server/services/employer";
import {
  applyToOpportunity,
  getApplicationForEmployer,
  withdrawApplication,
  addApplicationNote,
  listApplicationNotes,
  createShortlist,
  addToShortlist,
  getShortlist,
  listShortlists,
  getTalentForEmployer,
  requestIntroduction,
  setApplicationStatus,
} from "@/server/services/applications";
import { recordVerificationReview } from "@/server/services/admin";
import { deleteAccount, exportAccountData } from "@/server/services/account-data";
import { claims, shareLinks, talentProfiles, applications, evidenceItems } from "@/server/db/schema";
import type { Actor } from "@/server/policy/actor";

let ctx: Awaited<ReturnType<typeof setupTestDb>>;
beforeAll(async () => {
  ctx = await setupTestDb();
});
afterAll(async () => ctx.close());

const pdf = (text = "fictional evidence") => ({ name: "contract-summary.pdf", type: "application/pdf", bytes: new TextEncoder().encode(`%PDF-1.4\n${text}`) });

async function talentWithEvidence(visible: boolean) {
  const talent = await makeCompleteTalent("Evidence Owner", { visible });
  const engagementId = await saveEngagement(talent, {
    kind: "project",
    title: "Confidential pipeline project",
    confidentiality: "anonymised",
    anonymisedDescription: "an East African water utility",
    organisationName: "Secret Client Plc",
    status: "completed",
    individualActions: "Led the procurement workstream zebracrossing",
    privateNotes: "PRIVATE NOTE do not share",
  });
  const claimId = await saveClaim(talent, { engagementId, claimType: "outcome", text: "Reduced procurement cycle time by 30%." });
  const privateFile = await uploadEvidenceFile(talent, { title: "Private board paper", visibility: "private", claimId }, pdf());
  const sharedFile = await uploadEvidenceFile(talent, { title: "Redacted completion certificate", visibility: "approved_employers", isRedacted: true, claimId }, pdf("certificate"));
  await saveOwnedRecord(talent, "referee", { name: "Ref Erence", relationship: "Former manager", email: "referee@example.test", phone: "+000", consentToContact: true, visibility: "approved_employers" });
  return { talent: await reload(talent), engagementId, claimId, privateFile, sharedFile };
}

describe("projects, claims and private evidence (acceptance 2)", () => {
  it("stores a project, claim and private file; uploading does not verify the claim", async () => {
    const { talent, claimId, privateFile } = await talentWithEvidence(false);
    const [claim] = await ctx.db.select().from(claims).where(eq(claims.id, claimId));
    expect(claim.verificationStatus).toBe("evidence_supplied");
    expect(ctx.storage.objects.size).toBeGreaterThan(0);
    const view = await buildProfileView((await loadProfileRow(talent.profileId!))!, { kind: "owner" });
    expect(view.evidence.map((e) => e.id)).toContain(privateFile);
    expect(view.engagements.find((e) => e.title === "Confidential pipeline project")!.privateNotes).toBe("PRIVATE NOTE do not share");
  });

  it("rejects files whose contents do not match their type", async () => {
    const talent = await makeTalent();
    await expect(uploadEvidenceFile(talent, { title: "Fake" }, { name: "x.pdf", type: "application/pdf", bytes: new TextEncoder().encode("MZ not a pdf") })).rejects.toMatchObject({ fieldErrors: { file: expect.stringMatching(/do not match/) } });
    await expect(uploadEvidenceFile(talent, { title: "Exe" }, { name: "x.exe", type: "application/x-msdownload", bytes: new Uint8Array([1]) })).rejects.toMatchObject({ code: "validation" });
  });

  it("requires evidence before verification can be requested", async () => {
    const talent = await makeCompleteTalent("No Evidence");
    const claimId = await saveClaim(talent, { claimType: "outcome", text: "Closed three financings." });
    await expect(requestVerification(talent, claimId)).rejects.toMatchObject({ code: "validation" });
  });
});

describe("private profiles and files are not reachable by others (acceptance 3)", () => {
  let owner: Actor, ids: Awaited<ReturnType<typeof talentWithEvidence>>, employer: Actor, otherTalent: Actor, pendingEmployer: Actor;
  beforeAll(async () => {
    ids = await talentWithEvidence(false);
    owner = ids.talent;
    employer = await makeEmployer("Approved Co");
    pendingEmployer = await makeEmployer("Pending Co", "pending");
    otherTalent = await makeTalent("Nosy Talent");
  });

  it("returns not-found for a private profile to employers and other talent", async () => {
    const profile = (await loadProfileRow(owner.profileId!))!;
    expect(await resolveAudience(employer, profile)).toBeNull();
    expect(await resolveAudience(otherTalent, profile)).toBeNull();
    expect(await resolveAudience(null, profile)).toBeNull();
    await expect(getTalentForEmployer(employer, owner.profileId!)).rejects.toMatchObject({ code: "not_found" });
  });

  it("refuses file downloads by id to anyone but the owner", async () => {
    for (const actor of [employer, otherTalent, pendingEmployer, null]) {
      await expect(authoriseEvidenceDownload({ kind: "live", actor }, ids.privateFile)).rejects.toMatchObject({ code: "not_found" });
      await expect(authoriseEvidenceDownload({ kind: "live", actor }, ids.sharedFile)).rejects.toMatchObject({ code: "not_found" });
    }
    await expect(authoriseEvidenceDownload({ kind: "live", actor: owner }, ids.privateFile)).resolves.toMatchObject({ url: expect.stringContaining("expires=60") });
  });

  it("lets approved employers see a visible profile but never private items, notes or reference contacts", async () => {
    await updateVisibilitySettings(owner, { visibility: "approved_employers", contactVisibility: "on_introduction", evidenceVisibility: "approved_employers" });
    const { view } = await getTalentForEmployer(employer, owner.profileId!);
    expect(view.contact).toBeNull();
    const confidential = view.engagements.find((e) => e.title === "Confidential pipeline project")!;
    expect(confidential.privateNotes).toBeUndefined();
    expect(confidential.organisationName).toBeNull();
    expect(confidential.organisationLabel).toBe("an East African water utility");
    expect(JSON.stringify(view)).not.toContain("Secret Client Plc");
    expect(JSON.stringify(view)).not.toContain("PRIVATE NOTE");
    expect(view.evidence.map((e) => e.id)).toEqual([ids.sharedFile]);
    expect(view.referees[0].contact).toBeNull();
    expect(JSON.stringify(view)).not.toContain("referee@example.test");
    await expect(authoriseEvidenceDownload({ kind: "live", actor: employer }, ids.privateFile)).rejects.toMatchObject({ code: "not_found" });
    await expect(authoriseEvidenceDownload({ kind: "live", actor: employer }, ids.sharedFile)).resolves.toBeTruthy();
    // Members of organisations awaiting approval still see nothing.
    await expect(authoriseEvidenceDownload({ kind: "live", actor: pendingEmployer }, ids.sharedFile)).rejects.toMatchObject({ code: "not_found" });
  });

  it("releases contact details only to an organisation whose introduction was accepted", async () => {
    const other = await makeEmployer("Other Co");
    await requestIntroduction(employer, { profileId: owner.profileId!, message: "We would like to discuss a port finance advisory role with you." });
    const [req] = await listIntroductionRequests(owner);
    await respondToIntroduction(owner, req.request.id, true);
    expect((await getTalentForEmployer(employer, owner.profileId!)).view.contact).not.toBeNull();
    expect((await getTalentForEmployer(other, owner.profileId!)).view.contact).toBeNull();
  });
});

describe("share links can be enabled and revoked (acceptance 4)", () => {
  it("serves a share link until it is revoked, and excludes restricted data", async () => {
    const { talent, privateFile, sharedFile } = await talentWithEvidence(false);
    const link = await createShareLink(talent, { label: "For a recruiter", expiresInDays: "7", includeContact: false, includeEvidence: "on" });
    const shared = await viewSharedProfile(link.token);
    expect(shared).not.toBeNull();
    const json = JSON.stringify(shared!.view);
    expect(json).not.toContain("PRIVATE NOTE");
    expect(json).not.toContain("referee@example.test");
    expect(json).not.toContain("Secret Client Plc");
    expect(shared!.view.contact).toBeNull();
    expect(shared!.view.evidence.map((e) => e.id)).toEqual([sharedFile]);
    await expect(authoriseEvidenceDownload({ kind: "share", token: link.token }, sharedFile)).resolves.toBeTruthy();
    await expect(authoriseEvidenceDownload({ kind: "share", token: link.token }, privateFile)).rejects.toMatchObject({ code: "not_found" });

    await revokeShareLink(talent, link.id);
    expect(await viewSharedProfile(link.token)).toBeNull();
    await expect(authoriseEvidenceDownload({ kind: "share", token: link.token }, sharedFile)).rejects.toMatchObject({ code: "not_found" });
  });

  it("stops working after it expires", async () => {
    const talent = await makeCompleteTalent("Expiring");
    const link = await createShareLink(talent, { label: "Short", expiresInDays: "1" });
    await ctx.db.update(shareLinks).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(shareLinks.id, link.id));
    expect(await viewSharedProfile(link.token)).toBeNull();
  });

  it("cannot be revoked by someone else", async () => {
    const talent = await makeCompleteTalent("Link Owner");
    const intruder = await makeTalent("Intruder");
    const link = await createShareLink(talent, { label: "Mine", expiresInDays: "3" });
    await expect(revokeShareLink(intruder, link.id)).rejects.toMatchObject({ code: "not_found" });
    expect(await viewSharedProfile(link.token)).not.toBeNull();
  });
});

describe("search respects visibility (acceptance 6)", () => {
  let employer: Actor;
  beforeAll(async () => {
    employer = await makeEmployer("Searcher Ltd");
    const hidden = await makeCompleteTalent("Hidden Person");
    await saveEngagement(hidden, { kind: "project", title: "Quantumleap refinery", status: "completed" });
    const visible = await makeCompleteTalent("Visible Person", { visible: true });
    await saveEngagement(visible, { kind: "project", title: "Private moonshot", status: "completed", visibility: "private", outcomes: "secretkeyword" });
    await saveModuleAnswer(visible, { moduleKey: "values", questionKey: "values", answer: "valuesonlyword integrity" });
    await saveProfileSection(visible, "compensation", { compensationCurrency: "USD", compensationMin: "200000", compensationPeriod: "annual", compensationVisibility: "private" });
  });

  it("never returns private profiles, even for exact keywords", async () => {
    const { results } = await searchTalent(employer, { q: "Quantumleap" });
    expect(results).toHaveLength(0);
    const all = await searchTalent(employer, {});
    expect(all.results.map((r) => r.view.fullName)).not.toContain("Hidden Person");
    expect(all.results.map((r) => r.view.fullName)).toContain("Visible Person");
  });

  it("does not match text in private records or values answers", async () => {
    expect((await searchTalent(employer, { q: "secretkeyword" })).results).toHaveLength(0);
    expect((await searchTalent(employer, { q: "valuesonlyword" })).results).toHaveLength(0);
  });

  it("does not use compensation the candidate kept private", async () => {
    const { results } = await searchTalent(employer, { budgetMax: "1000", budgetCurrency: "USD", budgetPeriod: "annual" });
    const person = results.find((r) => r.view.fullName === "Visible Person");
    expect(person).toBeDefined();
    expect(person!.compensation).toBe("not_shared");
  });

  it("is unavailable to organisations awaiting approval", async () => {
    const pending = await makeEmployer("Waiting Ltd", "pending");
    await expect(searchTalent(pending, {})).rejects.toMatchObject({ code: "forbidden" });
  });

  it("filters by capability and evidence", async () => {
    expect((await searchTalent(employer, { capabilities: ["Project finance"] })).results.length).toBeGreaterThan(0);
    expect((await searchTalent(employer, { capabilities: ["Underwater basket weaving"] })).results).toHaveLength(0);
  });
});

describe("opportunities, applications and shortlists (acceptance 5, 7, 8)", () => {
  let employerA: Actor, employerB: Actor, talent: Actor, oppId: string, appId: string;

  beforeAll(async () => {
    employerA = await makeEmployer("Alpha Infrastructure");
    employerB = await makeEmployer("Beta Capital");
    const data = await talentWithEvidence(true);
    talent = data.talent;
    oppId = await saveOpportunity(employerA, {
      title: "Head of Project Finance",
      engagementType: "permanent",
      problemStatement: "We need to close two port financings.",
      expectedOutcomes: "Financial close on both within 18 months.",
      workArrangement: "hybrid",
    });
  });

  it("requires approval and requirements before publishing", async () => {
    const pending = await makeEmployer("Pending Publisher", "pending");
    const draft = await saveOpportunity(pending, { title: "Draft role", engagementType: "advisory", problemStatement: "x", expectedOutcomes: "y" });
    await addRequirement(pending, draft, { kind: "capability", label: "Project finance", importance: "essential" });
    await expect(setOpportunityStatus(pending, draft, "published")).rejects.toMatchObject({ code: "forbidden" });
    await expect(setOpportunityStatus(employerA, oppId, "published")).rejects.toMatchObject({ fieldErrors: { requirements: expect.any(String) } });
  });

  it("publishes an opportunity for an approved employer", async () => {
    await addRequirement(employerA, oppId, { kind: "capability", label: "Project finance", importance: "essential", minProficiency: "advanced" });
    await addRequirement(employerA, oppId, { kind: "language", label: "Portuguese", importance: "desirable" });
    await setOpportunityStatus(employerA, oppId, "published");
    const listed = await listPublishedOpportunities();
    expect(listed.map((l) => l.opportunity.id)).toContain(oppId);
  });

  it("keeps draft and other organisations' opportunities out of reach", async () => {
    await expect(getOwnOpportunity(employerB, oppId)).rejects.toMatchObject({ code: "not_found" });
    await expect(setOpportunityStatus(employerB, oppId, "closed")).rejects.toMatchObject({ code: "not_found" });
  });

  it("creates an application with a frozen snapshot", async () => {
    appId = await applyToOpportunity(talent, {
      opportunityId: oppId,
      expressionOfInterest: "I have closed comparable port financings and would like to discuss this role.",
      includeContact: false,
      includeEvidence: true,
      confirm: true,
    });
    await saveProfileSection(talent, "basics", { fullName: "Evidence Owner", headline: "Changed headline after applying" });
    const view = await getApplicationForEmployer(employerA, appId);
    expect(view.snapshot!.headline).toBe("Infrastructure finance lead");
    expect(view.snapshot!.contact).toBeNull();
    expect(view.comparison!.requirements.find((r) => r.label === "Portuguese")!.outcome).toBe("not_provided");
    await expect(applyToOpportunity(talent, { opportunityId: oppId, expressionOfInterest: "Applying twice to see what happens here, which should fail.", confirm: true })).rejects.toMatchObject({ code: "conflict" });
  });

  it("isolates applications and notes between organisations", async () => {
    await addApplicationNote(employerA, appId, "Strong on financing; check references.");
    expect((await listApplicationNotes(employerA, appId)).map((n) => n.body)).toEqual(["Strong on financing; check references."]);
    await expect(getApplicationForEmployer(employerB, appId)).rejects.toMatchObject({ code: "not_found" });
    await expect(listApplicationNotes(employerB, appId)).rejects.toMatchObject({ code: "not_found" });
    await expect(addApplicationNote(employerB, appId, "intrusion")).rejects.toMatchObject({ code: "not_found" });
    await expect(setApplicationStatus(employerB, appId, "offer")).rejects.toMatchObject({ code: "not_found" });
  });

  it("persists status changes and shortlists", async () => {
    await setApplicationStatus(employerA, appId, "shortlisted", "Moving forward");
    const listId = await createShortlist(employerA, { name: "Port finance bench", opportunityId: oppId });
    await addToShortlist(employerA, listId, talent.profileId!, "Strong evidence");
    const lists = await listShortlists(employerA);
    expect(lists.find((l) => l.id === listId)!.entryCount).toBe(1);
    const full = await getShortlist(employerA, listId);
    expect(full.entries[0].view!.fullName).toBe("Evidence Owner");
    await expect(getShortlist(employerB, listId)).rejects.toMatchObject({ code: "not_found" });
    await expect(addToShortlist(employerB, listId, talent.profileId!)).rejects.toMatchObject({ code: "not_found" });
    const [app] = await ctx.db.select().from(applications).where(eq(applications.id, appId));
    expect(app.status).toBe("shortlisted");
  });

  it("ends employer access to the snapshot and its files when the candidate withdraws", async () => {
    const view = await getApplicationForEmployer(employerA, appId);
    const fileId = view.snapshot!.evidence[0].id;
    await expect(authoriseEvidenceDownload({ kind: "application", actor: employerA, applicationId: appId }, fileId)).resolves.toBeTruthy();
    await expect(authoriseEvidenceDownload({ kind: "application", actor: employerB, applicationId: appId }, fileId)).rejects.toMatchObject({ code: "not_found" });
    await withdrawApplication(talent, appId);
    expect((await getApplicationForEmployer(employerA, appId)).snapshot).toBeNull();
    await expect(authoriseEvidenceDownload({ kind: "application", actor: employerA, applicationId: appId }, fileId)).rejects.toMatchObject({ code: "not_found" });
  });

  it("drops a shortlisted profile from view when the candidate makes it private", async () => {
    const listId = (await listShortlists(employerA))[0].id;
    await updateVisibilitySettings(talent, { visibility: "private", contactVisibility: "private", evidenceVisibility: "private" });
    const full = await getShortlist(employerA, listId);
    expect(full.entries[0].view).toBeNull();
  });
});

describe("verification is a human, recorded decision", () => {
  it("only an administrator review verifies a claim, without changing its text, and edits reset it", async () => {
    const { talent, claimId, sharedFile } = await talentWithEvidence(true);
    const admin = await makeAdmin();
    const employer = await makeEmployer("Not Admin");
    await requestVerification(talent, claimId);
    const input = { claimId, decision: "independently_verified", method: "document_review", scope: "Checked the redacted completion certificate against the project dates.", evidenceIdsReviewed: [sharedFile], reason: "Certificate matches the claim." };
    await expect(recordVerificationReview(employer, input)).rejects.toMatchObject({ code: "not_found" });
    await expect(recordVerificationReview(admin, { ...input, evidenceIdsReviewed: [] })).rejects.toMatchObject({ code: "validation" });
    await recordVerificationReview(admin, input);
    let [claim] = await ctx.db.select().from(claims).where(eq(claims.id, claimId));
    expect(claim.verificationStatus).toBe("independently_verified");
    expect(claim.text).toBe("Reduced procurement cycle time by 30%.");

    await saveClaim(talent, { engagementId: claim.engagementId, claimType: "outcome", text: "Reduced procurement cycle time by 45%." }, claimId);
    [claim] = await ctx.db.select().from(claims).where(eq(claims.id, claimId));
    expect(claim.verificationStatus).toBe("evidence_supplied");
  });

  it("does not let deleting a file leave a claim showing evidence it no longer has", async () => {
    const talent = await makeCompleteTalent("Deleter");
    const claimId = await saveClaim(talent, { claimType: "financial", text: "Managed a budget of USD 2m." });
    const fileId = await uploadEvidenceFile(talent, { title: "Budget", claimId }, pdf());
    await deleteEvidence(talent, fileId);
    const [claim] = await ctx.db.select().from(claims).where(eq(claims.id, claimId));
    expect(claim.verificationStatus).toBe("self_reported");
  });
});

describe("export and deletion", () => {
  it("exports the owner's data and deletes files, records and search text", async () => {
    const employer = await makeEmployer("Deletion Employer");
    const { talent, privateFile } = await talentWithEvidence(true);
    await addEvidenceLink(talent, { title: "Public article", url: "https://example.org/article" });
    const opp = await saveOpportunity(employer, { title: "Advisor", engagementType: "advisory", problemStatement: "p", expectedOutcomes: "o" });
    await addRequirement(employer, opp, { kind: "capability", label: "Procurement", importance: "essential" });
    await setOpportunityStatus(employer, opp, "published");
    const appId = await applyToOpportunity(talent, { opportunityId: opp, expressionOfInterest: "I would be glad to advise on procurement reform for this programme.", confirm: true });

    const exported = await exportAccountData(talent);
    expect(JSON.stringify(exported)).toContain("Reduced procurement cycle time");
    expect((exported.applications as unknown[]).length).toBe(1);

    const [file] = await ctx.db.select().from(evidenceItems).where(eq(evidenceItems.id, privateFile));
    await expect(deleteAccount(talent, "nope")).rejects.toMatchObject({ code: "validation" });
    await deleteAccount(talent, "DELETE");
    expect(ctx.storage.objects.has(file.storageKey!)).toBe(false);
    expect(await ctx.db.select().from(talentProfiles).where(eq(talentProfiles.id, talent.profileId!))).toHaveLength(0);
    expect(await ctx.db.select().from(evidenceItems).where(eq(evidenceItems.profileId, talent.profileId!))).toHaveLength(0);
    const [app] = await ctx.db.select().from(applications).where(eq(applications.id, appId));
    expect(app.status).toBe("withdrawn");
    expect(app.candidateDisplayName).toBe("Deleted account");
    expect(app.profileId).toBeNull();
    expect((await getApplicationForEmployer(employer, appId)).snapshot).toBeNull();
  });
});
