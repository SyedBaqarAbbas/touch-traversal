import { expect, test } from "@playwright/test";

import graph from "../../public/data/graph.json";
import layouts from "../../public/data/layouts.json";
import manifest from "../../public/data/manifest.json";
import report from "../../public/data/pipeline-report.json";

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

test("one-file build activates a personal graph and switches to the sample without reload", async ({
  page,
}) => {
  await page.addInitScript(
    ({ graph, layouts, manifest, report }) => {
      const nativeFetch = window.fetch.bind(window);
      const methods: string[] = [];
      let requestId = "studio-e2e";
      Object.assign(window, { __studioE2eMethods: methods });
      const snapshot = (
        state: "running" | "succeeded",
        stage: "accepted" | "complete",
        sequence: number,
      ) => ({
        contractVersion: 1,
        requestId,
        jobId: "job-e2e",
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
          requestId = JSON.parse(String(init.body)).requestId as string;
          return jsonResponse(snapshot("running", "accepted", 0), 202);
        }
        if (url.pathname === "/v1/jobs/job-e2e/result") {
          return jsonResponse({
            contractVersion: 1,
            requestId,
            jobId: "job-e2e",
            bundle: { graph, layouts, manifest, report },
          });
        }
        if (url.pathname === "/v1/jobs/job-e2e" && method === "DELETE") {
          return new Response(null, { status: 204 });
        }
        return jsonResponse(snapshot("succeeded", "complete", 9));
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
    page.getByRole("heading", { name: "Personal graph ready" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open personal graph" }).click();
  await expect(page).toHaveURL(/\/demo\/?$/);
  await expect(
    page.getByRole("button", { name: "personal", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "sample", exact: true }).click();
  await expect(page).toHaveURL(/\/demo\/?$/);
  await expect(
    page.getByRole("button", { name: "sample", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("folder-shaped drop keeps relative paths ordered and reports exclusions", async ({
  page,
}) => {
  await page.locator(".studio-dropzone").evaluate((dropzone) => {
    const transfer = new DataTransfer();
    const add = (
      name: string,
      relativePath: string,
      body: string,
      type: string,
    ) => {
      const file = new File([body], name, {
        type,
        lastModified: 1_784_377_800_000,
      });
      Object.defineProperty(file, "webkitRelativePath", {
        value: relativePath,
      });
      transfer.items.add(file);
    };
    add("zeta.txt", "zeta/zeta.txt", "Zeta", "text/plain");
    add("origin.md", "alpha/origin.md", "# Origin", "text/markdown");
    add("AGENTS.md", "alpha/AGENTS.md", "Agent instructions", "text/markdown");
    add("photo.png", "alpha/photo.png", "not supported", "image/png");
    dropzone.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }),
    );
  });

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
