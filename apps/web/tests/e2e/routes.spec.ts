import { expect, test } from "@playwright/test";

const routes = [
  ["/", "Explore the topologies of your thoughts."],
  ["/demo", "The graph will emerge here."],
  ["/calibration", "Camera calibration comes later."],
  ["/debug", "Graph diagnostics"],
] as const;

for (const [path, heading] of routes) {
  test(`${path} renders its route shell`, async ({ page }) => {
    await page.goto(path);

    await expect(page).toHaveTitle(/Touch Traversal/);
    await expect(
      page.getByRole("heading", { level: 1, name: heading }),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Prototype routes" }),
    ).toBeVisible();
  });
}
