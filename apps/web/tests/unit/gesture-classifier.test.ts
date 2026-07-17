import { describe, expect, it } from "vitest";

import rawFixtures from "../fixtures/gesture-fixtures.json";
import {
  cooldownReady,
  createBooleanDebounceState,
  createGesturePlayback,
  expandGestureFixtures,
  findGestureFixture,
  normalizeClassifierInput,
  palmCenter,
  palmScale,
  poseConfidence,
  updateBooleanDebounce,
  velocityWindow,
  type GestureFixtureFile,
  type GestureFixtureName,
} from "../../lib/gesture-classifier";

const fixtureFile = rawFixtures as unknown as GestureFixtureFile;
const fixtures = expandGestureFixtures(fixtureFile);

describe("gesture classifier primitives", () => {
  it("loads every deterministic gesture fixture from compact JSON", () => {
    const names = fixtures.map((fixture) => fixture.name).sort();
    expect(names).toEqual([
      "hand-loss",
      "idle",
      "left-swipe",
      "noisy-pinch",
      "open-palm",
      "pointing",
      "right-swipe",
      "stable-pinch",
    ] satisfies GestureFixtureName[]);
    expect(JSON.stringify(rawFixtures).length).toBeLessThan(16000);
  });

  it("plays fixtures back deterministically with controllable timing", () => {
    const pointing = findGestureFixture(fixtures, "pointing");
    const playback = createGesturePlayback(pointing, {
      startAtMs: 1000,
      timeScale: 2,
    });

    expect(playback.sample(1000).timestampMs).toBe(0);
    expect(playback.sample(1040).timestampMs).toBe(80);
    expect(playback.sample(1080).timestampMs).toBe(160);
    playback.reset(2000);
    expect(playback.sample(2000).timestampMs).toBe(0);
  });

  it("normalizes classifier input and detects finger extension", () => {
    const pointing = normalizeClassifierInput(
      findGestureFixture(fixtures, "pointing").frames[0]!,
    );
    const openPalm = normalizeClassifierInput(
      findGestureFixture(fixtures, "open-palm").frames[0]!,
    );

    expect(pointing.palmScale).toBeGreaterThan(0);
    expect(pointing.confidence).toBeGreaterThan(0.85);
    expect(pointing.fingers.index.extended).toBe(true);
    expect(pointing.fingers.middle.extended).toBe(false);
    expect(openPalm.fingers.index.extended).toBe(true);
    expect(openPalm.fingers.middle.extended).toBe(true);
    expect(openPalm.fingers.ring.extended).toBe(true);
    expect(openPalm.fingers.pinky.extended).toBe(true);
  });

  it("computes shared palm scale, pose confidence, and mirrored palm centers", () => {
    const frame = findGestureFixture(fixtures, "stable-pinch").frames[0]!;
    expect(frame.hand).not.toBeNull();
    const hand = frame.hand!;

    expect(palmScale(hand)).toBeGreaterThan(0.1);
    expect(poseConfidence(hand)).toBeCloseTo(0.9);
    expect(palmCenter(hand)?.x).toBeLessThan(0.2);
  });

  it("computes velocity windows from timestamped points", () => {
    const leftSwipe = findGestureFixture(fixtures, "left-swipe")
      .frames.map((frame) =>
        frame.hand
          ? { point: palmCenter(frame.hand), timestampMs: frame.timestampMs }
          : null,
      )
      .filter(
        (
          sample,
        ): sample is { point: { x: number; y: number }; timestampMs: number } =>
          sample?.point != null,
      );
    const rightSwipe = findGestureFixture(fixtures, "right-swipe")
      .frames.map((frame) =>
        frame.hand
          ? { point: palmCenter(frame.hand), timestampMs: frame.timestampMs }
          : null,
      )
      .filter(
        (
          sample,
        ): sample is { point: { x: number; y: number }; timestampMs: number } =>
          sample?.point != null,
      );

    expect(velocityWindow(leftSwipe, 220).x).toBeGreaterThan(0);
    expect(velocityWindow(rightSwipe, 220).x).toBeLessThan(0);
  });

  it("debounces booleans and enforces cooldown windows", () => {
    let debounce = createBooleanDebounceState(false, 0);
    debounce = updateBooleanDebounce(debounce, true, 40, 120);
    expect(debounce.value).toBe(false);
    debounce = updateBooleanDebounce(debounce, true, 180, 120);
    expect(debounce.value).toBe(true);

    expect(
      cooldownReady({
        cooldownMs: 900,
        lastTriggeredAtMs: null,
        nowMs: 1000,
      }),
    ).toBe(true);
    expect(
      cooldownReady({
        cooldownMs: 900,
        lastTriggeredAtMs: 1000,
        nowMs: 1500,
      }),
    ).toBe(false);
    expect(
      cooldownReady({
        cooldownMs: 900,
        lastTriggeredAtMs: 1000,
        nowMs: 1900,
      }),
    ).toBe(true);
  });
});
