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
});
