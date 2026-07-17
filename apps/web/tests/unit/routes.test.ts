import { readFileSync, statSync } from "node:fs";

import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const readRoot = (path: string) =>
  readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
const statRoot = (path: string) =>
  statSync(new URL(`../../../../${path}`, import.meta.url));

describe("web application contract", () => {
  it("keeps TypeScript strict and uses the App Router plugin", () => {
    const tsconfig = JSON.parse(read("tsconfig.json"));

    expect(tsconfig.compilerOptions.strict).toBe(true);
    expect(tsconfig.compilerOptions.allowJs).toBe(false);
    expect(tsconfig.compilerOptions.plugins).toEqual([{ name: "next" }]);
  });

  it.each([
    ["app/page.tsx", "Explore the topologies of your thoughts."],
    ["app/_components/graph-scene.tsx", "Graph artifact boundary"],
    ["app/calibration/page.tsx", "Calibrate hand traversal."],
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

  it("documents the reference-driven visual language", () => {
    const visualLanguage = readRoot("docs/visual-language.md");

    expect(visualLanguage).toContain("Line density");
    expect(visualLanguage).toContain("Hover labels are title-only");
    expect(visualLanguage).toContain("Background: `#050505`");
    expect(visualLanguage).toContain("dot rail");
    expect(visualLanguage).toContain("does not recreate the camera pane");
    expect(visualLanguage).toContain("No neon cyberpunk palette");
    expect(visualLanguage).toContain("visual-language-overview.png");
    expect(
      statRoot("docs/assets/visual-language-overview.png").size,
    ).toBeGreaterThan(10_000);
    expect(
      statRoot("docs/assets/visual-language-focus.png").size,
    ).toBeGreaterThan(10_000);
  });

  it("locks the demo scene to the nocturnal camera-reference palette", () => {
    const css = read("app/globals.css");
    const graphScene = read("app/_components/graph-scene.tsx");

    expect(css).toContain("--background: #050505");
    expect(css).toContain("--primary-text: #f2f0ea");
    expect(css).toContain("--selected-core: #fffdf6");
    expect(css).toContain("--subtle-line: rgba(242, 240, 234, 0.1)");
    expect(css).toContain("--strong-line: rgba(242, 240, 234, 0.56)");
    expect(css).toContain("--matte-panel: rgba(5, 5, 5, 0.72)");
    expect(css).toContain("--desaturated-warning: #bdb6a0");
    expect(css).not.toContain("backdrop-filter");

    expect(graphScene).toContain('color="#fffdf6"');
    expect(graphScene).not.toContain("AdditiveBlending");
    expect(graphScene).not.toContain("#fff1b8");
    expect(graphScene).toContain("vec3 clusterA = vec3(0.76, 0.75, 0.70)");
    expect(graphScene).toContain("vec3 clusterB = vec3(0.66, 0.65, 0.61)");
  });

  it("defines graceful demo intro and failure transition surfaces", () => {
    const boundary = read("app/_components/artifact-boundary.tsx");
    const cameraPanel = read("app/_components/camera-access-panel.tsx");
    const css = read("app/globals.css");
    const graphScene = read("app/_components/graph-scene.tsx");

    expect(graphScene).toContain("SCENE_INTRO_DURATION_MS = 3000");
    expect(graphScene).toContain("--scene-intro-duration");
    expect(css).toContain("@keyframes scene-canvas-reveal");
    expect(css).toContain("@keyframes scene-ui-reveal");
    expect(css).toContain(".scene-performance-note");
    expect(css).toContain("prefers-reduced-motion");

    expect(boundary).toContain("Preparing graph field");
    expect(boundary).toContain("No notes to draw");
    expect(boundary).toContain("Graph artifacts could not load");
    expect(boundary).toContain("mouse and keyboard are ready first");
    expect(boundary).not.toMatch(/todo|placeholder|lorem/i);

    expect(cameraPanel).toContain("Hand model could not load");
    expect(cameraPanel).toContain("Mouse and keyboard remain available");
  });

  it("wires ambient scene effects without unsupported cinematic artifacts", () => {
    const graphScene = read("app/_components/graph-scene.tsx");
    const performanceReport = readRoot("docs/performance-report.md");

    expect(graphScene).toContain("AmbientDustField");
    expect(graphScene).toContain("SceneFrameBudgetMonitor");
    expect(graphScene).toContain("ACESFilmicToneMapping");
    expect(graphScene).toContain("Bloom");
    expect(graphScene).toContain("Vignette");
    expect(graphScene).not.toContain("ChromaticAberration");
    expect(graphScene).not.toContain("DepthOfField");

    expect(performanceReport).toContain("Decorative features are disabled");
    expect(performanceReport).toContain(
      "Depth of field and chromatic aberration remain off",
    );
  });

  it("documents HUD idle and reduced-motion timing contracts in the scene", () => {
    const css = read("app/globals.css");
    const graphScene = read("app/_components/graph-scene.tsx");

    expect(graphScene).toContain("HUD_IDLE_TIMEOUT_MS = 4200");
    expect(graphScene).toContain("FOCUS_TRANSITION_MS = 1100");
    expect(graphScene).toContain("RETURN_OVERVIEW_TRANSITION_MS = 1400");
    expect(graphScene).toContain("REDUCED_MOTION_FOCUS_TRANSITION_MS = 220");
    expect(graphScene).toContain(
      'data-hud={hudVisible ? "visible" : "dimmed"}',
    );
    expect(graphScene).toContain(
      'data-motion={reducedMotion ? "reduced" : "full"}',
    );
    expect(graphScene).toContain("usePrefersReducedMotion");
    expect(graphScene).toContain("layoutMorphDuration(reducedMotion)");
    expect(graphScene).toContain("activeTraversal && !reducedMotion");

    expect(css).toContain('.scene-shell[data-hud="dimmed"] .scene-overlay');
    expect(css).toContain("opacity 320ms ease");
    expect(css).toContain("@keyframes scene-label-enter");
    expect(css).toContain(".scene-thought-label");
  });

  it("documents mouse-route performance measurements", () => {
    const performanceReport = readRoot("docs/performance-report.md");

    expect(performanceReport).toContain("/demo?input=mouse");
    expect(performanceReport).toContain("overview-300-1500");
    expect(performanceReport).toContain("Minimum acceptable threshold: 45 FPS");
    expect(performanceReport).toContain("cap visible edges at 900");
  });

  it("documents topology keyboard controls", () => {
    const controls = readRoot("docs/interaction-controls.md");

    expect(controls).toContain("| `1` | semantic |");
    expect(controls).toContain("| `2` | communities |");
    expect(controls).toContain("| `3` | temporal |");
    expect(controls).toContain("| `4` | force |");
    expect(controls).toContain("`Escape`");
  });

  it("documents the local hand-tracking worker contract", () => {
    const workerContract = readRoot("docs/hand-tracking-worker.md");

    expect(workerContract).toContain("hand.worker.ts");
    expect(workerContract).toContain("/models/hand_landmarker");
    expect(workerContract).toContain("15–30 FPS");
    expect(workerContract).toContain("never uploaded");
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
