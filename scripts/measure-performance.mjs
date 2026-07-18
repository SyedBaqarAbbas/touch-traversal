#!/usr/bin/env node

import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { arch, cpus, platform, release, totalmem } from "node:os";

const requireFromWeb = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
);
const { chromium } = requireFromWeb("@playwright/test");

const targetUrl = (
  process.env.PERF_TARGET_URL ?? "http://127.0.0.1:3000"
).replace(/\/$/, "");
const scenarioDurationMs = numberFromEnvironment(
  "PERF_SCENARIO_DURATION_MS",
  2_500,
);
const workerDurationMs = numberFromEnvironment(
  "PERF_WORKER_DURATION_MS",
  8_000,
);

const browser = await chromium.launch({
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
  ],
  headless: false,
});

try {
  const context = await browser.newContext({
    permissions: ["camera"],
    viewport: { height: 900, width: 1440 },
  });
  const page = await context.newPage();
  await installWorkerMeasurements(page);
  await page.goto(`${targetUrl}/demo?input=mouse`, {
    waitUntil: "networkidle",
  });
  await page.locator(".scene-shell canvas").waitFor();

  const environment = await page.evaluate(async () => {
    const graph = await fetch("/data/graph.json").then((response) =>
      response.json(),
    );
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    const debugInfo = gl?.getExtension("WEBGL_debug_renderer_info");
    const renderer =
      gl && debugInfo
        ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
        : "unavailable";

    return {
      browserUserAgent: navigator.userAgent,
      devicePixelRatio: window.devicePixelRatio,
      hardwareConcurrency: navigator.hardwareConcurrency,
      renderer,
      sampleGraph: {
        edgeCount: Array.isArray(graph.edges) ? graph.edges.length : null,
        nodeCount: Array.isArray(graph.nodes) ? graph.nodes.length : null,
      },
      viewport: {
        height: window.innerHeight,
        width: window.innerWidth,
      },
    };
  });
  environment.sampleGraph.quality = qualityName(
    environment.sampleGraph.nodeCount,
    environment.sampleGraph.edgeCount,
  );

  const sceneScaleProbes = await page.evaluate(
    async ({ durationMs }) => {
      const definitions = [
        ["overview", 100, 400],
        ["focus", 100, 400],
        ["morph", 100, 400],
        ["hand-tracking", 100, 400],
        ["overview", 300, 1500],
        ["focus", 300, 1500],
        ["morph", 300, 1500],
        ["hand-tracking", 300, 1500],
      ];

      const results = [];
      for (const [mode, nodeCount, edgeCount] of definitions) {
        const quality = chooseQuality(nodeCount, edgeCount);
        const visibleEdgeCount = Math.min(edgeCount, quality.maxVisibleEdges);
        const workload = createWorkload(mode, nodeCount, visibleEdgeCount);

        await runFrames(workload, 500);
        const measurement = await runFrames(workload, durationMs);
        results.push({
          edgeCount,
          id: `${mode}-${nodeCount}-${edgeCount}`,
          mode,
          nodeCount,
          processedEdgeCount: visibleEdgeCount,
          quality: quality.name,
          ...measurement,
        });
      }
      return results;

      function chooseQuality(nodeCount, edgeCount) {
        if (edgeCount > 1200 || nodeCount > 260) {
          return { maxVisibleEdges: 900, name: "low" };
        }
        if (edgeCount > 700 || nodeCount > 160) {
          return { maxVisibleEdges: 1200, name: "medium" };
        }
        return { maxVisibleEdges: Number.POSITIVE_INFINITY, name: "high" };
      }

      function createWorkload(mode, nodeCount, edgeCount) {
        const source = new Float64Array(nodeCount * 3);
        const target = new Float64Array(nodeCount * 3);
        const current = new Float64Array(nodeCount * 3);
        const edgeSources = new Uint16Array(edgeCount);
        const edgeTargets = new Uint16Array(edgeCount);
        const landmarks = new Float64Array(21 * 3);
        let elapsedMs = 0;

        for (let index = 0; index < nodeCount; index += 1) {
          const offset = index * 3;
          const angle = (index / Math.max(1, nodeCount)) * Math.PI * 2;
          source[offset] = Math.cos(angle) * 4;
          source[offset + 1] = Math.sin(angle) * 4;
          source[offset + 2] = Math.sin(angle * 3) * 0.8;
          target[offset] = Math.cos(angle * 2.1) * 3.6;
          target[offset + 1] = Math.sin(angle * 1.7) * 3.6;
          target[offset + 2] = Math.cos(angle * 4) * 1.2;
        }
        for (let index = 0; index < edgeCount; index += 1) {
          edgeSources[index] = index % nodeCount;
          edgeTargets[index] = (index * 17 + 7) % nodeCount;
        }
        for (let index = 0; index < landmarks.length; index += 1) {
          landmarks[index] = (index % 7) / 7;
        }

        return (deltaMs) => {
          elapsedMs += deltaMs;
          const morphProgress = (Math.sin(elapsedMs / 760) + 1) / 2;
          let checksum = 0;

          for (let index = 0; index < nodeCount; index += 1) {
            const offset = index * 3;
            if (mode === "morph") {
              current[offset] =
                source[offset] +
                (target[offset] - source[offset]) * morphProgress;
              current[offset + 1] =
                source[offset + 1] +
                (target[offset + 1] - source[offset + 1]) * morphProgress;
              current[offset + 2] =
                source[offset + 2] +
                (target[offset + 2] - source[offset + 2]) * morphProgress;
            } else {
              current[offset] = source[offset];
              current[offset + 1] = source[offset + 1];
              current[offset + 2] = source[offset + 2];
            }

            if (mode === "focus") {
              const distance = Math.hypot(
                current[offset] - current[0],
                current[offset + 1] - current[1],
                current[offset + 2] - current[2],
              );
              checksum += distance < 2.5 ? 1.18 : 0.42;
            } else {
              checksum += current[offset] * 0.001;
            }
          }

          for (let index = 0; index < edgeCount; index += 1) {
            const sourceOffset = edgeSources[index] * 3;
            const targetOffset = edgeTargets[index] * 3;
            checksum += Math.hypot(
              current[targetOffset] - current[sourceOffset],
              current[targetOffset + 1] - current[sourceOffset + 1],
              current[targetOffset + 2] - current[sourceOffset + 2],
            );
          }

          if (mode === "hand-tracking") {
            for (let index = 0; index < landmarks.length; index += 3) {
              landmarks[index] = landmarks[index] * 0.72 + morphProgress * 0.28;
              landmarks[index + 1] =
                landmarks[index + 1] * 0.72 + (1 - morphProgress) * 0.28;
              checksum += Math.hypot(
                landmarks[index] - landmarks[24],
                landmarks[index + 1] - landmarks[25],
              );
            }
          }

          return checksum;
        };
      }

      async function runFrames(workload, requestedDurationMs) {
        const frameDurationsMs = [];
        const workloadDurationsMs = [];
        let checksum = 0;
        let previousFrameAtMs = null;
        const startedAtMs = performance.now();
        while (performance.now() - startedAtMs < requestedDurationMs) {
          const frameAtMs = await new Promise(requestAnimationFrame);
          if (previousFrameAtMs !== null) {
            frameDurationsMs.push(frameAtMs - previousFrameAtMs);
          }
          const workStartedAtMs = performance.now();
          checksum += workload(
            previousFrameAtMs === null ? 0 : frameAtMs - previousFrameAtMs,
          );
          workloadDurationsMs.push(performance.now() - workStartedAtMs);
          previousFrameAtMs = frameAtMs;
        }
        return {
          checksum: round(checksum, 3),
          durationMs: round(performance.now() - startedAtMs, 1),
          frameCount: frameDurationsMs.length + 1,
          frameTiming: summarize(frameDurationsMs),
          workloadTiming: summarize(workloadDurationsMs),
        };
      }

      function summarize(values) {
        const sorted = [...values].sort((left, right) => left - right);
        const average =
          values.reduce((sum, value) => sum + value, 0) /
          Math.max(1, values.length);
        const p95 =
          sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
        const maximum = sorted.at(-1) ?? 0;
        return {
          averageFps: round(1000 / Math.max(average, 0.001), 1),
          averageMs: round(average, 2),
          maximumMs: round(maximum, 2),
          minimumFps: round(1000 / Math.max(maximum, 0.001), 1),
          p95Ms: round(p95, 2),
          sampleCount: values.length,
        };
      }

      function round(value, digits) {
        const multiplier = 10 ** digits;
        return Math.round(value * multiplier) / multiplier;
      }
    },
    { durationMs: scenarioDurationMs },
  );

  let handWorker = await measureHandWorker(page, workerDurationMs);
  if (
    !handWorker.ready &&
    "error" in handWorker &&
    handWorker.error.includes("Execution context was destroyed")
  ) {
    await page.goto(`${targetUrl}/demo?input=mouse`, {
      waitUntil: "networkidle",
    });
    await page.locator(".scene-shell canvas").waitFor();
    handWorker = await measureHandWorker(page, workerDurationMs);
  }
  const performancePresentation = await measurePerformancePresentation(
    page,
    targetUrl,
    scenarioDurationMs,
  );
  const macHardware = readMacHardware();
  const output = {
    benchmark: {
      cameraRequest: {
        audio: false,
        video: {
          facingMode: "user",
          idealHeight: 480,
          idealWidth: 640,
        },
      },
      cameraSource: "Chromium privacy-safe synthetic video device",
      chromiumFlags: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
      ],
      route: "/demo?input=mouse",
      scenarioDurationMs,
      targetUrl,
      workerDurationMs,
    },
    browserVersion: browser.version(),
    capturedAt: new Date().toISOString(),
    environment,
    handWorker,
    host: {
      architecture: arch(),
      cpu: cpus()[0]?.model ?? "unavailable",
      deviceName: macHardware?.deviceName ?? null,
      gpu: macHardware?.gpu ?? null,
      gpuCores: macHardware?.gpuCores ?? null,
      hardwareModel: commandOutput("/usr/sbin/sysctl", ["-n", "hw.model"]),
      logicalCores: cpus().length,
      memoryGiB: round(totalmem() / 1024 ** 3, 1),
      operatingSystem: `${platform()} ${release()}`,
    },
    notes: [
      "Scene scale probes add deterministic JavaScript position, focus, edge, morph, and landmark work while the checked-in sample WebGL scene remains active.",
      "Scale probes do not instantiate 100/400 or 300/1500 WebGL objects and are not WebGL draw-call benchmarks.",
      "The 300/1500 probes apply the runtime low-quality visible-edge cap and process 900 edges.",
      "The fake camera contains no recognizable hand; a visible cursor rate is null when MediaPipe returns no landmarks.",
      "The checked-in 16-node/48-edge sample selects the high quality preset.",
      "Performance presentation measurements keep the real visible video layer, sample WebGL graph, and MediaPipe worker active while adding representative synthetic scale work.",
    ],
    performancePresentation,
    sceneScaleProbes,
    schemaVersion: 2,
  };
  const serializedOutput = `${JSON.stringify(output, null, 2)}\n`;
  const outputPath = process.env.PERF_OUTPUT_PATH;
  if (outputPath) {
    if (!outputPath.startsWith("/tmp/")) {
      throw new Error("PERF_OUTPUT_PATH must point inside /tmp/.");
    }
    await writeFile(outputPath, serializedOutput, "utf8");
    process.stdout.write(`Performance data written to ${outputPath}\n`);
  } else {
    process.stdout.write(serializedOutput);
  }
  await context.close();
} finally {
  await browser.close();
}

async function installWorkerMeasurements(page) {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    const measurements = {
      errors: [],
      readyAtMs: [],
      resultArrivalsMs: [],
      resultInferenceMs: [],
      resultSizes: [],
      submissionsMs: [],
    };
    window.__touchTraversalWorkerMeasurements = measurements;

    function MeasuredWorker(...args) {
      const worker = new NativeWorker(...args);
      const nativePostMessage = worker.postMessage.bind(worker);
      worker.postMessage = (message, transfer) => {
        if (message?.type === "FRAME") {
          measurements.submissionsMs.push(performance.now());
        }
        return nativePostMessage(message, transfer ?? []);
      };
      worker.addEventListener("message", (event) => {
        if (event.data?.type === "READY") {
          measurements.readyAtMs.push(performance.now());
        }
        if (event.data?.type === "RESULT") {
          measurements.resultArrivalsMs.push(performance.now());
          measurements.resultInferenceMs.push(event.data.inferenceMs);
          measurements.resultSizes.push({
            handCount: event.data.hands.length,
            height: event.data.height,
            width: event.data.width,
          });
        }
        if (event.data?.type === "ERROR") {
          measurements.errors.push(event.data);
        }
      });
      return worker;
    }

    Object.setPrototypeOf(MeasuredWorker, NativeWorker);
    MeasuredWorker.prototype = NativeWorker.prototype;
    window.Worker = MeasuredWorker;
  });
}

async function measureHandWorker(page, durationMs) {
  const enableButton = page.getByRole("button", { name: "Enable hand camera" });
  try {
    await enableButton.click();
    await page.waitForFunction(
      () => {
        const measurements = window.__touchTraversalWorkerMeasurements;
        return (
          measurements.readyAtMs.length > 0 || measurements.errors.length > 0
        );
      },
      undefined,
      { timeout: 30_000 },
    );

    await page.evaluate(() => {
      const measurements = window.__touchTraversalWorkerMeasurements;
      measurements.resultArrivalsMs.length = 0;
      measurements.resultInferenceMs.length = 0;
      measurements.resultSizes.length = 0;
      measurements.submissionsMs.length = 0;
    });

    const mainThreadRender = await page.evaluate(async (measurementMs) => {
      const frameTimestampsMs = [];
      const cursorVisibleTimestampsMs = [];
      const startedAtMs = performance.now();
      while (performance.now() - startedAtMs < measurementMs) {
        const timestampMs = await new Promise(requestAnimationFrame);
        frameTimestampsMs.push(timestampMs);
        if (document.querySelector(".hand-gesture-cursor")) {
          cursorVisibleTimestampsMs.push(timestampMs);
        }
      }
      return { cursorVisibleTimestampsMs, frameTimestampsMs };
    }, durationMs);

    const workerMeasurements = await page.evaluate(() => ({
      ...window.__touchTraversalWorkerMeasurements,
      camera: (() => {
        const video = document.querySelector(".camera-access-panel__video");
        return video
          ? {
              height: video.videoHeight,
              readyState: video.readyState,
              width: video.videoWidth,
            }
          : null;
      })(),
    }));

    const resultSizes = workerMeasurements.resultSizes;
    const detectedHandFrames = resultSizes.filter(
      (entry) => entry.handCount > 0,
    ).length;
    const cursorTimestamps = mainThreadRender.cursorVisibleTimestampsMs;

    return {
      camera: workerMeasurements.camera,
      cursorRenderFps:
        cursorTimestamps.length > 1 ? averageFps(cursorTimestamps) : null,
      cursorRenderStatus:
        cursorTimestamps.length > 1
          ? "measured from visible hand cursor frames"
          : "not measurable: the synthetic camera produced no recognized hand",
      detectedHandFrames,
      errors: workerMeasurements.errors,
      inference: {
        durationMs,
        rateFps: averageFps(workerMeasurements.resultArrivalsMs),
        resultCount: workerMeasurements.resultArrivalsMs.length,
        timingMs: summarizeValues(workerMeasurements.resultInferenceMs),
      },
      mainThreadRenderFps: averageFps(mainThreadRender.frameTimestampsMs),
      mainThreadRenderFrameCount: mainThreadRender.frameTimestampsMs.length,
      ready: workerMeasurements.readyAtMs.length > 0,
      submittedFrameRateFps: averageFps(workerMeasurements.submissionsMs),
      submittedFrames: workerMeasurements.submissionsMs.length,
      workerFrameSize: resultSizes.at(-1)
        ? {
            height: resultSizes.at(-1).height,
            width: resultSizes.at(-1).width,
          }
        : null,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      ready: false,
    };
  } finally {
    const disableButton = page.getByRole("button", {
      name: "Disable hand camera",
    });
    if (await disableButton.isVisible().catch(() => false)) {
      await disableButton.click();
    }
  }
}

async function measurePerformancePresentation(page, targetUrl, durationMs) {
  await page.goto(`${targetUrl}/perform`, { waitUntil: "networkidle" });
  await page.locator(".scene-shell canvas").waitFor();
  await page.getByRole("button", { name: "Enable hand camera" }).click();
  await page.waitForFunction(
    () => {
      const measurements = window.__touchTraversalWorkerMeasurements;
      return (
        measurements.readyAtMs.length > 0 || measurements.errors.length > 0
      );
    },
    undefined,
    { timeout: 30_000 },
  );
  await page.evaluate(() => {
    const measurements = window.__touchTraversalWorkerMeasurements;
    measurements.resultArrivalsMs.length = 0;
    measurements.resultInferenceMs.length = 0;
    measurements.resultSizes.length = 0;
    measurements.submissionsMs.length = 0;
  });

  const browserResult = await page.evaluate(async (measurementDurationMs) => {
    const definitions = [
      {
        edgeCount: 400,
        nodeCount: 100,
        processedEdgeCount: 400,
        quality: "high",
      },
      {
        edgeCount: 1500,
        nodeCount: 300,
        processedEdgeCount: 900,
        quality: "low",
      },
    ];
    const scenarios = [];

    for (const definition of definitions) {
      const positions = new Float64Array(definition.nodeCount * 3);
      const landmarks = new Float64Array(21 * 3);
      const edgeSources = new Uint16Array(definition.processedEdgeCount);
      const edgeTargets = new Uint16Array(definition.processedEdgeCount);
      for (let index = 0; index < definition.nodeCount; index += 1) {
        const offset = index * 3;
        const angle = (index / definition.nodeCount) * Math.PI * 2;
        positions[offset] = Math.cos(angle) * 4;
        positions[offset + 1] = Math.sin(angle) * 4;
        positions[offset + 2] = Math.sin(angle * 3);
      }
      for (let index = 0; index < definition.processedEdgeCount; index += 1) {
        edgeSources[index] = index % definition.nodeCount;
        edgeTargets[index] = (index * 17 + 7) % definition.nodeCount;
      }

      const frameDurationsMs = [];
      let previousFrameAtMs = null;
      let checksum = 0;
      const startedAtMs = performance.now();
      while (performance.now() - startedAtMs < measurementDurationMs) {
        const frameAtMs = await new Promise(requestAnimationFrame);
        if (previousFrameAtMs !== null) {
          frameDurationsMs.push(frameAtMs - previousFrameAtMs);
        }
        const phase = (Math.sin(frameAtMs / 760) + 1) / 2;
        for (let index = 0; index < definition.processedEdgeCount; index += 1) {
          const sourceOffset = edgeSources[index] * 3;
          const targetOffset = edgeTargets[index] * 3;
          checksum += Math.hypot(
            positions[targetOffset] - positions[sourceOffset],
            positions[targetOffset + 1] - positions[sourceOffset + 1],
            positions[targetOffset + 2] - positions[sourceOffset + 2],
          );
        }
        for (let index = 0; index < landmarks.length; index += 3) {
          landmarks[index] = landmarks[index] * 0.72 + phase * 0.28;
          landmarks[index + 1] =
            landmarks[index + 1] * 0.72 + (1 - phase) * 0.28;
          checksum += landmarks[index] + landmarks[index + 1];
        }
        previousFrameAtMs = frameAtMs;
      }
      scenarios.push({
        ...definition,
        checksum: Math.round(checksum * 1000) / 1000,
        frameTiming: summarizeFrameTimes(frameDurationsMs),
      });
    }

    const cameraLayer = document.querySelector(".performance-camera-layer");
    const video = document.querySelector(".performance-camera-layer__video");
    const canvas = document.querySelector(".scene-canvas");
    return {
      camera: video
        ? { height: video.videoHeight, width: video.videoWidth }
        : null,
      composition: {
        cameraLayerActive: cameraLayer?.getAttribute("data-active"),
        cameraLayerOpacity: cameraLayer
          ? getComputedStyle(cameraLayer).opacity
          : null,
        canvasZIndex: canvas ? getComputedStyle(canvas).zIndex : null,
        mirrored: cameraLayer?.getAttribute("data-mirrored"),
        videoOpacity: video ? getComputedStyle(video).opacity : null,
      },
      scenarios,
    };

    function summarizeFrameTimes(values) {
      const sorted = [...values].sort((left, right) => left - right);
      const average =
        values.reduce((sum, value) => sum + value, 0) /
        Math.max(1, values.length);
      const maximum = sorted.at(-1) ?? 0;
      const p95 = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
      return {
        averageFps: round(1000 / Math.max(average, 0.001), 1),
        averageMs: round(average, 2),
        maximumMs: round(maximum, 2),
        minimumFps: round(1000 / Math.max(maximum, 0.001), 1),
        p95Ms: round(p95, 2),
        sampleCount: values.length,
      };
    }

    function round(value, digits) {
      const multiplier = 10 ** digits;
      return Math.round(value * multiplier) / multiplier;
    }
  }, durationMs);

  const workerMeasurements = await page.evaluate(
    () => window.__touchTraversalWorkerMeasurements,
  );
  const resultSizes = workerMeasurements.resultSizes;
  const output = {
    ...browserResult,
    cursorRenderFps: null,
    cursorRenderStatus:
      "not measurable: the synthetic camera produced no recognized hand",
    inference: {
      rateFps: averageFps(workerMeasurements.resultArrivalsMs),
      resultCount: workerMeasurements.resultArrivalsMs.length,
      timingMs: summarizeValues(workerMeasurements.resultInferenceMs),
    },
    workerFrameSize: resultSizes.at(-1)
      ? {
          height: resultSizes.at(-1).height,
          width: resultSizes.at(-1).width,
        }
      : null,
  };
  await page.getByRole("button", { name: "Disable camera" }).click();
  return output;
}

function summarizeValues(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const average =
    values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  return {
    average: round(average, 2),
    maximum: round(sorted.at(-1) ?? 0, 2),
    p95: round(
      sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0,
      2,
    ),
    sampleCount: values.length,
  };
}

function averageFps(timestampsMs) {
  if (timestampsMs.length < 2) {
    return 0;
  }
  const elapsedMs = timestampsMs.at(-1) - timestampsMs[0];
  return round(((timestampsMs.length - 1) / Math.max(elapsedMs, 1)) * 1000, 1);
}

function numberFromEnvironment(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return value;
}

function qualityName(nodeCount, edgeCount) {
  if (nodeCount == null || edgeCount == null) {
    return "unknown";
  }
  if (edgeCount > 1200 || nodeCount > 260) {
    return "low";
  }
  if (edgeCount > 700 || nodeCount > 160) {
    return "medium";
  }
  return "high";
}

function commandOutput(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function readMacHardware() {
  if (platform() !== "darwin") {
    return null;
  }
  try {
    const profile = JSON.parse(
      execFileSync(
        "/usr/sbin/system_profiler",
        ["-json", "SPHardwareDataType", "SPDisplaysDataType"],
        { encoding: "utf8" },
      ),
    );
    const hardware = profile.SPHardwareDataType?.[0];
    const display = profile.SPDisplaysDataType?.[0];
    return {
      deviceName: hardware?.machine_name ?? null,
      gpu: display?.sppci_model ?? null,
      gpuCores: Number(display?.sppci_cores) || null,
    };
  } catch {
    return null;
  }
}

function round(value, digits) {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}
