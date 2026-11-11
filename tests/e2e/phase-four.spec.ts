import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("Phase 4 public experience", () => {
  test("presents the complete landing journey accessibly", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", {
        level: 1,
        name: /Your work deserves a memory, not another tab\./u
      })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Four surfaces. One durable thread." })
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "From context to capability." })).toBeVisible();
    await expect(page.getByRole("link", { name: "Create your workspace" })).toHaveAttribute(
      "href",
      "/auth/register"
    );

    const metadata = await page.locator('meta[property="og:image"]').getAttribute("content");
    expect(metadata).toContain("/og.png");

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test("reflows the landing page at a narrow mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    await expect
      .poll(async () =>
        page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      )
      .toBe(true);
    await expect(
      page.getByRole("link", { name: "Create account", exact: true }).first()
    ).toBeVisible();
    await expect(
      page.getByText("Illustrative product direction · not live AI output")
    ).toBeVisible();
  });
});
