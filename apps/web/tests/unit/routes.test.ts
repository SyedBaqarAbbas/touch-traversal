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
    ["app/debug/page.tsx", "Graph diagnostics"],
  ])("keeps the route shell at %s", (path, marker) => {
    expect(read(path)).toContain(marker);
  });

  it("checks in frontend graph fixtures for diagnostics", () => {
    const graph = JSON.parse(read("public/data/graph.json"));
    const layouts = JSON.parse(read("public/data/layouts.json"));
    const manifest = JSON.parse(read("public/data/manifest.json"));
    const report = JSON.parse(read("public/data/pipeline-report.json"));

    expect(graph.schemaVersion).toBe(1);
    expect(layouts.version).toBe(1);
    expect(manifest.nodeCount).toBe(graph.nodes.length);
    expect(report.edgeCount).toBe(graph.edges.length);
    expect(Object.keys(layouts.layouts.semantic).sort()).toEqual(
      graph.nodes.map((node: { id: string }) => node.id).sort(),
    );
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
