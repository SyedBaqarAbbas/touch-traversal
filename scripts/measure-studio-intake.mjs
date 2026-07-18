#!/usr/bin/env node

import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
import { arch, platform, release } from "node:os";
import { performance } from "node:perf_hooks";

const requireFromWeb = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
);
const { chromium } = requireFromWeb("@playwright/test");
const targetUrl = (
  process.env.PERF_TARGET_URL ?? "http://127.0.0.1:3000"
).replace(/\/$/, "");
const outputPath =
  process.env.PERF_OUTPUT_PATH ?? "/tmp/touch-traversal-studio-intake.json";
if (!outputPath.startsWith("/tmp/")) {
  throw new Error("PERF_OUTPUT_PATH must point inside /tmp/.");
}

const browser = await chromium.launch({ headless: false });
try {
  const page = await browser.newPage({
    viewport: { height: 900, width: 1440 },
  });
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, "showDirectoryPicker");
  });
  await page.goto(`${targetUrl}/studio`, { waitUntil: "networkidle" });

  const profiles = [];
  profiles.push(await measurePreview(page, "small-two-file", [500, 500]));
  await page.getByRole("button", { name: "Clear selection" }).click();
  await page.getByRole("button", { name: "Choose files" }).waitFor();

  const acceptedCorpusBytes = 16 * 1024 * 1024;
  const baseSize = Math.floor(acceptedCorpusBytes / 200);
  const upperSizes = Array.from({ length: 200 }, (_, index) =>
    index < acceptedCorpusBytes % 200 ? baseSize + 1 : baseSize,
  );
  profiles.push(
    await measurePreview(page, "maximum-count-and-corpus-bytes", upperSizes),
  );
  await page.getByRole("button", { name: "Clear selection" }).click();
  await page.getByRole("button", { name: "Choose files" }).waitFor();

  const output = {
    browserVersion: browser.version(),
    capturedAt: new Date().toISOString(),
    environment: {
      architecture: arch(),
      operatingSystem: `${platform()} ${release()}`,
      viewport: { height: 900, width: 1440 },
    },
    limits: {
      acceptedCorpusBytes,
      fileCount: 200,
      noteBytes: 2 * 1024 * 1024,
    },
    notes: [
      "All payloads are generated fictional UTF-8 Markdown held only for the browser benchmark.",
      "The upper profile simultaneously reaches the 200-file and 16 MiB accepted-corpus limits; no companion request or graph generation occurs.",
      "Wall time includes Playwright file transfer plus browser validation and preview rendering.",
    ],
    profiles,
    schemaVersion: 1,
  };
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  process.stdout.write(`Studio intake data written to ${outputPath}\n`);
} finally {
  await browser.close();
}

async function measurePreview(page, profile, sizes) {
  const files = sizes.map((size, index) => {
    const heading = Buffer.from(`# Synthetic capacity note ${index}\n\n`);
    const body = Buffer.alloc(Math.max(0, size - heading.length), 0x61);
    return {
      buffer: Buffer.concat([heading, body]).subarray(0, size),
      mimeType: "text/markdown",
      name: `synthetic-${index.toString().padStart(3, "0")}.md`,
    };
  });
  await page.evaluate(() => {
    window.__studioPreviewStartedAt = performance.now();
  });
  const wallStartedAt = performance.now();
  await page.locator("#studio-files").setInputFiles(files);
  await page
    .getByRole("status")
    .filter({ hasText: `${files.length} accepted, 0 excluded` })
    .waitFor();
  const wallMs = performance.now() - wallStartedAt;
  const browserMs = await page.evaluate(
    () => performance.now() - window.__studioPreviewStartedAt,
  );
  const renderedRows = await page.locator(".studio-file-list strong").count();
  return {
    browserMs: round(browserMs),
    fileCount: files.length,
    profile,
    renderedRows,
    sourceBytes: sizes.reduce((sum, size) => sum + size, 0),
    wallMs: round(wallMs),
  };
}

function round(value) {
  return Math.round(value * 10) / 10;
}
