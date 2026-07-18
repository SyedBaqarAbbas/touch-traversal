import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const panelSource = readFileSync(
  new URL("../../app/_components/camera-access-panel.tsx", import.meta.url),
  "utf8",
);

describe("camera access panel output contract", () => {
  it("keeps camera outputs optional for standalone panel use", () => {
    expect(panelSource).toContain("export type CameraAccessPanelProps");
    expect(panelSource).toContain("compact?: boolean");
    expect(panelSource).toContain(
      "onCursorFrame?: (frame: HandCursorFrame | null) => void",
    );
    expect(panelSource).toContain(
      "onLandmarkFrame?: (frame: TimestampedLandmarkFrame) => void",
    );
    expect(panelSource).toContain(
      "performance?: PerformanceCameraPresentation",
    );
    expect(panelSource).toContain("}: CameraAccessPanelProps = {})");
  });

  it("publishes interpolated cursor and timestamped landmark frames", () => {
    expect(panelSource).toContain("onCursorFrameRef.current?.(displayFrame)");
    expect(panelSource).toContain(
      "onLandmarkFrameRef.current?.(update.landmarkFrame)",
    );
  });

  it("owns one stream across performance-layer changes and releases it", () => {
    expect(panelSource).toContain("performance-camera-layer__video");
    expect(panelSource).toContain("stopCameraStream(streamRef.current)");
    expect(panelSource).toContain("watchCameraStreamEnded(stream");
    expect(panelSource).toContain("controller.setTargetFps");
    expect(panelSource).toContain('router.push("/demo")');
  });
});
