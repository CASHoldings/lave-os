import { expect, test } from "@playwright/test";
import { demoSignIn, unique } from "./helpers";

test.describe("employer workflow", () => {
  test("new employer registrations wait for approval before discovery", async ({ page }) => {
    await page.goto("/sign-up?as=employer");
    await page.getByLabel("Your name").fill("New Employer");
    await page.getByLabel("Email address").fill(`emp-${unique()}@example.test`);
    await page.getByLabel("Password").fill("a long test password");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/employer\/onboarding/);
    await page.getByLabel("Organisation name").fill("E2E Holdings (fictional)");
    await page.getByRole("button", { name: "Submit for review" }).click();
    await expect(page.getByText("Awaiting approval")).toBeVisible();
    await page.goto("/employer/search");
    await expect(page).toHaveURL(/\/employer\?pending=1/);
  });

  test("5. an approved employer can publish an opportunity", async ({ page }) => {
    await demoSignIn(page, "Kofi Asante");
    await page.goto("/employer/opportunities/new");
    const title = `Fractional CFO ${unique()}`;
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Type of engagement").selectOption("fractional");
    await page.getByLabel("The problem to solve").fill("Our finance function needs structure before a fundraise.");
    await page.getByLabel("Expected outcomes").fill("Investor-ready reporting within six months.");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();

    // Publishing without requirements is refused with a clear message.
    await page.getByRole("button", { name: "Publish" }).click();
    await expect(page.getByText("Add at least one requirement before publishing.").or(page.getByText("A few things are needed before this can be published."))).toBeVisible();

    const req = page.getByRole("form", { name: "Add a requirement" });
    await req.getByLabel("Requirement").fill("Financial modelling");
    await req.getByRole("button", { name: "Add requirement" }).click();
    await expect(page.getByText("Requirement added.")).toBeVisible();
    await page.getByRole("button", { name: "Publish" }).click();
    await expect(page.getByText(/^Published/).first()).toBeVisible();

    await page.goto("/opportunities");
    await expect(page.getByRole("link", { name: title })).toBeVisible();
  });

  test("6 and 7. search respects visibility, and shortlists persist", async ({ page }) => {
    await demoSignIn(page, "Kofi Asante");
    await page.goto("/employer/search");
    await expect(page.getByRole("link", { name: "Efua" })).toBeVisible();
    // Private and draft profiles never appear.
    await expect(page.getByRole("link", { name: /Samuel/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Lindiwe/ })).toHaveCount(0);
    // Text from a private record cannot be found by keyword.
    await page.goto("/employer/search?q=parcel");
    await expect(page.getByText("No discoverable profiles match")).toBeVisible();

    const listName = `Bench ${unique()}`;
    await page.goto("/employer/shortlists");
    await page.getByRole("form", { name: "Create a shortlist" }).getByLabel("Name").fill(listName);
    await page.getByRole("button", { name: "Create shortlist" }).click();
    await expect(page.getByRole("link", { name: listName })).toBeVisible();

    await page.goto("/employer/search?q=compliance");
    const card = page.getByRole("listitem").filter({ hasText: "Wanjiru" });
    await card.getByText("Add to a shortlist").click();
    await card.getByRole("combobox", { name: /Shortlist/ }).selectOption({ label: listName });
    await card.getByRole("button", { name: "Add" }).click();
    await expect(card.getByText("Added to shortlist.")).toBeVisible();

    await page.goto("/employer/shortlists");
    await page.getByRole("link", { name: listName }).click();
    await page.waitForURL(/\/employer\/shortlists\/[0-9a-f-]+/);
    await page.reload();
    await expect(page.getByRole("link", { name: "Wanjiru Kariuki" })).toBeVisible();
  });

  test("8. one employer cannot open another employer's applications, opportunities or shortlists", async ({ page, browser }) => {
    await demoSignIn(page, "Kofi Asante");
    await page.goto("/employer");
    await page.getByRole("link", { name: "Efua" }).first().click();
    await page.waitForURL(/\/employer\/applications\/[0-9a-f-]+/);
    const applicationUrl = new URL(page.url()).pathname;
    await page.goto("/employer/shortlists");
    await page.getByRole("link", { name: "Ports finance bench" }).click();
    await page.waitForURL(/\/employer\/shortlists\/[0-9a-f-]+/);
    const shortlistUrl = new URL(page.url()).pathname;
    await page.goto("/employer/opportunities");
    await page.getByRole("link", { name: "Director, Project Finance (Ports)" }).click();
    await page.waitForURL(/\/employer\/opportunities\/[0-9a-f-]+/);
    const opportunityUrl = new URL(page.url()).pathname;

    const other = await browser.newContext();
    const op = await other.newPage();
    await demoSignIn(op, "Nomvula Khumalo");
    for (const url of [applicationUrl, shortlistUrl, opportunityUrl, `${opportunityUrl}/edit`]) {
      const r = await op.goto(url);
      expect(r!.status(), url).toBe(404);
    }
    await other.close();
  });

  test("administrators record decisions with reasons and cannot edit claims", async ({ page }) => {
    await demoSignIn(page, "Platform Reviewer");
    await page.goto("/admin/organisations");
    const pending = page.getByRole("listitem").filter({ hasText: "Sahel Agritech Ventures" });
    await pending.getByText("Record a decision").click();
    await pending.getByLabel("Reason (kept in the audit record)").fill("Registration details confirmed against the website.");
    await pending.getByRole("button", { name: "Record decision" }).click();
    await expect(pending.getByText("approved", { exact: true })).toBeVisible();
    await page.goto("/admin/audit?action=organisation.approved");
    await expect(page.getByText("Registration details confirmed against the website.")).toBeVisible();

    await page.goto("/admin/verification");
    await page.getByRole("link", { name: /Led due diligence on four/ }).click();
    await expect(page.getByText("You cannot edit the claim.")).toBeVisible();
    await expect(page.getByRole("textbox", { name: /^Claim$/ })).toHaveCount(0);
  });
});
