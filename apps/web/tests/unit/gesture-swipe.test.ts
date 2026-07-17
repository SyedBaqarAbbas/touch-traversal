import { describe, expect, it } from "vitest";

import rawFixtures from "../fixtures/gesture-fixtures.json";
import {
  expandGestureFixtures,
  findGestureFixture,
  type GestureFixtureFile,
  type TimestampedLandmarkFrame,
} from "../../lib/gesture-classifier";
import {
  createSwipeState,
  runSwipeRecognition,
  updateSwipeRecognition,
} from "../../lib/gesture-swipe";

const fixtures = expandGestureFixtures(
  rawFixtures as unknown as GestureFixtureFile,
);

const safeContext = {
  pinchActive: false,
  topologyMorphing: false,
};

describe("gesture swipe", () => {
  it("recognizes left and right swipes in mirrored preview coordinates", () => {
    const leftEvents = runSwipeRecognition(
      findGestureFixture(fixtures, "left-swipe").frames,
      safeContext,
    );
    const rightEvents = runSwipeRecognition(
      findGestureFixture(fixtures, "right-swipe").frames,
      safeContext,
    );

    expect(leftEvents).toHaveLength(1);
    expect(leftEvents[0]?.direction).toBe("left");
    expect(leftEvents[0]?.metrics.displacement).toBeLessThan(0);
    expect(rightEvents).toHaveLength(1);
    expect(rightEvents[0]?.direction).toBe("right");
    expect(rightEvents[0]?.metrics.displacement).toBeGreaterThan(0);
  });

  it("requires enough distance, speed, and direction stability", () => {
    expect(
      runSwipeRecognition(
        findGestureFixture(fixtures, "idle").frames,
        safeContext,
      ),
    ).toHaveLength(0);
    expect(
      runSwipeRecognition(
        findGestureFixture(fixtures, "noisy-pinch").frames,
        safeContext,
      ),
    ).toHaveLength(0);
  });

  it("blocks recognition during pinch and topology morphing", () => {
    const frames = findGestureFixture(fixtures, "right-swipe").frames;

    expect(
      runSwipeRecognition(frames, {
        pinchActive: true,
        topologyMorphing: false,
      }),
    ).toHaveLength(0);
    expect(
      runSwipeRecognition(frames, {
        pinchActive: false,
        topologyMorphing: true,
      }),
    ).toHaveLength(0);
  });

  it("applies the initial cooldown after recognition", () => {
    const frames = [
      ...findGestureFixture(fixtures, "right-swipe").frames,
      ...retime(findGestureFixture(fixtures, "right-swipe").frames, 360),
    ];

    expect(runSwipeRecognition(frames, safeContext)).toHaveLength(1);
  });

  it("resets the sample window when a hand is lost", () => {
    let state = createSwipeState();
    const frames = findGestureFixture(fixtures, "right-swipe").frames;
    state = updateSwipeRecognition(state, frames[0]!, safeContext).state;
    expect(state.samples).toHaveLength(1);

    state = updateSwipeRecognition(
      state,
      { hand: null, timestampMs: 80 },
      safeContext,
    ).state;
    expect(state.samples).toHaveLength(0);
  });
});

function retime(
  frames: readonly TimestampedLandmarkFrame[],
  offsetMs: number,
): TimestampedLandmarkFrame[] {
  return frames.map((frame) => ({
    ...frame,
    timestampMs: frame.timestampMs + offsetMs,
  }));
}
