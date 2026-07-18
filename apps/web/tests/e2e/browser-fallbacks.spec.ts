import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, "showDirectoryPicker");
    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: () => {
          const count = Number(
            sessionStorage.getItem("camera-request-count") ?? "0",
          );
          sessionStorage.setItem("camera-request-count", String(count + 1));
          return Promise.reject(
            new DOMException(
              "Camera denied by fallback fixture",
              "NotAllowedError",
            ),
          );
        },
      },
    });
  });
});

test("portable browser path keeps tutorial, file intake, graph controls, and denied-camera fallback usable", async ({
  page,
}) => {
  await page.goto("/tutorial");
  await expect(
    page.getByRole("heading", { name: "Learn the graph at your pace." }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => sessionStorage.getItem("camera-request-count")),
  ).toBeNull();

  await page.goto("/studio");
  await page.locator("#studio-files").setInputFiles({
    name: "portable-note.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Portable note\nA local fallback fixture."),
  });
  await expect(page.getByRole("status")).toContainText(
    "1 accepted, 0 excluded",
  );
  await expect(page.getByText("portable-note.md")).toBeVisible();

  await page.goto("/demo");
  await expect(
    page.getByRole("button", { name: "Orbit view left" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Orbit view left" }).click();
  await page.getByRole("button", { name: "Zoom view in" }).click();
  await page.getByRole("button", { name: "Reset view" }).click();
  await page.getByRole("button", { name: "Enable hand camera" }).click();
  await expect(page.getByText("Camera access unavailable")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Select / }).first(),
  ).toBeEnabled();
  expect(
    await page.evaluate(() => sessionStorage.getItem("camera-request-count")),
  ).toBe("1");

  await page.goto("/perform?fixture=camera-free");
  await page.getByRole("button", { name: "Enable hand camera" }).click();
  await expect(page.getByText("camera fixture / no device")).toBeVisible();
  await expect(
    page.getByText(
      "This browser cannot create local recordings. Live performance mode remains available.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "exit performance" }),
  ).toBeEnabled();
});

test("essential local-first routes fit a narrow mobile viewport", async ({
  page,
}) => {
  await page.setViewportSize({ height: 844, width: 390 });

  for (const path of ["/tutorial", "/studio", "/demo"] as const) {
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();
    expect(
      await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      })),
    ).toEqual({ clientWidth: 390, scrollWidth: 390 });
  }

  await expect(
    page.getByRole("button", { name: "Zoom view in" }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Prototype routes" }),
  ).toBeVisible();
});
