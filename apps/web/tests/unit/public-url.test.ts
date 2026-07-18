import { describe, expect, it } from "vitest";

import { normalizePublicBasePath, publicAssetUrl } from "../../lib/public-url";

describe("public asset URLs", () => {
  it("keeps local development on the site root", () => {
    expect(normalizePublicBasePath(undefined)).toBe("");
    expect(normalizePublicBasePath("/")).toBe("");
    expect(publicAssetUrl("/data/graph.json", "")).toBe("/data/graph.json");
  });

  it("prefixes static assets for the GitHub Pages project site", () => {
    expect(normalizePublicBasePath("touch-traversal/")).toBe(
      "/touch-traversal",
    );
    expect(publicAssetUrl("data/graph.json", "/touch-traversal")).toBe(
      "/touch-traversal/data/graph.json",
    );
    expect(
      publicAssetUrl("/vendor/mediapipe/tasks-vision/wasm", "/touch-traversal"),
    ).toBe("/touch-traversal/vendor/mediapipe/tasks-vision/wasm");
  });

  it("rejects origins, query strings, fragments, and parent traversal", () => {
    expect(() => normalizePublicBasePath("https://example.com/site")).toThrow(
      "must be an absolute URL path",
    );
    expect(() => publicAssetUrl("../private.json")).toThrow(
      "must identify a local static file",
    );
    expect(() => publicAssetUrl("data/graph.json?draft=1")).toThrow(
      "must identify a local static file",
    );
  });
});
