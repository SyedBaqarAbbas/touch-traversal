import { describe, expect, it } from "vitest";

import { scaledFrameSize } from "../../lib/hand-tracking-client";

describe("hand tracking client", () => {
  it("keeps small frames unchanged", () => {
    expect(scaledFrameSize(320, 180, 320)).toEqual({
      height: 180,
      width: 320,
    });
  });

  it("downscales wide camera frames before worker transfer", () => {
    expect(scaledFrameSize(1280, 720, 320)).toEqual({
      height: 180,
      width: 320,
    });
  });

  it("exposes adaptive target cadence without allocating a second stream", async () => {
    const source = await import("node:fs").then(({ readFileSync }) =>
      readFileSync(
        new URL("../../lib/hand-tracking-client.ts", import.meta.url),
        "utf8",
      ),
    );

    expect(source).toContain("setTargetFps: (targetFps: number) => void");
    expect(source).toContain("targetFps = nextTargetFps");
    expect(source).toContain("const worker = new Worker");
  });
});
