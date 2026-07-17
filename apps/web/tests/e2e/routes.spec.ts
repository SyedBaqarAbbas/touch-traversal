import { expect, test } from "@playwright/test";

const routes = [
  ["/", "Explore the topologies of your thoughts."],
  ["/demo", "Graph artifact boundary"],
  ["/calibration", "Calibrate hand traversal."],
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

test("/demo camera denial preserves mouse and keyboard access", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: () =>
          Promise.reject(new DOMException("denied", "NotAllowedError")),
      },
    });
  });
  await page.goto("/demo");

  await expect(
    page.getByText("Frames remain local and are not uploaded"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Enable hand camera" }).click();
  await expect(page.getByText("camera unavailable")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry camera" }),
  ).toBeVisible();

  await page
    .getByRole("button", {
      name: /Distributed note topology/,
    })
    .click();
  await expect(page.getByText("focused / focus")).toBeVisible({
    timeout: 1600,
  });
});

test("/demo shows camera-active indicator and disable action", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: () => Promise.resolve(new MediaStream()),
      },
    });
  });
  await page.goto("/demo");

  await page.getByRole("button", { name: "Enable hand camera" }).click();
  await expect(page.getByText("camera active / local only")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Disable camera" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Disable camera" }).click();
  await expect(page.locator(".camera-access-panel__status")).toContainText(
    "camera disabled",
  );
  await expect(
    page.getByRole("button", { name: "Enable hand camera" }),
  ).toBeVisible();
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

test("/demo traverses an active focused neighbor", async ({ page }) => {
  await page.goto("/demo");

  await page
    .getByRole("button", {
      name: /Distributed note topology/,
    })
    .click();
  await expect(page.getByText("focused / focus")).toBeVisible({
    timeout: 1600,
  });

  await page
    .getByRole("button", {
      name: /Gesture traversal/,
    })
    .click();
  await expect(page.getByText("traversing / focus")).toBeVisible();
  await expect(page.locator(".scene-traversal-status")).toContainText(
    "Distributed note topology → Gesture traversal",
  );
  await page.keyboard.press("2");
  await expect(page.locator(".scene-topology-hud")).toContainText(
    "semantic topology",
  );
  await expect(page.getByText("focused / focus")).toBeVisible({
    timeout: 2200,
  });
  await expect(page.locator(".scene-selected-card")).toContainText(
    "Gestures turn the graph into a spatial traversal surface.",
  );
  await expect(page.locator(".debug-history-breadcrumb")).toHaveCount(0);

  await page.keyboard.press("Backspace");
  await expect(page.getByText("focused / focus")).toBeVisible();
  await expect(page.locator(".scene-selected-card")).toContainText(
    "Thoughts become navigable when notes are connected by typed edges.",
  );

  await page
    .getByRole("button", {
      name: /Gesture traversal/,
    })
    .click();
  await expect(page.getByText("traversing / focus")).toBeVisible();
  await expect(page.getByText("focused / focus")).toBeVisible({
    timeout: 2200,
  });
  await expect(page.locator(".scene-selected-card")).toContainText(
    "Gestures turn the graph into a spatial traversal surface.",
  );

  await page.getByRole("button", { name: "return" }).click();
  await expect(page.getByText("idle / overview")).toBeVisible();
});

test("/debug exposes only the compact traversal history breadcrumb", async ({
  page,
}) => {
  await page.goto("/debug");

  await expect(
    page.getByRole("heading", { name: "Traversal history" }),
  ).toBeVisible();
  await expect(page.locator(".debug-history-breadcrumb")).toContainText(
    "no traversal history",
  );
  await expect(page.locator(".scene-traversal-status")).toHaveCount(0);
});

test("/demo?input=mouse covers the repeatable mouse flow and label density", async ({
  page,
}) => {
  await page.goto("/demo?input=mouse");

  await expect(page.getByText("input / mouse")).toBeVisible();
  await expect(page.locator(".scene-topology-hud")).toContainText(
    "semantic topology",
  );
  await page.keyboard.press("2");
  await expect(page.locator(".scene-topology-hud")).toContainText(
    "community topology",
  );
  await page.getByRole("button", { name: /force/ }).click();
  await expect(page.locator(".scene-topology-hud")).toContainText(
    "force topology",
  );

  const nodeButton = page.getByRole("button", {
    name: /Distributed note topology/,
  });
  await nodeButton.hover();
  await expect(page.locator(".scene-thought-label--hover")).toContainText(
    "Distributed note topology",
  );

  await nodeButton.click();
  await expect(page.getByText("focused / focus")).toBeVisible({
    timeout: 1600,
  });
  await expect(page.locator(".scene-selected-card")).toContainText(
    "Thoughts become navigable",
  );
  await expect(page.locator(".scene-thought-label")).toHaveCount(3);

  await page.getByRole("button", { name: "return" }).click();
  await expect(page.getByText("idle / overview")).toBeVisible();
  await expect(page.locator(".scene-thought-label")).toHaveCount(0);
});

test("/demo?input=gesture-fixture routes injected hand gestures", async ({
  page,
}) => {
  await page.goto("/demo?input=gesture-fixture");

  await expect(page.getByText("input / gesture fixture")).toBeVisible();
  await expect(page.locator(".scene-gesture-hint")).toContainText(
    "gesture / pinch select",
    { timeout: 2200 },
  );
  await expect(page.getByText("focused / focus")).toBeVisible({
    timeout: 3200,
  });

  await expect(page.locator(".scene-gesture-hint")).toContainText(
    "gesture / pinch traverse",
    { timeout: 4200 },
  );
  await expect(page.getByText("focused / focus")).toBeVisible({
    timeout: 3600,
  });
  await expect(page.locator(".scene-selected-card")).toContainText(
    "Gestures turn the graph into a spatial traversal surface.",
  );

  await expect(page.locator(".scene-gesture-hint")).toContainText(
    "gesture / right swipe topology",
    { timeout: 4200 },
  );
  await expect(page.locator(".scene-topology-hud")).toContainText(
    "community topology",
  );

  await expect(page.locator(".scene-gesture-hint")).toContainText(
    "gesture / open palm return",
    { timeout: 4800 },
  );
  await expect(page.getByText("idle / overview")).toBeVisible({
    timeout: 1600,
  });
});
