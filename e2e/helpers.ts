/**
 * E2E Test Helpers — Sprint 65
 * Shared utilities, fixtures, and page object helpers for Playwright tests.
 */
import { Page, expect } from "@playwright/test";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

export const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

/** Simulated test trader credentials (used in mock auth bypass for E2E) */
export const TEST_TRADER = {
  name: "Test Trader",
  role: "user",
  email: "trader@test.tradegateway.local",
};

export const TEST_ADMIN = {
  name: "Test Admin",
  role: "admin",
  email: "admin@test.tradegateway.local",
};

// ─── PAGE HELPERS ─────────────────────────────────────────────────────────────

/**
 * Navigate to the app and wait for the main layout to load.
 * In E2E tests we check the public-facing pages and the login redirect flow.
 */
export async function gotoApp(page: Page, path = "/") {
  await page.goto(`${BASE_URL}${path}`);
  await page.waitForLoadState("networkidle");
}

/**
 * Check that a page title or heading is visible.
 */
export async function expectHeading(page: Page, text: string | RegExp) {
  await expect(page.getByRole("heading", { name: text })).toBeVisible({ timeout: 10_000 });
}

/**
 * Wait for a toast notification to appear.
 */
export async function expectToast(page: Page, text: string | RegExp) {
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: text })).toBeVisible({ timeout: 8_000 });
}

/**
 * Fill a form field by label text.
 */
export async function fillByLabel(page: Page, label: string, value: string) {
  const field = page.getByLabel(label, { exact: false });
  await field.fill(value);
}

/**
 * Click a button by its visible text.
 */
export async function clickButton(page: Page, text: string) {
  await page.getByRole("button", { name: text }).click();
}

/**
 * Wait for a table row containing specific text to appear.
 */
export async function expectTableRow(page: Page, text: string) {
  await expect(page.locator("tr").filter({ hasText: text })).toBeVisible({ timeout: 10_000 });
}

/**
 * Select a value from a shadcn Select component by trigger label.
 */
export async function selectOption(page: Page, triggerLabel: string, optionText: string) {
  await page.getByRole("combobox", { name: triggerLabel }).click();
  await page.getByRole("option", { name: optionText }).click();
}

// ─── NAVIGATION HELPERS ───────────────────────────────────────────────────────

export async function gotoDeclarationSubmit(page: Page) {
  await gotoApp(page, "/app/declarations/new");
}

export async function gotoTraderDeclarations(page: Page) {
  await gotoApp(page, "/app/declarations");
}

export async function gotoAeoSelfAssessment(page: Page) {
  await gotoApp(page, "/app/trader/aeo-self-assessment");
}

export async function gotoDrawbackAutomation(page: Page) {
  await gotoApp(page, "/app/finance/drawback-automation");
}

export async function gotoAdminDeclarations(page: Page) {
  await gotoApp(page, "/app/admin/declarations");
}

export async function gotoNotificationCentre(page: Page) {
  await gotoApp(page, "/app/notifications");
}

// ─── ASSERTION HELPERS ────────────────────────────────────────────────────────

/**
 * Assert that the page is redirected to the login page when unauthenticated.
 */
export async function expectLoginRedirect(page: Page) {
  await expect(page).toHaveURL(/login|oauth|signin/, { timeout: 8_000 });
}

/**
 * Assert that a badge with a given status text is visible.
 */
export async function expectStatusBadge(page: Page, status: string) {
  await expect(page.locator("[data-slot='badge']").filter({ hasText: status })).toBeVisible({ timeout: 8_000 });
}

/**
 * Assert that a loading spinner is NOT visible (page has finished loading).
 */
export async function expectNoSpinner(page: Page) {
  await expect(page.locator(".animate-spin")).toHaveCount(0, { timeout: 15_000 });
}

/**
 * Assert that an element with a given test ID is visible.
 */
export async function expectTestId(page: Page, testId: string) {
  await expect(page.getByTestId(testId)).toBeVisible({ timeout: 8_000 });
}
