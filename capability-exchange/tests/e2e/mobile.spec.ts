import { expect, test } from "@playwright/test";
import { demoSignIn } from "./helpers";

test.describe("12. mobile", () => {
  test("a candidate can navigate, edit and apply on a phone-sized screen", async ({ page }) => {
    await demoSignIn(page, "Tendai Moyo");
    await expect(page).toHaveURL(/\/talent$/);
    const noHorizontalScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    expect(await noHorizontalScroll()).toBe(true);

    await page.getByText("Menu", { exact: true }).click();
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Opportunities", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Opportunities", level: 1 })).toBeVisible();
    expect(await noHorizontalScroll()).toBe(true);
    await page.getByRole("link", { name: "Fractional Head of Procurement" }).click();
    await expect(page.getByText("How your profile compares")).toBeVisible();
    await page.getByLabel("Expression of interest").fill("I have set up procurement frameworks across mine sites and would like to do the same for your construction work.");
    await page.getByLabel("I have reviewed what will be shared").check();
    await page.getByRole("button", { name: "Submit application" }).click();
    await expect(page.getByText("Application submitted")).toBeVisible();
    expect(await noHorizontalScroll()).toBe(true);
  });

  test("an employer can review an application on a phone-sized screen", async ({ page }) => {
    await demoSignIn(page, "Nomvula Khumalo");
    await page.getByRole("link", { name: "Wanjiru" }).first().click();
    await expect(page.getByText("Requirements compared with the shared profile")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
});
