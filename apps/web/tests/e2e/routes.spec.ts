import { expect, test } from "@playwright/test";

const routes = [
  ["/", "Explore the topologies of your thoughts."],
  ["/demo", "Graph artifact boundary"],
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

test("/demo reveals a title-only hover label after stable hover", async ({
  page,
}) => {
  await page.goto("/demo");

  await expect(
    page.getByRole("heading", { level: 1, name: "Graph artifact boundary" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Distributed note topology/ }).hover();

  const hoverLabel = page.locator(".scene-thought-label--hover");
  await expect(hoverLabel).toContainText("Distributed note topology", {
    timeout: 1200,
  });
  await expect(hoverLabel).not.toContainText("Thoughts become navigable");
});

test("/demo focuses a node and returns by mouse or keyboard", async ({
  page,
}) => {
  await page.goto("/demo");

  const nodeButton = page.getByRole("button", {
    name: /Distributed note topology/,
  });
  await nodeButton.click();
  await expect(page.getByText("focused / focus")).toBeVisible({
    timeout: 1600,
  });
  await expect(page.locator(".scene-selected-card")).toContainText(
    "Thoughts become navigable",
  );

  await page.getByRole("button", { name: "return" }).click();
  await expect(page.getByText("idle / overview")).toBeVisible();

  await nodeButton.click();
  await expect(page.getByText("focused / focus")).toBeVisible({
    timeout: 1600,
  });
  await page.keyboard.press("Escape");
  await expect(page.getByText("idle / overview")).toBeVisible();
});
