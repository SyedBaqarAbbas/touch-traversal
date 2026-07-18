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
    ["app/perform/page.tsx", "performanceMode"],
    ["app/studio/page.tsx", "StudioIntake"],
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
    expect(visualLanguage).toContain("default `/demo` route");
    expect(visualLanguage).toContain("still has no visible camera pane");
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
    const rawMeasurement = JSON.parse(
      readRoot("docs/performance-measurements/2026-07-18-m2-pro-chromium.json"),
    );

    expect(performanceReport).toContain("/demo?input=mouse");
    expect(performanceReport).toContain("overview-300-1500");
    expect(performanceReport).toContain("morph-300-1500");
    expect(performanceReport).toContain("hand-tracking-300-1500");
    expect(performanceReport).toContain("performance-measurements/");
    expect(performanceReport).toContain("16 nodes and 48 edges");
    expect(performanceReport).toContain("not a WebGL draw benchmark");
    expect(performanceReport).toContain("Minimum acceptable threshold: 45 FPS");
    expect(performanceReport).toContain("cap visible edges at 900");
    expect(performanceReport).toContain("Visible performance presentation");
    expect(rawMeasurement.schemaVersion).toBe(2);
    expect(rawMeasurement.environment.sampleGraph).toEqual({
      edgeCount: 48,
      nodeCount: 16,
      quality: "high",
    });
    expect(rawMeasurement.sceneScaleProbes).toHaveLength(8);
    expect(rawMeasurement.handWorker).toMatchObject({
      cursorRenderFps: null,
      detectedHandFrames: 0,
      ready: true,
    });
    expect(rawMeasurement.handWorker.inference.rateFps).toBeGreaterThanOrEqual(
      15,
    );
    expect(rawMeasurement.performancePresentation).toMatchObject({
      camera: { height: 480, width: 640 },
      composition: {
        cameraLayerActive: "true",
        mirrored: "true",
        videoOpacity: "0.68",
      },
      cursorRenderFps: null,
    });
    expect(rawMeasurement.performancePresentation.scenarios).toHaveLength(2);
    expect(
      rawMeasurement.performancePresentation.inference.rateFps,
    ).toBeGreaterThanOrEqual(15);
    for (const scenario of rawMeasurement.performancePresentation.scenarios) {
      expect(scenario.frameTiming.minimumFps).toBeGreaterThanOrEqual(45);
    }
  });

  it("defines the explicit single-stream performance presentation", () => {
    const boundary = read("app/_components/artifact-boundary.tsx");
    const cameraPanel = read("app/_components/camera-access-panel.tsx");
    const css = read("app/globals.css");
    const graphScene = read("app/_components/graph-scene.tsx");
    const performanceRoute = read("app/perform/page.tsx");

    expect(performanceRoute).toContain("<ArtifactBoundary performanceMode />");
    expect(boundary).toContain('get("fixture") === "camera-free"');
    expect(graphScene).toContain("data-presentation={");
    expect(graphScene).toContain('type: "TOGGLE_LAYER"');
    expect(cameraPanel).toContain("performance-camera-layer__video");
    expect(cameraPanel).toContain("Camera stays off until you enable it");
    expect(cameraPanel).toContain("watchCameraStreamEnded");
    expect(cameraPanel).toContain("pageVisibleRef.current");
    expect(cameraPanel).toContain('router.push("/demo")');
    expect(css).toContain(
      '.scene-shell[data-presentation="performance"] .scene-canvas',
    );
    expect(css).toContain("--performance-video-opacity");
    expect(css).toContain("prefers-reduced-motion: reduce");
  });

  it("documents topology keyboard controls", () => {
    const controls = readRoot("docs/interaction-controls.md");

    expect(controls).toMatch(/\| `1` \| semantic\s+\|/);
    expect(controls).toMatch(/\| `2` \| communities\s+\|/);
    expect(controls).toMatch(/\| `3` \| temporal\s+\|/);
    expect(controls).toMatch(/\| `4` \| force\s+\|/);
    expect(controls).toContain("`Escape`");
  });

  it("documents the local hand-tracking worker contract", () => {
    const workerContract = readRoot("docs/hand-tracking-worker.md");

    expect(workerContract).toContain("hand.worker.ts");
    expect(workerContract).toContain("/models/hand_landmarker");
    expect(workerContract).toContain("15–30 FPS");
    expect(workerContract).toContain("never uploaded");
  });

  it("keeps the complete setup, privacy, architecture, and recovery guide current", () => {
    const guide = readRoot("docs/project-guide.md");
    const makefile = readRoot("Makefile");
    const readme = readRoot("README.md");

    for (const command of [
      "make install",
      "make build-graph",
      "make dev",
      "make test",
      "make test-e2e",
      "make lint",
      "make typecheck",
      "make format-check",
      "make build",
    ]) {
      expect(`${readme}\n${guide}`).toContain(command);
    }

    expect(makefile).toContain(
      "sync --extra embeddings --extra layouts --all-groups --locked",
    );
    expect(guide).toContain("There is no application backend in the MVP");
    expect(guide).toContain(
      "live hand input share the graph interaction state",
    );
    expect(guide).toContain("private-notes/");
    expect(guide).toContain("Camera permission or device failure");
    expect(guide).toContain("Hand model or WASM fails to load");
    expect(guide).toContain("The scene reports medium or low quality");
    expect(guide).toContain("diagrams/gesture-input.svg");
    expect(readme).toContain(
      "performance-measurements/2026-07-18-m2-pro-chromium.json",
    );
    expect(readme).toContain(
      "https://syedbaqarabbas.github.io/touch-traversal/",
    );
    expect(guide).not.toContain("live landmark frames are not yet connected");
    expect(guide).not.toContain("live classified gestures do not yet dispatch");
  });

  it("publishes a sanitized, captioned portfolio media set", () => {
    const mediaGuide = readRoot("docs/portfolio-media.md");
    const readme = readRoot("README.md");
    const stills = [
      "overview.webp",
      "focused-thought.webp",
      "traversal.webp",
      "temporal-topology.webp",
      "calibration.webp",
    ];

    for (const filename of stills) {
      expect(mediaGuide).toContain(`assets/portfolio/${filename}`);
      expect(
        statRoot(`docs/assets/portfolio/${filename}`).size,
      ).toBeGreaterThan(20_000);
      expect(statRoot(`docs/assets/portfolio/${filename}`).size).toBeLessThan(
        150_000,
      );
    }

    expect(mediaGuide).toMatch(/Camera\s+permission stayed off/);
    expect(mediaGuide).toContain("fictional public sample");
    expect(mediaGuide).toContain("silent 26.52-second WebM");
    expect(readme).toContain("touch-traversal-demo.gif");
    expect(readme).toContain("touch-traversal-demo.webm");
    expect(
      statRoot("docs/assets/portfolio/touch-traversal-demo.gif").size,
    ).toBeLessThan(500_000);
    expect(
      statRoot("docs/assets/portfolio/touch-traversal-demo.webm").size,
    ).toBeLessThan(5_000_000);
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
