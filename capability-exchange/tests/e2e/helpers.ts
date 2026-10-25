import { expect, type Page } from "@playwright/test";

/** Signs in as a fictional demo persona (demo mode only). */
export async function demoSignIn(page: Page, name: RegExp | string) {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: typeof name === "string" ? new RegExp(name) : name }).click();
  await expect(page).not.toHaveURL(/sign-in/);
}

export async function signOut(page: Page) {
  const menu = page.getByText("Menu", { exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: "Sign out" }).first().click();
  await expect(page).toHaveURL("/");
}

export const unique = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;

/** Minimal valid PDF bytes for upload tests. */
export const pdfFile = (name = "evidence.pdf") => ({
  name,
  mimeType: "application/pdf",
  buffer: Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n"),
});
