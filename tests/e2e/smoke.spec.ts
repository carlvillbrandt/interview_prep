import { expect, test } from "@playwright/test";

/**
 * Smoke test: Welcome → Industry → Company → Pre-flight, then Start with the
 * interview API mocked (no Tavus/Anthropic calls are made). Runs against the
 * fixture firm enabled by NEXT_PUBLIC_E2E_FIXTURES=1 (see playwright.config.ts).
 */

test("welcome → industry → company → pre-flight → start (mocked)", async ({ page }) => {
  // Mock the server boundary to Tavus: start fails with a concurrency limit, as Tavus would report it.
  let startBody: Record<string, unknown> | null = null;
  await page.route("**/api/interview/start", async (route) => {
    startBody = route.request().postDataJSON();
    await route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "concurrency_limit",
          message: "Too many interviews are running on this account right now. End any open interview tabs, wait a minute, then try again.",
          retryable: true,
        },
      }),
    });
  });

  // Screen 1: Welcome
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Walk into the room");
  await expect(page.getByRole("link", { name: /^Investment Banking:/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Venture Capital & Private Equity:/ })).toBeVisible();
  await expect(page.getByText("not affiliated with or endorsed by any listed firm")).toBeVisible();
  await page.getByRole("link", { name: /^Consulting: 1 firm/ }).click();

  // Screen 2: Company selection (with search)
  await expect(page).toHaveURL(/\/industry\/consulting$/);
  await expect(page.getByRole("heading", { level: 1, name: "Consulting" })).toBeVisible();
  const search = page.getByRole("searchbox", { name: "Search firms" });
  await search.fill("no such firm");
  await expect(page.getByRole("status").filter({ hasText: "No firms match" })).toBeVisible();
  await search.fill("meridian");
  await page.getByRole("link", { name: /Meridian Test Partners/ }).click();

  // Screen 3: Pre-flight modal (privacy notice first, then live preview + options)
  await expect(page).toHaveURL(/\/interview\/consulting\/e2e-test-firm$/);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Before your camera turns on" })).toBeVisible();
  await expect(dialog).toContainText("Tavus");
  await dialog.getByRole("button", { name: /I understand/ }).click();

  await expect(dialog.getByRole("heading", { name: /Ready for Meridian Test Partners/ })).toBeVisible();
  await expect(dialog.locator("video")).toBeVisible();
  await dialog.getByLabel("Role / level").selectOption("MBA Associate");
  await dialog.getByLabel("Interview focus").selectOption("Behavioral");
  await dialog.getByLabel(/first name/).fill("Sam");
  const start = dialog.getByRole("button", { name: "Start interview" });
  await expect(start).toBeEnabled();
  await start.click();

  // Screen 4: full-screen stage shows a friendly, retryable error from the mocked API.
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expect(page.getByRole("alertdialog")).toContainText("Too many interviews are running");
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  expect(startBody).toEqual({
    industry: "consulting",
    company: "e2e-test-firm",
    level: "MBA Associate",
    focus: "Behavioral",
    candidateName: "Sam",
  });

  // Back to setup restores the pre-flight modal.
  await page.getByRole("button", { name: "Back to setup" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("welcome page is keyboard navigable", async ({ page }) => {
  await page.goto("/");
  const target = page.getByRole("link", { name: /^Investment Banking:/ });
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((el) => el === document.activeElement)) break;
  }
  await expect(target).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/industry\/investment-banking$/);
  await expect(page.getByText("Firms are on their way")).toBeVisible();
});

test("unknown firm shows the not-found page", async ({ page }) => {
  // With Cache Components the shell streams first, so the HTTP status stays 200; the UI must still say 404.
  await page.goto("/interview/consulting/not-a-firm");
  await expect(page.getByRole("heading", { name: "This room is empty" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
