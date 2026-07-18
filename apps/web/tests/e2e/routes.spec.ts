import { expect, test, type Page, type TestInfo } from "@playwright/test";

const routes = [
  ["/", "Explore the topologies of your thoughts."],
  ["/demo", "Graph artifact boundary"],
  ["/calibration", "Calibrate hand traversal."],
  ["/debug", "Graph diagnostics"],
] as const;

const focusSettleTimeoutMs = 3200;
const gestureHintTimeoutMs = 4400;

async function restoreSceneHud(page: Page): Promise<void> {
  const scene = page.locator(".scene-shell");
  await page.mouse.move(32, 32);
  await expect(scene).toHaveAttribute("data-hud", "visible");
}

async function attachVisual(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  await testInfo.attach(name, {
    body: await page.screenshot({ animations: "disabled", fullPage: true }),
    contentType: "image/png",
  });
}

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
  await page
    .getByRole("button", { name: /Constellations before filing/ })
    .hover();

  const hoverLabel = page.locator(".scene-thought-label--hover");
  await expect(hoverLabel).toContainText("Constellations before filing", {
    timeout: 1200,
  });
  await expect(hoverLabel).not.toContainText("A memory observatory");
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
      name: /Constellations before filing/,
    })
    .click({ force: true });
  await expect(page.getByText("focused / focus")).toBeVisible({
    timeout: focusSettleTimeoutMs,
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
    name: /Constellations before filing/,
  });
  await nodeButton.click();
  await expect(page.getByText("focused / focus")).toBeVisible({
    timeout: focusSettleTimeoutMs,
  });
  await expect(page.locator(".scene-selected-card")).toContainText(
    "A memory observatory",
  );

  await page.getByRole("button", { name: "return", exact: true }).click();
  await expect(page.getByText("idle / overview")).toBeVisible();

  await nodeButton.click();
  await expect(page.getByText("focused / focus")).toBeVisible({
    timeout: focusSettleTimeoutMs,
  });
  await page.keyboard.press("Escape");
  await expect(page.getByText("idle / overview")).toBeVisible();
});

test("/demo traverses an active focused neighbor", async ({ page }) => {
  await page.goto("/demo");

  await page
    .getByRole("button", {
      name: /Constellations before filing/,
    })
    .click();
  await expect(page.getByText("focused / focus")).toBeVisible({
    timeout: focusSettleTimeoutMs,
  });

  await restoreSceneHud(page);
  await page
    .getByRole("button", {
      name: /Orientation before action/,
    })
    .click();
  await expect(page.getByText("traversing / focus")).toBeVisible();
  await expect(page.locator(".scene-traversal-status")).toContainText(
    "Constellations before filing → Orientation before action",
  );
  await page.keyboard.press("2");
  await expect(page.locator(".scene-topology-hud")).toContainText(
    "semantic topology",
  );
  await expect(page.getByText("focused / focus")).toBeVisible({
    timeout: focusSettleTimeoutMs,
  });
  await expect(page.locator(".scene-selected-card")).toContainText(
    "The first view should invite orientation before action.",
  );
  await expect(page.locator(".debug-history-breadcrumb")).toHaveCount(0);

  await page.keyboard.press("Backspace");
  await expect(page.getByText("focused / focus")).toBeVisible();
  await expect(page.locator(".scene-selected-card")).toContainText(
    "A memory observatory is a place for looking across thoughts",
  );

  await page
    .getByRole("button", {
      name: /Orientation before action/,
    })
    .click();
  await expect(page.getByText("traversing / focus")).toBeVisible();
  await expect(page.getByText("focused / focus")).toBeVisible({
    timeout: focusSettleTimeoutMs,
  });
  await expect(page.locator(".scene-selected-card")).toContainText(
    "The first view should invite orientation before action.",
  );

  await page.getByRole("button", { name: "return", exact: true }).click();
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
    name: /Constellations before filing/,
  });
  await restoreSceneHud(page);
  await nodeButton.hover();
  await expect(page.locator(".scene-thought-label--hover")).toContainText(
    "Constellations before filing",
  );

  await nodeButton.click();
  await expect(page.getByText("focused / focus")).toBeVisible({
    timeout: focusSettleTimeoutMs,
  });
  await expect(page.locator(".scene-selected-card")).toContainText(
    "A memory observatory",
  );
  await expect(page.locator(".scene-thought-label")).toHaveCount(3);

  await page.getByRole("button", { name: "return", exact: true }).click();
  await expect(page.getByText("idle / overview")).toBeVisible();
  await expect(page.locator(".scene-thought-label")).toHaveCount(0);
});

test("/demo visual states cover temporal mode, hover, focus, and HUD idle", async ({
  page,
}, testInfo) => {
  await page.goto("/demo?input=mouse");

  const scene = page.locator(".scene-shell");
  await expect(scene).toHaveAttribute("data-hud", "visible");
  await attachVisual(page, testInfo, "overview");
  await page.getByRole("button", { name: /temporal/ }).click();
  await expect(page.locator(".scene-topology-hud")).toContainText(
    "temporal topology",
  );
  await page.waitForTimeout(2300);
  await attachVisual(page, testInfo, "temporal-topology");

  const nodeButton = page.getByRole("button", {
    name: /Constellations before filing/,
  });
  await restoreSceneHud(page);
  await nodeButton.hover();
  await expect(page.locator(".scene-thought-label--hover")).toContainText(
    "Constellations before filing",
  );
  await attachVisual(page, testInfo, "hovered-node");
  await nodeButton.click();
  await expect(page.getByText("focused / focus")).toBeVisible({
    timeout: focusSettleTimeoutMs,
  });
  await expect(page.locator(".scene-selected-card")).toContainText(
    "A memory observatory",
  );
  await attachVisual(page, testInfo, "focused-node");

  await page.waitForTimeout(4500);
  await expect(scene).toHaveAttribute("data-hud", "dimmed");
  await page.mouse.move(32, 32);
  await expect(scene).toHaveAttribute("data-hud", "visible");
});

test("/demo respects reduced-motion media preferences", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/demo?input=mouse");

  const scene = page.locator(".scene-shell");
  await expect(scene).toHaveAttribute("data-motion", "reduced");
  await page
    .getByRole("button", {
      name: /Constellations before filing/,
    })
    .click();
  await expect(page.getByText("focused / focus")).toBeVisible({
    timeout: focusSettleTimeoutMs,
  });
  await expect(page.locator(".scene-selected-card")).toContainText(
    "A memory observatory",
  );
  await attachVisual(page, testInfo, "reduced-motion");
});

test("/calibration captures its visual state", async ({ page }, testInfo) => {
  await page.goto("/calibration");
  await expect(
    page.getByRole("heading", { level: 1, name: "Calibrate hand traversal." }),
  ).toBeVisible();
  await attachVisual(page, testInfo, "calibration");
});

test("/demo?input=gesture-fixture routes injected hand gestures", async ({
  page,
}) => {
  await page.goto("/demo?input=gesture-fixture");

  await expect(page.getByText("input / gesture fixture")).toBeVisible();
  await expect(page.locator(".scene-gesture-hint")).toContainText(
    "gesture / pinch select",
    { timeout: gestureHintTimeoutMs },
  );
  await expect(page.getByText("focused / focus")).toBeVisible({
    timeout: focusSettleTimeoutMs,
  });

  await expect(page.locator(".scene-gesture-hint")).toContainText(
    "gesture / pinch traverse",
    { timeout: gestureHintTimeoutMs },
  );
  await expect(page.getByText("focused / focus")).toBeVisible({
    timeout: focusSettleTimeoutMs,
  });
  await expect(page.locator(".scene-selected-card")).toContainText(
    "The first view should invite orientation before action.",
  );

  await expect(page.locator(".scene-gesture-hint")).toContainText(
    "gesture / right swipe topology",
    { timeout: gestureHintTimeoutMs },
  );
  await expect(page.locator(".scene-topology-hud")).toContainText(
    "community topology",
  );

  await expect(page.locator(".scene-gesture-hint")).toContainText(
    "gesture / open palm return",
    { timeout: gestureHintTimeoutMs },
  );
  await expect(page.getByText("idle / overview")).toBeVisible({
    timeout: focusSettleTimeoutMs,
  });
});

test("/demo?recording=1 plays a clean deterministic showcase", async ({
  page,
}) => {
  test.setTimeout(36_000);
  await page.goto("/demo?recording=1");

  const scene = page.locator(".scene-shell");
  const cue = page.locator(".scene-recording-cue");
  await expect(scene).toHaveAttribute("data-presentation", "recording");
  await expect(cue).toContainText("constellation / reveal");
  await expect(
    page.getByRole("navigation", { name: "Prototype routes" }),
  ).toHaveCount(0);
  await expect(page.locator(".scene-node-list")).not.toBeVisible();
  await expect(page.locator(".scene-performance-note")).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Enable hand camera" }),
  ).toBeVisible();

  await expect(cue).toContainText("hand / acquiring locally", {
    timeout: 5_500,
  });
  await expect(cue).toContainText("gesture / select", { timeout: 5_000 });
  await expect(page.locator(".scene-selected-card")).toContainText(
    "Constellations before filing",
  );

  await expect(cue).toContainText("gesture / traverse", { timeout: 7_000 });
  await expect(page.locator(".scene-traversal-status")).toBeVisible();
  await expect(cue).toContainText("topology / communities", {
    timeout: 10_000,
  });
  await expect(page.locator(".scene-topology-hud")).toContainText(
    "community topology",
  );

  await expect(cue).toContainText("thoughts remain connected", {
    timeout: 13_000,
  });
  await expect(page.locator(".scene-selected-card")).toHaveCount(0);
});
