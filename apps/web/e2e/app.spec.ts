import { expect, test } from "@playwright/test";

test("climate markets to allocation flow", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Climate Markets").first()).toBeVisible();
  const marketLink = page.locator("tbody a[href^='/market/']").first();
  await expect(marketLink).toBeVisible();
  const href = await marketLink.getAttribute("href");
  await page.goto(href!);
  await expect(page).toHaveURL(/\/market\//);
  await expect(page.getByRole("heading", { name: "Sources" })).toBeVisible();
  await expect(page.getByText("Kalshi market")).toBeVisible();
  await page.goto("/allocation");
  await page.getByRole("button", { name: "$100" }).click();
  await page.getByRole("button", { name: "Calculate" }).click();
  await expect(page.getByText("Cash held back")).toBeVisible();
  await expect(page.getByText("Maximum possible loss")).toBeVisible();
  await expect(page.getByText(/guaranteed profit/i)).toHaveCount(0);
});
