import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("web application contract", () => {
  it("keeps TypeScript strict and uses the App Router plugin", () => {
    const tsconfig = JSON.parse(read("tsconfig.json"));

    expect(tsconfig.compilerOptions.strict).toBe(true);
    expect(tsconfig.compilerOptions.allowJs).toBe(false);
    expect(tsconfig.compilerOptions.plugins).toEqual([{ name: "next" }]);
  });

  it.each([
    ["app/page.tsx", "Explore the topologies of your thoughts."],
    ["app/demo/page.tsx", "The graph will emerge here."],
    ["app/calibration/page.tsx", "Camera calibration comes later."],
    ["app/debug/page.tsx", "Graph diagnostics will live here."],
  ])("keeps the route shell at %s", (path, marker) => {
    expect(read(path)).toContain(marker);
  });

  it("exposes development and verification scripts", () => {
    const packageJson = JSON.parse(read("package.json"));

    for (const script of [
      "dev",
      "build",
      "start",
      "lint",
      "typecheck",
      "test",
      "test:e2e",
      "format",
      "format:check",
    ]) {
      expect(packageJson.scripts[script]).toEqual(expect.any(String));
    }
  });
});
