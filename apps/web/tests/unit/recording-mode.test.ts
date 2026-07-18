import { describe, expect, it } from "vitest";

import {
  RECORDING_MODE_AUDIO_ENABLED,
  RECORDING_MODE_DURATION_MS,
  recordingBeatAt,
  recordingBeats,
  recordingModeEnabled,
} from "../../lib/recording-mode";

describe("recording mode", () => {
  it("fits the complete deterministic story inside a 45 second take", () => {
    expect(RECORDING_MODE_DURATION_MS).toBeLessThan(45_000);
    expect(RECORDING_MODE_DURATION_MS).toBeLessThanOrEqual(25_000);
    expect(recordingBeats.map((beat) => beat.name)).toEqual([
      "reveal",
      "hand-acquisition",
      "select",
      "traverse",
      "topology-morph",
      "closing",
    ]);
    expect(recordingBeats.at(-1)?.atMs).toBeLessThan(
      RECORDING_MODE_DURATION_MS,
    );
  });

  it("resolves a stable active beat at every point in the take", () => {
    expect(recordingBeatAt(-1).name).toBe("reveal");
    expect(recordingBeatAt(5_999).name).toBe("hand-acquisition");
    expect(recordingBeatAt(6_000).name).toBe("select");
    expect(recordingBeatAt(24_999).name).toBe("closing");
  });

  it("requires an explicit query flag and leaves audio off", () => {
    expect(recordingModeEnabled("?recording=1")).toBe(true);
    expect(recordingModeEnabled("?recording=true&input=mouse")).toBe(true);
    expect(recordingModeEnabled("?recording=0")).toBe(false);
    expect(recordingModeEnabled("")).toBe(false);
    expect(RECORDING_MODE_AUDIO_ENABLED).toBe(false);
  });
});
