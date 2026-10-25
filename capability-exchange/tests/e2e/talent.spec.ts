import { expect, test } from "@playwright/test";
import { demoSignIn, pdfFile, signOut, unique } from "./helpers";

test.describe("talent workflow", () => {
  test("1. a candidate can register, save a profile and return later", async ({ page }) => {
    const email = `e2e-${unique()}@example.test`;
    await page.goto("/sign-up");
    await page.getByLabel("As a professional").check();
    await page.getByLabel("Your name").fill("Test Candidate");
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill("a long test password");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/talent\/profile/);
    await expect(page.getByText("Your draft profile has been created")).toBeVisible();

    const basics = page.getByRole("form", { name: "Name and headline" });
    await basics.getByLabel("Professional headline").fill("Risk and compliance lead for payments");
    await expect(basics.getByText(/Saved at/)).toBeVisible();
    const location = page.getByRole("form", { name: "Location, time zone and languages" });
    await location.getByRole("textbox", { name: /^Country/ }).fill("Kenya");
    await location.getByRole("button", { name: "Save" }).click();
    await expect(location.getByText(/Saved at/)).toBeVisible();

    await signOut(page);
    await page.goto("/sign-in");
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill("a long test password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/talent/);
    await page.goto("/talent/profile");
    await expect(page.getByLabel("Professional headline")).toHaveValue("Risk and compliance lead for payments");
    await expect(page.getByRole("textbox", { name: /^Country/ })).toHaveValue("Kenya");
  });

  test("2 and 3. a candidate adds a project, claim and private evidence that nobody else can open", async ({ page, browser }) => {
    await demoSignIn(page, "Lindiwe Dlamini");
    await page.goto("/talent/portfolio/new");
    await page.getByRole("textbox", { name: /^Name/ }).fill("Warehouse network redesign");
    await page.getByLabel("What you did personally").fill("I redesigned the routing between three warehouses.");
    await page.getByRole("button", { name: "Save project" }).click();
    await expect(page).toHaveURL(/\/talent\/portfolio\/[0-9a-f-]+\?saved=1/);

    const addClaim = page.getByRole("form", { name: "Add a claim" });
    await addClaim.getByLabel("Claim").fill("Cut average delivery time from 4 days to 2 days.");
    await addClaim.getByRole("button", { name: "Add claim" }).click();
    await expect(page.getByText("Cut average delivery time from 4 days to 2 days.").first()).toBeVisible();
    await expect(page.getByText("Self-reported").first()).toBeVisible();

    await page.getByText("Upload a file for this claim").click();
    const upload = page.getByRole("form", { name: "Upload evidence file" });
    await upload.getByLabel("File").setInputFiles(pdfFile("delivery-report.pdf"));
    await upload.getByLabel("Title").fill("Delivery report (redacted)");
    await upload.getByRole("button", { name: "Upload file" }).click();
    await expect(page.getByRole("link", { name: "Delivery report (redacted)" })).toBeVisible();
    // Uploading supplies evidence; it never verifies.
    await expect(page.getByText("Evidence supplied").first()).toBeVisible();
    await expect(page.getByText("Independently verified")).toHaveCount(0);

    const href = await page.getByRole("link", { name: "Delivery report (redacted)" }).getAttribute("href");
    expect(href).toMatch(/^\/api\/evidence\/[0-9a-f-]+\/download$/);
    // The owner gets a short-lived link.
    const own = await page.request.get(href!, { maxRedirects: 0 });
    expect(own.status()).toBe(302);
    expect(own.headers()["location"]).toMatch(/\/api\/files\//);

    // Anonymous and other signed-in people get "not found", by direct URL and API.
    const anon = await browser.newContext();
    expect((await anon.request.get(href!, { maxRedirects: 0 })).status()).toBe(404);
    const employer = await browser.newContext();
    const ep = await employer.newPage();
    await demoSignIn(ep, "Kofi Asante");
    expect((await ep.request.get(href!, { maxRedirects: 0 })).status()).toBe(404);
    // A signed download link stops working after it expires; a tampered one never works.
    const tampered = own.headers()["location"]!.replace(/.$/, "x");
    expect((await anon.request.get(tampered)).status()).toBe(404);
    await anon.close();
    await employer.close();
  });

  test("3. private profiles are not reachable by employers through direct URLs", async ({ page, browser }) => {
    await demoSignIn(page, "Samuel Tesfaye");
    await page.goto("/talent/profile/preview?as=employer");
    await expect(page.getByText("Your profile is private")).toBeVisible();
    // The owner's own export gives us the profile id to try as someone else.
    const res = await page.request.get("/api/account/export");
    const data = await res.json();
    const profileId = data.profile.id as string;

    const emp = await browser.newContext();
    const ep = await emp.newPage();
    await demoSignIn(ep, "Kofi Asante");
    const r = await ep.goto(`/employer/talent/${profileId}`);
    expect(r!.status()).toBe(404);
    await ep.goto("/employer/search?q=Samuel");
    await expect(ep.getByText("No discoverable profiles match")).toBeVisible();
    await emp.close();

    const anon = await browser.newContext();
    expect((await anon.request.get("/api/account/export")).status()).toBe(401);
    await anon.close();
  });

  test("4. a candidate can enable and revoke a share link", async ({ page, browser }) => {
    await demoSignIn(page, "Karim Benali");
    await page.goto("/talent/sharing");
    const form = page.getByRole("form", { name: "Create a share link" });
    await form.getByLabel("Who is it for?").fill("E2E recruiter");
    await form.getByRole("button", { name: "Create link" }).click();
    const url = await page.getByLabel("Your new link").inputValue();
    expect(url).toMatch(/\/share\/[\w-]+$/);
    const path = new URL(url).pathname;

    const anon = await browser.newContext();
    const ap = await anon.newPage();
    await ap.goto(path);
    await expect(ap.getByRole("heading", { name: /Karim Benali/ })).toBeVisible();
    await expect(ap.getByText("Shared only with the candidate's approval")).toBeVisible();

    await page.reload();
    const card = page.getByRole("listitem").filter({ hasText: "E2E recruiter" });
    page.once("dialog", (d) => d.accept());
    await card.getByRole("button", { name: "Revoke link" }).click();
    await expect(card.getByText("Revoked", { exact: true })).toBeVisible();
    const after = await ap.goto(path);
    expect(after!.status()).toBe(404);
    await anon.close();
  });

  test("9. a candidate can approve or reject assistant suggestions", async ({ page }) => {
    await demoSignIn(page, "Efua Mensah-Bonsu");
    await page.goto("/talent/assistant");
    await expect(page.getByText("Demonstration responses")).toBeVisible();
    await page.getByRole("button", { name: "Summarise" }).click();
    await expect(page.getByText("Summary of your shareable profile")).toBeVisible();
    await expect(page.getByText("Demonstration response: rules, not AI").first()).toBeVisible();
    const summary = page.locator("section").filter({ hasText: "Summary of your shareable profile" }).last();
    await summary.getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByText(/^Dismissed \d/).first()).toBeVisible();

    await page.getByRole("form", { name: "Suggest clearer wording" }).getByRole("button", { name: "Suggest wording" }).click();
    await expect(page.getByRole("button", { name: "Approve and save" })).toBeVisible();
    await page.getByRole("button", { name: "Approve and save" }).click();
    await expect(page.getByText(/^Approved \d/).first()).toBeVisible();
  });
});
