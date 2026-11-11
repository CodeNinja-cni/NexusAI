import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("NEXUS design system", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await page.goto("/design-system");
  });

  test("has no automatically detectable WCAG A/AA violations", async ({ page }) => {
    await expect(
      page.getByRole("heading", { level: 1, name: "Clarity at the edge of complexity." })
    ).toBeVisible();
    const scan = () =>
      new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();

    expect((await scan()).violations).toEqual([]);

    await page.getByRole("button", { name: "Open confirmation" }).click();
    await page.getByRole("dialog").evaluate(async (dialog) => {
      const animations = dialog.parentElement?.getAnimations({ subtree: true }) ?? [];
      await Promise.all(animations.map((animation) => animation.finished));
    });
    expect((await scan()).violations).toEqual([]);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Signal room", exact: true }).click();
    await page.getByRole("menu").evaluate(async (menu) => {
      await Promise.all(
        menu.getAnimations({ subtree: true }).map((animation) => animation.finished)
      );
    });
    expect((await scan()).violations).toEqual([]);
  });

  test("supports keyboard interaction for menus, dialogs, tooltips, tabs, and toasts", async ({
    page
  }) => {
    const workspaceButton = page.getByRole("button", { name: "Signal room", exact: true });
    await workspaceButton.focus();
    await workspaceButton.press("ArrowDown");
    await expect(page.getByRole("menu", { name: "Signal room" })).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Research studio", exact: true })).toBeVisible();

    const tooltipTrigger = page.getByRole("button", { name: "Explain ready status" });
    await tooltipTrigger.focus();
    await expect(page.getByRole("tooltip")).toContainText("Evidence has been indexed");
    await tooltipTrigger.press("Escape");
    await expect(page.getByRole("tooltip")).toHaveCount(0);

    const modalTrigger = page.getByRole("button", { name: "Open confirmation" });
    await modalTrigger.click();
    await expect(page.getByRole("dialog", { name: "Remove this source?" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(modalTrigger).toBeFocused();

    await page.getByRole("tab", { name: "Policy" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Tokens" })).toHaveAttribute(
      "aria-selected",
      "true"
    );

    await page.getByRole("button", { name: "Send toast" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Knowledge saved" })).toBeVisible();
  });

  test("reflows without horizontal page overflow and exposes mobile navigation", async ({
    page
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(async () =>
        page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      )
      .toBe(true);

    const mobileNavigationTrigger = page.getByRole("button", {
      name: "Open workspace navigation"
    });
    await mobileNavigationTrigger.click();
    await expect(page.getByRole("navigation", { name: "Workspace navigation" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("navigation", { name: "Workspace navigation" })
    ).not.toBeInViewport();
    await expect(mobileNavigationTrigger).toBeFocused();
  });
});
