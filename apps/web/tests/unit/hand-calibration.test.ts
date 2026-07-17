import { describe, expect, it } from "vitest";

import {
  HAND_CALIBRATION_STORAGE_KEY,
  buildHandCalibrationSteps,
  createInjectedCalibrationHand,
  defaultHandCalibrationSettings,
  loadHandCalibrationSettings,
  resetHandCalibrationSettings,
  saveHandCalibrationSettings,
  summarizeCalibrationHand,
} from "../../lib/hand-calibration";

describe("hand calibration", () => {
  it("loads and validates stored versioned settings", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      HAND_CALIBRATION_STORAGE_KEY,
      JSON.stringify({
        confidenceFloor: 0.62,
        cursorSmoothingMs: 64,
        mirrored: false,
        pinchClosedDistance: 0.34,
        pinchOpenDistance: 0.86,
        version: 1,
      }),
    );

    expect(loadHandCalibrationSettings(storage)).toMatchObject({
      confidenceFloor: 0.62,
      cursorSmoothingMs: 64,
      mirrored: false,
      pinchClosedDistance: 0.34,
      pinchOpenDistance: 0.86,
      version: 1,
    });
  });

  it("falls back when stored settings are invalid or from another version", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      HAND_CALIBRATION_STORAGE_KEY,
      JSON.stringify({
        confidenceFloor: "high",
        pinchClosedDistance: 2,
        pinchOpenDistance: 0.1,
        version: 99,
      }),
    );

    expect(loadHandCalibrationSettings(storage)).toEqual(
      defaultHandCalibrationSettings,
    );
  });

  it("saves sanitized settings and reset removes localStorage data", () => {
    const storage = new MemoryStorage();
    saveHandCalibrationSettings(storage, {
      ...defaultHandCalibrationSettings,
      confidenceFloor: 0.74,
      pinchClosedDistance: 0.4,
    });

    expect(loadHandCalibrationSettings(storage).confidenceFloor).toBe(0.74);
    expect(resetHandCalibrationSettings(storage)).toEqual(
      defaultHandCalibrationSettings,
    );
    expect(storage.getItem(HAND_CALIBRATION_STORAGE_KEY)).toBeNull();
  });

  it("blocks calibration steps after denied camera access", () => {
    expect(
      buildHandCalibrationSteps({
        cameraStatus: "denied",
        settings: defaultHandCalibrationSettings,
        signal: null,
      }).map((step) => step.state),
    ).toEqual(["blocked", "blocked", "blocked"]);
  });

  it("summarizes injected landmark data for debug and calibration routes", () => {
    const summary = summarizeCalibrationHand({
      hand: createInjectedCalibrationHand(),
      nowMs: 1000,
      settings: defaultHandCalibrationSettings,
    });

    expect(summary?.confidence).toBeCloseTo(0.86);
    expect(summary?.cursorLeft).toMatch(/%$/);
    expect(summary?.cursorTop).toMatch(/%$/);
    expect(summary?.pinchProgress).toBeGreaterThanOrEqual(0);
    expect(summary?.pinchProgress).toBeLessThanOrEqual(1);
    expect(summary?.signal.fingertip.x).toBeLessThan(0);
  });
});

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}
