import { expect, test } from "@playwright/test";

test.skip("embed implementation is introduced after the v1 protocol contract", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173");
  await expect(page.locator("#app")).toContainText("Consulta Autofill");
});
