import { expect, test, type Page, type TestInfo } from "@playwright/test";

import rawGestureFixtures from "../fixtures/gesture-fixtures.json";
import {
  expandGestureFixtures,
  findGestureFixture,
  type GestureFixtureFile,
  type TimestampedLandmarkFrame,
} from "../../lib/gesture-classifier";

const routes = [
  ["/", "Explore the topologies of your thoughts."],
  ["/demo", "Graph artifact boundary"],
  ["/perform", "Webcam graph performance"],
  ["/studio", "Choose notes for a local graph."],
  ["/calibration", "Calibrate hand traversal."],
  ["/debug", "Graph diagnostics"],
] as const;

const focusSettleTimeoutMs = 3200;
const gestureHintTimeoutMs = 4400;
const gestureFixtures = expandGestureFixtures(
  rawGestureFixtures as unknown as GestureFixtureFile,
);

async function restoreSceneHud(page: Page): Promise<void> {
  const scene = page.locator(".scene-shell");
  const nodeRail = page.locator(".scene-node-list");
  await nodeRail.evaluate(async (element) => {
    await Promise.all(
      element.getAnimations().map((animation) => animation.finished),
    );
  });
  await page.evaluate(() => {
    window.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerType: "mouse",
      }),
    );
  });
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

async function pointHandCursorAtNode(
  page: Page,
  accessibleName: RegExp,
): Promise<void> {
  const node = page.getByRole("button", { name: accessibleName });
  const box = await node.boundingBox();
  if (!box) {
    throw new Error(`Could not locate gesture target ${accessibleName}`);
  }
  const pointing = findGestureFixture(gestureFixtures, "pointing").frames[0]!;
  await page.evaluate(
    ({ center, frame }) => {
      const timestampMs = performance.now();
      window.dispatchEvent(
        new CustomEvent("touch-traversal:hand-cursor-frame", {
          detail: {
            confidence: 0.92,
            pinchProgress: 0,
            position: {
              x: (center.x / window.innerWidth) * 2 - 1,
              y: 1 - (center.y / window.innerHeight) * 2,
            },
            status: "tracking",
            timestampMs,
            visible: true,
          },
        }),
      );
      window.dispatchEvent(
        new CustomEvent("touch-traversal:landmark-frame", {
          detail: { ...frame, timestampMs },
        }),
      );
    },
    {
      center: { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      frame: pointing,
    },
  );
}

async function injectLandmarkFrames(
  page: Page,
  frames: readonly TimestampedLandmarkFrame[],
): Promise<void> {
  await page.evaluate((fixtureFrames) => {
    const startAtMs = performance.now();
    for (const frame of fixtureFrames) {
      window.dispatchEvent(
        new CustomEvent("touch-traversal:landmark-frame", {
          detail: {
            ...frame,
            timestampMs: startAtMs + frame.timestampMs,
          },
        }),
      );
    }
  }, frames);
}

async function releaseHandInput(page: Page): Promise<void> {
  await page.evaluate(() => {
    const timestampMs = performance.now();
    window.dispatchEvent(
      new CustomEvent("touch-traversal:landmark-frame", {
        detail: { hand: null, timestampMs },
      }),
    );
    window.dispatchEvent(
      new CustomEvent("touch-traversal:hand-cursor-frame", { detail: null }),
    );
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

test("first-run tutorial supports mouse-only practice, resume, and replay", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Take a calm, private first pass." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Mouse and keyboard only" }).click();
  await expect(page).toHaveURL(/\/tutorial/);
  await expect(
    page.getByRole("heading", {
      name: "Thoughts become nodes. Relationships become edges.",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "Practice with fiction before choosing personal notes.",
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("touch-traversal:tutorial:v2") ?? "null"),
    ),
  ).toMatchObject({ inputPath: "mouse-keyboard", status: "active" });

  await page.goto("/demo");
  await page.getByRole("link", { name: "controls" }).click();
  await expect(page).toHaveURL(/\/tutorial\/?#controls$/);
  await expect(
    page.getByRole("heading", {
      name: "Focus, traverse, return, reshape, reset.",
    }),
  ).toBeVisible();

  for (let remaining = 6; remaining > 0; remaining -= 1) {
    await page
      .getByRole("button", {
        name: /^(?:Next|Next \/ skip optional|Finish)$/,
      })
      .click();
  }
  await expect(
    page.getByRole("heading", { name: "The graph is yours to explore." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Replay tutorial" }).click();
  await expect(
    page.getByRole("heading", { name: "Learn the graph at your pace." }),
  ).toBeVisible();
});

test("tutorial requests no permissions, supports skip, and remains available from help", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: () => {
          sessionStorage.setItem("unexpected-camera-request", "true");
          return Promise.reject(
            new Error("tutorial must not request a device"),
          );
        },
      },
    });
  });
  await page.goto("/tutorial");
  await expect(
    page.getByRole("heading", { name: "Learn the graph at your pace." }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("unexpected-camera-request"),
    ),
  ).toBeNull();

  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("touch-traversal:tutorial:v2") ?? "null"),
    ),
  ).toMatchObject({ status: "skipped" });

  await page.goto("/demo");
  await page.getByRole("link", { name: "help" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Thoughts become nodes. Relationships become edges.",
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("unexpected-camera-request"),
    ),
  ).toBeNull();
});

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

test("/perform camera-free fixture composites the graph and preserves scene state", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: () =>
          Promise.reject(new Error("fixture must not request a device")),
      },
    });
  });
  await page.goto("/perform?fixture=camera-free");

  const scene = page.locator(".scene-shell");
  const cameraLayer = page.locator(".performance-camera-layer");
  await expect(scene).toHaveAttribute("data-presentation", "performance");
  await expect(scene).toHaveAttribute("data-motion", "full");
  await expect(cameraLayer).toHaveAttribute("data-active", "false");
  await expect(
    page.getByText("Camera stays off until you enable it"),
  ).toBeVisible();

  await page.getByRole("button", { name: "Enable hand camera" }).click();
  await expect(cameraLayer).toHaveAttribute("data-active", "true");
  await expect(page.getByText("camera fixture / no device")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Disable camera" }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: /Constellations before filing/ })
    .click();
  await expect(page.getByText("focused / focus")).toBeVisible({
    timeout: focusSettleTimeoutMs,
  });
  await expect(page.locator(".scene-selected-card")).toContainText(
    "A memory observatory",
  );

  await page.getByRole("button", { name: "Graph only" }).click();
  await expect(scene).toHaveAttribute("data-performance-layer", "graph-only");
  await expect(page.locator(".scene-selected-card")).toContainText(
    "A memory observatory",
  );
  await page.getByRole("button", { name: "Show video layer" }).click();
  await expect(scene).toHaveAttribute("data-performance-layer", "video");

  const mirror = page.getByRole("button", { name: "mirror" });
  await expect(mirror).toHaveAttribute("aria-pressed", "true");
  await mirror.click();
  await expect(scene).toHaveAttribute("data-performance-mirrored", "false");

  await page
    .getByRole("button", { name: "Graph and video emphasis: balanced" })
    .click();
  await expect(scene).toHaveAttribute("data-performance-emphasis", "graph");
  const framingBefore = await cameraLayer.getAttribute("data-framing-revision");
  await page.getByRole("button", { name: "reset framing" }).click();
  await expect(cameraLayer).not.toHaveAttribute(
    "data-framing-revision",
    framingBefore ?? "0",
  );
  await attachVisual(page, testInfo, "performance-camera-free");
});

test("/perform denial falls back to a complete graph path", async ({
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
  await page.goto("/perform");

  await page.getByRole("button", { name: "Enable hand camera" }).click();
  await expect(page.getByText("camera unavailable")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry camera" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Constellations before filing/ })
    .click({ force: true });
  await expect(page.getByText("focused / focus")).toBeVisible({
    timeout: focusSettleTimeoutMs,
  });
});

test("/perform reuses one stream, stops it on exit, and handles track end", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: () => {
          const canvas = document.createElement("canvas");
          canvas.width = 640;
          canvas.height = 480;
          const stream = canvas.captureStream(5);
          const track = stream.getVideoTracks()[0]!;
          const nativeStop = track.stop.bind(track);
          track.stop = () => {
            const stops = Number(sessionStorage.getItem("mock-camera-stops"));
            sessionStorage.setItem("mock-camera-stops", String(stops + 1));
            nativeStop();
          };
          const requests = Number(
            sessionStorage.getItem("mock-camera-requests"),
          );
          sessionStorage.setItem("mock-camera-requests", String(requests + 1));
          (
            window as typeof window & { __endMockCameraTrack?: () => void }
          ).__endMockCameraTrack = () =>
            track.dispatchEvent(new Event("ended"));
          return Promise.resolve(stream);
        },
      },
    });
  });
  await page.goto("/perform");
  await page.getByRole("button", { name: "Enable hand camera" }).click();
  await expect(page.getByText("camera active / local only")).toBeVisible();

  await page.getByRole("button", { name: "Graph only" }).click();
  await page.getByRole("button", { name: "Show video layer" }).click();
  expect(
    await page.evaluate(() => sessionStorage.getItem("mock-camera-requests")),
  ).toBe("1");

  await page.evaluate(() =>
    (
      window as typeof window & { __endMockCameraTrack?: () => void }
    ).__endMockCameraTrack?.(),
  );
  await expect(page.getByText("camera error")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry camera" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Retry camera" }).click();
  await expect(page.getByText("camera active / local only")).toBeVisible();
  await page.getByRole("button", { name: "exit performance" }).click();
  await expect(page).toHaveURL(/\/demo\/?$/);
  expect(
    await page.evaluate(() => sessionStorage.getItem("mock-camera-requests")),
  ).toBe("2");
  expect(
    Number(
      await page.evaluate(() => sessionStorage.getItem("mock-camera-stops")),
    ),
  ).toBeGreaterThanOrEqual(2);
});

test("/perform preserves reduced-motion and named controls", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/perform?fixture=camera-free");

  await expect(page.locator(".scene-shell")).toHaveAttribute(
    "data-motion",
    "reduced",
  );
  await expect(
    page.getByRole("button", { name: "Graph and video emphasis: balanced" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "mirror" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "reset framing" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "exit performance" }),
  ).toBeVisible();
});

test("/perform records and downloads the deterministic local composition", async ({
  page,
}) => {
  await page.addInitScript(() => {
    class MockMediaRecorder extends EventTarget {
      static isTypeSupported(mimeType: string) {
        return mimeType === "video/webm;codecs=vp8";
      }

      readonly mimeType: string;
      state: RecordingState = "inactive";

      constructor(stream: MediaStream, options?: MediaRecorderOptions) {
        super();
        this.mimeType = options?.mimeType ?? "video/webm";
        sessionStorage.setItem(
          "recording-audio-tracks",
          String(stream.getAudioTracks().length),
        );
        sessionStorage.setItem("recording-mime", this.mimeType);
      }

      start() {
        this.state = "recording";
      }

      stop() {
        if (this.state === "inactive") return;
        this.state = "inactive";
        queueMicrotask(() => {
          const dataEvent = new Event("dataavailable") as Event & {
            data: Blob;
          };
          dataEvent.data = new Blob(["webcam+graph+authored-overlays"], {
            type: this.mimeType,
          });
          this.dispatchEvent(dataEvent);
          this.dispatchEvent(new Event("stop"));
        });
      }
    }
    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: MockMediaRecorder,
    });
    const nativeRevoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (url) => {
      const count = Number(sessionStorage.getItem("recording-revokes"));
      sessionStorage.setItem("recording-revokes", String(count + 1));
      nativeRevoke(url);
    };
  });
  await page.goto("/perform?fixture=camera-free");
  await page.getByRole("button", { name: "Enable hand camera" }).click();
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(page.getByText("recording locally")).toBeVisible();
  await expect(page.getByText("00:00")).toBeVisible();
  expect(
    await page.evaluate(() => sessionStorage.getItem("recording-mime")),
  ).toBe("video/webm;codecs=vp8");
  expect(
    await page.evaluate(() => sessionStorage.getItem("recording-audio-tracks")),
  ).toBe("0");

  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(page.getByText("recording ready")).toBeVisible();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download recording" }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(
    /^touch-traversal-performance-\d{8}T\d{6}Z\.webm$/,
  );
  expect(download.suggestedFilename()).not.toContain("memory");
  await expect(page.getByText("not recording")).toBeVisible();
  expect(
    Number(
      await page.evaluate(() => sessionStorage.getItem("recording-revokes")),
    ),
  ).toBeGreaterThanOrEqual(1);
});

test("/perform keeps live mode when local recording is unsupported", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: undefined,
    });
  });
  await page.goto("/perform?fixture=camera-free");
  await page.getByRole("button", { name: "Enable hand camera" }).click();
  await expect(
    page.getByText("This browser cannot create local recordings"),
  ).toBeVisible();
  await expect(page.locator(".scene-shell")).toHaveAttribute(
    "data-presentation",
    "performance",
  );
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
  await restoreSceneHud(page);
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

test("/demo?input=gesture-fixture manipulates and resets the camera view", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "touch-traversal:tutorial:v2",
      JSON.stringify({
        completedActions: [],
        completedSteps: ["model", "sources", "mouse-keyboard", "hand"],
        currentStep: "manipulation",
        inputPath: "full",
        status: "active",
        version: 2,
      }),
    );
  });
  await page.goto("/demo?input=gesture-fixture&tutorial=manipulation");
  await expect(page.getByText("input / gesture fixture")).toBeVisible();

  const orbit = findGestureFixture(gestureFixtures, "orbit").frames;
  await injectLandmarkFrames(page, orbit.slice(0, 3));
  await expect(page.locator(".scene-gesture-hint")).toContainText(
    "gesture / pinch empty space to grab",
    { timeout: gestureHintTimeoutMs },
  );

  await injectLandmarkFrames(page, orbit.slice(3));
  await expect(page.locator(".scene-gesture-hint")).toContainText(
    "gesture / orbit · pan · depth zoom",
    { timeout: gestureHintTimeoutMs },
  );
  await injectLandmarkFrames(
    page,
    findGestureFixture(gestureFixtures, "grab-release").frames.slice(-2),
  );
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("touch-traversal:tutorial:v2") ?? "null"),
    ),
  ).toMatchObject({
    completedActions: [
      "manipulation-start",
      "manipulation-update",
      "manipulation-end",
    ],
  });

  const controls = page.getByRole("complementary", {
    name: "View manipulation",
  });
  await expect(controls.getByRole("button")).toHaveCount(9);
  await controls.getByRole("button", { name: "Reset view" }).click();
  await expect(page.locator(".scene-gesture-hint")).toContainText(
    "view / reset",
  );

  await page.keyboard.press("Shift+ArrowUp");
  await page.keyboard.press("+");
  await page.keyboard.press("0");
  await expect(page.locator(".scene-gesture-hint")).toContainText(
    "view / reset",
  );
});

test("/demo?input=gesture-fixture routes injected hand gestures", async ({
  page,
}) => {
  await page.goto("/demo?input=gesture-fixture");

  await expect(page.getByText("input / gesture fixture")).toBeVisible();
  await pointHandCursorAtNode(page, /Constellations before filing/);
  await expect(page.locator(".scene-thought-label--hover")).toContainText(
    "Constellations before filing",
  );
  await injectLandmarkFrames(
    page,
    findGestureFixture(gestureFixtures, "stable-pinch").frames,
  );
  await expect(page.locator(".scene-gesture-hint")).toContainText(
    "gesture / pinch select",
    { timeout: gestureHintTimeoutMs },
  );
  await expect(page.getByText("focused / focus")).toBeVisible({
    timeout: focusSettleTimeoutMs,
  });

  await releaseHandInput(page);
  await pointHandCursorAtNode(page, /Orientation before action/);
  await expect(page.locator(".scene-thought-label--hover")).toContainText(
    "Orientation before action",
  );
  await injectLandmarkFrames(
    page,
    findGestureFixture(gestureFixtures, "stable-pinch").frames,
  );
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

  await releaseHandInput(page);
  await injectLandmarkFrames(
    page,
    findGestureFixture(gestureFixtures, "right-swipe").frames,
  );
  await expect(page.locator(".scene-gesture-hint")).toContainText(
    "gesture / right swipe topology",
    { timeout: gestureHintTimeoutMs },
  );
  await expect(page.locator(".scene-topology-hud")).toContainText(
    "community topology",
  );

  await releaseHandInput(page);
  const openPalm = findGestureFixture(gestureFixtures, "open-palm").frames[0]!;
  await injectLandmarkFrames(
    page,
    [0, 240, 480].map((timestampMs) => ({ ...openPalm, timestampMs })),
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
