import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { demoSignIn } from "./helpers";

async function audit(page: import("@playwright/test").Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

test.describe("accessibility", () => {
  test("public pages have no serious automated accessibility issues", async ({ page }) => {
    for (const path of ["/", "/sign-in", "/sign-up", "/privacy", "/how-it-works"]) {
      await page.goto(path);
      await audit(page);
    }
  });

  test("main signed-in screens have no serious automated accessibility issues", async ({ page }) => {
    await demoSignIn(page, "Efua Mensah-Bonsu");
    for (const path of ["/talent", "/talent/profile", "/talent/profile/preview", "/talent/portfolio", "/talent/sharing", "/talent/assistant", "/opportunities", "/settings"]) {
      await page.goto(path);
      await audit(page);
    }
  });

  test("12. sign-in and core navigation work with the keyboard alone", async ({ page }) => {
    await page.goto("/sign-in");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
    // Move focus to the first demo persona with the keyboard and activate it.
    const persona = page.getByRole("button", { name: /Efua Mensah-Bonsu/ });
    for (let i = 0; i < 40 && !(await persona.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
    await expect(persona).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/talent$/);

    await page.goto("/talent/profile");
    const headline = page.getByLabel("Professional headline");
    await headline.focus();
    await page.keyboard.press("Control+A");
    await page.keyboard.type("Infrastructure finance lead (keyboard edit)");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("form", { name: "Name and headline" }).getByText(/Saved at/)).toBeVisible();
    // Focus outlines are visible.
    const outline = await headline.evaluate((el) => {
      (el as HTMLElement).focus();
      return getComputedStyle(el).outlineStyle;
    });
    expect(outline).not.toBe("none");
  });
});
