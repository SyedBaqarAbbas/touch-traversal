import { expect, test, type Page } from "@playwright/test";

import graph from "../../public/data/graph.json";
import layouts from "../../public/data/layouts.json";
import manifest from "../../public/data/manifest.json";
import report from "../../public/data/pipeline-report.json";
import linearProjectSession from "../../public/examples/touch-traversal-linear-project.json";
import rawGestureFixtures from "../fixtures/gesture-fixtures.json";
import {
  expandGestureFixtures,
  findGestureFixture,
  type GestureFixtureFile,
  type TimestampedLandmarkFrame,
} from "../../lib/gesture-classifier";

const gestureHintTimeoutMs = 4400;
const focusSettleTimeoutMs = 3200;
const gestureFixtures = expandGestureFixtures(
  rawGestureFixtures as unknown as GestureFixtureFile,
);

async function dropFolderCorpus(
  page: Page,
  files: ReadonlyArray<{
    body: string;
    mimeType: string;
    relativePath: string;
  }>,
): Promise<void> {
  await page.locator(".studio-dropzone").evaluate((dropzone, corpus) => {
    const transfer = new DataTransfer();
    for (const file of corpus) {
      const name = file.relativePath.split("/").at(-1) ?? file.relativePath;
      const candidate = new File([file.body], name, {
        type: file.mimeType,
        lastModified: 1_784_377_800_000,
      });
      Object.defineProperty(candidate, "webkitRelativePath", {
        value: file.relativePath,
      });
      transfer.items.add(candidate);
    }
    dropzone.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }),
    );
  }, files);
}

async function pointHandCursorAtNode(page: Page, title: string): Promise<void> {
  const node = page.getByRole("button", {
    name: `Select ${title}`,
    exact: true,
  });
  await node.evaluate(
    (element) =>
      new Promise<void>((resolve) => {
        element.scrollIntoView({ block: "nearest", inline: "center" });
        requestAnimationFrame(() => resolve());
      }),
  );
  const box = await node.boundingBox();
  if (!box) throw new Error(`Could not locate gesture target ${title}`);
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
          detail: { ...frame, timestampMs: startAtMs + frame.timestampMs },
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

const privateSessionFixture = JSON.stringify({
  sessionVersion: 1,
  metadata: {
    id: "private-session-e2e",
    createdAt: "2026-07-18T00:00:00.000Z",
    noteCount: report.fileCount,
  },
  bundle: { graph, layouts, manifest, report },
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, "showDirectoryPicker");
  });
  await page.goto("/studio");
});

test("standard multi-file fallback previews metadata without transport or body disclosure", async ({
  page,
}) => {
  const noteBodyMarker = "PRIVATE_BROWSER_BODY_MARKER";
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));

  const input = page.locator("#studio-files");
  await expect(input).toHaveAttribute("multiple", "");
  await input.setInputFiles([
    {
      name: "zeta.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(`${noteBodyMarker} zeta`),
    },
    {
      name: "alpha.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(`# Alpha\n${noteBodyMarker}`),
    },
  ]);

  const previewTitle = page.getByRole("heading", {
    name: "Review before continuing",
  });
  await expect(previewTitle).toBeFocused();
  await expect(page.getByRole("status")).toContainText(
    "2 accepted, 0 excluded",
  );
  await expect(page.locator(".studio-file-list strong")).toHaveText([
    "alpha.md",
    "zeta.txt",
  ]);
  await expect(page.getByText(noteBodyMarker)).toHaveCount(0);
  expect(requests).toEqual([]);
});

test("one-note intake previews, builds, loads, traverses, and resets", async ({
  page,
}) => {
  await page.addInitScript(
    ({ graph, layouts, manifest, report }) => {
      const nativeFetch = window.fetch.bind(window);
      let requestId = "one-note-e2e";
      const jsonResponse = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      window.fetch = async (input, init = {}) => {
        const request = input instanceof Request ? input : null;
        const url = new URL(
          request?.url ?? String(input),
          window.location.href,
        );
        if (url.origin !== "http://127.0.0.1:8765") {
          return nativeFetch(input, init);
        }
        const method = init.method ?? request?.method ?? "GET";
        if (url.pathname === "/v1/capabilities") {
          return jsonResponse({
            contractVersion: 1,
            provider: "localhost-python",
            status: "ready",
            pipelineVersion: "one-note-e2e",
            sessionToken: "one-note-e2e-token-with-at-least-32-characters",
            progressStages: [
              "accepted",
              "materializing",
              "ingesting",
              "chunking",
              "relating",
              "embedding",
              "laying_out",
              "validating",
              "complete",
            ],
            limits: {
              maxNotes: 200,
              maxNoteBytes: 2097152,
              maxRequestBytes: 20971520,
            },
            privacy: {
              transport: "loopback-http",
              noteContentsLogged: false,
              writesTrackedPublicData: false,
              persistentPersonalCache: false,
            },
          });
        }
        if (url.pathname === "/v1/jobs" && method === "POST") {
          requestId = JSON.parse(String(init.body)).requestId as string;
          return jsonResponse(
            {
              contractVersion: 1,
              requestId,
              jobId: "job-one-note",
              state: "succeeded",
              progress: {
                sequence: 9,
                stage: "complete",
                stageIndex: 8,
                totalStages: 9,
                message: "personal graph bundle ready",
              },
              resultAvailable: true,
              error: null,
            },
            202,
          );
        }
        if (url.pathname === "/v1/jobs/job-one-note/result") {
          return jsonResponse({
            contractVersion: 1,
            requestId,
            jobId: "job-one-note",
            bundle: { graph, layouts, manifest, report },
          });
        }
        if (url.pathname === "/v1/jobs/job-one-note" && method === "DELETE") {
          return new Response(null, { status: 204 });
        }
        return jsonResponse({ error: "unexpected fixture request" }, 500);
      };
    },
    { graph, layouts, manifest, report },
  );
  await page.reload();

  await page.locator("#studio-files").setInputFiles({
    name: "one.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# One fictional private note"),
  });
  await expect(page.getByRole("status")).toContainText(
    "1 accepted, 0 excluded",
  );
  await page
    .getByRole("button", { name: "Continue to graph generation" })
    .click();
  await page.getByRole("button", { name: "Start local graph build" }).click();
  await expect(
    page.getByRole("heading", { name: "Personal graph ready" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open personal graph" }).click();

  const edge = graph.edges[0]!;
  const source = graph.nodes.find((node) => node.id === edge.source)!;
  const target = graph.nodes.find((node) => node.id === edge.target)!;
  await page
    .locator(`[data-scene-node-id="${source.id}"]`)
    .click({ force: true });
  await page
    .locator(`[data-scene-node-id="${target.id}"]`)
    .click({ force: true });
  await expect(page.locator(".scene-traversal-status")).toBeVisible();
  await page.getByRole("button", { name: "remove personal graph" }).click();
  await expect(
    page.getByRole("button", { name: "sample", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("folder build activates, gestures through, performs graph-only, switches, and removes a personal graph", async ({
  page,
}) => {
  await page.addInitScript(
    ({ graph, layouts, manifest, report }) => {
      const nativeFetch = window.fetch.bind(window);
      const methods: string[] = [];
      let attempt = 0;
      let requestId = "studio-e2e";
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          getUserMedia: () => {
            const canvas = document.createElement("canvas");
            canvas.width = 640;
            canvas.height = 480;
            canvas.getContext("2d")?.fillRect(0, 0, 640, 480);
            const stream = canvas.captureStream(5);
            const track = stream.getVideoTracks()[0]!;
            const nativeStop = track.stop.bind(track);
            track.stop = () => {
              const stops = Number(
                sessionStorage.getItem("studio-integration-camera-stops"),
              );
              sessionStorage.setItem(
                "studio-integration-camera-stops",
                String(stops + 1),
              );
              nativeStop();
            };
            return Promise.resolve(stream);
          },
        },
      });
      Object.assign(window, { __studioE2eMethods: methods });
      const snapshot = (
        state: "running" | "succeeded",
        stage: "accepted" | "complete",
        sequence: number,
        jobId = `job-e2e-${attempt}`,
      ) => ({
        contractVersion: 1,
        requestId,
        jobId,
        state,
        progress: {
          sequence,
          stage,
          stageIndex: stage === "complete" ? 8 : 0,
          totalStages: 9,
          message:
            stage === "complete"
              ? "personal graph bundle ready"
              : "request accepted",
        },
        resultAvailable: state === "succeeded",
        error: null,
      });
      window.fetch = async (input, init = {}) => {
        const request = input instanceof Request ? input : null;
        const url = new URL(
          request?.url ?? String(input),
          window.location.href,
        );
        if (url.origin !== "http://127.0.0.1:8765") {
          return nativeFetch(input, init);
        }
        const method = init.method ?? request?.method ?? "GET";
        methods.push(`${method} ${url.pathname}`);
        const jsonResponse = (body: unknown, status = 200) =>
          new Response(JSON.stringify(body), {
            status,
            headers: { "Content-Type": "application/json" },
          });
        if (url.pathname === "/v1/capabilities") {
          return jsonResponse({
            contractVersion: 1,
            provider: "localhost-python",
            status: "ready",
            pipelineVersion: "e2e-fixture",
            sessionToken: "e2e-fixture-token-with-at-least-32-characters",
            progressStages: [
              "accepted",
              "materializing",
              "ingesting",
              "chunking",
              "relating",
              "embedding",
              "laying_out",
              "validating",
              "complete",
            ],
            limits: {
              maxNotes: 200,
              maxNoteBytes: 2097152,
              maxRequestBytes: 20971520,
            },
            privacy: {
              transport: "loopback-http",
              noteContentsLogged: false,
              writesTrackedPublicData: false,
              persistentPersonalCache: false,
            },
          });
        }
        if (url.pathname === "/v1/jobs" && method === "POST") {
          attempt += 1;
          requestId = JSON.parse(String(init.body)).requestId as string;
          return jsonResponse(snapshot("running", "accepted", 0), 202);
        }
        if (url.pathname.endsWith("/result")) {
          const jobId = url.pathname.split("/").at(-2) ?? "job-e2e-2";
          return jsonResponse({
            contractVersion: 1,
            requestId,
            jobId,
            bundle: { graph, layouts, manifest, report },
          });
        }
        if (url.pathname.startsWith("/v1/jobs/") && method === "DELETE") {
          return new Response(null, { status: 204 });
        }
        if (url.pathname === "/v1/jobs/job-e2e-1") {
          return jsonResponse(snapshot("running", "accepted", 1, "job-e2e-1"));
        }
        return jsonResponse(snapshot("succeeded", "complete", 9));
      };
    },
    { graph, layouts, manifest, report },
  );
  await page.reload();

  await dropFolderCorpus(page, [
    {
      body: "# Origin\nA fictional private origin note.",
      mimeType: "text/markdown",
      relativePath: "private-corpus/origin.md",
    },
    {
      body: "# Companion\nA fictional private companion note.",
      mimeType: "text/markdown",
      relativePath: "private-corpus/nested/companion.md",
    },
  ]);
  await expect(page.getByRole("status")).toContainText(
    "2 accepted, 0 excluded",
  );
  await expect(
    page.locator(".studio-file-list").first().locator("strong"),
  ).toHaveText([
    "private-corpus/nested/companion.md",
    "private-corpus/origin.md",
  ]);
  await page
    .getByRole("button", { name: "Continue to graph generation" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Ready to send notes over loopback" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __studioE2eMethods: string[] })
          .__studioE2eMethods,
    ),
  ).not.toContain("POST /v1/jobs");

  await page.getByRole("button", { name: "Start local graph build" }).click();
  await expect(
    page.getByRole("heading", { name: "Building your personal graph" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel build" }).click();
  await expect(
    page.getByRole("heading", { name: "Build cancelled" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry local build" }).click();
  await expect(
    page.getByRole("heading", { name: "Ready to send notes over loopback" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Start local graph build" }).click();
  await expect(
    page.getByRole("heading", { name: "Personal graph ready" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open personal graph" }).click();
  await expect(page).toHaveURL(/\/demo\/?$/);
  await expect(
    page.getByRole("button", { name: "personal", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("link", { name: "calibration", exact: true }).click();
  await expect(page).toHaveURL(/\/calibration\/?$/);
  await page.getByRole("button", { name: "Enable hand camera" }).click();
  await expect(page.getByText("camera active / local only")).toBeVisible();
  await page.getByRole("button", { name: "use current depth" }).click();
  await page.getByRole("link", { name: "demo", exact: true }).click();
  await expect(page).toHaveURL(/\/demo\/?$/);
  await expect(
    page.getByRole("button", { name: "personal", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() =>
      page.evaluate(() =>
        Number(sessionStorage.getItem("studio-integration-camera-stops")),
      ),
    )
    .toBeGreaterThanOrEqual(1);

  const source = graph.nodes.find(
    (node) => node.title === "Constellations before filing",
  )!;
  const target = graph.nodes.find(
    (node) => node.title === "Orientation before action",
  )!;
  await page.evaluate(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("input", "gesture-fixture");
    window.history.pushState({}, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page.locator(".scene-shell")).toHaveAttribute(
    "data-input-mode",
    "gesture-fixture",
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await pointHandCursorAtNode(page, source.title);
  await expect(page.locator(".scene-thought-label--hover")).toContainText(
    source.title,
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
  await pointHandCursorAtNode(page, target.title);
  await expect(page.locator(".scene-thought-label--hover")).toContainText(
    target.title,
  );
  await injectLandmarkFrames(
    page,
    findGestureFixture(gestureFixtures, "stable-pinch").frames,
  );
  await expect(page.locator(".scene-gesture-hint")).toContainText(
    "gesture / pinch traverse",
    { timeout: gestureHintTimeoutMs },
  );
  await expect(page.locator(".scene-selected-card")).toContainText(
    target.title,
  );

  await releaseHandInput(page);
  const openPalm = findGestureFixture(gestureFixtures, "open-palm").frames[0]!;
  await injectLandmarkFrames(
    page,
    [0, 240, 480].map((timestampMs) => ({ ...openPalm, timestampMs })),
  );
  await expect(page.getByText("idle / overview")).toBeVisible({
    timeout: focusSettleTimeoutMs,
  });
  await releaseHandInput(page);
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

  await page.getByRole("link", { name: "perform", exact: true }).click();
  await expect(page).toHaveURL(/\/perform\/?$/);
  await expect(page.locator(".scene-shell")).toHaveAttribute(
    "data-presentation",
    "performance",
  );
  await page.getByRole("button", { name: "Graph only" }).click();
  await expect(page.locator(".scene-shell")).toHaveAttribute(
    "data-performance-layer",
    "graph-only",
  );
  await expect(
    page.locator(`[data-scene-node-id="${source.id}"]`),
  ).toBeVisible();
  await page.getByRole("button", { name: "exit performance" }).click();
  await expect(page).toHaveURL(/\/demo\/?$/);
  await expect(
    page.getByRole("button", { name: "personal", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "sample", exact: true }).click();
  await expect(page).toHaveURL(/\/demo\/?$/);
  await expect(
    page.getByRole("button", { name: "sample", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "personal", exact: true }).click();
  await page.evaluate(() =>
    sessionStorage.setItem(
      "touch-traversal:history",
      JSON.stringify([
        {
          edgeId: "private-edge-id",
          sourceNodeId: "private-source-id",
          targetNodeId: "private-target-id",
          timestampMs: 1000,
        },
      ]),
    ),
  );
  await page.getByRole("button", { name: "remove personal graph" }).click();
  await expect(
    page.getByText(
      "Personal graph and derived traversal history removed from memory.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "sample", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("touch-traversal:history"),
    ),
  ).toBeNull();
});

test("private export downloads, reload clears memory, and the download imports again", async ({
  page,
}) => {
  await page.goto("/demo");
  await page.getByText("JSON format + example", { exact: true }).click();
  await expect(
    page.getByRole("link", { name: "download full JSON Schema" }),
  ).toHaveAttribute("href", "/examples/personal-graph-session.schema.json");
  await expect(
    page.getByRole("link", { name: "download Linear project graph" }),
  ).toHaveAttribute("href", "/examples/touch-traversal-linear-project.json");
  await page.getByLabel("Import private graph JSON").setInputFiles({
    name: "private-session.json",
    mimeType: "application/json",
    buffer: Buffer.from(privateSessionFixture),
  });
  await expect(page.getByRole("status")).toContainText(
    `Imported ${graph.nodes.length} nodes into memory`,
  );

  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "export private JSON" }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe(
    "touch-traversal-personal-session.json",
  );
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error("Private session download had no path");

  await page.reload();
  await expect(
    page.getByRole("button", { name: "sample", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "personal", exact: true }),
  ).toBeDisabled();

  await page
    .getByLabel("Import private graph JSON")
    .setInputFiles(downloadPath);
  await expect(page.getByRole("status")).toContainText(
    `Imported ${graph.nodes.length} nodes into memory`,
  );
  await expect(
    page.getByRole("button", { name: "personal", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.locator(`[data-scene-node-id="${graph.nodes[0]!.id}"]`),
  ).toBeVisible();
});

test("the Linear project example imports and traverses a dependency", async ({
  page,
}) => {
  await page.goto("/demo?input=mouse");
  await page.getByLabel("Import private graph JSON").setInputFiles({
    name: "touch-traversal-linear-project.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(linearProjectSession)),
  });

  await expect(page.getByRole("status")).toContainText(
    "Imported 9 nodes into memory",
  );
  await expect(
    page.getByRole("button", { name: "personal", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(/9 thoughts and 24 relationships/)).toBeVisible();

  await page
    .getByRole("button", {
      name: "Select Choose and implement the local personal-ingestion architecture",
    })
    .click();
  await expect(page.getByText("focused / focus")).toBeVisible({
    timeout: focusSettleTimeoutMs,
  });
  await page
    .getByRole("button", {
      name: "Select Add browser file and folder intake with private corpus preview",
    })
    .click();
  await expect(page.getByText("traversing / focus")).toBeVisible();
  await expect(page.getByText("focused / focus")).toBeVisible({
    timeout: focusSettleTimeoutMs,
  });
  await expect(page.locator(".scene-selected-card")).toContainText(
    "Add browser file and folder intake with private corpus preview",
  );
});

test("folder-shaped drop keeps relative paths ordered and reports exclusions", async ({
  page,
}) => {
  await dropFolderCorpus(page, [
    {
      body: "Zeta",
      mimeType: "text/plain",
      relativePath: "zeta/zeta.txt",
    },
    {
      body: "# Origin",
      mimeType: "text/markdown",
      relativePath: "alpha/origin.md",
    },
    {
      body: "Agent instructions",
      mimeType: "text/markdown",
      relativePath: "alpha/AGENTS.md",
    },
    {
      body: "not supported",
      mimeType: "image/png",
      relativePath: "alpha/photo.png",
    },
  ]);

  await expect(page.getByRole("status")).toContainText(
    "2 accepted, 2 excluded",
  );
  await expect(
    page.locator(".studio-file-list").first().locator("strong"),
  ).toHaveText(["alpha/origin.md", "zeta/zeta.txt"]);
  await expect(
    page.getByText("Excluded by the public pipeline corpus rules."),
  ).toBeVisible();
  await expect(
    page.getByText("Only .md, .markdown, and .txt files are supported."),
  ).toBeVisible();
});

test("duplicate and unsafe paths are actionable, removal revalidates, and clear restores focus", async ({
  page,
}) => {
  await page.locator(".studio-dropzone").evaluate((dropzone) => {
    const transfer = new DataTransfer();
    const paths = ["notes/Origin.md", "notes/origin.md", "../private.md"];
    for (const [index, path] of paths.entries()) {
      const name = path.split("/").at(-1) ?? `note-${index}.md`;
      const file = new File([`Note ${index}`], name, { type: "text/markdown" });
      Object.defineProperty(file, "webkitRelativePath", { value: path });
      transfer.items.add(file);
    }
    dropzone.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }),
    );
  });

  await expect(page.getByRole("status")).toContainText(
    "0 accepted, 3 excluded",
  );
  await expect(page.getByText(/same relative path ignoring case/)).toHaveCount(
    2,
  );
  await expect(
    page.getByText(/Path cannot contain empty, dot, traversal/),
  ).toBeVisible();

  await page
    .getByRole("button", { name: "Remove notes/Origin.md", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "1 accepted, 1 excluded",
  );
  await expect(
    page.getByText("notes/origin.md", { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Clear selection" }).click();
  await expect(
    page.getByRole("button", { name: "Choose files" }),
  ).toBeFocused();
  await expect(
    page.getByRole("heading", { name: "Review before continuing" }),
  ).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("Selection cleared");
});

test("sample navigation releases intake state", async ({ page }) => {
  await page.locator("#studio-files").setInputFiles({
    name: "temporary.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Temporary\nThis selection should be released."),
  });
  await expect(page.getByRole("status")).toContainText("1 accepted");

  await page
    .getByRole("link", { name: "Explore the fictional sample instead" })
    .click();
  await expect(page).toHaveURL(/\/demo\/?\?input=mouse$/);
  await page.goBack();

  await expect(page).toHaveURL(/\/studio\/?$/);
  await expect(
    page.getByRole("heading", { name: "Review before continuing" }),
  ).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText(
    "No personal files selected",
  );
});
